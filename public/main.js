import {
  STONE,
  COLOR_LABEL,
  collectBlockedPoints,
  createGameState,
  generateConnectedBlockedRegions,
  normalizePointList,
  passTurn,
  playMove,
  resignGame,
  scoreGame
} from "/shared/go-rules.js";

const MAP_STORAGE_KEY = "go_web_game_maps_v1";

const ui = {
  boardSizeInput: document.querySelector("#board-size-input"),
  komiInput: document.querySelector("#komi-input"),
  regionCountInput: document.querySelector("#region-count-input"),
  regionDefaultSizeInput: document.querySelector("#region-default-size-input"),
  regionSizesInput: document.querySelector("#region-sizes-input"),
  mapSelect: document.querySelector("#map-select"),
  startLocalBtn: document.querySelector("#start-local-btn"),
  openEditorBtn: document.querySelector("#open-editor-btn"),
  createRoomBtn: document.querySelector("#create-room-btn"),
  joinRoomInput: document.querySelector("#join-room-input"),
  joinRoomBtn: document.querySelector("#join-room-btn"),
  leaveRoomBtn: document.querySelector("#leave-room-btn"),
  roomIdText: document.querySelector("#room-id-text"),
  myColorText: document.querySelector("#my-color-text"),
  roomPlayersText: document.querySelector("#room-players-text"),
  passBtn: document.querySelector("#pass-btn"),
  resignBtn: document.querySelector("#resign-btn"),
  scoreBtn: document.querySelector("#score-btn"),
  gameInfo: document.querySelector("#game-info"),
  editorSizeInput: document.querySelector("#editor-size-input"),
  applyEditorSizeBtn: document.querySelector("#apply-editor-size-btn"),
  clearEditorBtn: document.querySelector("#clear-editor-btn"),
  editorMapSelect: document.querySelector("#editor-map-select"),
  loadMapBtn: document.querySelector("#load-map-btn"),
  deleteMapBtn: document.querySelector("#delete-map-btn"),
  mapNameInput: document.querySelector("#map-name-input"),
  saveMapBtn: document.querySelector("#save-map-btn"),
  statusText: document.querySelector("#status-text"),
  canvas: document.querySelector("#board-canvas")
};

const ctx = ui.canvas.getContext("2d");
const app = {
  mode: "local",
  game: null,
  previewScore: null,
  maps: [],
  editor: {
    size: 19,
    blocked: new Set()
  },
  boardMetrics: null,
  viewWidth: 0,
  viewHeight: 0,
  ws: null,
  wsReady: false,
  reconnectTimer: null,
  room: {
    id: null,
    color: null,
    players: []
  }
};

const rafState = { pending: false };

function pointKey(x, y) {
  return `${x},${y}`;
}

function parsePointKey(key) {
  const [x, y] = key.split(",").map((n) => Number(n));
  return { x, y };
}

function getColorName(color) {
  if (color === STONE.BLACK) return "黑";
  if (color === STONE.WHITE) return "白";
  return "-";
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

function saveMapsToStorage() {
  localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(app.maps));
}

function loadMapsFromStorage() {
  try {
    const raw = localStorage.getItem(MAP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item?.name === "string" && Number.isInteger(item?.size) && Array.isArray(item?.blockedPoints))
      .map((item) => ({
        id: String(item.id),
        name: item.name,
        size: item.size,
        blockedPoints: normalizePointList(item.blockedPoints, item.size),
        updatedAt: item.updatedAt ?? Date.now()
      }));
  } catch (_err) {
    return [];
  }
}

function refreshMapSelects() {
  const gameSelected = ui.mapSelect.value;
  const editorSelected = ui.editorMapSelect.value;
  ui.mapSelect.innerHTML = `<option value="">不使用（按上方随机配置）</option>`;
  ui.editorMapSelect.innerHTML = `<option value="">选择地图</option>`;
  for (const map of app.maps) {
    const gameOption = document.createElement("option");
    gameOption.value = map.id;
    gameOption.textContent = `${map.name} (${map.size}x${map.size}, 水潭${map.blockedPoints.length}点)`;
    ui.mapSelect.appendChild(gameOption);

    const editorOption = document.createElement("option");
    editorOption.value = map.id;
    editorOption.textContent = gameOption.textContent;
    ui.editorMapSelect.appendChild(editorOption);
  }
  if (app.maps.some((m) => m.id === gameSelected)) ui.mapSelect.value = gameSelected;
  if (app.maps.some((m) => m.id === editorSelected)) ui.editorMapSelect.value = editorSelected;
}

