import path from "node:path";
import { randomUUID } from "node:crypto";
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

const ROOM_STAGE = Object.freeze({
  LOBBY: "lobby",
  PLAYING: "playing"
});

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
const connections = new Set();
const PORT = Number(process.env.PORT ?? 3001);
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH ?? "/games/go");
const STATIC_PATH = BASE_PATH || "/";
const SHARED_PATH = BASE_PATH ? `${BASE_PATH}/shared` : "/shared";
const WS_PATH = `${BASE_PATH}/ws`;

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
const HEARTBEAT_INTERVAL_MS = 15000;

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
    emit(client, type, payload);
  }
}

function broadcastAll(type, payload = {}) {
  for (const client of connections) {
    emit(client, type, payload);
  }
}

function sidesForGame(gameType) {
  if (gameType === GAME.XIANGQI) {
    return { first: XQ_TEAM.RED, second: XQ_TEAM.BLACK };
  }
  return { first: STONE.BLACK, second: STONE.WHITE };
}

function sideList(gameType) {
  const { first, second } = sidesForGame(gameType);
  return [first, second];
}

function roomReadyCount(room) {
  return sideList(room.gameType).filter((side) => room.ready.get(side)).length;
}

function roomHasAnyReady(room) {
  return roomReadyCount(room) > 0;
}

function roomCanEdit(room) {
  return room.stage === ROOM_STAGE.LOBBY && !roomHasAnyReady(room);
}

function roomCanJoin(room) {
  if (room.clients.size >= 2) return false;
  if (room.stage === ROOM_STAGE.LOBBY) return true;
  return room.stage === ROOM_STAGE.PLAYING && !room.state?.gameOver;
}

function updateRoomTimestamp(room) {
  room.updatedAt = Date.now();
}

