export const XQ_TEAM = Object.freeze({
  RED: 1,
  BLACK: 2,
  NEUTRAL: 0
});

export const XQ_PIECE = Object.freeze({
  KING: "king",
  ADVISOR: "advisor",
  ELEPHANT: "elephant",
  HORSE: "horse",
  ROOK: "rook",
  CANNON: "cannon",
  PAWN: "pawn",
  FU: "fu"
});

export const XQ_BOARD = Object.freeze({
  WIDTH: 9,
  HEIGHT: 10
});

function pointKey(x, y) {
  return `${x},${y}`;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < XQ_BOARD.WIDTH && y < XQ_BOARD.HEIGHT;
}

function otherTeam(team) {
  return team === XQ_TEAM.RED ? XQ_TEAM.BLACK : XQ_TEAM.RED;
}

function clonePiece(piece) {
  if (!piece) return null;
  return {
    team: piece.team,
    type: piece.type,
    upgraded: Boolean(piece.upgraded)
  };
}

function cloneBoard(board) {
  return board.map((row) => row.map((piece) => clonePiece(piece)));
}

function createEmptyBoard() {
  return Array.from({ length: XQ_BOARD.HEIGHT }, () => Array(XQ_BOARD.WIDTH).fill(null));
}

function createPiece(team, type, upgraded = false) {
  return { team, type, upgraded };
}

function place(board, x, y, piece) {
  board[y][x] = piece;
}

function makeInitialBoard() {
  const board = createEmptyBoard();
  const back = [
    XQ_PIECE.ROOK,
    XQ_PIECE.HORSE,
    XQ_PIECE.ELEPHANT,
    XQ_PIECE.ADVISOR,
    XQ_PIECE.KING,
    XQ_PIECE.ADVISOR,
    XQ_PIECE.ELEPHANT,
    XQ_PIECE.HORSE,
    XQ_PIECE.ROOK
  ];

  for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
    place(board, x, 0, createPiece(XQ_TEAM.BLACK, back[x]));
    place(board, x, 9, createPiece(XQ_TEAM.RED, back[x]));
  }

  place(board, 1, 2, createPiece(XQ_TEAM.BLACK, XQ_PIECE.CANNON));
  place(board, 7, 2, createPiece(XQ_TEAM.BLACK, XQ_PIECE.CANNON));
  place(board, 1, 7, createPiece(XQ_TEAM.RED, XQ_PIECE.CANNON));
  place(board, 7, 7, createPiece(XQ_TEAM.RED, XQ_PIECE.CANNON));

  for (const x of [0, 2, 4, 6, 8]) {
    place(board, x, 3, createPiece(XQ_TEAM.BLACK, XQ_PIECE.PAWN));
    place(board, x, 6, createPiece(XQ_TEAM.RED, XQ_PIECE.PAWN));
  }

  return board;
}

function normalizeFuPoints(points) {
  const out = [];
  const seen = new Set();
  for (const point of points ?? []) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    if (!inBounds(x, y)) continue;
    const k = pointKey(x, y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x, y });
  }
  return out;
}

function applyFuPoints(board, fuPoints) {
  for (const point of normalizeFuPoints(fuPoints)) {
    if (board[point.y][point.x]) {
      continue;
    }
    board[point.y][point.x] = createPiece(XQ_TEAM.NEUTRAL, XQ_PIECE.FU, false);
  }
}

function isRedSide(team) {
  return team === XQ_TEAM.RED;
}

function isInPalace(team, x, y) {
  if (x < 3 || x > 5) return false;
  if (team === XQ_TEAM.RED) return y >= 7 && y <= 9;
  return y >= 0 && y <= 2;
}

function crossedRiver(team, y) {
  if (team === XQ_TEAM.RED) return y <= 4;
  return y >= 5;
}

function getKingPos(board, team) {
  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      const piece = board[y][x];
      if (!piece) continue;
      if (piece.team === team && piece.type === XQ_PIECE.KING) return { x, y };
    }
  }
  return null;
}

