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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const rooms = new Map();
const PORT = Number(process.env.PORT ?? 5173);

app.use(express.static(path.join(__dirname, "public")));
app.use("/shared", express.static(path.join(__dirname, "shared")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

function emit(ws, type, payload = {}) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload = {}) {
  for (const client of room.clients.values()) {
    emit(client, type, payload);
  }
}

function roomPublicInfo(room) {
  return {
    id: room.id,
    gameType: room.gameType,
    players: Array.from(room.clients.keys()),
    redReady: room.clients.has(XQ_TEAM.RED),
    blackReady: room.clients.has(XQ_TEAM.BLACK)
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

function leaveCurrentRoom(ws) {
  const room = getRoomByClient(ws);
  if (!room) {
    ws.meta = { roomId: null, color: null };
    return;
  }

  if (ws.meta.color) {
    room.clients.delete(ws.meta.color);
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

  const room = {
    id: roomId,
    gameType: setup.gameType,
    config: setup.config,
    state: setup.state,
    clients: new Map([[setup.gameType === GAME.XIANGQI ? XQ_TEAM.RED : STONE.BLACK, ws]])
  };

  ws.meta = { roomId, color: setup.gameType === GAME.XIANGQI ? XQ_TEAM.RED : STONE.BLACK };
  rooms.set(roomId, room);

  emit(ws, "room_created", {
    roomId,
    gameType: room.gameType,
    color: ws.meta.color,
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

  const first = room.gameType === GAME.XIANGQI ? XQ_TEAM.RED : STONE.BLACK;
  const second = room.gameType === GAME.XIANGQI ? XQ_TEAM.BLACK : STONE.WHITE;

  if (room.clients.has(first) && room.clients.has(second)) {
    emit(ws, "error", { message: "房间已满" });
    return;
  }

  const color = room.clients.has(first) ? second : first;
  room.clients.set(color, ws);
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
  broadcast(room, "state_update", {
    gameType: room.gameType,
    state: room.state,
    room: roomPublicInfo(room)
  });
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
  broadcast(room, "state_update", {
    gameType: room.gameType,
    state: room.state,
    room: roomPublicInfo(room)
  });
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
  broadcast(room, "state_update", {
    gameType: room.gameType,
    state: room.state,
    room: roomPublicInfo(room)
  });
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
  console.log(`Board game server listening on http://localhost:${PORT}`);
});