function roomPublicInfo(room) {
  const slots = sideList(room.gameType).map((side) => ({
    side,
    online: room.clients.has(side),
    ready: Boolean(room.ready.get(side))
  }));

  return {
    id: room.id,
    gameType: room.gameType,
    stage: room.stage,
    players: Array.from(room.clients.keys()),
    slots,
    readyCount: roomReadyCount(room),
    hasAnyReady: roomHasAnyReady(room),
    canEdit: roomCanEdit(room),
    canSwap: roomCanEdit(room),
    currentTurn: room.state?.turn ?? null,
    winner: room.state?.winner ?? null,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

function roomListItem(room) {
  const info = roomPublicInfo(room);
  return {
    id: info.id,
    gameType: info.gameType,
    stage: info.stage,
    slots: info.slots,
    readyCount: info.readyCount,
    currentTurn: info.currentTurn,
    winner: info.winner,
    canJoin: roomCanJoin(room),
    createdAt: info.createdAt,
    updatedAt: info.updatedAt
  };
}

function broadcastRoomList() {
  const roomList = Array.from(rooms.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(roomListItem);
  broadcastAll("room_list", { rooms: roomList });
}

function emitRoomSnapshot(ws, type, room) {
  emit(ws, type, {
    roomId: room.id,
    gameType: room.gameType,
    color: ws.meta?.color ?? null,
    playerToken: ws.meta?.playerToken ?? null,
    config: room.config,
    state: room.state,
    room: roomPublicInfo(room)
  });
}

function broadcastRoomSnapshot(room, type = "room_info") {
  for (const client of room.clients.values()) {
    emit(client, type, {
      roomId: room.id,
      gameType: room.gameType,
      color: client.meta?.color ?? null,
      playerToken: client.meta?.playerToken ?? null,
      config: room.config,
      state: room.state,
      room: roomPublicInfo(room)
    });
  }
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

function createRoom(gameType, rawConfig, ownerWs) {
  const setup = buildRoomSetup(gameType, rawConfig);
  let roomId = randomRoomId();
  while (rooms.has(roomId)) roomId = randomRoomId();

  const firstSide = sideList(setup.gameType)[0];
  const ownerToken = randomUUID();
  const ready = new Map();
  for (const side of sideList(setup.gameType)) ready.set(side, false);
  const seatTokens = new Map([[firstSide, ownerToken]]);

  const now = Date.now();
  const room = {
    id: roomId,
    gameType: setup.gameType,
    config: setup.config,
    state: null,
    stage: ROOM_STAGE.LOBBY,
    clients: new Map([[firstSide, ownerWs]]),
    seatTokens,
    ready,
    createdAt: now,
    updatedAt: now
  };

  ownerWs.meta = { roomId, color: firstSide, playerToken: ownerToken };
  rooms.set(roomId, room);
  return room;
}

function getRoomByClient(ws) {
  const roomId = ws.meta?.roomId;
  if (!roomId) return null;
  return rooms.get(roomId) ?? null;
}

function clearReady(room) {
  for (const side of sideList(room.gameType)) {
    room.ready.set(side, false);
  }
}

function assignWsToSide(room, ws, side) {
  const currentSide = ws.meta?.color;
  const currentToken = ws.meta?.playerToken ?? randomUUID();
  if (currentSide && room.clients.get(currentSide) === ws) {
    room.clients.delete(currentSide);
    room.seatTokens.delete(currentSide);
  }
  room.clients.set(side, ws);
  room.ready.set(side, false);
  room.seatTokens.set(side, currentToken);
  ws.meta = { roomId: room.id, color: side, playerToken: currentToken };
  updateRoomTimestamp(room);
}

function leaveCurrentRoom(ws, preserveSeat = false) {
  const room = getRoomByClient(ws);
  if (!room) {
    ws.meta = { roomId: null, color: null, playerToken: ws.meta?.playerToken ?? null };
    return;
  }

  const side = ws.meta?.color;
  if (side && room.clients.get(side) === ws) {
    room.clients.delete(side);
    if (!preserveSeat) {
      room.ready.set(side, false);
      room.seatTokens.delete(side);
    }
  }
  ws.meta = { roomId: null, color: null, playerToken: ws.meta?.playerToken ?? null };

  if (room.clients.size === 0 && (!preserveSeat || room.stage !== ROOM_STAGE.PLAYING)) {
    rooms.delete(room.id);
    broadcastRoomList();
    return;
  }

  updateRoomTimestamp(room);
  broadcastRoomSnapshot(room, "room_info");
  broadcastRoomList();
}

function handleCreateRoom(ws, payload) {
  if (getRoomByClient(ws)) {
    emit(ws, "error", { message: "请先离开当前房间" });
    return;
  }

  const reqGameType = payload?.gameType === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO;
  const room = createRoom(reqGameType, payload?.config ?? {}, ws);
  emitRoomSnapshot(ws, "room_created", room);
  broadcastRoomList();
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
  if (!roomCanJoin(room)) {
    emit(ws, "error", { message: "该房间当前不可加入" });
    return;
  }

  const freeSide = sideList(room.gameType).find((side) => !room.clients.has(side));
  if (!freeSide) {
    emit(ws, "error", { message: "房间已满" });
    return;
  }

  assignWsToSide(room, ws, freeSide);
  emitRoomSnapshot(ws, "joined_room", room);
  broadcastRoomSnapshot(room, "room_info");
  broadcastRoomList();
}

function handleResumeSession(ws, payload) {
  if (getRoomByClient(ws)) {
    emit(ws, "session_resume_failed", { message: "请先离开当前房间" });
    return;
  }
  const roomId = String(payload?.roomId ?? "").trim().toUpperCase();
  const playerToken = String(payload?.playerToken ?? "").trim();
  if (!roomId || !playerToken) {
    emit(ws, "session_resume_failed", { message: "缺少恢复凭证" });
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    emit(ws, "session_resume_failed", { message: "房间不存在" });
    return;
  }

  const side = sideList(room.gameType).find((item) => room.seatTokens.get(item) === playerToken);
  if (!side) {
    emit(ws, "session_resume_failed", { message: "恢复凭证已失效" });
    return;
  }
  const occupant = room.clients.get(side);
  if (occupant) {
    if (occupant.meta?.playerToken !== playerToken) {
      emit(ws, "session_resume_failed", { message: "该席位当前在线，无法恢复" });
      return;
    }

    // Same player reopened the page before the old socket fully closed.
    occupant.meta = { roomId: null, color: null, playerToken };
    try {
      occupant.close(4001, "session-replaced");
    } catch (_err) {}
  }

  room.clients.set(side, ws);
  ws.meta = { roomId: room.id, color: side, playerToken };
  updateRoomTimestamp(room);
  emitRoomSnapshot(ws, "session_resumed", room);
  broadcastRoomSnapshot(room, "room_info");
  broadcastRoomList();
}

function handleChooseSide(ws, payload) {
  const room = getRoomByClient(ws);
  if (!room) {
    emit(ws, "error", { message: "你不在房间内" });
    return;
  }
  if (room.stage !== ROOM_STAGE.LOBBY) {
    emit(ws, "error", { message: "对局已开始，不能换位置" });
    return;
  }
  if (!roomCanEdit(room)) {
    emit(ws, "error", { message: "已有玩家准备，不能换位置" });
    return;
  }

  const targetSide =
    room.gameType === GAME.XIANGQI
      ? Number(payload?.side) === XQ_TEAM.BLACK
        ? XQ_TEAM.BLACK
        : XQ_TEAM.RED
      : Number(payload?.side) === STONE.WHITE
        ? STONE.WHITE
        : STONE.BLACK;

  const occupant = room.clients.get(targetSide);
  if (occupant && occupant !== ws) {
    const currentSide = ws.meta?.color;
    if (!currentSide) {
      emit(ws, "error", { message: "未分配执子颜色" });
      return;
    }
    room.clients.set(targetSide, ws);
    room.clients.set(currentSide, occupant);
    room.ready.set(targetSide, false);
    room.ready.set(currentSide, false);
    const currentToken = ws.meta?.playerToken ?? randomUUID();
    const occupantToken = occupant.meta?.playerToken ?? randomUUID();
    room.seatTokens.set(targetSide, currentToken);
    room.seatTokens.set(currentSide, occupantToken);
    ws.meta = { roomId: room.id, color: targetSide, playerToken: currentToken };
    occupant.meta = { roomId: room.id, color: currentSide, playerToken: occupantToken };
    updateRoomTimestamp(room);
  } else {
    assignWsToSide(room, ws, targetSide);
  }
  broadcastRoomSnapshot(room, "room_info");
  broadcastRoomList();
}

function handleUpdateRoomConfig(ws, payload) {
  const room = getRoomByClient(ws);
  if (!room) {
    emit(ws, "error", { message: "你不在房间内" });
    return;
  }
  if (room.stage !== ROOM_STAGE.LOBBY) {
    emit(ws, "error", { message: "对局已开始，不能编辑棋盘" });
    return;
  }
  if (!roomCanEdit(room)) {
    emit(ws, "error", { message: "已有玩家准备，不能继续编辑棋盘" });
    return;
  }

  const setup = buildRoomSetup(room.gameType, payload?.config ?? room.config);
  room.config = setup.config;
  room.state = null;
  updateRoomTimestamp(room);
  broadcastRoomSnapshot(room, "room_info");
  broadcastRoomList();
}

function startRoomGame(room) {
  const setup = buildRoomSetup(room.gameType, room.config);
  room.config = setup.config;
  room.state = setup.state;
  room.stage = ROOM_STAGE.PLAYING;
  updateRoomTimestamp(room);
  broadcastRoomSnapshot(room, "game_start");
  broadcastRoomList();
}

function handleSetReady(ws, payload) {
  const room = getRoomByClient(ws);
  if (!room) {
    emit(ws, "error", { message: "你不在房间内" });
    return;
  }
  if (room.stage !== ROOM_STAGE.LOBBY) {
    emit(ws, "error", { message: "对局已开始" });
    return;
  }

  const side = ws.meta?.color;
  if (!side || room.clients.get(side) !== ws) {
    emit(ws, "error", { message: "未分配执子颜色" });
    return;
  }

  room.ready.set(side, Boolean(payload?.ready));
  updateRoomTimestamp(room);
  broadcastRoomSnapshot(room, "room_info");
  broadcastRoomList();

  const occupiedSides = sideList(room.gameType).filter((item) => room.clients.has(item));
  const allReady = occupiedSides.length === 2 && occupiedSides.every((item) => room.ready.get(item));
  if (allReady) {
    startRoomGame(room);
  }
}

function validateRoomTurn(ws, room) {
  if (!room) {
    emit(ws, "error", { message: "你不在房间内" });
    return null;
  }
  if (room.stage !== ROOM_STAGE.PLAYING || !room.state) {
    emit(ws, "error", { message: "双方准备后才能开始对局" });
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

function broadcastState(room) {
  updateRoomTimestamp(room);
  for (const client of room.clients.values()) {
    emit(client, "state_update", {
      roomId: room.id,
      gameType: room.gameType,
      color: client.meta?.color ?? null,
      playerToken: client.meta?.playerToken ?? null,
      state: room.state,
      room: roomPublicInfo(room)
    });
  }
}

function broadcastGameEnd(room) {
  broadcast(room, "game_end", {
    gameType: room.gameType,
    roomId: room.id,
    winner: room.state?.winner ?? null,
    resignedBy: room.state?.resignedBy ?? null,
    state: room.state,
    room: roomPublicInfo(room)
  });
  broadcastRoomList();
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
  if (room.state.gameOver) {
    broadcastGameEnd(room);
  }
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
  if (room.state.gameOver) {
    broadcastGameEnd(room);
  }
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
  if (room.state.gameOver) {
    broadcastGameEnd(room);
  }
}

wss.on("connection", (ws) => {
  connections.add(ws);
  ws.isAlive = true;
  ws.meta = { roomId: null, color: null, playerToken: null };
  emit(ws, "connected", { message: "connected" });
  emit(ws, "room_list", {
    rooms: Array.from(rooms.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(roomListItem)
  });

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
      case "resume_session":
        handleResumeSession(ws, data);
        break;
      case "choose_side":
        handleChooseSide(ws, data);
        break;
      case "update_room_config":
        handleUpdateRoomConfig(ws, data);
        break;
      case "set_ready":
        handleSetReady(ws, data);
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

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("close", () => {
    connections.delete(ws);
    leaveCurrentRoom(ws, true);
  });
});

const heartbeatTimer = setInterval(() => {
  for (const client of connections) {
    if (!client.isAlive) {
      try {
        client.terminate();
      } catch (_err) {}
      continue;
    }
    client.isAlive = false;
    try {
      client.ping();
    } catch (_err) {}
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => {
  clearInterval(heartbeatTimer);
});

httpServer.listen(PORT, () => {
  console.log(`Board game server listening on http://localhost:${PORT}${BASE_PATH || "/"}`);
  console.log(`WebSocket endpoint ws://localhost:${PORT}${WS_PATH}`);
});