function countPiecesBetween(board, fromX, fromY, toX, toY) {
  let count = 0;
  if (fromX === toX) {
    const step = fromY < toY ? 1 : -1;
    for (let y = fromY + step; y !== toY; y += step) {
      if (board[y][fromX]) count += 1;
    }
    return count;
  }
  if (fromY === toY) {
    const step = fromX < toX ? 1 : -1;
    for (let x = fromX + step; x !== toX; x += step) {
      if (board[fromY][x]) count += 1;
    }
    return count;
  }
  return -1;
}

function isLineClear(board, fromX, fromY, toX, toY) {
  if (fromX === toX || fromY === toY) {
    return countPiecesBetween(board, fromX, fromY, toX, toY) === 0;
  }
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) !== Math.abs(dy)) return false;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  let x = fromX + stepX;
  let y = fromY + stepY;
  while (x !== toX && y !== toY) {
    if (board[y][x]) return false;
    x += stepX;
    y += stepY;
  }
  return true;
}

function isKnightMove(dx, dy) {
  return (Math.abs(dx) === 2 && Math.abs(dy) === 1) || (Math.abs(dx) === 1 && Math.abs(dy) === 2);
}

function canStandardKingMove(board, piece, fromX, fromY, toX, toY, target) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) + Math.abs(dy) === 1 && isInPalace(piece.team, toX, toY)) {
    return true;
  }
  if (
    target &&
    target.type === XQ_PIECE.KING &&
    target.team !== piece.team &&
    fromX === toX &&
    countPiecesBetween(board, fromX, fromY, toX, toY) === 0
  ) {
    return true;
  }
  return false;
}

function canPieceMoveByRule(board, piece, fromX, fromY, toX, toY, target) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return false;
  if (!inBounds(toX, toY)) return false;

  if (piece.type === XQ_PIECE.FU || piece.team === XQ_TEAM.NEUTRAL) {
    return false;
  }

  if (piece.upgraded) {
    switch (piece.type) {
      case XQ_PIECE.PAWN: {
        const forward = isRedSide(piece.team) ? -1 : 1;
        if (dy === forward && Math.abs(dx) <= 1) return true;
        if (dy === 0 && Math.abs(dx) === 1) return true;
        return false;
      }
      case XQ_PIECE.CANNON: {
        if (fromX !== toX && fromY !== toY) return false;
        const between = countPiecesBetween(board, fromX, fromY, toX, toY);
        if (between < 0) return false;
        if (!target) return between === 0;
        return between === 1 || between === 2;
      }
      case XQ_PIECE.ROOK:
      case XQ_PIECE.ADVISOR: {
        if (fromX === toX || fromY === toY) {
          return isLineClear(board, fromX, fromY, toX, toY);
        }
        return isLineClear(board, fromX, fromY, toX, toY);
      }
      case XQ_PIECE.HORSE:
        return isKnightMove(dx, dy);
      case XQ_PIECE.ELEPHANT:
        return isLineClear(board, fromX, fromY, toX, toY);
      case XQ_PIECE.KING:
        return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
      default:
        return false;
    }
  }

  switch (piece.type) {
    case XQ_PIECE.KING:
      return canStandardKingMove(board, piece, fromX, fromY, toX, toY, target);
    case XQ_PIECE.ADVISOR:
      return Math.abs(dx) === 1 && Math.abs(dy) === 1 && isInPalace(piece.team, toX, toY);
    case XQ_PIECE.ELEPHANT: {
      if (Math.abs(dx) !== 2 || Math.abs(dy) !== 2) return false;
      if (piece.team === XQ_TEAM.RED && toY <= 4) return false;
      if (piece.team === XQ_TEAM.BLACK && toY >= 5) return false;
      const eyeX = fromX + dx / 2;
      const eyeY = fromY + dy / 2;
      return !board[eyeY][eyeX];
    }
    case XQ_PIECE.HORSE: {
      if (!isKnightMove(dx, dy)) return false;
      const legX = fromX + (Math.abs(dx) === 2 ? dx / 2 : 0);
      const legY = fromY + (Math.abs(dy) === 2 ? dy / 2 : 0);
      return !board[legY][legX];
    }
    case XQ_PIECE.ROOK:
      if (fromX !== toX && fromY !== toY) return false;
      return isLineClear(board, fromX, fromY, toX, toY);
    case XQ_PIECE.CANNON: {
      if (fromX !== toX && fromY !== toY) return false;
      const between = countPiecesBetween(board, fromX, fromY, toX, toY);
      if (between < 0) return false;
      if (!target) return between === 0;
      return between === 1;
    }
    case XQ_PIECE.PAWN: {
      const forward = isRedSide(piece.team) ? -1 : 1;
      if (dy === forward && dx === 0) return true;
      if (crossedRiver(piece.team, fromY) && dy === 0 && Math.abs(dx) === 1) return true;
      return false;
    }
    default:
      return false;
  }
}