function loadMapToEditor(map) {
  app.mode = "editor";
  app.editor.size = map.size;
  app.editor.blocked = new Set(map.blockedPoints.map((p) => pointKey(p.x, p.y)));
  ui.editorSizeInput.value = String(map.size);
  ui.mapNameInput.value = map.name;
  requestRender();
  setStatus(`已加载地图：${map.name}，进入编辑器模式`);
}

function setEditorSize(size) {
  const clamped = Math.max(5, Math.min(25, size));
  app.editor.size = clamped;
  app.editor.blocked = new Set();
  ui.editorSizeInput.value = String(clamped);
  app.mode = "editor";
  requestRender();
}

function parseRegionSizes() {
  const count = Math.max(0, Number(ui.regionCountInput.value) || 0);
  const defaultSize = Math.max(1, Number(ui.regionDefaultSizeInput.value) || 1);
  const csv = ui.regionSizesInput.value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isInteger(num) && num > 0);

  let sizes = [];
  if (csv.length > 0) {
    sizes = csv;
    if (count > 0 && sizes.length < count) {
      sizes = sizes.concat(Array(count - sizes.length).fill(defaultSize));
    }
    if (count > 0 && sizes.length > count) {
      sizes = sizes.slice(0, count);
    }
  } else if (count > 0) {
    sizes = Array(count).fill(defaultSize);
  }
  return sizes;
}

function selectedMapById(id) {
  if (!id) return null;
  return app.maps.find((item) => item.id === id) ?? null;
}

function buildGameConfig() {
  const map = selectedMapById(ui.mapSelect.value);
  const komi = Number(ui.komiInput.value);
  const finalKomi = Number.isFinite(komi) ? komi : 7.5;

  if (map) {
    return {
      size: map.size,
      komi: finalKomi,
      blockedPoints: map.blockedPoints,
      mapName: map.name
    };
  }

  const size = Math.max(5, Math.min(25, Number(ui.boardSizeInput.value) || 19));
  const regionSizes = parseRegionSizes();
  let blockedPoints = [];
  if (regionSizes.length > 0) {
    try {
      blockedPoints = generateConnectedBlockedRegions(size, regionSizes).blockedPoints;
    } catch (error) {
      setStatus(`随机生成水潭失败：${error.message}`);
      return null;
    }
  }
  return {
    size,
    komi: finalKomi,
    blockedPoints,
    mapName: ""
  };
}

function startLocalGame() {
  const config = buildGameConfig();
  if (!config) return;
  if (app.room.id) {
    leaveRoom();
  }
  app.mode = "local";
  app.game = createGameState(config);
  app.previewScore = null;
  setStatus(`已开始本地自我对弈：${config.size}路，水潭点 ${config.blockedPoints.length}`);
  updateRoomInfo();
  updateGameInfo();
  requestRender();
}

function getWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function connectWs() {
  if (app.ws && (app.ws.readyState === WebSocket.OPEN || app.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const ws = new WebSocket(getWsUrl());
  app.ws = ws;
  ws.addEventListener("open", () => {
    app.wsReady = true;
    setStatus("WebSocket 已连接，可进行网页对战。");
  });
  ws.addEventListener("close", () => {
    app.wsReady = false;
    if (app.mode === "network") {
      setStatus("网络连接断开，正在重连...");
    }
    if (app.reconnectTimer) clearTimeout(app.reconnectTimer);
    app.reconnectTimer = setTimeout(connectWs, 1200);
  });
  ws.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (_err) {
      return;
    }
    handleWsMessage(data);
  });
}

function sendWs(type, payload = {}) {
  if (!app.wsReady || !app.ws || app.ws.readyState !== WebSocket.OPEN) {
    setStatus("WebSocket 未就绪，请稍后重试");
    return false;
  }
  app.ws.send(JSON.stringify({ type, ...payload }));
  return true;
}

