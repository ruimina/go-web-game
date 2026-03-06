import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  createGameState,
  normalizePointList,
  playMove,
  passTurn,
  resignGame,
  STONE
} from "./shared/go-rules.js";
import {
  XQ_TEAM,
  createXiangqiGameState,
  moveXiangqi,
  resignXiangqi,
  collectFuPoints
} from "./shared/xiangqi-rules.js";

const GAME = Object.freeze({
  GO: "go",
  XIANGQI: "xiangqi"
});

const RECONNECT_TIMEOUT_MS = 60000; // 60秒重连窗口

function normalizeBasePath(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw === "/") return "";
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  return normalized.replace(/\/+$/, "");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const rooms = new Map();
const PORT = Number(process.env.PORT ?? 3001);
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH ?? "/games/go");
const STATIC_PATH = BASE_PATH || "/";
const SHARED_PATH = BASE_PATH ? `${BASE_PATH}/shared` : "/shared";
const WS_PATH = `${BASE_PATH}/ws`;

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

app.use(STATIC_PATH, express.static(path.join(__dirname, "public")));
app.use(SHARED_PATH, express.static(path.join(__dirname, "shared")));

if (BASE_PATH) {
  app.get(BASE_PATH, (_req, res) => {
    res.redirect(302, `${BASE_PATH}/`);
  });
}

app.get(BASE_PATH ? `${BASE_PATH}/health` : "/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, basePath: BASE_PATH || "/" });
});

if (BASE_PATH) {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, basePath: BASE_PATH || "/" });
  });
}

app.get("/", (_req, res) => {
  if (BASE_PATH) {
    res.redirect(302, `${BASE_PATH}/`);
    return;
  }
  res.json({ ok: true, rooms: rooms.size });
});

function emit(ws, type, payload = {}) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload = {}) {
  for (const client of room.clients.values()) {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      emit(client.ws, type, payload);
    }
  }
}

function sidesForGame(gameType) {
  if (gameType === GAME.XIANGQI) {
    return { first: XQ_TEAM.RED, second: XQ_TEAM.BLACK };
  }
  return { first: STONE.BLACK, second: STONE.WHITE };
}

function isRoomReadyToStart(room) {
  const { first, second } = sidesForGame(room.gameType);
  const firstClient = room.clients.get(first);
  const secondClient = room.clients.get(second);
  // 至少有一个在线才算准备好
  return (firstClient && firstClient.connected) || (secondClient && secondClient.connected);
}

function broadcastState(room) {
  broadcast(room, "state_update", {
    gameType: room.gameType,
    state: room.state,
    room: roomPublicInfo(room)
  });
}

function broadcastGameEnd(room) {
  broadcast(room, "game_end", {
    gameType: room.gameType,
    roomId: room.id,
    winner: room.state.winner ?? null,
    resignedBy: room.state.resignedBy ?? null,
    state: room.state
  });
}

function roomPublicInfo(room) {
  const { first, second } = sidesForGame(room.gameType);
  const firstClient = room.clients.get(first);
  const secondClient = room.clients.get(second);
  return {
    id: room.id,
    gameType: room.gameType,
    players: Array.from(room.clients.keys()),
    redReady: firstClient ? firstClient.connected : false,
    blackReady: secondClient ? secondClient.connected : false,
    disconnectedPlayers: Array.from(room.clients.entries())
      .filter(([_, c]) => !c.connected)
      .map(([color, _]) => color)
  };
}

function randomRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function sanitizeGoConfig(inputConfig = {}) {
  const size = Math.max(5, Math.min(25, Number(inputConfig.size) || 19));
  const komi = Number.isFinite(Number(inputConfig.komi)) ? Number(inputConfig.komi) : 7.5;
  const blockedPoints = normalizePointList(inputConfig.blockedPoints ?? [], size);
  const mapName = typeof inputConfig.mapName === "string" ? inputConfig.mapName.slice(0, 60) : "";
  return { size, komi, blockedPoints, mapName };
}

function sanitizeXiangqiConfig(inputConfig = {}) {
  const mapName = typeof inputConfig.mapName === "string" ? inputConfig.mapName.slice(0, 60) : "";
  const state = createXiangqiGameState({ fuPoints: inputConfig.fuPoints ?? [] });
  const fuPoints = collectFuPoints(state.board);
  return { mapName, fuPoints };
}

function buildRoomSetup(gameType, rawConfig = {}) {
  if (gameType === GAME.XIANGQI) {
    const config = sanitizeXiangqiConfig(rawConfig);
    return {
      gameType,
      config,
      state: createXiangqiGameState(config)
    };
  }
  const config = sanitizeGoConfig(rawConfig);
  return {
    gameType: GAME.GO,
    config,
    state: createGameState(config)
  };
}

function getRoomByClient(ws) {
  const roomId = ws.meta?.roomId;
  if (!roomId) return null;
  return rooms.get(roomId) ?? null;
}