function isKingsFacing(board) {
  const redKing = getKingPos(board, XQ_TEAM.RED);
  const blackKing = getKingPos(board, XQ_TEAM.BLACK);
  if (!redKing || !blackKing) return false;
  if (redKing.x !== blackKing.x) return false;
  return countPiecesBetween(board, redKing.x, redKing.y, blackKing.x, blackKing.y) === 0;
}

function canPieceAttackSquare(board, piece, fromX, fromY, toX, toY) {
  const target = board[toY][toX];
  return canPieceMoveByRule(board, piece, fromX, fromY, toX, toY, target);
}

export function isXiangqiInCheck(state, team) {
  const board = state.board;
  const king = getKingPos(board, team);
  if (!king) return true;

  if (isKingsFacing(board)) {
    return true;
  }

  const enemy = otherTeam(team);
  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      const piece = board[y][x];
      if (!piece || piece.team !== enemy) continue;
      if (canPieceAttackSquare(board, piece, x, y, king.x, king.y)) {
        return true;
      }
    }
  }
  return false;
}

function cloneState(state) {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    moveNumber: state.moveNumber,
    gameOver: state.gameOver,
    winner: state.winner,
    resignedBy: state.resignedBy,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    check: state.check ? { ...state.check } : null
  };
}

function simulateMove(state, fromX, fromY, toX, toY) {
  const next = cloneState(state);
  const piece = clonePiece(next.board[fromY][fromX]);
  const target = clonePiece(next.board[toY][toX]);

  next.board[fromY][fromX] = null;
  if (
    target &&
    ((target.team === XQ_TEAM.NEUTRAL && target.type === XQ_PIECE.FU) ||
      (target.team !== XQ_TEAM.NEUTRAL && target.upgraded))
  ) {
    piece.upgraded = true;
  }
  next.board[toY][toX] = piece;
  return { next, piece, target };
}

function isMoveLegal(state, fromX, fromY, toX, toY, team = state.turn) {
  if (state.gameOver) return false;
  if (!inBounds(fromX, fromY) || !inBounds(toX, toY)) return false;
  const piece = state.board[fromY][fromX];
  if (!piece || piece.team !== team || piece.team === XQ_TEAM.NEUTRAL) return false;
  const target = state.board[toY][toX];
  if (target && target.team === team) return false;
  if (!canPieceMoveByRule(state.board, piece, fromX, fromY, toX, toY, target)) return false;

  const { next } = simulateMove(state, fromX, fromY, toX, toY);
  if (isXiangqiInCheck(next, team)) return false;
  return true;
}

