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
} from "./shared/go-rules.js";
import {
  XQ_TEAM,
  XQ_PIECE,
  XQ_BOARD,
  createXiangqiGameState,
  moveXiangqi,
  resignXiangqi,
  collectFuPoints,
  generateRandomFuPoints,
  isXiangqiInCheck
} from "./shared/xiangqi-rules.js";

const GAME = Object.freeze({
  GO: "go",
  XIANGQI: "xiangqi"
});

const MAP_STORAGE_KEY = "board_game_maps_v2";
const ACTIVE_ROOM_SESSION_KEY = "board_game_active_room_session_v1";

const ui = {
  gameTabGo: document.querySelector("#game-tab-go"),
  gameTabXiangqi: document.querySelector("#game-tab-xiangqi"),
  activeGameBadge: document.querySelector("#active-game-badge"),
  activeModeBadge: document.querySelector("#active-mode-badge"),
  activeTurnBadge: document.querySelector("#active-turn-badge"),
  headlineTitle: document.querySelector("#headline-title"),
  headlineSubtitle: document.querySelector("#headline-subtitle"),
  goConfigPanel: document.querySelector("#go-config-panel"),
  xqConfigPanel: document.querySelector("#xiangqi-config-panel"),

  boardSizeInput: document.querySelector("#board-size-input"),
  komiInput: document.querySelector("#komi-input"),
  regionCountInput: document.querySelector("#region-count-input"),
  regionDefaultSizeInput: document.querySelector("#region-default-size-input"),
  regionSizesInput: document.querySelector("#region-sizes-input"),
  goMapSelect: document.querySelector("#go-map-select"),

  xqFuCountInput: document.querySelector("#xq-fu-count-input"),
  xqMapSelect: document.querySelector("#xq-map-select"),

  startLocalBtn: document.querySelector("#start-local-btn"),
  openSettingsBtn: document.querySelector("#open-settings-btn"),
  openEditorBtn: document.querySelector("#open-editor-btn"),
  enterEditorBtn: document.querySelector("#enter-editor-btn"),
  settingsModal: document.querySelector("#settings-modal"),
  closeSettingsBtn: document.querySelector("#close-settings-btn"),
  menuTabSetup: document.querySelector("#menu-tab-setup"),
  menuTabEditor: document.querySelector("#menu-tab-editor"),
  menuPanelSetup: document.querySelector("#menu-panel-setup"),
  menuPanelEditor: document.querySelector("#menu-panel-editor"),

  createRoomBtn: document.querySelector("#create-room-btn"),
  leaveRoomBtn: document.querySelector("#leave-room-btn"),
  roomListCountText: document.querySelector("#room-list-count-text"),
  roomList: document.querySelector("#room-list"),
  connectionBadge: document.querySelector("#connection-badge"),
  roomStatusBanner: document.querySelector("#room-status-banner"),
  roomIdText: document.querySelector("#room-id-text"),
  roomGameTypeText: document.querySelector("#room-game-type-text"),
  myColorText: document.querySelector("#my-color-text"),
  roomPlayersText: document.querySelector("#room-players-text"),
  playerSlot1: document.querySelector("#player-slot-1"),
  playerSlot1Label: document.querySelector("#player-slot-1-label"),
  playerSlot1Note: document.querySelector("#player-slot-1-note"),
  playerSlot1State: document.querySelector("#player-slot-1-state"),
  playerSlot1Action: document.querySelector("#player-slot-1-action"),
  playerSlot2: document.querySelector("#player-slot-2"),
  playerSlot2Label: document.querySelector("#player-slot-2-label"),
  playerSlot2Note: document.querySelector("#player-slot-2-note"),
  playerSlot2State: document.querySelector("#player-slot-2-state"),
  playerSlot2Action: document.querySelector("#player-slot-2-action"),

  readyBtn: document.querySelector("#ready-btn"),
  passBtn: document.querySelector("#pass-btn"),
  resignBtn: document.querySelector("#resign-btn"),
  scoreBtn: document.querySelector("#score-btn"),
  modeIndicatorText: document.querySelector("#mode-indicator-text"),
  phaseIndicatorText: document.querySelector("#phase-indicator-text"),
  turnIndicatorText: document.querySelector("#turn-indicator-text"),
  gameInfo: document.querySelector("#game-info"),

  editorSizeRow: document.querySelector("#editor-size-row"),
  editorSizeInput: document.querySelector("#editor-size-input"),
  applyEditorSizeBtn: document.querySelector("#apply-editor-size-btn"),
  clearEditorBtn: document.querySelector("#clear-editor-btn"),
  editorMapSelect: document.querySelector("#editor-map-select"),
  loadMapBtn: document.querySelector("#load-map-btn"),
  deleteMapBtn: document.querySelector("#delete-map-btn"),
  mapNameInput: document.querySelector("#map-name-input"),
  saveMapBtn: document.querySelector("#save-map-btn"),
  editorHint: document.querySelector("#editor-hint"),

  rulesBtn: document.querySelector("#rules-btn"),
  rulesModal: document.querySelector("#rules-modal"),
  closeRulesBtn: document.querySelector("#close-rules-btn"),
  rulesContent: document.querySelector("#rules-content"),

  statusText: document.querySelector("#status-text"),
  toastStack: document.querySelector("#toast-stack"),
  canvas: document.querySelector("#board-canvas")
};

const ctx = ui.canvas.getContext("2d");
const rafState = { pending: false };

const initialXqState = createXiangqiGameState({ fuPoints: [] });
const xqInitialOccupied = new Set();
for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
  for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
    if (initialXqState.board[y][x]) xqInitialOccupied.add(`${x},${y}`);
  }
}

const app = {
  gameType: GAME.GO,
  mode: "local",
  maps: [],

  go: {
    state: null,
    previewScore: null
  },

  xiangqi: {
    state: null,
    selected: null
  },

  editor: {
    gameType: GAME.GO,
    size: 19,
    blocked: new Set(),
    fu: new Set()
  },

  boardMetrics: null,
  viewWidth: 0,
  viewHeight: 0,

  ws: null,
  wsReady: false,
  connectionState: "connecting",
  reconnectTimer: null,

  room: createEmptyRoomState(),

  rulesTextCache: null,
  menuPanel: "setup"
};

function createEmptyRoomState(list = []) {
  return {
    id: null,
    gameType: null,
    color: null,
    playerToken: null,
    players: [],
    slots: [],
    stage: "idle",
    readyCount: 0,
    hasAnyReady: false,
    canEdit: true,
    canSwap: true,
    list,
    hasStartedNotice: false,
    hasEndedNotice: false
  };
}

function pointKey(x, y) {
  return `${x},${y}`;
}