function setClientDisconnected(room, color) {
  const client = room.clients.get(color);
  if (!client) return;
  
  client.connected = false;
  client.ws = null;
  
  // 设置重连超时
  if (client.reconnectTimer) {
    clearTimeout(client.reconnectTimer);
  }
  
  client.reconnectTimer = setTimeout(() => {
    // 超时后真正移除玩家
    const currentClient = room.clients.get(color);
    if (currentClient && !currentClient.connected) {
      room.clients.delete(color);
      broadcast(room, "player_timeout", { 
        color, 
        message: `${color === STONE.BLACK ? '黑方' : color === STONE.WHITE ? '白方' : color} 超时离线`
      });
      
      // 如果房间空了，删除房间
      if (room.clients.size === 0) {
        rooms.delete(room.id);
      } else {
        broadcast(room, "room_info", { room: roomPublicInfo(room) });
      }
    }
  }, RECONNECT_TIMEOUT_MS);
  
  broadcast(room, "player_disconnected", { 
    color, 
    reconnectWindow: RECONNECT_TIMEOUT_MS / 1000,
    message: `${color === STONE.BLACK ? '黑方' : color === STONE.WHITE ? '白方' : color === XQ_TEAM.RED ? '红方' : '黑方'} 断线，等待重连...`
  });
  broadcast(room, "room_info", { room: roomPublicInfo(room) });
}

function handleReconnect(ws, roomId, color) {
  const room = rooms.get(roomId);
  if (!room) {
    emit(ws, "error", { message: "房间已不存在" });
    return false;
  }
  
  const client = room.clients.get(color);
  if (!client) {
    emit(ws, "error", { message: "该玩家不在房间中" });
    return false;
  }
  
  // 清除重连计时器
  if (client.reconnectTimer) {
    clearTimeout(client.reconnectTimer);
    client.reconnectTimer = null;
  }
  
  // 恢复连接
  client.connected = true;
  client.ws = ws;
  ws.meta = { roomId, color };
  
  emit(ws, "reconnected", {
    roomId,
    gameType: room.gameType,
    color,
    config: room.config,
    state: room.state,
    room: roomPublicInfo(room)
  });
  
  broadcast(room, "player_reconnected", { 
    color,
    message: `${color === STONE.BLACK ? '黑方' : color === STONE.WHITE ? '白方' : color === XQ_TEAM.RED ? '红方' : '黑方'} 已重连`
  });
  broadcast(room, "room_info", { room: roomPublicInfo(room) });
  
  return true;
}

function leaveCurrentRoom(ws) {
  const room = getRoomByClient(ws);
  if (!room) {
    ws.meta = { roomId: null, color: null };
    return;
  }

  const color = ws.meta?.color;
  if (color) {
    const client = room.clients.get(color);
    if (client) {
      // 如果在游戏中，标记为断线而不是直接移除
      if (room.state && !room.state.gameOver && room.clients.size > 1) {
        setClientDisconnected(room, color);
      } else {
        // 游戏结束或只有一人，直接移除
        room.clients.delete(color);
        if (client.reconnectTimer) {
          clearTimeout(client.reconnectTimer);
        }
      }
    }
  }
  
  ws.meta = { roomId: null, color: null };

  if (room.clients.size === 0) {
    rooms.delete(room.id);
    return;
  }
  broadcast(room, "room_info", { room: roomPublicInfo(room) });
}

function handleCreateRoom(ws, payload) {
  if (getRoomByClient(ws)) {
    emit(ws, "error", { message: "请先离开当前房间" });
    return;
  }

  const reqGameType = payload?.gameType === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO;
  const setup = buildRoomSetup(reqGameType, payload?.config ?? {});

  let roomId = randomRoomId();
  while (rooms.has(roomId)) roomId = randomRoomId();

  const color = setup.gameType === GAME.XIANGQI ? XQ_TEAM.RED : STONE.BLACK;
  const room = {
    id: roomId,
    gameType: setup.gameType,
    config: setup.config,
    state: setup.state,
    clients: new Map([[color, { ws, connected: true, reconnectTimer: null }]])
  };

  ws.meta = { roomId, color };
  rooms.set(roomId, room);

  emit(ws, "room_created", {
    roomId,
    gameType: room.gameType,
    color: color,
    config: room.config,
    state: room.state,
    room: roomPublicInfo(room)
  });
}

