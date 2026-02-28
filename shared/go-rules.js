export const STONE = Object.freeze({
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2,
  BLOCKED: 3
});

export const COLOR_LABEL = Object.freeze({
  [STONE.BLACK]: "black",
  [STONE.WHITE]: "white"
});

export function otherColor(color) {
  return color === STONE.BLACK ? STONE.WHITE : STONE.BLACK;
}

function pointKey(x, y) {
  return `${x},${y}`;
}

function parsePointKey(key) {
  const [x, y] = key.split(",").map((n) => Number(n));
  return { x, y };
}

function makeBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(STONE.EMPTY));
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function isInBounds(size, x, y) {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function neighbors(size, x, y) {
  const output = [];
  if (x > 0) output.push({ x: x - 1, y });
  if (x + 1 < size) output.push({ x: x + 1, y });
  if (y > 0) output.push({ x, y: y - 1 });
  if (y + 1 < size) output.push({ x, y: y + 1 });
  return output;
}

function groupAndLiberties(board, size, startX, startY) {
  const color = board[startY][startX];
  const stack = [{ x: startX, y: startY }];
  const seen = new Set([pointKey(startX, startY)]);
  const stones = [];
  const liberties = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    stones.push(current);
    for (const next of neighbors(size, current.x, current.y)) {
      const nextValue = board[next.y][next.x];
      if (nextValue === STONE.EMPTY) {
        liberties.add(pointKey(next.x, next.y));
        continue;
      }
      if (nextValue !== color) {
        continue;
      }
      const k = pointKey(next.x, next.y);
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      stack.push(next);
    }
  }

  return { color, stones, liberties };
}

function removeGroup(board, stones) {
  let removed = 0;
  for (const stone of stones) {
    if (board[stone.y][stone.x] !== STONE.EMPTY) {
      board[stone.y][stone.x] = STONE.EMPTY;
      removed += 1;
    }
  }
  return removed;
}

function cloneState(state) {
  return {
    size: state.size,
    board: cloneBoard(state.board),
    turn: state.turn,
    passes: state.passes,
    moveNumber: state.moveNumber,
    captures: {
      [STONE.BLACK]: state.captures[STONE.BLACK],
      [STONE.WHITE]: state.captures[STONE.WHITE]
    },
    ko: state.ko ? { x: state.ko.x, y: state.ko.y } : null,
    komi: state.komi,
    gameOver: state.gameOver,
    winner: state.winner,
    resignedBy: state.resignedBy,
    score: state.score ? { ...state.score } : null,
    lastMove: state.lastMove ? { ...state.lastMove } : null
  };
}

export function normalizePointList(points, size) {
  const unique = new Set();
  const output = [];
  for (const point of points ?? []) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      continue;
    }
    if (!isInBounds(size, x, y)) {
      continue;
    }
    const k = pointKey(x, y);
    if (unique.has(k)) {
      continue;
    }
    unique.add(k);
    output.push({ x, y });
  }
  return output;
}

export function createGameState({ size = 19, blockedPoints = [], komi = 7.5 } = {}) {
  const board = makeBoard(size);
  for (const point of normalizePointList(blockedPoints, size)) {
    board[point.y][point.x] = STONE.BLOCKED;
  }
  return {
    size,
    board,
    turn: STONE.BLACK,
    passes: 0,
    moveNumber: 0,
    captures: {
      [STONE.BLACK]: 0,
      [STONE.WHITE]: 0
    },
    ko: null,
    komi,
    gameOver: false,
    winner: null,
    resignedBy: null,
    score: null,
    lastMove: null
  };
}

export function playMove(state, x, y) {
  if (state.gameOver) {
    return { ok: false, error: "棋局已结束" };
  }
  if (!isInBounds(state.size, x, y)) {
    return { ok: false, error: "落子越界" };
  }
  if (state.board[y][x] !== STONE.EMPTY) {
    return { ok: false, error: "该位置不可落子" };
  }
  if (state.ko && state.ko.x === x && state.ko.y === y) {
    return { ok: false, error: "打劫，暂不可在此落子" };
  }

  const next = cloneState(state);
  const color = state.turn;
  const enemy = otherColor(color);
  next.board[y][x] = color;
  next.passes = 0;
  next.moveNumber += 1;
  next.lastMove = { type: "play", x, y, color, moveNumber: next.moveNumber };
  next.ko = null;

  let capturedTotal = 0;
  let capturedPoint = null;
  const checkedEnemy = new Set();
  for (const near of neighbors(state.size, x, y)) {
    if (next.board[near.y][near.x] !== enemy) {
      continue;
    }
    const k = pointKey(near.x, near.y);
    if (checkedEnemy.has(k)) {
      continue;
    }
    const enemyGroup = groupAndLiberties(next.board, state.size, near.x, near.y);
    for (const stone of enemyGroup.stones) {
      checkedEnemy.add(pointKey(stone.x, stone.y));
    }
    if (enemyGroup.liberties.size > 0) {
      continue;
    }
    capturedTotal += removeGroup(next.board, enemyGroup.stones);
    if (enemyGroup.stones.length === 1) {
      capturedPoint = { x: enemyGroup.stones[0].x, y: enemyGroup.stones[0].y };
    } else {
      capturedPoint = null;
    }
  }

  const ownGroup = groupAndLiberties(next.board, state.size, x, y);
  if (ownGroup.liberties.size === 0) {
    return { ok: false, error: "禁入点（自杀）" };
  }

  if (capturedTotal > 0) {
    next.captures[color] += capturedTotal;
  }

  if (capturedTotal === 1 && capturedPoint && ownGroup.stones.length === 1 && ownGroup.liberties.size === 1) {
    const onlyLiberty = parsePointKey(Array.from(ownGroup.liberties)[0]);
    if (onlyLiberty.x === capturedPoint.x && onlyLiberty.y === capturedPoint.y) {
      next.ko = capturedPoint;
    }
  }

  next.turn = enemy;
  return { ok: true, state: next, captured: capturedTotal };
}