function parsePointKey(key) {
  const [x, y] = key.split(",").map((n) => Number(n));
  return { x, y };
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

function loadActiveRoomSession() {
  try {
    const raw = localStorage.getItem(ACTIVE_ROOM_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const roomId = String(parsed?.roomId ?? "").trim().toUpperCase();
    const playerToken = String(parsed?.playerToken ?? "").trim();
    if (!roomId || !playerToken) return null;
    return { roomId, playerToken };
  } catch (_err) {
    return null;
  }
}

function saveActiveRoomSession(roomId, playerToken) {
  if (!roomId || !playerToken) return;
  try {
    localStorage.setItem(
      ACTIVE_ROOM_SESSION_KEY,
      JSON.stringify({
        roomId: String(roomId).trim().toUpperCase(),
        playerToken: String(playerToken).trim()
      })
    );
  } catch (_err) {}
}

function clearActiveRoomSession(roomId = null) {
  const saved = loadActiveRoomSession();
  if (!saved) return;
  if (roomId && saved.roomId !== String(roomId).trim().toUpperCase()) return;
  try {
    localStorage.removeItem(ACTIVE_ROOM_SESSION_KEY);
  } catch (_err) {}
}

function rememberRoomSession(roomId, playerToken) {
  if (!roomId || !playerToken) return;
  app.room.playerToken = playerToken;
  saveActiveRoomSession(roomId, playerToken);
}

function openSettingsModal() {
  ui.settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  ui.settingsModal.classList.add("hidden");
}

function switchMenuPanel(panel) {
  app.menuPanel = panel === "editor" ? "editor" : "setup";
  ui.menuTabSetup.classList.toggle("active", app.menuPanel === "setup");
  ui.menuTabEditor.classList.toggle("active", app.menuPanel === "editor");
  ui.menuPanelSetup.classList.toggle("hidden", app.menuPanel !== "setup");
  ui.menuPanelEditor.classList.toggle("hidden", app.menuPanel !== "editor");
}

async function openRulesModal() {
  ui.rulesModal.classList.remove("hidden");
  if (app.rulesTextCache) {
    ui.rulesContent.textContent = app.rulesTextCache;
    return;
  }
  ui.rulesContent.textContent = "加载中...";
  try {
    const resp = await fetch("./RULES.md", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    app.rulesTextCache = text;
    ui.rulesContent.textContent = text;
  } catch (error) {
    ui.rulesContent.textContent = `规则加载失败：${error.message}`;
  }
}

function closeRulesModal() {
  ui.rulesModal.classList.add("hidden");
}

function gameTypeLabel(gameType) {
  return gameType === GAME.XIANGQI ? "中国象棋" : "围棋";
}

function gameModeLabel(mode) {
  if (mode === "network") return "网页对战";
  if (mode === "editor") return "地图编辑";
  return "本地练习";
}

function roomStageLabel(stage) {
  if (stage === "playing") return "对战中";
  if (stage === "lobby") return "房间布阵";
  return "等待开局";
}

function sideLabel(gameType, side) {
  if (gameType === GAME.XIANGQI) {
    if (side === XQ_TEAM.RED) return "红方";
    if (side === XQ_TEAM.BLACK) return "黑方";
    return "-";
  }
  if (side === STONE.BLACK) return "黑";
  if (side === STONE.WHITE) return "白";
  return "-";
}

function sideList(gameType) {
  return gameType === GAME.XIANGQI ? [XQ_TEAM.RED, XQ_TEAM.BLACK] : [STONE.BLACK, STONE.WHITE];
}

function getRoomSlots() {
  const gameType = app.room.gameType ?? app.gameType;
  const slotsFromServer = Array.isArray(app.room.slots) && app.room.slots.length === 2 ? app.room.slots : null;
  if (slotsFromServer) {
    return slotsFromServer.map((slot) => ({
      side: slot.side,
      online: Boolean(slot.online),
      ready: Boolean(slot.ready)
    }));
  }
  return sideList(gameType).map((side) => ({
    side,
    online: app.room.players.includes(side),
    ready: false
  }));
}

function currentTurnLabel() {
  if (app.mode === "editor") return "编辑中";
  if (isNetworkLobby()) return "等待准备";
  const state = getCurrentState();
  if (!state) return "等待开局";
  return sideLabel(app.gameType, state.turn);
}

function currentPhaseLabel() {
  const state = getCurrentState();
  if (app.mode === "editor") return "地图编辑中";
  if (isNetworkLobby()) {
    return roomEditLocked() ? "已锁定布阵" : "房间布阵中";
  }
  if (!state) return "等待开局";
  if (state.gameOver) return "对局结束";
  if (app.mode === "network" && app.room.id) {
    return state.turn === app.room.color ? "轮到你行动" : "等待对手操作";
  }
  return "对局进行中";
}

function roomBannerText() {
  const state = getCurrentState();
  if (app.connectionState !== "online") {
    return app.room.id
      ? `房间 ${app.room.id} 连接中断，系统会自动重连；若恢复失败，可在大厅继续之前的棋局。`
      : "联机连接断开，系统会自动重连。";
  }
  if (!app.room.id) {
    return "未进入房间，可直接从下方房间列表点击加入。";
  }

  const slots = getRoomSlots();
  const onlineCount = slots.filter((slot) => slot.online).length;
  if (onlineCount < slots.length) {
    const missing = slots.find((slot) => !slot.online);
    return `房间 ${app.room.id} 已建立，等待 ${sideLabel(app.room.gameType ?? app.gameType, missing?.side)} 玩家加入。`;
  }

  if (app.room.stage === "lobby") {
    if (app.room.hasAnyReady) {
      return `房间 ${app.room.id} 已有人准备，当前不能换位置或编辑棋盘。`;
    }
    return `房间 ${app.room.id} 布阵阶段：先选边、同步棋盘，然后双方准备开始。`;
  }

  if (!state) {
    return `房间 ${app.room.id} 已满员，等待局面同步。`;
  }
  if (state.gameOver) {
    return `房间 ${app.room.id} 对局已结束，可继续复盘或重新开房。`;
  }
  if (state.turn === app.room.color) {
    return `房间 ${app.room.id} 轮到你行动。`;
  }
  return `房间 ${app.room.id} 轮到对手行动。`;
}

function isNetworkLobby() {
  return app.mode === "network" && app.room.id && app.room.stage === "lobby";
}

function roomEditLocked() {
  return isNetworkLobby() && app.room.hasAnyReady;
}

function syncEditorFromRoomConfig(config, gameType) {
  if (!config) return;
  app.editor.gameType = gameType;
  if (gameType === GAME.XIANGQI) {
    app.editor.fu = new Set((config.fuPoints ?? []).map((point) => pointKey(point.x, point.y)));
    setEditorHintByType(GAME.XIANGQI);
    return;
  }

  app.editor.size = Math.max(5, Math.min(25, Number(config.size) || 19));
  app.editor.blocked = new Set((config.blockedPoints ?? []).map((point) => pointKey(point.x, point.y)));
  ui.editorSizeInput.value = String(app.editor.size);
  ui.boardSizeInput.value = String(app.editor.size);
  ui.komiInput.value = String(Number.isFinite(Number(config.komi)) ? Number(config.komi) : 7.5);
  setEditorHintByType(GAME.GO);
}

function buildRoomConfigFromEditor(gameType = app.gameType) {
  if (gameType === GAME.XIANGQI) {
    return {
      fuPoints: Array.from(app.editor.fu).map(parsePointKey),
      mapName: ""
    };
  }

  return {
    size: app.editor.size,
    komi: Number(ui.komiInput.value) || 7.5,
    blockedPoints: normalizePointList(Array.from(app.editor.blocked).map(parsePointKey), app.editor.size),
    mapName: ""
  };
}

function pushRoomConfigUpdate() {
  if (!isNetworkLobby()) return;
  if (roomEditLocked()) {
    setStatus("已有玩家准备，当前不能再编辑棋盘。");
    return;
  }
  sendWs("update_room_config", { config: buildRoomConfigFromEditor(app.room.gameType ?? app.gameType) });
}

function createPreviewStateFromConfig(gameType, config) {
  if (gameType === GAME.XIANGQI) {
    return createXiangqiGameState({ fuPoints: config?.fuPoints ?? [] });
  }
  return createGameState({ size: config?.size ?? 19, blockedPoints: config?.blockedPoints ?? [], komi: config?.komi ?? 7.5 });
}

function resumeRoomSession(session, pendingText) {
  if (!session) {
    setStatus("未找到可恢复的房间凭证。");
    return false;
  }
  const sent = sendWs("resume_session", session);
  if (sent) {
    setStatus(pendingText ?? `正在恢复房间 ${session.roomId}...`);
  }
  return sent;
}

function applyRoomPayload(data, { autoEnterLobby = false } = {}) {
  const type = data.gameType === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO;
  setGameType(type, true);
  app.mode = "network";
  app.room.id = data.roomId ?? app.room.id;
  app.room.gameType = type;
  if (data.color != null) app.room.color = data.color;
  if (typeof data.playerToken === "string" && data.playerToken) {
    rememberRoomSession(data.roomId ?? app.room.id, data.playerToken);
  }
  app.room.stage = data.room?.stage ?? app.room.stage ?? "lobby";
  app.room.readyCount = Number(data.room?.readyCount ?? app.room.readyCount ?? 0);
  app.room.hasAnyReady = Boolean(data.room?.hasAnyReady ?? app.room.hasAnyReady);
  app.room.canEdit = Boolean(data.room?.canEdit ?? app.room.canEdit);
  app.room.canSwap = Boolean(data.room?.canSwap ?? app.room.canSwap);
  if (Array.isArray(data.room?.players)) app.room.players = data.room.players;
  if (Array.isArray(data.room?.slots)) app.room.slots = data.room.slots;
  if (data.config) {
    syncEditorFromRoomConfig(data.config, type);
  }
  if (data.state) {
    setCurrentState(data.state, type);
  } else if (app.room.stage === "lobby") {
    setCurrentState(createPreviewStateFromConfig(type, data.config ?? buildRoomConfigFromEditor(type)), type);
  }
  if (autoEnterLobby && app.room.stage === "lobby") {
    app.editor.gameType = type;
    setEditorHintByType(type);
  }
  updateRoomInfo();
  updateGameInfo();
  requestRender();
}

function renderRoomList() {
  const rooms = Array.isArray(app.room.list) ? app.room.list : [];
  const savedSession = loadActiveRoomSession();
  ui.roomListCountText.textContent = `${rooms.length} 个`;
  ui.roomList.innerHTML = "";

  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "room-list-empty";
    empty.textContent = "当前没有可见房间。点击“创建房间”即可建立一个可加入的联机房间。";
    ui.roomList.appendChild(empty);
    return;
  }

  for (const room of rooms) {
    const item = document.createElement("article");
    item.className = "room-list-item";

    const slots = Array.isArray(room.slots) ? room.slots : [];
    const onlineCount = slots.filter((slot) => slot.online).length;
    const readyCount = slots.filter((slot) => slot.ready).length;
    const canResume = Boolean(
      savedSession &&
        savedSession.roomId === room.id &&
        room.stage === "playing" &&
        slots.some((slot) => !slot.online)
    );

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${gameTypeLabel(room.gameType)} · ${room.id}`;
    const note = document.createElement("p");
    const detailParts = [`在线 ${onlineCount}/2`];
    if (room.stage === "lobby") {
      detailParts.push(`已准备 ${readyCount}/2`);
    } else if (room.winner != null) {
      detailParts.push(`胜方 ${sideLabel(room.gameType, room.winner)}`);
    } else if (room.currentTurn != null) {
      detailParts.push(`当前回合 ${sideLabel(room.gameType, room.currentTurn)}`);
    }
    note.textContent = `${roomStageLabel(room.stage)} | ${detailParts.join(" | ")}`;
    info.appendChild(title);
    info.appendChild(note);

    const action = document.createElement("button");
    action.type = "button";
    action.textContent =
      app.room.id === room.id
        ? "当前房间"
        : canResume
          ? "继续"
          : room.canJoin
            ? room.stage === "playing"
              ? "接管"
              : "加入"
            : room.stage === "playing"
              ? "进行中"
              : "已满";
    action.disabled = app.room.id === room.id || (!canResume && !room.canJoin);
    if (canResume) {
      action.addEventListener("click", () => {
        resumeRoomSession(savedSession, `正在继续房间 ${room.id} 的棋局...`);
      });
    } else if (room.canJoin && app.room.id !== room.id) {
      action.addEventListener("click", () => {
        sendWs("join_room", { roomId: room.id });
        setStatus(room.stage === "playing" ? `正在接回房间 ${room.id} 的空席位...` : `正在加入房间 ${room.id}...`);
      });
    }

    item.appendChild(info);
    item.appendChild(action);
    ui.roomList.appendChild(item);
  }
}

function showPopup(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  ui.toastStack.appendChild(item);
  window.setTimeout(() => {
    item.remove();
  }, 2600);
}

function showStartPopup(gameType) {
  showPopup(`对手已加入，${gameTypeLabel(gameType)}对局开始！`);
}

function showEndPopup(gameType, winner, myColor) {
  const winnerText = sideLabel(gameType, winner);
  if (!myColor) {
    showPopup(`对局结束，胜方：${winnerText}`);
    return;
  }
  if (winner === myColor) {
    showPopup(`对局结束：你获得胜利！`);
  } else {
    showPopup(`对局结束：你失败了。胜方：${winnerText}`);
  }
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
      .map((item) => {
        const gameType = item?.gameType === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO;
        if (gameType === GAME.GO) {
          const size = Math.max(5, Math.min(25, Number(item?.size) || 19));
          const blockedPoints = normalizePointList(item?.blockedPoints ?? [], size);
          return {
            id: String(item?.id ?? `map_${Date.now()}_${Math.floor(Math.random() * 10000)}`),
            name: String(item?.name ?? "未命名围棋图"),
            gameType,
            size,
            blockedPoints,
            updatedAt: Number(item?.updatedAt) || Date.now()
          };
        }
        const temp = createXiangqiGameState({ fuPoints: item?.fuPoints ?? [] });
        return {
          id: String(item?.id ?? `map_${Date.now()}_${Math.floor(Math.random() * 10000)}`),
          name: String(item?.name ?? "未命名象棋图"),
          gameType,
          fuPoints: collectFuPoints(temp.board),
          updatedAt: Number(item?.updatedAt) || Date.now()
        };
      })
      .filter((item) => Boolean(item?.id && item?.name));
  } catch (_err) {
    return [];
  }
}

function mapsByGameType(gameType) {
  return app.maps.filter((m) => m.gameType === gameType);
}

function selectedMapById(id, gameType) {
  if (!id) return null;
  return app.maps.find((m) => m.id === id && m.gameType === gameType) ?? null;
}

function fillSelectOptions(selectEl, options, emptyLabel) {
  const selected = selectEl.value;
  selectEl.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = emptyLabel;
  selectEl.appendChild(first);
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.id;
    el.textContent = option.label;
    selectEl.appendChild(el);
  }
  if (options.some((o) => o.id === selected)) {
    selectEl.value = selected;
  }
}

function refreshMapSelects() {
  fillSelectOptions(
    ui.goMapSelect,
    mapsByGameType(GAME.GO).map((map) => ({
      id: map.id,
      label: `${map.name} (${map.size}x${map.size}, 水潭${map.blockedPoints.length}点)`
    })),
    "不使用（按上方随机配置）"
  );

  fillSelectOptions(
    ui.xqMapSelect,
    mapsByGameType(GAME.XIANGQI).map((map) => ({
      id: map.id,
      label: `${map.name}（符${map.fuPoints.length}枚）`
    })),
    "不使用（按上方随机符数量）"
  );

  const editorType = app.mode === "editor" ? app.editor.gameType : app.gameType;
  fillSelectOptions(
    ui.editorMapSelect,
    mapsByGameType(editorType).map((map) => ({
      id: map.id,
      label: editorType === GAME.GO ? `${map.name} (${map.size}x${map.size})` : `${map.name}（符${map.fuPoints.length}枚）`
    })),
    "选择地图"
  );
}

function setActionButtonsByGame() {
  const isGo = app.gameType === GAME.GO;
  ui.passBtn.disabled = !isGo;
  ui.scoreBtn.disabled = !isGo;
  ui.passBtn.textContent = isGo ? "停一手（围棋）" : "停一手（围棋）";
  ui.scoreBtn.textContent = isGo ? "计算形势（围棋）" : "计算形势（围棋）";
}

function setEditorHintByType(type) {
  if (type === GAME.GO) {
    ui.editorHint.textContent = "围棋编辑器模式：点击交叉点切换水潭点。";
    ui.editorSizeRow.classList.remove("hidden");
  } else {
    ui.editorHint.textContent = "象棋编辑器模式：点击交叉点切换“符”位置（不可覆盖初始棋子）。";
    ui.editorSizeRow.classList.add("hidden");
  }
}

function setGameType(type, fromNetwork = false) {
  const next = type === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO;
  if (app.gameType === next && !fromNetwork) {
    setActionButtonsByGame();
    return;
  }

  if (app.mode === "network" && app.room.id && !fromNetwork) {
    leaveRoom();
    app.mode = "local";
  }

  app.gameType = next;
  ui.gameTabGo.classList.toggle("active", next === GAME.GO);
  ui.gameTabXiangqi.classList.toggle("active", next === GAME.XIANGQI);
  ui.goConfigPanel.classList.toggle("hidden", next !== GAME.GO);
  ui.xqConfigPanel.classList.toggle("hidden", next !== GAME.XIANGQI);

  if (app.mode === "editor") {
    app.editor.gameType = next;
    if (next === GAME.GO && !app.editor.size) app.editor.size = 19;
    setEditorHintByType(next);
  }

  setActionButtonsByGame();
  refreshMapSelects();
  updateRoomInfo();
  updateGameInfo();
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
    if (count > 0 && sizes.length < count) sizes = sizes.concat(Array(count - sizes.length).fill(defaultSize));
    if (count > 0 && sizes.length > count) sizes = sizes.slice(0, count);
  } else if (count > 0) {
    sizes = Array(count).fill(defaultSize);
  }
  return sizes;
}

function buildGoConfig() {
  const map = selectedMapById(ui.goMapSelect.value, GAME.GO);
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

function buildXqConfig() {
  const map = selectedMapById(ui.xqMapSelect.value, GAME.XIANGQI);
  if (map) {
    return {
      fuPoints: map.fuPoints,
      mapName: map.name
    };
  }

  const count = Math.max(0, Number(ui.xqFuCountInput.value) || 0);
  return {
    fuPoints: generateRandomFuPoints(count),
    mapName: ""
  };
}

function getCurrentState() {
  return app.gameType === GAME.XIANGQI ? app.xiangqi.state : app.go.state;
}

function setCurrentState(state, gameType = app.gameType) {
  if (gameType === GAME.XIANGQI) {
    app.xiangqi.state = state;
    app.xiangqi.selected = null;
  } else {
    app.go.state = state;
    app.go.previewScore = null;
  }
}

function startLocalGame() {
  if (app.room.id) leaveRoom();
  app.mode = "local";
  closeSettingsModal();

  if (app.gameType === GAME.XIANGQI) {
    const config = buildXqConfig();
    const state = createXiangqiGameState(config);
    setCurrentState(state, GAME.XIANGQI);
    setStatus(`已开始象棋自我对弈：符 ${config.fuPoints.length} 枚。`);
  } else {
    const config = buildGoConfig();
    if (!config) return;
    const state = createGameState(config);
    setCurrentState(state, GAME.GO);
    setStatus(`已开始围棋自我对弈：${config.size}路，水潭点 ${config.blockedPoints.length}`);
  }

  updateRoomInfo();
  updateGameInfo();
  requestRender();
}

function getWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const baseDirPath = new URL("./", window.location.href).pathname;
  const basePath = baseDirPath.endsWith("/") ? baseDirPath.slice(0, -1) : baseDirPath;
  return `${protocol}//${window.location.host}${basePath}/ws`;
}

function connectWs() {
  if (app.ws && (app.ws.readyState === WebSocket.OPEN || app.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  app.connectionState = "connecting";
  updateDashboard();
  const ws = new WebSocket(getWsUrl());
  app.ws = ws;

  ws.addEventListener("open", () => {
    if (app.reconnectTimer) {
      clearTimeout(app.reconnectTimer);
      app.reconnectTimer = null;
    }
    app.wsReady = true;
    app.connectionState = "online";
    updateRoomInfo();
    const savedSession = loadActiveRoomSession();
    if (savedSession) {
      ws.send(JSON.stringify({ type: "resume_session", ...savedSession }));
      setStatus(`网络已连接，正在恢复房间 ${savedSession.roomId}...`);
      return;
    }
    setStatus("WebSocket 已连接，可进行网页对战。");
  });

  ws.addEventListener("close", () => {
    app.wsReady = false;
    app.connectionState = "offline";
    if (app.room.id && app.room.playerToken) {
      saveActiveRoomSession(app.room.id, app.room.playerToken);
    }
    updateRoomInfo();
    if (app.mode === "network") setStatus("网络连接断开，正在重连...");
    if (app.reconnectTimer) clearTimeout(app.reconnectTimer);
    app.reconnectTimer = setTimeout(() => {
      app.reconnectTimer = null;
      connectWs();
    }, 1200);
  });

  ws.addEventListener("error", () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
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

function updatePresenceSlot(slotEl, labelEl, noteEl, stateEl, actionEl, slot, index) {
  const gameType = app.room.gameType ?? app.gameType;
  const state = getCurrentState();
  const online = Boolean(slot?.online);
  const ready = Boolean(slot?.ready);
  const side = slot?.side ?? sideList(gameType)[index];
  const isMine = app.room.color === side;
  const isTurn = Boolean(!isNetworkLobby() && state && !state.gameOver && state.turn === side);

  labelEl.textContent = `${sideLabel(gameType, side)}席位`;
  if (!app.room.id) {
    noteEl.textContent = index === 0 ? "房主位置" : "等待第二位玩家";
  } else if (isMine) {
    noteEl.textContent = ready ? "你已准备" : online ? "你已就位" : "你的席位断线";
  } else if (online) {
    noteEl.textContent = ready ? "对手已准备" : "对手已在线";
  } else {
    noteEl.textContent = "等待玩家进入";
  }

  stateEl.textContent = isTurn && online ? "行动中" : ready ? "已准备" : online ? "在线" : "离线";
  stateEl.className = `player-state ${online ? "online" : "offline"}${isTurn && online ? " turn" : ""}`;
  slotEl.classList.toggle("me", isMine);
  slotEl.classList.toggle("active-turn", isTurn && online);

  if (!app.room.id) {
    actionEl.textContent = "待加入";
    actionEl.disabled = true;
    return;
  }
  if (!isNetworkLobby()) {
    actionEl.textContent = isMine ? "已锁定" : "锁定";
    actionEl.disabled = true;
    return;
  }
  if (isMine) {
    actionEl.textContent = "当前";
    actionEl.disabled = true;
    return;
  }
  actionEl.textContent = roomEditLocked() ? "已锁定" : online ? "换到这边" : "选这边";
  actionEl.disabled = roomEditLocked();
}

function updateConfigLocks() {
  const lockRoomEditing = roomEditLocked() || (app.mode === "network" && app.room.stage === "playing");
  const disableSetup = app.mode === "network" && app.room.id && app.room.stage !== "idle";

  ui.boardSizeInput.disabled = disableSetup;
  ui.regionCountInput.disabled = disableSetup;
  ui.regionDefaultSizeInput.disabled = disableSetup;
  ui.regionSizesInput.disabled = disableSetup;
  ui.goMapSelect.disabled = disableSetup;
  ui.xqFuCountInput.disabled = disableSetup;
  ui.xqMapSelect.disabled = disableSetup;

  ui.komiInput.disabled = lockRoomEditing && isNetworkLobby();
  ui.editorSizeInput.disabled = lockRoomEditing;
  ui.applyEditorSizeBtn.disabled = lockRoomEditing;
  ui.clearEditorBtn.disabled = lockRoomEditing;
  ui.editorMapSelect.disabled = lockRoomEditing;
  ui.loadMapBtn.disabled = lockRoomEditing;
}

function updateDashboard() {
  const state = getCurrentState();
  const gameType = app.room.gameType ?? app.gameType;
  const connectionText =
    app.connectionState === "online" ? "已连接" : app.connectionState === "offline" ? "已断开" : "连接中";

  ui.connectionBadge.textContent = connectionText;
  ui.connectionBadge.className = `connection-pill ${app.connectionState === "online" ? "online" : ""}${
    app.connectionState === "offline" ? " offline" : ""
  }`;

  ui.activeGameBadge.textContent = gameTypeLabel(gameType);
  ui.activeModeBadge.textContent = gameModeLabel(app.mode);
  ui.activeTurnBadge.textContent =
    app.mode === "editor"
      ? "编辑模式已开启"
      : isNetworkLobby()
        ? roomEditLocked()
          ? "已有人准备"
          : "等待双方准备"
        : state
          ? `当前回合 ${sideLabel(gameType, state.turn)}`
          : "等待开局";

  ui.headlineTitle.textContent =
    app.mode === "editor" ? `${gameTypeLabel(gameType)}地图工坊` : isNetworkLobby() ? `${gameTypeLabel(gameType)}房间布阵` : `${gameTypeLabel(gameType)}对战台`;
  if (isNetworkLobby()) {
    ui.headlineSubtitle.textContent = `房间 ${app.room.id} 布阵阶段已开启，双方可先同步棋盘、选边并准备开局。`;
  } else if (app.mode === "network" && app.room.id) {
    ui.headlineSubtitle.textContent = `房间 ${app.room.id} 已接入，主界面突出房间状态、在线席位和当前回合。`;
  } else if (app.mode === "editor") {
    ui.headlineSubtitle.textContent = "棋盘保持在主舞台，复杂的地图尺寸、存档读取和保存管理都收纳在对局菜单中。";
  } else {
    ui.headlineSubtitle.textContent = "优先显示棋盘与关键回合信息，复杂配置收纳在对局菜单中。";
  }

  ui.modeIndicatorText.textContent = gameModeLabel(app.mode);
  ui.phaseIndicatorText.textContent = currentPhaseLabel();
  ui.turnIndicatorText.textContent = currentTurnLabel();
  ui.roomStatusBanner.textContent = roomBannerText();
  ui.readyBtn.disabled = !app.room.id || app.room.stage !== "lobby";
  const mySlot = getRoomSlots().find((slot) => slot.side === app.room.color);
  ui.readyBtn.textContent = mySlot?.ready ? "取消准备" : "准备";
  updateConfigLocks();
}

function updateRoomInfo() {
  const slots = getRoomSlots();
  const onlineCount = slots.filter((slot) => slot.online).length;

  ui.roomIdText.textContent = app.room.id ?? "-";
  ui.roomGameTypeText.textContent = app.room.gameType ? gameTypeLabel(app.room.gameType) : "-";
  ui.myColorText.textContent = app.room.color ? sideLabel(app.room.gameType ?? app.gameType, app.room.color) : "-";
  ui.roomPlayersText.textContent = app.room.id ? `${onlineCount} / ${slots.length} 在线` : "-";

  updatePresenceSlot(ui.playerSlot1, ui.playerSlot1Label, ui.playerSlot1Note, ui.playerSlot1State, ui.playerSlot1Action, slots[0], 0);
  updatePresenceSlot(ui.playerSlot2, ui.playerSlot2Label, ui.playerSlot2Note, ui.playerSlot2State, ui.playerSlot2Action, slots[1], 1);
  updateDashboard();
  renderRoomList();
}

function handleWsMessage(data) {
  if (data.type === "error") {
    setStatus(`服务端提示：${data.message}`);
    return;
  }
  if (data.type === "connected") return;

  if (data.type === "room_list") {
    app.room.list = Array.isArray(data.rooms) ? data.rooms : [];
    renderRoomList();
    return;
  }

  if (typeof data.playerToken === "string" && data.playerToken) {
    rememberRoomSession(data.roomId ?? app.room.id, data.playerToken);
  }

  if (data.room) {
    if (data.roomId) app.room.id = data.roomId;
    if (data.color != null) app.room.color = data.color;
    app.room.players = Array.isArray(data.room.players) ? data.room.players : app.room.players;
    app.room.slots = Array.isArray(data.room.slots) ? data.room.slots : app.room.slots;
    app.room.gameType = data.room.gameType ?? app.room.gameType;
    app.room.stage = data.room.stage ?? app.room.stage;
    app.room.readyCount = Number(data.room.readyCount ?? app.room.readyCount ?? 0);
    app.room.hasAnyReady = Boolean(data.room.hasAnyReady ?? app.room.hasAnyReady);
    app.room.canEdit = Boolean(data.room.canEdit ?? app.room.canEdit);
    app.room.canSwap = Boolean(data.room.canSwap ?? app.room.canSwap);
    updateRoomInfo();
  }

  if (data.type === "room_created" || data.type === "joined_room") {
    app.room.hasStartedNotice = false;
    app.room.hasEndedNotice = false;
    applyRoomPayload(data, { autoEnterLobby: true });
    closeSettingsModal();
    setStatus(
      data.room?.stage === "playing"
        ? `已进入房间 ${data.roomId}，已接回当前进行中的对局。`
        : `已进入房间 ${data.roomId}，可先同步棋盘、选择执方并准备开局。`
    );
    return;
  }

  if (data.type === "session_resumed") {
    app.room.hasStartedNotice = false;
    app.room.hasEndedNotice = false;
    applyRoomPayload(data, { autoEnterLobby: data.room?.stage === "lobby" });
    closeSettingsModal();
    setStatus(
      data.room?.stage === "playing"
        ? `已恢复房间 ${data.roomId} 的进行中对局。`
        : `已恢复房间 ${data.roomId}，继续布阵。`
    );
    return;
  }

  if (data.type === "session_resume_failed") {
    const keepSession = String(data.message ?? "").includes("当前在线");
    if (!keepSession) {
      clearActiveRoomSession();
      app.room = createEmptyRoomState(app.room.list);
      if (app.mode === "network") app.mode = "local";
      updateRoomInfo();
      updateGameInfo();
    }
    setStatus(
      keepSession
        ? `恢复失败：${data.message}`
        : `恢复失败：${data.message}。若房间仍在进行且有空席位，可在大厅直接点击“接管”。`
    );
    return;
  }

  if (data.type === "room_info") {
    if (app.room.id && data.roomId === app.room.id) {
      applyRoomPayload(data, { autoEnterLobby: true });
      setStatus(`房间信息更新：${data.room.id}`);
    } else {
      updateRoomInfo();
    }
    return;
  }

  if (data.type === "game_start") {
    app.room.hasStartedNotice = false;
    app.room.hasEndedNotice = false;
    applyRoomPayload(data);
    if (app.mode === "network" && app.room.id === data.roomId && !app.room.hasStartedNotice) {
      app.room.hasStartedNotice = true;
      showStartPopup(data.gameType === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO);
    }
    setStatus("双方已准备，对局开始。");
    return;
  }

  if (data.type === "state_update") {
    const type = data.gameType === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO;
    app.mode = "network";
    setGameType(type, true);
    app.room.stage = "playing";
    setCurrentState(data.state, type);
    updateGameInfo();
    requestRender();
    if (getCurrentState()?.gameOver) {
      setStatus("对局已结束。");
    } else {
      setStatus(`已同步对局，轮到 ${sideLabel(type, getCurrentState().turn)}。`);
    }
    return;
  }

  if (data.type === "game_end") {
    if (app.mode === "network" && app.room.id === data.roomId && !app.room.hasEndedNotice) {
      app.room.hasEndedNotice = true;
      const gameType = data.gameType === GAME.XIANGQI ? GAME.XIANGQI : GAME.GO;
      showEndPopup(gameType, data.winner, app.room.color);
    }
    return;
  }
}

function createRoom() {
  const config = app.gameType === GAME.XIANGQI ? buildXqConfig() : buildGoConfig();
  if (!config) return;
  if (!sendWs("create_room", { gameType: app.gameType, config })) return;
  setStatus(`正在创建${gameTypeLabel(app.gameType)}房间...`);
}

function leaveRoom() {
  sendWs("leave_room");
  clearActiveRoomSession(app.room.id);
  app.room = createEmptyRoomState(app.room.list);
  if (app.mode === "network") app.mode = "local";
  updateRoomInfo();
}

function myTurnInNetwork() {
  const state = getCurrentState();
  return app.mode === "network" && app.room.stage === "playing" && state && app.room.color === state.turn;
}

function runPass() {
  if (app.gameType !== GAME.GO) {
    setStatus("中国象棋不支持停一手。");
    return;
  }
  const state = app.go.state;
  if (!state) return;

  if (app.mode === "network") {
    if (app.room.stage !== "playing") {
      setStatus("双方准备并开始对局后，才可使用停一手。");
      return;
    }
    if (!myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    sendWs("pass");
    return;
  }

  const result = passTurn(state);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  app.go.state = result.state;
  app.go.previewScore = null;
  updateGameInfo();
  requestRender();
}

function runResign() {
  const state = getCurrentState();
  if (!state) return;

  if (app.mode === "network") {
    if (app.room.stage !== "playing") {
      setStatus("房间仍在布阵阶段，当前不能认输。");
      return;
    }
    if (!myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    sendWs("resign");
    return;
  }

  const result = app.gameType === GAME.XIANGQI ? resignXiangqi(state) : resignGame(state);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  setCurrentState(result.state);
  updateGameInfo();
  requestRender();
}

function runScorePreview() {
  if (app.gameType !== GAME.GO) {
    setStatus("中国象棋无形势计分按钮。可直接继续走子或认输。\n若局面无合法步，系统会判负。");
    return;
  }
  if (!app.go.state) return;
  app.go.previewScore = scoreGame(app.go.state);
  updateGameInfo();
}

function countXqUpgraded(state) {
  let red = 0;
  let black = 0;
  let fu = 0;
  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      const piece = state.board[y][x];
      if (!piece) continue;
      if (piece.team === XQ_TEAM.NEUTRAL) {
        if (piece.type === XQ_PIECE.FU) fu += 1;
      } else if (piece.upgraded) {
        if (piece.team === XQ_TEAM.RED) red += 1;
        else black += 1;
      }
    }
  }
  return { red, black, fu };
}

function updateGameInfo() {
  const state = getCurrentState();
  if (isNetworkLobby()) {
    const lines = [];
    lines.push(`游戏：${gameTypeLabel(app.gameType)} | 模式：网页对战房间`);
    lines.push(`阶段：房间布阵 | 房间：${app.room.id}`);
    lines.push(`执方：${app.room.color ? sideLabel(app.gameType, app.room.color) : "未选择"} | 已准备：${app.room.readyCount}/2`);
    lines.push(roomEditLocked() ? "布阵已锁定：已有玩家点击准备，当前不能再换边或编辑棋盘。" : "布阵可编辑：双方可在开局前同步棋盘、切换执方。");
    if (app.gameType === GAME.GO) {
      lines.push(`当前房间配置：${app.editor.size} 路 | 水潭点 ${app.editor.blocked.size} | 贴目 ${Number(ui.komiInput.value) || 7.5}`);
    } else {
      lines.push(`当前房间配置：场上符 ${app.editor.fu.size} 枚`);
    }
    ui.gameInfo.textContent = lines.join("\n");
    updateDashboard();
    return;
  }

  if (!state) {
    ui.gameInfo.textContent = "未开始对局";
    updateDashboard();
    return;
  }

  const lines = [];
  lines.push(`游戏：${gameTypeLabel(app.gameType)} | 模式：${app.mode === "network" ? "网页对战" : app.mode === "editor" ? "地图编辑器" : "本地自我对弈"}`);

  if (app.gameType === GAME.XIANGQI) {
    lines.push(`轮到：${sideLabel(GAME.XIANGQI, state.turn)} | 手数：${state.moveNumber}`);
    const counts = countXqUpgraded(state);
    lines.push(`升级棋子：红 ${counts.red} / 黑 ${counts.black} | 场上符：${counts.fu}`);

    if (app.xiangqi.selected) {
      lines.push(`当前选中：(${app.xiangqi.selected.x}, ${app.xiangqi.selected.y})`);
    }
    if (state.lastMove) {
      if (state.lastMove.type === "move") {
        lines.push(`最近走子：(${state.lastMove.fromX}, ${state.lastMove.fromY}) -> (${state.lastMove.toX}, ${state.lastMove.toY})`);
      } else if (state.lastMove.type === "resign") {
        lines.push(`最近操作：${sideLabel(GAME.XIANGQI, state.lastMove.color)} 认输`);
      }
    }

    const checkRed = isXiangqiInCheck(state, XQ_TEAM.RED);
    const checkBlack = isXiangqiInCheck(state, XQ_TEAM.BLACK);
    if (checkRed || checkBlack) {
      lines.push(`将军状态：${checkRed ? "红方被将" : ""}${checkRed && checkBlack ? "，" : ""}${checkBlack ? "黑方被将" : ""}`);
    }

    if (state.gameOver) {
      lines.push(`对局结束，胜者：${sideLabel(GAME.XIANGQI, state.winner)}`);
    }
  } else {
    lines.push(`轮到：${sideLabel(GAME.GO, state.turn)} | 手数：${state.moveNumber} | 连续停着：${state.passes}`);
    lines.push(`提子：黑 ${state.captures[STONE.BLACK]} / 白 ${state.captures[STONE.WHITE]}`);

    if (state.lastMove) {
      if (state.lastMove.type === "play") {
        lines.push(`最近落子：${sideLabel(GAME.GO, state.lastMove.color)} (${state.lastMove.x}, ${state.lastMove.y})`);
      } else if (state.lastMove.type === "pass") {
        lines.push(`最近操作：${sideLabel(GAME.GO, state.lastMove.color)} 停一手`);
      } else if (state.lastMove.type === "resign") {
        lines.push(`最近操作：${sideLabel(GAME.GO, state.lastMove.color)} 认输`);
      }
    }

    if (state.gameOver) {
      if (state.score) {
        lines.push(`终局得分：黑 ${state.score.blackTotal.toFixed(1)} / 白 ${state.score.whiteTotal.toFixed(1)}，胜者：${sideLabel(GAME.GO, state.winner)}`);
      } else {
        lines.push(`对局结束，胜者：${sideLabel(GAME.GO, state.winner)}`);
      }
    } else if (app.go.previewScore) {
      lines.push(`形势预估：黑 ${app.go.previewScore.blackTotal.toFixed(1)} / 白 ${app.go.previewScore.whiteTotal.toFixed(1)}`);
    }
  }

  ui.gameInfo.textContent = lines.join("\n");
  updateDashboard();
}

function drawWoodBackground(width, height) {
  const wood = ctx.createLinearGradient(0, 0, width, height);
  wood.addColorStop(0, "#d9b568");
  wood.addColorStop(1, "#bc8f43");
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, width, height);
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

function getStarPoints(size) {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  return [];
}

function computeGoMetrics(size) {
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
  return { width, height, side, boardX, boardY, firstX, firstY, lastX, lastY, cell, size };
}

function drawGoBoard(metrics) {
  drawWoodBackground(metrics.width, metrics.height);

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
  const dirs = [
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
      const cur = stack.pop();
      region.push(cur);
      for (const d of dirs) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        const nk = pointKey(nx, ny);
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
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
    cx: metrics.firstX + point.x * metrics.cell,
    cy: metrics.firstY + point.y * metrics.cell,
    point
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

  ctx.fillStyle = grad;
  const bleed = Math.max(0.6, metrics.cell * 0.03);
  for (const point of region) {
    const right = pointKey(point.x + 1, point.y);
    const down = pointKey(point.x, point.y + 1);
    const diag = pointKey(point.x + 1, point.y + 1);
    if (!regionSet.has(right) || !regionSet.has(down) || !regionSet.has(diag)) continue;
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
  ctx.restore();
}

function drawPonds(goState, metrics) {
  const blocked = collectBlockedPoints(goState.board);
  if (!blocked.length) return;
  const regions = blockRegions(blocked, goState.size);
  for (const region of regions) drawPondRegion(region, metrics);
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

function drawGoStones(goState, metrics) {
  for (let y = 0; y < goState.size; y += 1) {
    for (let x = 0; x < goState.size; x += 1) {
      const cell = goState.board[y][x];
      if (cell === STONE.BLACK || cell === STONE.WHITE) drawStone(x, y, cell, metrics);
    }
  }
}

function drawGoMarkers(goState, metrics) {
  if (goState.lastMove && goState.lastMove.type === "play") {
    const x = metrics.firstX + goState.lastMove.x * metrics.cell;
    const y = metrics.firstY + goState.lastMove.y * metrics.cell;
    ctx.fillStyle = "rgba(231, 65, 61, 0.92)";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.5, metrics.cell * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
  if (goState.ko) {
    const x = metrics.firstX + goState.ko.x * metrics.cell;
    const y = metrics.firstY + goState.ko.y * metrics.cell;
    const half = Math.max(3, metrics.cell * 0.14);
    ctx.strokeStyle = "rgba(8, 192, 224, 0.92)";
    ctx.lineWidth = Math.max(1.2, metrics.cell * 0.06);
    ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  }
}

function computeXqMetrics() {
  const width = app.viewWidth;
  const height = app.viewHeight;
  const cell = Math.min((width * 0.82) / 8, (height * 0.88) / 9);
  const boardW = cell * 8;
  const boardH = cell * 9;
  const firstX = (width - boardW) / 2;
  const firstY = (height - boardH) / 2;
  const lastX = firstX + boardW;
  const lastY = firstY + boardH;
  return {
    width,
    height,
    cell,
    firstX,
    firstY,
    lastX,
    lastY,
    boardW,
    boardH
  };
}

function drawXqBoard(metrics) {
  drawWoodBackground(metrics.width, metrics.height);

  const boardPad = metrics.cell * 0.68;
  const boardX = metrics.firstX - boardPad;
  const boardY = metrics.firstY - boardPad;
  const boardW = metrics.boardW + boardPad * 2;
  const boardH = metrics.boardH + boardPad * 2;
  const boardGrad = ctx.createLinearGradient(boardX, boardY, boardX, boardY + boardH);
  boardGrad.addColorStop(0, "#e8c982");
  boardGrad.addColorStop(1, "#cfa158");
  ctx.fillStyle = boardGrad;
  roundRect(ctx, boardX, boardY, boardW, boardH, metrics.cell * 0.2);
  ctx.fill();

  ctx.strokeStyle = "#6f4a16";
  ctx.lineWidth = 1.5;

  for (let y = 0; y <= 9; y += 1) {
    const py = metrics.firstY + y * metrics.cell;
    ctx.beginPath();
    ctx.moveTo(metrics.firstX, py);
    ctx.lineTo(metrics.lastX, py);
    ctx.stroke();
  }

  for (let x = 0; x <= 8; x += 1) {
    const px = metrics.firstX + x * metrics.cell;
    ctx.beginPath();
    if (x === 0 || x === 8) {
      ctx.moveTo(px, metrics.firstY);
      ctx.lineTo(px, metrics.lastY);
    } else {
      ctx.moveTo(px, metrics.firstY);
      ctx.lineTo(px, metrics.firstY + metrics.cell * 4);
      ctx.moveTo(px, metrics.firstY + metrics.cell * 5);
      ctx.lineTo(px, metrics.lastY);
    }
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(metrics.firstX + metrics.cell * 3, metrics.firstY);
  ctx.lineTo(metrics.firstX + metrics.cell * 5, metrics.firstY + metrics.cell * 2);
  ctx.moveTo(metrics.firstX + metrics.cell * 5, metrics.firstY);
  ctx.lineTo(metrics.firstX + metrics.cell * 3, metrics.firstY + metrics.cell * 2);

  ctx.moveTo(metrics.firstX + metrics.cell * 3, metrics.firstY + metrics.cell * 7);
  ctx.lineTo(metrics.firstX + metrics.cell * 5, metrics.firstY + metrics.cell * 9);
  ctx.moveTo(metrics.firstX + metrics.cell * 5, metrics.firstY + metrics.cell * 7);
  ctx.lineTo(metrics.firstX + metrics.cell * 3, metrics.firstY + metrics.cell * 9);
  ctx.stroke();

  ctx.fillStyle = "rgba(88, 52, 16, 0.78)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(14, metrics.cell * 0.6)}px "Noto Serif SC", "Songti SC", serif`;
  ctx.fillText("楚河", metrics.firstX + metrics.cell * 2, metrics.firstY + metrics.cell * 4.5);
  ctx.fillText("汉界", metrics.firstX + metrics.cell * 6, metrics.firstY + metrics.cell * 4.5);
}

function drawUpgradeHalo(cx, cy, size) {
  const outer = ctx.createRadialGradient(cx, cy, size * 0.22, cx, cy, size * 1.32);
  outer.addColorStop(0, "rgba(255, 244, 189, 0.12)");
  outer.addColorStop(0.55, "rgba(242, 196, 74, 0.38)");
  outer.addColorStop(1, "rgba(170, 106, 18, 0)");

  ctx.save();
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 1.32, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 245, 208, 0.7)";
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.beginPath();
  ctx.arc(cx, cy, size * 1.06, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function xqPieceText(piece) {
  if (piece.type === XQ_PIECE.FU) return "符";
  if (piece.type === XQ_PIECE.KING) return piece.team === XQ_TEAM.RED ? "帅" : "将";
  if (piece.type === XQ_PIECE.ADVISOR) return piece.team === XQ_TEAM.RED ? "仕" : "士";
  if (piece.type === XQ_PIECE.ELEPHANT) return piece.team === XQ_TEAM.RED ? "相" : "象";
  if (piece.type === XQ_PIECE.HORSE) return "马";
  if (piece.type === XQ_PIECE.ROOK) return "车";
  if (piece.type === XQ_PIECE.CANNON) return "炮";
  if (piece.type === XQ_PIECE.PAWN) return piece.team === XQ_TEAM.RED ? "兵" : "卒";
  return "?";
}

function drawXqPiece(piece, x, y, metrics, selected) {
  const cx = metrics.firstX + x * metrics.cell;
  const cy = metrics.firstY + y * metrics.cell;
  const r = Math.max(16, metrics.cell * 0.43);

  if (piece.upgraded && piece.team !== XQ_TEAM.NEUTRAL) {
    drawUpgradeHalo(cx, cy, r);
  }

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = r * 0.22;
  ctx.shadowOffsetY = r * 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);

  if (piece.team === XQ_TEAM.NEUTRAL) {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
    g.addColorStop(0, "#f5ffff");
    g.addColorStop(0.48, "#9bdfe1");
    g.addColorStop(1, "#4d8793");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#2f6874";
  } else {
    const g = ctx.createRadialGradient(cx - r * 0.26, cy - r * 0.32, r * 0.14, cx, cy, r);
    if (piece.upgraded) {
      g.addColorStop(0, "#fff9e6");
      g.addColorStop(0.42, "#f2d270");
      g.addColorStop(1, "#bb811f");
    } else {
      g.addColorStop(0, "#fffdf6");
      g.addColorStop(0.55, "#f0ddbd");
      g.addColorStop(1, "#d4b17b");
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = piece.team === XQ_TEAM.RED ? "#b12323" : "#242424";
  }

  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.stroke();

  if (selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(6, 209, 231, 0.95)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle =
    piece.team === XQ_TEAM.NEUTRAL
      ? "#1f5964"
      : piece.upgraded
        ? piece.team === XQ_TEAM.RED
          ? "#7f2113"
          : "#2d2417"
        : piece.team === XQ_TEAM.RED
          ? "#b42020"
          : "#191919";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(17, r * 0.92)}px "Noto Serif SC", "Songti SC", serif`;
  ctx.fillText(xqPieceText(piece), cx, cy + 1);

  ctx.restore();
}

function drawXqPieces(state, metrics) {
  const selected = app.xiangqi.selected;
  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      const piece = state.board[y][x];
      if (!piece) continue;
      const isSelected = Boolean(selected && selected.x === x && selected.y === y);
      drawXqPiece(piece, x, y, metrics, isSelected);
    }
  }

  if (state.lastMove?.type === "move") {
    const lx = metrics.firstX + state.lastMove.toX * metrics.cell;
    const ly = metrics.firstY + state.lastMove.toY * metrics.cell;
    ctx.fillStyle = "rgba(27, 195, 227, 0.95)";
    ctx.beginPath();
    ctx.arc(lx, ly, Math.max(4, metrics.cell * 0.11), 0, Math.PI * 2);
    ctx.fill();
  }
}

function getRenderGoState() {
  if ((app.mode === "editor" || isNetworkLobby()) && app.editor.gameType === GAME.GO) {
    const board = Array.from({ length: app.editor.size }, () => Array(app.editor.size).fill(STONE.EMPTY));
    for (const key of app.editor.blocked) {
      const p = parsePointKey(key);
      board[p.y][p.x] = STONE.BLOCKED;
    }
    return { size: app.editor.size, board, lastMove: null, ko: null };
  }
  return app.go.state;
}

function getRenderXqState() {
  if ((app.mode === "editor" || isNetworkLobby()) && app.editor.gameType === GAME.XIANGQI) {
    const fuPoints = Array.from(app.editor.fu).map(parsePointKey);
    return createXiangqiGameState({ fuPoints });
  }
  return app.xiangqi.state;
}

function render() {
  if (app.gameType === GAME.XIANGQI) {
    const state = getRenderXqState();
    const metrics = computeXqMetrics();
    app.boardMetrics = { ...metrics, gameType: GAME.XIANGQI };
    window.__codexMetrics = app.boardMetrics;
    drawXqBoard(metrics);
    if (state) drawXqPieces(state, metrics);
    return;
  }

  const goState = getRenderGoState();
  const size = goState?.size ?? Math.max(5, Math.min(25, Number(ui.boardSizeInput.value) || 19));
  const metrics = computeGoMetrics(size);
  app.boardMetrics = { ...metrics, gameType: GAME.GO };
  window.__codexMetrics = app.boardMetrics;
  drawGoBoard(metrics);
  if (goState) {
    drawPonds(goState, metrics);
    drawGoStones(goState, metrics);
    drawGoMarkers(goState, metrics);
  }
}

function requestRender() {
  if (rafState.pending) return;
  rafState.pending = true;
  window.requestAnimationFrame(() => {
    rafState.pending = false;
    render();
  });
}

function canvasPointToGo(clientX, clientY) {
  const rect = ui.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const metrics = app.boardMetrics;
  if (!metrics || metrics.gameType !== GAME.GO) return null;
  const boardX = Math.round((x - metrics.firstX) / metrics.cell);
  const boardY = Math.round((y - metrics.firstY) / metrics.cell);
  if (boardX < 0 || boardY < 0 || boardX >= metrics.size || boardY >= metrics.size) return null;
  const cx = metrics.firstX + boardX * metrics.cell;
  const cy = metrics.firstY + boardY * metrics.cell;
  if (Math.hypot(x - cx, y - cy) > metrics.cell * 0.43) return null;
  return { x: boardX, y: boardY };
}

function canvasPointToXq(clientX, clientY) {
  const rect = ui.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const metrics = app.boardMetrics;
  if (!metrics || metrics.gameType !== GAME.XIANGQI) return null;

  const gx = Math.round((x - metrics.firstX) / metrics.cell);
  const gy = Math.round((y - metrics.firstY) / metrics.cell);
  if (gx < 0 || gy < 0 || gx >= XQ_BOARD.WIDTH || gy >= XQ_BOARD.HEIGHT) return null;

  const cx = metrics.firstX + gx * metrics.cell;
  const cy = metrics.firstY + gy * metrics.cell;
  if (Math.hypot(x - cx, y - cy) > metrics.cell * 0.42) return null;
  return { x: gx, y: gy };
}

function handleGoPlay(point) {
  if (isNetworkLobby()) {
    setStatus("房间仍在布阵阶段，请先完成准备后再开始落子。");
    return;
  }
  const state = app.go.state;
  if (!state || state.gameOver) return;

  if (app.mode === "network") {
    if (!myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    sendWs("play_move", { x: point.x, y: point.y });
    return;
  }

  const result = playMove(state, point.x, point.y);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  app.go.state = result.state;
  app.go.previewScore = null;
  updateGameInfo();
  requestRender();
}

function handleXqPlay(point) {
  if (isNetworkLobby()) {
    setStatus("房间仍在布阵阶段，请先完成准备后再开始走子。");
    return;
  }
  const state = app.xiangqi.state;
  if (!state || state.gameOver) return;
  const piece = state.board[point.y][point.x];

  if (!app.xiangqi.selected) {
    if (!piece || piece.team !== state.turn) {
      setStatus("请选择当前回合的己方棋子。");
      return;
    }
    if (app.mode === "network" && !myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    app.xiangqi.selected = { x: point.x, y: point.y };
    updateGameInfo();
    requestRender();
    return;
  }

  const sel = app.xiangqi.selected;
  if (sel.x === point.x && sel.y === point.y) {
    app.xiangqi.selected = null;
    updateGameInfo();
    requestRender();
    return;
  }

  const selectedPiece = state.board[sel.y][sel.x];
  if (!selectedPiece || selectedPiece.team !== state.turn) {
    app.xiangqi.selected = null;
    updateGameInfo();
    requestRender();
    return;
  }

  if (piece && piece.team === state.turn) {
    app.xiangqi.selected = { x: point.x, y: point.y };
    updateGameInfo();
    requestRender();
    return;
  }

  if (app.mode === "network") {
    if (!myTurnInNetwork()) {
      setStatus("当前不是你的回合");
      return;
    }
    sendWs("play_move", { fromX: sel.x, fromY: sel.y, toX: point.x, toY: point.y });
    return;
  }

  const result = moveXiangqi(state, sel.x, sel.y, point.x, point.y);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  app.xiangqi.selected = null;
  app.xiangqi.state = result.state;
  updateGameInfo();
  requestRender();
}

function toggleEditorPoint(point) {
  if (roomEditLocked()) {
    setStatus("已有玩家准备，当前不能继续编辑棋盘。");
    return;
  }
  if (app.editor.gameType === GAME.GO) {
    const key = pointKey(point.x, point.y);
    if (app.editor.blocked.has(key)) app.editor.blocked.delete(key);
    else app.editor.blocked.add(key);
    setStatus(`${isNetworkLobby() ? "房间布阵" : "围棋编辑器"}：水潭点 ${app.editor.blocked.size}`);
    if (isNetworkLobby()) pushRoomConfigUpdate();
    requestRender();
    updateGameInfo();
    return;
  }

  const key = pointKey(point.x, point.y);
  if (xqInitialOccupied.has(key)) {
    setStatus("该点是象棋初始棋子位置，不能放置符。");
    return;
  }
  if (app.editor.fu.has(key)) app.editor.fu.delete(key);
  else app.editor.fu.add(key);
  setStatus(`${isNetworkLobby() ? "房间布阵" : "象棋编辑器"}：符 ${app.editor.fu.size} 枚`);
  if (isNetworkLobby()) pushRoomConfigUpdate();
  requestRender();
  updateGameInfo();
}

function handleBoardClick(event) {
  if (app.gameType === GAME.XIANGQI) {
    const point = canvasPointToXq(event.clientX, event.clientY);
    if (!point) return;
    if (app.mode === "editor" || isNetworkLobby()) {
      toggleEditorPoint(point);
      return;
    }
    handleXqPlay(point);
    return;
  }

  const point = canvasPointToGo(event.clientX, event.clientY);
  if (!point) return;
  if (app.mode === "editor" || isNetworkLobby()) {
    toggleEditorPoint(point);
    return;
  }
  handleGoPlay(point);
}

function loadMapToEditor(map) {
  const inRoomLobby = isNetworkLobby();
  if (!inRoomLobby) app.mode = "editor";
  app.editor.gameType = map.gameType;
  setGameType(map.gameType, true);

  if (map.gameType === GAME.GO) {
    app.editor.size = map.size;
    app.editor.blocked = new Set(map.blockedPoints.map((p) => pointKey(p.x, p.y)));
    ui.editorSizeInput.value = String(map.size);
    setEditorHintByType(GAME.GO);
  } else {
    app.editor.fu = new Set(map.fuPoints.map((p) => pointKey(p.x, p.y)));
    setEditorHintByType(GAME.XIANGQI);
  }

  ui.mapNameInput.value = map.name;
  refreshMapSelects();
  ui.editorMapSelect.value = map.id;
  setStatus(`已加载地图：${map.name}`);
  if (inRoomLobby) {
    pushRoomConfigUpdate();
  }
  updateGameInfo();
  requestRender();
}

function setEditorSize(size) {
  const clamped = Math.max(5, Math.min(25, Number(size) || 19));
  app.editor.size = clamped;
  app.editor.blocked = new Set();
  ui.editorSizeInput.value = String(clamped);
  ui.boardSizeInput.value = String(clamped);
  if (!isNetworkLobby()) app.mode = "editor";
  app.editor.gameType = GAME.GO;
  setEditorHintByType(GAME.GO);
  refreshMapSelects();
  if (isNetworkLobby()) {
    pushRoomConfigUpdate();
    updateGameInfo();
  }
  requestRender();
}

function openEditorForCurrentGame() {
  if (isNetworkLobby()) {
    app.editor.gameType = app.gameType;
    setEditorHintByType(app.editor.gameType);
    refreshMapSelects();
    setStatus(`已进入${gameTypeLabel(app.editor.gameType)}房间布阵模式。`);
    updateGameInfo();
    requestRender();
    return;
  }

  app.mode = "editor";
  app.editor.gameType = app.gameType;
  setEditorHintByType(app.editor.gameType);

  if (app.editor.gameType === GAME.GO) {
    if (app.go.state) {
      app.editor.size = app.go.state.size;
      ui.editorSizeInput.value = String(app.go.state.size);
      app.editor.blocked = new Set(collectBlockedPoints(app.go.state.board).map((p) => pointKey(p.x, p.y)));
    }
  } else {
    if (app.xiangqi.state) {
      app.editor.fu = new Set(collectFuPoints(app.xiangqi.state.board).map((p) => pointKey(p.x, p.y)));
    }
  }

  refreshMapSelects();
  setStatus(`已进入${gameTypeLabel(app.editor.gameType)}地图编辑器。`);
  updateGameInfo();
  requestRender();
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
  ui.gameTabGo.addEventListener("click", () => setGameType(GAME.GO));
  ui.gameTabXiangqi.addEventListener("click", () => setGameType(GAME.XIANGQI));

  ui.startLocalBtn.addEventListener("click", startLocalGame);
  ui.openEditorBtn.addEventListener("click", () => {
    switchMenuPanel("editor");
    openSettingsModal();
  });
  ui.enterEditorBtn.addEventListener("click", () => {
    openEditorForCurrentGame();
    closeSettingsModal();
  });
  ui.openSettingsBtn.addEventListener("click", () => {
    switchMenuPanel("setup");
    openSettingsModal();
  });
  ui.closeSettingsBtn.addEventListener("click", closeSettingsModal);
  ui.menuTabSetup.addEventListener("click", () => switchMenuPanel("setup"));
  ui.menuTabEditor.addEventListener("click", () => switchMenuPanel("editor"));
  ui.settingsModal.addEventListener("click", (event) => {
    if (event.target === ui.settingsModal) closeSettingsModal();
  });

  ui.createRoomBtn.addEventListener("click", createRoom);
  ui.playerSlot1Action.addEventListener("click", () => {
    sendWs("choose_side", { side: getRoomSlots()[0]?.side });
  });
  ui.playerSlot2Action.addEventListener("click", () => {
    sendWs("choose_side", { side: getRoomSlots()[1]?.side });
  });
  ui.leaveRoomBtn.addEventListener("click", () => {
    leaveRoom();
    setStatus("已离开房间");
    updateGameInfo();
  });

  ui.readyBtn.addEventListener("click", () => {
    if (!isNetworkLobby()) {
      setStatus("当前不在房间布阵阶段。");
      return;
    }
    const mySlot = getRoomSlots().find((slot) => slot.side === app.room.color);
    sendWs("set_ready", { ready: !mySlot?.ready });
  });
  ui.passBtn.addEventListener("click", runPass);
  ui.resignBtn.addEventListener("click", runResign);
  ui.scoreBtn.addEventListener("click", runScorePreview);

  ui.applyEditorSizeBtn.addEventListener("click", () => {
    setEditorSize(Number(ui.editorSizeInput.value) || 19);
    setStatus(`围棋编辑器棋盘已切换为 ${app.editor.size} 路。`);
  });

  ui.clearEditorBtn.addEventListener("click", () => {
    if (roomEditLocked()) {
      setStatus("已有玩家准备，当前不能继续编辑棋盘。");
      return;
    }
    if (app.editor.gameType === GAME.GO) app.editor.blocked = new Set();
    else app.editor.fu = new Set();
    setStatus(`${gameTypeLabel(app.editor.gameType)}编辑点已清空。`);
    if (isNetworkLobby()) pushRoomConfigUpdate();
    requestRender();
    updateGameInfo();
  });

  ui.loadMapBtn.addEventListener("click", () => {
    const type = app.mode === "editor" ? app.editor.gameType : app.gameType;
    const map = selectedMapById(ui.editorMapSelect.value, type);
    if (!map) {
      setStatus("请选择地图后再加载。");
      return;
    }
    loadMapToEditor(map);
  });

  ui.deleteMapBtn.addEventListener("click", () => {
    const type = app.mode === "editor" ? app.editor.gameType : app.gameType;
    const mapId = ui.editorMapSelect.value;
    if (!selectedMapById(mapId, type)) {
      setStatus("请选择地图后再删除。");
      return;
    }
    app.maps = app.maps.filter((m) => m.id !== mapId);
    saveMapsToStorage();
    refreshMapSelects();
    setStatus("已删除地图。");
  });

  ui.saveMapBtn.addEventListener("click", () => {
    const name = String(ui.mapNameInput.value ?? "").trim();
    if (!name) {
      setStatus("请填写地图名称。");
      return;
    }

    const type = app.editor.gameType;
    const exists = selectedMapById(ui.editorMapSelect.value, type);
    const id = exists?.id ?? `map_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    let map;
    if (type === GAME.GO) {
      map = {
        id,
        name,
        gameType: GAME.GO,
        size: app.editor.size,
        blockedPoints: normalizePointList(Array.from(app.editor.blocked).map(parsePointKey), app.editor.size),
        updatedAt: Date.now()
      };
    } else {
      const state = createXiangqiGameState({ fuPoints: Array.from(app.editor.fu).map(parsePointKey) });
      map = {
        id,
        name,
        gameType: GAME.XIANGQI,
        fuPoints: collectFuPoints(state.board),
        updatedAt: Date.now()
      };
    }

    if (exists) {
      app.maps = app.maps.map((m) => (m.id === id ? map : m));
      setStatus(`已覆盖保存地图：${name}`);
    } else {
      app.maps.push(map);
      setStatus(`已新增保存地图：${name}`);
    }

    app.maps.sort((a, b) => b.updatedAt - a.updatedAt);
    saveMapsToStorage();
    refreshMapSelects();
    ui.editorMapSelect.value = id;
    if (type === GAME.GO) ui.goMapSelect.value = id;
    else ui.xqMapSelect.value = id;
  });

  ui.canvas.addEventListener("click", handleBoardClick);
  ui.komiInput.addEventListener("change", () => {
    if (isNetworkLobby() && app.gameType === GAME.GO && !roomEditLocked()) {
      pushRoomConfigUpdate();
      updateGameInfo();
    }
  });
  ui.rulesBtn.addEventListener("click", () => {
    closeSettingsModal();
    openRulesModal();
  });
  ui.closeRulesBtn.addEventListener("click", closeRulesModal);
  ui.rulesModal.addEventListener("click", (event) => {
    if (event.target === ui.rulesModal) closeRulesModal();
  });

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("online", () => {
    if (app.connectionState !== "online") connectWs();
  });
  window.addEventListener("offline", () => {
    if (app.mode === "network") {
      setStatus("浏览器检测到网络离线，正在等待恢复...");
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !ui.rulesModal.classList.contains("hidden")) {
      closeRulesModal();
      return;
    }
    if (event.key === "Escape" && !ui.settingsModal.classList.contains("hidden")) {
      closeSettingsModal();
      return;
    }
    if (event.key.toLowerCase() !== "f") return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    document.documentElement.requestFullscreen().catch(() => {});
  });
}

function buildGoTextPayload(state) {
  const blackStones = [];
  const whiteStones = [];
  const blocked = [];
  for (let y = 0; y < state.size; y += 1) {
    for (let x = 0; x < state.size; x += 1) {
      const v = state.board[y][x];
      if (v === STONE.BLACK) blackStones.push({ x, y });
      if (v === STONE.WHITE) whiteStones.push({ x, y });
      if (v === STONE.BLOCKED) blocked.push({ x, y });
    }
  }
  return {
    gameType: GAME.GO,
    boardSize: state.size,
    turn: COLOR_LABEL[state.turn] ?? null,
    gameOver: state.gameOver,
    lastMove: state.lastMove ?? null,
    ko: state.ko ?? null,
    captures: state.captures ?? null,
    stones: {
      black: blackStones,
      white: whiteStones,
      blocked
    }
  };
}

function buildXqTextPayload(state) {
  const red = [];
  const black = [];
  const fu = [];

  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      const piece = state.board[y][x];
      if (!piece) continue;
      const info = { x, y, type: piece.type, upgraded: Boolean(piece.upgraded) };
      if (piece.team === XQ_TEAM.RED) red.push(info);
      else if (piece.team === XQ_TEAM.BLACK) black.push(info);
      else fu.push(info);
    }
  }

  return {
    gameType: GAME.XIANGQI,
    boardSize: { width: XQ_BOARD.WIDTH, height: XQ_BOARD.HEIGHT },
    turn: state.turn === XQ_TEAM.RED ? "red" : "black",
    gameOver: state.gameOver,
    winner: state.winner === XQ_TEAM.RED ? "red" : state.winner === XQ_TEAM.BLACK ? "black" : null,
    lastMove: state.lastMove ?? null,
    selected: app.xiangqi.selected,
    pieces: { red, black, fu }
  };
}

function initTextHooks() {
  window.render_game_to_text = () => {
    const payload = {
      mode: app.mode,
      coordinate: "原点在左上角，x 向右，y 向下",
      roomId: app.room.id,
      mySide: app.room.color ? sideLabel(app.room.gameType ?? app.gameType, app.room.color) : null
    };

    if (app.gameType === GAME.XIANGQI) {
      const state = getRenderXqState() ?? createXiangqiGameState({ fuPoints: [] });
      return JSON.stringify({ ...payload, ...buildXqTextPayload(state) });
    }

    const state = getRenderGoState() ?? createGameState({ size: 19, blockedPoints: [] });
    return JSON.stringify({ ...payload, ...buildGoTextPayload(state) });
  };

  window.advanceTime = (_ms) => {
    render();
  };
}

function init() {
  app.maps = loadMapsFromStorage();
  refreshMapSelects();
  bindEvents();
  switchMenuPanel("setup");
  connectWs();

  app.editor.size = 19;
  setGameType(GAME.GO, true);
  setEditorHintByType(GAME.GO);

  app.go.state = createGameState(buildGoConfig() ?? { size: 19, komi: 7.5, blockedPoints: [] });
  app.xiangqi.state = createXiangqiGameState(buildXqConfig());

  app.mode = "local";
  initTextHooks();
  resizeCanvas();
  updateGameInfo();
  setStatus("准备就绪：可在“围棋 / 中国象棋”标签中切换，支持本地与网页对战。");
}

init();