function handleJoinRoom(ws, payload) {
  if (getRoomByClient(ws)) {
    emit(ws, "error", { message: "请先离开当前房间" });
    return;
  }

  const roomId = String(payload?.roomId ?? "").trim().toUpperCase();
  const room = rooms.get(roomId);
  if (!room) {
    emit(ws, "error", { message: "房间不存在" });
    return;
  }

  const { first, second } = sidesForGame(room.gameType);

  // 检查是否是断线重连
  const reconnectColor = payload?.reconnectColor;
  if (reconnectColor) {
    const client = room.clients.get(reconnectColor);
    if (client && !client.connected) {
      handleReconnect(ws, roomId, reconnectColor);
      return;
    }
  }

  // 检查是否有断线的玩家可以接替
  const firstClient = room.clients.get(first);
  const secondClient = room.clients.get(second);
  
  // 如果有断线的玩家，可以重连
  if (firstClient && !firstClient.connected && !payload?.forceNew) {
    handleReconnect(ws, roomId, first);
    return;
  }
  if (secondClient && !secondClient.connected && !payload?.forceNew) {
    handleReconnect(ws, roomId, second);
    return;
  }

  // 检查房间是否已满（两个在线玩家）
  const onlineCount = [firstClient, secondClient].filter(c => c && c.connected).length;
  if (onlineCount >= 2) {
    emit(ws, "error", { message: "房间已满" });
    return;
  }

  // 新玩家加入
  const color = (firstClient && firstClient.connected) ? second : first;
  
  // 如果该位置有断线玩家，先清除
  if (room.clients.has(color)) {
    const oldClient = room.clients.get(color);
    if (oldClient.reconnectTimer) {
      clearTimeout(oldClient.reconnectTimer);
    }
  }
  
  room.clients.set(color, { ws, connected: true, reconnectTimer: null });
  ws.meta = { roomId, color };

  emit(ws, "joined_room", {
    roomId,
    gameType: room.gameType,
    color,
    config: room.config,
    state: room.state,
    room: roomPublicInfo(room)
  });
  broadcast(room, "room_info", { room: roomPublicInfo(room) });
  
  if (isRoomReadyToStart(room)) {
    broadcast(room, "game_start", {
      gameType: room.gameType,
      roomId: room.id
    });
  }
}

function validateRoomTurn(ws, room) {
  if (!room) {
    emit(ws, "error", { message: "你不在房间内" });
    return null;
  }

  const color = ws.meta?.color;
  if (!color) {
    emit(ws, "error", { message: "未分配执子颜色" });
    return null;
  }

  if (room.state.gameOver) {
    emit(ws, "error", { message: "棋局已结束" });
    return null;
  }

  if (room.state.turn !== color) {
    emit(ws, "error", { message: "当前不是你的回合" });
    return null;
  }

  return color;
}

function handlePlayMove(ws, payload) {
  const room = getRoomByClient(ws);
  if (!validateRoomTurn(ws, room)) return;

  let result;
  if (room.gameType === GAME.XIANGQI) {
    const fromX = Number(payload?.fromX);
    const fromY = Number(payload?.fromY);
    const toX = Number(payload?.toX);
    const toY = Number(payload?.toY);
    if (![fromX, fromY, toX, toY].every(Number.isInteger)) {
      emit(ws, "error", { message: "走子参数非法" });
      return;
    }
    result = moveXiangqi(room.state, fromX, fromY, toX, toY);
  } else {
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (![x, y].every(Number.isInteger)) {
      emit(ws, "error", { message: "落子参数非法" });
      return;
    }
    result = playMove(room.state, x, y);
  }

  if (!result.ok) {
    emit(ws, "error", { message: result.error });
    return;
  }

  room.state = result.state;
  broadcastState(room);
  if (room.state.gameOver) broadcastGameEnd(room);
}

function handlePass(ws) {
  const room = getRoomByClient(ws);
  if (!validateRoomTurn(ws, room)) return;

  if (room.gameType !== GAME.GO) {
    emit(ws, "error", { message: "当前游戏不支持停一手" });
    return;
  }

  const result = passTurn(room.state);
  if (!result.ok) {
    emit(ws, "error", { message: result.error });
    return;
  }

  room.state = result.state;
  broadcastState(room);
  if (room.state.gameOver) broadcastGameEnd(room);
}

function handleResign(ws) {
  const room = getRoomByClient(ws);
  if (!validateRoomTurn(ws, room)) return;

  const result = room.gameType === GAME.XIANGQI ? resignXiangqi(room.state, ws.meta.color) : resignGame(room.state, ws.meta.color);
  if (!result.ok) {
    emit(ws, "error", { message: result.error });
    return;
  }

  room.state = result.state;
  broadcastState(room);
  if (room.state.gameOver) broadcastGameEnd(room);
}

wss.on("connection", (ws) => {
  ws.meta = { roomId: null, color: null };
  emit(ws, "connected", { message: "connected" });

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (_err) {
      emit(ws, "error", { message: "消息格式错误" });
      return;
    }

    switch (data.type) {
      case "create_room":
        handleCreateRoom(ws, data);
        break;
      case "join_room":
        handleJoinRoom(ws, data);
        break;
      case "reconnect":
        // 显式重连请求
        if (data.roomId && data.color) {
          handleReconnect(ws, data.roomId, data.color);
        } else {
          emit(ws, "error", { message: "重连需要提供房间ID和颜色" });
        }
        break;
      case "play_move":
        handlePlayMove(ws, data);
        break;
      case "pass":
        handlePass(ws);
        break;
      case "resign":
        handleResign(ws);
        break;
      case "leave_room":
        leaveCurrentRoom(ws);
        break;
      default:
        emit(ws, "error", { message: "未知消息类型" });
        break;
    }
  });

  ws.on("close", () => {
    leaveCurrentRoom(ws);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Board game server listening on http://localhost:${PORT}${BASE_PATH || "/"}`);
  console.log(`WebSocket endpoint ws://localhost:${PORT}${WS_PATH}`);
  console.log(`Reconnect timeout: ${RECONNECT_TIMEOUT_MS / 1000}s`);
});