function hasAnyLegalMove(state, team) {
  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      const piece = state.board[y][x];
      if (!piece || piece.team !== team) continue;
      for (let ty = 0; ty < XQ_BOARD.HEIGHT; ty += 1) {
        for (let tx = 0; tx < XQ_BOARD.WIDTH; tx += 1) {
          if (isMoveLegal(state, x, y, tx, ty, team)) return true;
        }
      }
    }
  }
  return false;
}

export function createXiangqiGameState({ fuPoints = [] } = {}) {
  const board = makeInitialBoard();
  applyFuPoints(board, fuPoints);
  return {
    board,
    turn: XQ_TEAM.RED,
    moveNumber: 0,
    gameOver: false,
    winner: null,
    resignedBy: null,
    lastMove: null,
    check: null
  };
}

export function moveXiangqi(state, fromX, fromY, toX, toY) {
  if (state.gameOver) return { ok: false, error: "棋局已结束" };
  if (!inBounds(fromX, fromY) || !inBounds(toX, toY)) return { ok: false, error: "走子越界" };
  const piece = state.board[fromY][fromX];
  if (!piece) return { ok: false, error: "起点没有棋子" };
  if (piece.team !== state.turn || piece.team === XQ_TEAM.NEUTRAL) {
    return { ok: false, error: "只能走己方棋子" };
  }
  const target = state.board[toY][toX];
  if (target && target.team === state.turn) {
    return { ok: false, error: "不能吃己方棋子" };
  }

  if (!canPieceMoveByRule(state.board, piece, fromX, fromY, toX, toY, target)) {
    return { ok: false, error: "不符合该棋子走法" };
  }

  const { next, piece: movedPiece, target: captured } = simulateMove(state, fromX, fromY, toX, toY);
  if (isXiangqiInCheck(next, state.turn)) {
    return { ok: false, error: "该走法会导致己方将帅受将" };
  }

  next.moveNumber += 1;
  next.lastMove = {
    type: "move",
    fromX,
    fromY,
    toX,
    toY,
    pieceType: movedPiece.type,
    pieceTeam: movedPiece.team,
    capturedType: captured?.type ?? null,
    capturedTeam: captured?.team ?? null,
    upgraded: movedPiece.upgraded
  };

  if (captured && captured.type === XQ_PIECE.KING) {
    next.gameOver = true;
    next.winner = state.turn;
    next.turn = otherTeam(state.turn);
    next.check = null;
    return { ok: true, state: next };
  }

  const enemy = otherTeam(state.turn);
  next.turn = enemy;
  const enemyInCheck = isXiangqiInCheck(next, enemy);
  next.check = enemyInCheck ? { team: enemy } : null;

  if (!hasAnyLegalMove(next, enemy)) {
    next.gameOver = true;
    next.winner = state.turn;
  }

  return { ok: true, state: next };
}

export function resignXiangqi(state, color = state.turn) {
  if (state.gameOver) {
    return { ok: false, error: "棋局已结束" };
  }
  const next = cloneState(state);
  next.moveNumber += 1;
  next.gameOver = true;
  next.resignedBy = color;
  next.winner = otherTeam(color);
  next.lastMove = { type: "resign", color };
  next.check = null;
  return { ok: true, state: next };
}

export function collectFuPoints(board) {
  const points = [];
  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      const piece = board[y][x];
      if (!piece) continue;
      if (piece.team === XQ_TEAM.NEUTRAL && piece.type === XQ_PIECE.FU) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

function randomInt(limit) {
  return Math.floor(Math.random() * limit);
}

export function generateRandomFuPoints(count = 0) {
  const target = Math.max(0, Number(count) || 0);
  if (target === 0) return [];
  const board = makeInitialBoard();
  const candidates = [];
  for (let y = 0; y < XQ_BOARD.HEIGHT; y += 1) {
    for (let x = 0; x < XQ_BOARD.WIDTH; x += 1) {
      if (!board[y][x]) {
        candidates.push({ x, y });
      }
    }
  }
  const total = Math.min(target, candidates.length);
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }
  return candidates.slice(0, total);
}