function updateRoomInfo() {
  ui.roomIdText.textContent = app.room.id ?? "-";
  ui.myColorText.textContent = getColorName(app.room.color);
  if (app.room.players.length === 0) {
    ui.roomPlayersText.textContent = "-";
    return;
  }
  ui.roomPlayersText.textContent = app.room.players.map((c) => getColorName(c)).join(" / ");
}

function handleWsMessage(data) {
  if (data.type === "error") {
    setStatus(`服务端提示：${data.message}`);
    return;
  }
  if (data.type === "connected") {
    return;
  }

  if (data.room) {
    app.room.players = Array.isArray(data.room.players) ? data.room.players : app.room.players;
    updateRoomInfo();
  }

  if (data.type === "room_created" || data.type === "joined_room") {
    app.mode = "network";
    app.room.id = data.roomId;
    app.room.color = data.color;
    app.game = data.state;
    app.previewScore = null;
    updateRoomInfo();
    updateGameInfo();
    requestRender();
    setStatus(`已进入房间 ${data.roomId}，你执${getColorName(data.color)}。`);
    return;
  }

  if (data.type === "state_update") {
    app.mode = "network";
    app.game = data.state;
    app.previewScore = null;
    updateGameInfo();
    requestRender();
    if (app.game.gameOver) {
      setStatus("对局已结束。");
    } else {
      setStatus(`已同步对局，轮到${getColorName(app.game.turn)}。`);
    }
    return;
  }

  if (data.type === "room_info") {
    updateRoomInfo();
    setStatus(`房间信息更新：${data.room.id}`);
  }
}

function createRoom() {
  const config = buildGameConfig();
  if (!config) return;
  if (!sendWs("create_room", { config })) return;
  setStatus("正在创建房间...");
}

function joinRoom() {
  const roomId = String(ui.joinRoomInput.value ?? "").trim().toUpperCase();
  if (!roomId) {
    setStatus("请先输入房间码");
    return;
  }
  if (!sendWs("join_room", { roomId })) return;
  setStatus(`正在加入房间 ${roomId}...`);
}

function leaveRoom() {
  sendWs("leave_room");
  app.room = { id: null, color: null, players: [] };
  if (app.mode === "network") {
    app.mode = "local";
  }
  updateRoomInfo();
}

function myTurnInNetwork() {
  return app.mode === "network" && app.game && app.room.color === app.game.turn;
}

function runLocalMove(x, y) {
  if (!app.game) return;
  const result = playMove(app.game, x, y);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  app.game = result.state;
  app.previewScore = null;
  updateGameInfo();
  requestRender();
}