export function passTurn(state) {
  if (state.gameOver) {
    return { ok: false, error: "棋局已结束" };
  }
  const next = cloneState(state);
  const color = state.turn;
  next.moveNumber += 1;
  next.lastMove = { type: "pass", color, moveNumber: next.moveNumber };
  next.passes += 1;
  next.ko = null;
  next.turn = otherColor(color);
  if (next.passes >= 2) {
    next.gameOver = true;
    next.score = scoreGame(next);
    next.winner = next.score.blackTotal > next.score.whiteTotal ? STONE.BLACK : STONE.WHITE;
  }
  return { ok: true, state: next };
}

export function resignGame(state, color = state.turn) {
  if (state.gameOver) {
    return { ok: false, error: "棋局已结束" };
  }
  const next = cloneState(state);
  next.moveNumber += 1;
  next.lastMove = { type: "resign", color, moveNumber: next.moveNumber };
  next.gameOver = true;
  next.resignedBy = color;
  next.winner = otherColor(color);
  next.score = null;
  return { ok: true, state: next };
}

export function scoreGame(state) {
  const size = state.size;
  const board = state.board;
  let blackStones = 0;
  let whiteStones = 0;
  let blocked = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cell = board[y][x];
      if (cell === STONE.BLACK) blackStones += 1;
      if (cell === STONE.WHITE) whiteStones += 1;
      if (cell === STONE.BLOCKED) blocked += 1;
    }
  }

  const seen = new Set();
  let blackTerritory = 0;
  let whiteTerritory = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (board[y][x] !== STONE.EMPTY) {
        continue;
      }
      const root = pointKey(x, y);
      if (seen.has(root)) {
        continue;
      }
      const stack = [{ x, y }];
      const emptyRegion = [];
      const borderColors = new Set();
      seen.add(root);

      while (stack.length > 0) {
        const current = stack.pop();
        emptyRegion.push(current);
        for (const next of neighbors(size, current.x, current.y)) {
          const nextValue = board[next.y][next.x];
          if (nextValue === STONE.EMPTY) {
            const nk = pointKey(next.x, next.y);
            if (!seen.has(nk)) {
              seen.add(nk);
              stack.push(next);
            }
          } else if (nextValue === STONE.BLACK || nextValue === STONE.WHITE) {
            borderColors.add(nextValue);
          }
        }
      }

      if (borderColors.size === 1) {
        if (borderColors.has(STONE.BLACK)) {
          blackTerritory += emptyRegion.length;
        } else if (borderColors.has(STONE.WHITE)) {
          whiteTerritory += emptyRegion.length;
        }
      }
    }
  }

  const blackTotal = blackStones + blackTerritory;
  const whiteTotal = whiteStones + whiteTerritory + state.komi;

  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    blocked,
    komi: state.komi,
    blackTotal,
    whiteTotal,
    winner: blackTotal > whiteTotal ? STONE.BLACK : STONE.WHITE
  };
}

export function collectBlockedPoints(board) {
  const points = [];
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board[y].length; x += 1) {
      if (board[y][x] === STONE.BLOCKED) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

function randomInt(limit) {
  return Math.floor(Math.random() * limit);
}

export function generateConnectedBlockedRegions(size, regionSizes, maxRegionAttempts = 160) {
  const occupied = new Set();
  const regions = [];
  const allSizes = (regionSizes ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);

  for (const targetSize of allSizes) {
    let created = null;
    for (let attempt = 0; attempt < maxRegionAttempts; attempt += 1) {
      const candidate = buildConnectedRegion(size, targetSize, occupied);
      if (candidate) {
        created = candidate;
        break;
      }
    }
    if (!created) {
      throw new Error(`无法生成大小为 ${targetSize} 的连通不可达区域`);
    }
    for (const point of created) {
      occupied.add(pointKey(point.x, point.y));
    }
    regions.push(created);
  }

  return {
    regions,
    blockedPoints: regions.flat()
  };
}

function buildConnectedRegion(size, targetSize, occupied) {
  const available = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const k = pointKey(x, y);
      if (!occupied.has(k)) {
        available.push({ x, y });
      }
    }
  }
  if (available.length < targetSize) {
    return null;
  }

  const seed = available[randomInt(available.length)];
  const region = [seed];
  const regionSet = new Set([pointKey(seed.x, seed.y)]);
  const frontier = [];
  const frontierSet = new Set();

  const pushFrontier = (x, y) => {
    if (!isInBounds(size, x, y)) return;
    const k = pointKey(x, y);
    if (occupied.has(k) || regionSet.has(k) || frontierSet.has(k)) return;
    frontier.push({ x, y });
    frontierSet.add(k);
  };

  for (const near of neighbors(size, seed.x, seed.y)) {
    pushFrontier(near.x, near.y);
  }

  while (region.length < targetSize) {
    if (frontier.length === 0) {
      return null;
    }
    const pickIndex = randomInt(frontier.length);
    const next = frontier[pickIndex];
    frontier.splice(pickIndex, 1);
    frontierSet.delete(pointKey(next.x, next.y));
    const nk = pointKey(next.x, next.y);
    if (occupied.has(nk) || regionSet.has(nk)) {
      continue;
    }
    region.push(next);
    regionSet.add(nk);
    for (const near of neighbors(size, next.x, next.y)) {
      pushFrontier(near.x, near.y);
    }
  }

  return region;
}