function runPass() {
  if (!app.game) return;
  if (app.mode === "network") {
    if (!myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    sendWs("pass");
    return;
  }
  const result = passTurn(app.game);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  app.game = result.state;
  app.previewScore = null;
  updateGameInfo();
  requestRender();
}

function runResign() {
  if (!app.game) return;
  if (app.mode === "network") {
    if (!myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    sendWs("resign");
    return;
  }
  const result = resignGame(app.game);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  app.game = result.state;
  app.previewScore = null;
  updateGameInfo();
  requestRender();
}

function runScorePreview() {
  if (!app.game) return;
  app.previewScore = scoreGame(app.game);
  updateGameInfo();
}

function updateGameInfo() {
  if (!app.game) {
    ui.gameInfo.textContent = "未开始对局";
    return;
  }
  const lines = [];
  lines.push(`模式：${app.mode === "network" ? "网页对战" : app.mode === "editor" ? "地图编辑器" : "本地自我对弈"}`);
  lines.push(`轮到：${getColorName(app.game.turn)} | 手数：${app.game.moveNumber} | 连续停着：${app.game.passes}`);
  lines.push(`提子：黑 ${app.game.captures[STONE.BLACK]} / 白 ${app.game.captures[STONE.WHITE]}`);
  if (app.game.lastMove) {
    if (app.game.lastMove.type === "play") {
      lines.push(`最近落子：${getColorName(app.game.lastMove.color)} (${app.game.lastMove.x}, ${app.game.lastMove.y})`);
    } else if (app.game.lastMove.type === "pass") {
      lines.push(`最近操作：${getColorName(app.game.lastMove.color)} 停一手`);
    } else if (app.game.lastMove.type === "resign") {
      lines.push(`最近操作：${getColorName(app.game.lastMove.color)} 认输`);
    }
  }
  if (app.game.gameOver) {
    if (app.game.score) {
      lines.push(`终局得分：黑 ${app.game.score.blackTotal.toFixed(1)} / 白 ${app.game.score.whiteTotal.toFixed(1)}，胜者：${getColorName(app.game.winner)}`);
    } else {
      lines.push(`对局结束，胜者：${getColorName(app.game.winner)}`);
    }
  } else if (app.previewScore) {
    lines.push(`形势预估：黑 ${app.previewScore.blackTotal.toFixed(1)} / 白 ${app.previewScore.whiteTotal.toFixed(1)}`);
  }
  ui.gameInfo.textContent = lines.join("\n");
}

function getActiveBoard() {
  if (app.mode === "editor") {
    const board = Array.from({ length: app.editor.size }, () => Array(app.editor.size).fill(STONE.EMPTY));
    for (const key of app.editor.blocked) {
      const point = parsePointKey(key);
      board[point.y][point.x] = STONE.BLOCKED;
    }
    return { size: app.editor.size, board, lastMove: null, ko: null };
  }
  if (app.game) {
    return app.game;
  }
  const size = Math.max(5, Math.min(25, Number(ui.boardSizeInput.value) || 19));
  return { size, board: Array.from({ length: size }, () => Array(size).fill(STONE.EMPTY)), lastMove: null, ko: null };
}

function getStarPoints(size) {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  return [];
}

function computeMetrics(size) {
  const width = app.viewWidth;
  const height = app.viewHeight;
  const side = Math.min(width, height) * 0.91;
  const boardX = (width - side) / 2;
  const boardY = (height - side) / 2;
  const padding = side * 0.085;
  const firstX = boardX + padding;
  const firstY = boardY + padding;
  const lastX = boardX + side - padding;
  const lastY = boardY + side - padding;
  const cell = size > 1 ? (lastX - firstX) / (size - 1) : 0;
  return { width, height, side, boardX, boardY, padding, firstX, firstY, lastX, lastY, cell, size };
}

function drawBoard(metrics) {
  const wood = ctx.createLinearGradient(0, 0, metrics.width, metrics.height);
  wood.addColorStop(0, "#d9b568");
  wood.addColorStop(1, "#bc8f43");
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, metrics.width, metrics.height);

  const boardGrad = ctx.createLinearGradient(metrics.boardX, metrics.boardY, metrics.boardX, metrics.boardY + metrics.side);
  boardGrad.addColorStop(0, "#e8c982");
  boardGrad.addColorStop(1, "#cfa158");
  ctx.fillStyle = boardGrad;
  roundRect(ctx, metrics.boardX, metrics.boardY, metrics.side, metrics.side, metrics.side * 0.022);
  ctx.fill();

  ctx.strokeStyle = "#6f4a16";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < metrics.size; i += 1) {
    const x = metrics.firstX + i * metrics.cell;
    const y = metrics.firstY + i * metrics.cell;
    ctx.beginPath();
    ctx.moveTo(x, metrics.firstY);
    ctx.lineTo(x, metrics.lastY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(metrics.firstX, y);
    ctx.lineTo(metrics.lastX, y);
    ctx.stroke();
  }

  const stars = getStarPoints(metrics.size);
  if (stars.length > 0) {
    ctx.fillStyle = "#5c370f";
    const starR = Math.max(2.2, metrics.cell * 0.082);
    for (const sy of stars) {
      for (const sx of stars) {
        const cx = metrics.firstX + sx * metrics.cell;
        const cy = metrics.firstY + sy * metrics.cell;
        ctx.beginPath();
        ctx.arc(cx, cy, starR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function blockRegions(points, size) {
  const byKey = new Set(points.map((p) => pointKey(p.x, p.y)));
  const seen = new Set();
  const regions = [];
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  for (const point of points) {
    const root = pointKey(point.x, point.y);
    if (seen.has(root)) continue;
    const stack = [point];
    const region = [];
    seen.add(root);
    while (stack.length > 0) {
      const current = stack.pop();
      region.push(current);
      for (const d of directions) {
        const nx = current.x + d.x;
        const ny = current.y + d.y;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const nk = pointKey(nx, ny);
        if (!byKey.has(nk) || seen.has(nk)) continue;
        seen.add(nk);
        stack.push({ x: nx, y: ny });
      }
    }
    regions.push(region);
  }
  return regions;
}

function drawPondRegion(region, metrics) {
  const regionSet = new Set(region.map((p) => pointKey(p.x, p.y)));
  const centers = region.map((point) => ({
    point,
    cx: metrics.firstX + point.x * metrics.cell,
    cy: metrics.firstY + point.y * metrics.cell
  }));
  const minX = Math.min(...centers.map((c) => c.cx));
  const maxX = Math.max(...centers.map((c) => c.cx));
  const minY = Math.min(...centers.map((c) => c.cy));
  const maxY = Math.max(...centers.map((c) => c.cy));
  const grad = ctx.createLinearGradient(minX, minY, maxX + 1, maxY + 1);
  grad.addColorStop(0, "rgba(53, 137, 171, 0.98)");
  grad.addColorStop(0.5, "rgba(31, 102, 144, 0.94)");
  grad.addColorStop(1, "rgba(17, 77, 120, 0.96)");
  const radius = Math.max(6, metrics.cell * 0.46);

  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(metrics.cell * 1.02, radius * 1.92);
  ctx.beginPath();
  for (const point of region) {
    const x = metrics.firstX + point.x * metrics.cell;
    const y = metrics.firstY + point.y * metrics.cell;
    const right = pointKey(point.x + 1, point.y);
    const down = pointKey(point.x, point.y + 1);
    if (regionSet.has(right)) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + metrics.cell, y);
    }
    if (regionSet.has(down)) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + metrics.cell);
    }
  }
  ctx.stroke();

  // Fill fully-occupied 2x2 blocks to avoid tiny holes at region centers.
  ctx.fillStyle = grad;
  const bleed = Math.max(0.6, metrics.cell * 0.03);
  for (const point of region) {
    const right = pointKey(point.x + 1, point.y);
    const down = pointKey(point.x, point.y + 1);
    const diag = pointKey(point.x + 1, point.y + 1);
    if (!regionSet.has(right) || !regionSet.has(down) || !regionSet.has(diag)) {
      continue;
    }
    const x = metrics.firstX + point.x * metrics.cell;
    const y = metrics.firstY + point.y * metrics.cell;
    ctx.fillRect(x - bleed, y - bleed, metrics.cell + bleed * 2, metrics.cell + bleed * 2);
  }

  for (const center of centers) {
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(center.cx, center.cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "rgba(190, 231, 244, 0.28)";
    ctx.arc(center.cx - radius * 0.2, center.cy - radius * 0.24, radius * 0.37, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(217, 248, 255, 0.46)";
  ctx.lineWidth = Math.max(1.2, radius * 0.15);
  ctx.stroke();
  ctx.restore();
}

function drawPonds(boardData, metrics) {
  const blocked = collectBlockedPoints(boardData.board);
  if (blocked.length === 0) return;
  const regions = blockRegions(blocked, boardData.size);
  for (const region of regions) {
    drawPondRegion(region, metrics);
  }
}

function drawStone(x, y, color, metrics) {
  const cx = metrics.firstX + x * metrics.cell;
  const cy = metrics.firstY + y * metrics.cell;
  const radius = Math.max(7, metrics.cell * 0.43);
  const grad = ctx.createRadialGradient(cx - radius * 0.28, cy - radius * 0.3, radius * 0.12, cx, cy, radius);
  if (color === STONE.BLACK) {
    grad.addColorStop(0, "#8a8a8a");
    grad.addColorStop(0.25, "#3f3f3f");
    grad.addColorStop(1, "#0c0c0c");
  } else {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.42, "#eeeeee");
    grad.addColorStop(1, "#c7c7c7");
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.34)";
  ctx.shadowBlur = radius * 0.26;
  ctx.shadowOffsetY = radius * 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function drawStones(boardData, metrics) {
  for (let y = 0; y < boardData.size; y += 1) {
    for (let x = 0; x < boardData.size; x += 1) {
      const cell = boardData.board[y][x];
      if (cell === STONE.BLACK || cell === STONE.WHITE) {
        drawStone(x, y, cell, metrics);
      }
    }
  }
}

function drawMarkers(boardData, metrics) {
  if (boardData.lastMove && boardData.lastMove.type === "play") {
    const x = metrics.firstX + boardData.lastMove.x * metrics.cell;
    const y = metrics.firstY + boardData.lastMove.y * metrics.cell;
    ctx.fillStyle = "rgba(231, 65, 61, 0.92)";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.5, metrics.cell * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
  if (boardData.ko) {
    const x = metrics.firstX + boardData.ko.x * metrics.cell;
    const y = metrics.firstY + boardData.ko.y * metrics.cell;
    const half = Math.max(3, metrics.cell * 0.14);
    ctx.strokeStyle = "rgba(8, 192, 224, 0.92)";
    ctx.lineWidth = Math.max(1.2, metrics.cell * 0.06);
    ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  }
}

function drawModeCaption(metrics) {
  const text =
    app.mode === "editor"
      ? "地图编辑器：点击交叉点切换水潭"
      : app.mode === "network"
        ? `网页对战：你执 ${getColorName(app.room.color)}`
        : "本地自我对弈";
  ctx.fillStyle = "rgba(32, 24, 10, 0.78)";
  ctx.font = `${Math.max(12, metrics.cell * 0.42)}px "Noto Sans SC", "PingFang SC", sans-serif`;
  ctx.fillText(text, metrics.boardX + 10, metrics.boardY + 20);
}

function render() {
  const boardData = getActiveBoard();
  const metrics = computeMetrics(boardData.size);
  app.boardMetrics = metrics;
  drawBoard(metrics);
  drawPonds(boardData, metrics);
  drawStones(boardData, metrics);
  drawMarkers(boardData, metrics);
  drawModeCaption(metrics);
}

function requestRender() {
  if (rafState.pending) return;
  rafState.pending = true;
  window.requestAnimationFrame(() => {
    rafState.pending = false;
    render();
  });
}

function canvasPointToBoard(clientX, clientY) {
  const rect = ui.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const metrics = app.boardMetrics;
  if (!metrics) return null;
  const boardX = Math.round((x - metrics.firstX) / metrics.cell);
  const boardY = Math.round((y - metrics.firstY) / metrics.cell);
  if (boardX < 0 || boardY < 0 || boardX >= metrics.size || boardY >= metrics.size) {
    return null;
  }
  const centerX = metrics.firstX + boardX * metrics.cell;
  const centerY = metrics.firstY + boardY * metrics.cell;
  const distance = Math.hypot(x - centerX, y - centerY);
  if (distance > metrics.cell * 0.43) {
    return null;
  }
  return { x: boardX, y: boardY };
}

function handleBoardClick(event) {
  const point = canvasPointToBoard(event.clientX, event.clientY);
  if (!point) return;

  if (app.mode === "editor") {
    const key = pointKey(point.x, point.y);
    if (app.editor.blocked.has(key)) app.editor.blocked.delete(key);
    else app.editor.blocked.add(key);
    requestRender();
    setStatus(`编辑器：水潭点数量 ${app.editor.blocked.size}`);
    return;
  }

  if (!app.game || app.game.gameOver) return;
  if (app.mode === "network") {
    if (!myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    sendWs("play_move", { x: point.x, y: point.y });
    return;
  }
  runLocalMove(point.x, point.y);
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function resizeCanvas() {
  const rect = ui.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  ui.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  ui.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  app.viewWidth = rect.width;
  app.viewHeight = rect.height;
  requestRender();
}

function bindEvents() {
  ui.startLocalBtn.addEventListener("click", startLocalGame);
  ui.openEditorBtn.addEventListener("click", () => {
    app.mode = "editor";
    if (!app.editor.size) setEditorSize(19);
    setStatus("已进入地图编辑器");
    requestRender();
  });
  ui.createRoomBtn.addEventListener("click", createRoom);
  ui.joinRoomBtn.addEventListener("click", joinRoom);
  ui.leaveRoomBtn.addEventListener("click", () => {
    leaveRoom();
    setStatus("已离开房间");
    updateGameInfo();
  });
  ui.passBtn.addEventListener("click", runPass);
  ui.resignBtn.addEventListener("click", runResign);
  ui.scoreBtn.addEventListener("click", runScorePreview);

  ui.applyEditorSizeBtn.addEventListener("click", () => {
    const size = Number(ui.editorSizeInput.value) || 19;
    setEditorSize(size);
    setStatus(`编辑器棋盘已切换为 ${app.editor.size} 路`);
  });
  ui.clearEditorBtn.addEventListener("click", () => {
    app.editor.blocked = new Set();
    app.mode = "editor";
    requestRender();
    setStatus("编辑器水潭点已清空");
  });

  ui.loadMapBtn.addEventListener("click", () => {
    const map = selectedMapById(ui.editorMapSelect.value);
    if (!map) {
      setStatus("请选择地图后再加载");
      return;
    }
    loadMapToEditor(map);
  });

  ui.deleteMapBtn.addEventListener("click", () => {
    const mapId = ui.editorMapSelect.value;
    if (!mapId) {
      setStatus("请选择地图后再删除");
      return;
    }
    app.maps = app.maps.filter((item) => item.id !== mapId);
    saveMapsToStorage();
    refreshMapSelects();
    setStatus("已删除地图");
  });

  ui.saveMapBtn.addEventListener("click", () => {
    const name = String(ui.mapNameInput.value ?? "").trim();
    if (!name) {
      setStatus("请填写地图名称");
      return;
    }
    const blockedPoints = Array.from(app.editor.blocked).map(parsePointKey);
    const exists = selectedMapById(ui.editorMapSelect.value);
    const map = {
      id: exists?.id ?? `map_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      name,
      size: app.editor.size,
      blockedPoints: normalizePointList(blockedPoints, app.editor.size),
      updatedAt: Date.now()
    };
    if (exists) {
      app.maps = app.maps.map((item) => (item.id === exists.id ? map : item));
      setStatus(`已覆盖保存地图：${name}`);
    } else {
      app.maps.push(map);
      setStatus(`已新增保存地图：${name}`);
    }
    app.maps.sort((a, b) => b.updatedAt - a.updatedAt);
    saveMapsToStorage();
    refreshMapSelects();
    ui.editorMapSelect.value = map.id;
    ui.mapSelect.value = map.id;
  });

  ui.canvas.addEventListener("click", handleBoardClick);

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "f") return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    document.documentElement.requestFullscreen().catch(() => {});
  });
}

function initTextHooks() {
  window.render_game_to_text = () => {
    const boardData = getActiveBoard();
    const blackStones = [];
    const whiteStones = [];
    const blocked = [];
    for (let y = 0; y < boardData.size; y += 1) {
      for (let x = 0; x < boardData.size; x += 1) {
        const v = boardData.board[y][x];
        if (v === STONE.BLACK) blackStones.push({ x, y });
        if (v === STONE.WHITE) whiteStones.push({ x, y });
        if (v === STONE.BLOCKED) blocked.push({ x, y });
      }
    }
    const payload = {
      mode: app.mode,
      coordinate: "原点在左上角，x 向右，y 向下",
      boardSize: boardData.size,
      turn: app.game ? COLOR_LABEL[app.game.turn] : null,
      gameOver: app.game ? app.game.gameOver : false,
      lastMove: app.game?.lastMove ?? null,
      ko: app.game?.ko ?? null,
      captures: app.game ? app.game.captures : null,
      roomId: app.room.id,
      myColor: app.room.color ? COLOR_LABEL[app.room.color] : null,
      stones: {
        black: blackStones,
        white: whiteStones,
        blocked
      }
    };
    return JSON.stringify(payload);
  };

  window.advanceTime = (_ms) => {
    render();
  };
}

function init() {
  app.maps = loadMapsFromStorage();
  refreshMapSelects();
  bindEvents();
  connectWs();
  setEditorSize(19);
  startLocalGame();
  initTextHooks();
  resizeCanvas();
  setStatus("准备就绪：可开始本地自我对弈，或创建房间进行网页对战。");
}

init();
