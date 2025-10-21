// Client-side TypeScript code for the chess game

import { getPossibleMoves } from './getPossibleMoves.js';
import { 
  ChessBoard, 
  ChessPiece, 
  Position, 
  MoveData, 
  BoardMessage, 
  ErrorMessage, 
  GameMessage, 
  SquarePosition, 
  HoverHandler, 
  WidthRatios, 
  MoveDetection 
} from './types.js';

// Client-specific game state interface
interface ClientGameState {
  ws: WebSocket | null;
  currentBoard: ChessBoard | null;
  selectedSquare: string | null;
  clickCount: number;
  listenersInitialized: boolean;
  reconnecting: boolean;
  reconnectStartAt: number;
  reconnectAttempts: number;
  reconnectLoopTimer: number | null;
  connectAttemptTimer: number | null;
  reconnectSucceeded: boolean;
}

// Constants
const MIN_RECONNECT_MS = 10000; 
const MIN_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL_MS = 1000;
const CONNECT_ATTEMPT_TIMEOUT_MS = 900;

// Piece image maps
const PIECES: Record<string, string> = {
  'K': '/pieces/simple/white_king_alive.png',
  'Q': '/pieces/simple/white_queen_alive.png', 
  'R': '/pieces/simple/white_rook_alive.png',
  'B': '/pieces/simple/white_bishop_alive.png',
  'N': '/pieces/simple/white_knight_alive.png',
  'P': '/pieces/simple/white_pawn_alive.png',
  'k': '/pieces/simple/black_king_alive.png',
  'q': '/pieces/simple/black_queen_alive.png',
  'r': '/pieces/simple/black_rook_alive.png',
  'b': '/pieces/simple/black_bishop_alive.png',
  'n': '/pieces/simple/black_knight_alive.png',
  'p': '/pieces/simple/black_pawn_alive.png'
};

const PIECES_DEAD: Record<string, string> = {
  'K': '/pieces/simple/white_king_dead.png',
  'Q': '/pieces/simple/white_queen_dead.png',
  'R': '/pieces/simple/white_rook_dead.png',
  'B': '/pieces/simple/white_bishop_dead.png',
  'N': '/pieces/simple/white_knight_dead.png',
  'P': '/pieces/simple/white_pawn_dead.png',
  'k': '/pieces/simple/black_king_dead.png',
  'q': '/pieces/simple/black_queen_dead.png',
  'r': '/pieces/simple/black_rook_dead.png',
  'b': '/pieces/simple/black_bishop_dead.png',
  'n': '/pieces/simple/black_knight_dead.png',
  'p': '/pieces/simple/black_pawn_dead.png'
};

// Global state
const gameState: ClientGameState = {
  ws: null,
  currentBoard: null,
  selectedSquare: null,
  clickCount: 0,
  listenersInitialized: false,
  reconnecting: false,
  reconnectStartAt: 0,
  reconnectAttempts: 0,
  reconnectLoopTimer: null,
  connectAttemptTimer: null,
  reconnectSucceeded: false
};

// Hover preview state/handlers
const hoverHandlers = new Map<string, HoverHandler>();
let previewedSquareId: string | null = null;

// Rendering constants and caches
const BOARD_SIZE = 8;
const CELL_SIZE = 50; // CSS pixels
const BOARD_PIXEL_SIZE = BOARD_SIZE * CELL_SIZE; // 400px
const DPR = Math.max(4, window.devicePixelRatio || 1);
const imageCache = new Map<string, HTMLImageElement>();

// Color constants
const LIGHT_SQUARE = '#ffffff';
const DARK_SQUARE = '#e2c3ac';
const HIGHLIGHT_SINGLE = '#90EE90';
const HIGHLIGHT_DOUBLE = '#ba9cf7';
const HIGHLIGHT_MOVE_LIGHT_SINGLE = '#ffe6f0';
const HIGHLIGHT_MOVE_DARK_SINGLE = '#f0d6e0';
const HIGHLIGHT_MOVE_LIGHT_DOUBLE = '#f0e6ff';
const HIGHLIGHT_MOVE_DARK_DOUBLE = '#e0d6f0';

// Canvas and rendering state
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let highlightedSquares = new Set<string>(); // Set of "row,col" strings
let selectedSquarePos: SquarePosition | null = null;
let doubleClickMode = false;

// Animation state
let pendingBoardRaf = 0;
let isAnimatingMove = false;
let animatingFromSquare: SquarePosition | null = null;

const WidthRatios: WidthRatios = {
  "Pawn": 0.59,
  "Knight": 0.78,
  "Bishop": 0.82,
  "Rook": 0.69,
  "Queen": 0.93,
  "King": 0.83
};

// Utility functions
function real_width(width: number, probability: number, piece_ratio: number): number {
  const x = width * (1.0 - piece_ratio) / 2;
  return x + width * piece_ratio * probability;
}

function isLightSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 0;
}

function preloadImages(): void {
  // Preload alive pieces
  Object.keys(PIECES).forEach((key) => {
    if (!imageCache.has(key)) {
      const img = new Image();
      img.src = PIECES[key]!;
      imageCache.set(key, img);
    }
  });
  
  // Preload dead pieces with proper key mapping
  Object.keys(PIECES_DEAD).forEach((key) => {
    const deadKey = key + '_dead';
    if (!imageCache.has(deadKey)) {
      const img = new Image();
      img.src = PIECES_DEAD[key]!;
      imageCache.set(deadKey, img);
    }
  });
}

function initializeCanvas(): void {
  canvas = document.getElementById('chessboard') as HTMLCanvasElement;
  if (!canvas) return;
  
  // Set internal canvas size to physical pixels for hi-DPI
  canvas.width = BOARD_PIXEL_SIZE * DPR;
  canvas.height = BOARD_PIXEL_SIZE * DPR;
  // Set CSS size
  canvas.style.width = BOARD_PIXEL_SIZE + 'px';
  canvas.style.height = BOARD_PIXEL_SIZE + 'px';
  
  ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  
  // Scale context to match DPR
  ctx.scale(DPR, DPR);
  // High quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Draw initial empty board
  drawCompleteBoard();
}

function drawSquareBackground(row: number, col: number, color: string | null = null): void {
  if (!ctx) return;
  
  if (color === null) {
    color = isLightSquare(row, col) ? LIGHT_SQUARE : DARK_SQUARE;
  }
  
  ctx.fillStyle = color;
  ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
}

function drawPieceAt(row: number, col: number, piece: ChessPiece, probability: number = 1.0): void {
  if (!ctx || !piece) return;
  
  // Skip drawing if this square is currently being animated
  if (animatingFromSquare && animatingFromSquare.row === row && animatingFromSquare.col === col) {
    return;
  }
  
  if (probability >= 1.0) {
    // Normal piece drawing for full probability
    const img = imageCache.get(piece);
    if (!img) return;
    
    if (img.complete) {
      ctx.drawImage(img, col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    } else {
      img.onload = () => {
        if (ctx) {
          ctx.drawImage(img, col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      };
    }
  } else {
    // Probabilistic piece drawing
    const pieceType = piece.replace(/^[wb]/, ''); // Remove color prefix to get piece type
    const piece_ratio = WidthRatios[pieceType] || 0.8; // Use specific ratio or default
    
    // Get alive and dead piece images with proper key lookup
    const img_alive = imageCache.get(piece);
    const img_dead = imageCache.get(piece + '_dead');
    
    if (!img_alive) return;
    
    const drawProbabilistic = () => {
      if (!ctx) return;
      
      // Draw alive portion
      if (img_alive.complete) {
        const alive_width = real_width(CELL_SIZE, probability, piece_ratio);
        ctx.drawImage(img_alive, 
          0, 0, real_width(img_alive.width, probability, piece_ratio), img_alive.height,
          col * CELL_SIZE, row * CELL_SIZE, alive_width, CELL_SIZE);
      }
      
      // Draw dead portion (only if dead image exists and probability < 1.0)
      if (img_dead && img_dead.complete && probability < 1.0) {
        const dead_start_x = real_width(CELL_SIZE, probability, piece_ratio);
        const dead_width = real_width(CELL_SIZE, 1.0 - probability, piece_ratio);
        ctx.drawImage(img_dead,
          real_width(img_dead.width, probability, piece_ratio), 0, real_width(img_dead.width, 1.0 - probability, piece_ratio), img_dead.height,
          col * CELL_SIZE + dead_start_x, row * CELL_SIZE, dead_width, CELL_SIZE);
      }
    };
    
    if (img_alive.complete && (!img_dead || img_dead.complete)) {
      drawProbabilistic();
    } else {
      let loadedCount = 0;
      const checkAndDraw = () => {
        loadedCount++;
        if (loadedCount >= 2 || (img_alive.complete && (!img_dead || img_dead.complete))) {
          drawProbabilistic();
        }
      };
      
      if (!img_alive.complete) {
        img_alive.onload = checkAndDraw;
      }
      if (img_dead && !img_dead.complete) {
        img_dead.onload = checkAndDraw;
      }
    }
  }
}

function drawSquare(row: number, col: number, piece: ChessPiece, backgroundColor: string | null = null): void {
  drawSquareBackground(row, col, backgroundColor);
  if (piece) {
    drawPieceAt(row, col, piece);
  }
}

function drawCompleteBoard(): void {
  if (!ctx) return;
  
  // Draw all squares with highlights
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      let bgColor: string | null = null;
      
      // Check if this square is highlighted
      const key = `${row},${col}`;
      if (highlightedSquares.has(key)) {
        // Get highlight color from the stored data
        if (selectedSquarePos && selectedSquarePos.row === row && selectedSquarePos.col === col) {
          bgColor = doubleClickMode ? HIGHLIGHT_DOUBLE : HIGHLIGHT_SINGLE;
        } else {
          const isLight = isLightSquare(row, col);
          if (doubleClickMode) {
            bgColor = isLight ? HIGHLIGHT_MOVE_LIGHT_DOUBLE : HIGHLIGHT_MOVE_DARK_DOUBLE;
          } else {
            bgColor = isLight ? HIGHLIGHT_MOVE_LIGHT_SINGLE : HIGHLIGHT_MOVE_DARK_SINGLE;
          }
        }
      }
      
      const piece = gameState.currentBoard ? gameState.currentBoard[row]?.[col] : null;
      if (piece) {
        drawSquare(row, col, piece, bgColor);
      } else {
        drawSquareBackground(row, col, bgColor);
      }
    }
  }
}

function getPieceImageSrc(piece: ChessPiece, alive: boolean = true): string | null {
  if (!piece) return null;
  const pieceKey = alive ? piece : piece.replace(/^[WB]/, '');
  const piecesMap = alive ? PIECES : PIECES_DEAD;
  return piecesMap[pieceKey] || null;
}

function getSquareIdFromRowCol(row: number, col: number): string {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  return `sq-${files[col]!}${ranks[row]!}`;
}

function parseSquareId(squareId: string): SquarePosition | null {
  const m = squareId.match(/^sq-([a-h])([1-8])$/);
  if (!m) return null;
  const col = m[1]!.charCodeAt(0) - 'a'.charCodeAt(0);
  const row = 8 - parseInt(m[2]!, 10);
  return { row, col };
}

function renderSquare(row: number, col: number): void {
  if (!gameState.currentBoard) return;
  // In single canvas mode, just redraw that specific square
  const piece = gameState.currentBoard[row]?.[col];
  if (piece) {
    drawSquare(row, col, piece);
  }
}

function getSquareFromClick(event: MouseEvent): SquarePosition | null {
  if (!canvas) return null;
  
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);
  
  if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
    return { row, col };
  }
  return null;
}

function makeWebSocketCall(data: MoveData): void {
  if (gameState.ws && gameState.ws.readyState === WebSocket.OPEN) {
    gameState.ws.send(JSON.stringify(data));
  }
}

function isConnected(): boolean {
  return gameState.ws !== null && gameState.ws.readyState === WebSocket.OPEN;
}

function showReconnectModal(): void {
  const modal = document.getElementById('reconnectModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function hideReconnectModal(): void {
  const modal = document.getElementById('reconnectModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function setReconnectBtnState(disabled: boolean, label?: string): void {
  const btn = document.getElementById('reconnectBtn') as HTMLButtonElement;
  if (btn) {
    btn.disabled = disabled;
    if (label) btn.textContent = label;
  }
}

function getInnerModal(): HTMLElement | null {
  const overlay = document.getElementById('reconnectModal');
  return overlay ? overlay.querySelector('.modal') : null;
}

function beginReconnectUI(): void {
  showReconnectModal();
  setReconnectBtnState(true, 'Reconnecting...');
  const btn = document.getElementById('reconnectBtn');
  if (btn) btn.classList.add('loading');
  const inner = getInnerModal();
  if (inner) inner.classList.add('pulsing');
  gameState.reconnectStartAt = performance.now();
}

function finalizeReconnectUI(success: boolean): void {
  const elapsed = gameState.reconnectStartAt ? (performance.now() - gameState.reconnectStartAt) : MIN_RECONNECT_MS;
  const remaining = Math.max(0, MIN_RECONNECT_MS - elapsed);
  const finish = () => {
    const btn = document.getElementById('reconnectBtn');
    if (btn) btn.classList.remove('loading');
    const inner = getInnerModal();
    if (inner) inner.classList.remove('pulsing');
    setReconnectBtnState(false, 'Reconnect');
    gameState.reconnecting = false;
    gameState.reconnectStartAt = 0;
    if (success) {
      hideReconnectModal();
    } else {
      showReconnectModal();
    }
  };
  // If reconnection succeeded, hide immediately without waiting the minimum duration
  if (success) {
    finish();
  } else {
    setTimeout(finish, remaining);
  }
}

function getGameIdFromPath(): string | null {
  // Expecting /game/<uuid>
  const parts = location.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('game');
  if (idx !== -1 && parts[idx + 1]) {
    return parts[idx + 1]!;
  }
  return null;
}

function getWsUrl(): string {
  let roomId = getGameIdFromPath();
  if (!roomId) {
    // If user navigated directly to root or invalid path, bounce to a new game
    const newId = crypto.randomUUID().replace(/-/g, '');
    location.replace(`/game/${newId}`);
    // Return a placeholder; caller will reconnect after navigation
    return '';
  }
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host;
  return `${protocol}://${host}/api/room/${roomId}/websocket`;
}

function clearReconnectTimers(): void {
  if (gameState.reconnectLoopTimer) {
    clearInterval(gameState.reconnectLoopTimer);
    gameState.reconnectLoopTimer = null;
  }
  if (gameState.connectAttemptTimer) {
    clearTimeout(gameState.connectAttemptTimer);
    gameState.connectAttemptTimer = null;
  }
}

function stopReconnectLoop(): void {
  clearReconnectTimers();
}

function safeCloseCurrentSocket(): void {
  try {
    if (gameState.ws && gameState.ws.readyState !== WebSocket.CLOSED && gameState.ws.readyState !== WebSocket.CLOSING) {
      gameState.ws.onopen = null;
      gameState.ws.onmessage = null;
      gameState.ws.onerror = null;
      gameState.ws.onclose = null;
      gameState.ws.close();
    }
  } catch (e) {
    // ignore
  }
}

function attemptReconnectOnce(): void {
  if (gameState.reconnectSucceeded) return;
  gameState.reconnectAttempts++;
  const wsUrl = getWsUrl();

  safeCloseCurrentSocket();
  try {
    gameState.ws = new WebSocket(wsUrl);
  } catch (e) {
    // will retry on next tick
    return;
  }

  gameState.ws.onopen = function() {
    // on success, finalize UI (with min duration) and stop loop
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      debugElement.innerHTML += 'Reconnected to chess game' + '\n';
    }
    gameState.reconnectSucceeded = true;
    stopReconnectLoop();
    finalizeReconnectUI(true);
    hideReconnectModal();
    gameState.reconnecting = false;
    // Re-render last known board immediately to avoid visual clearing
    if (gameState.currentBoard) {
      updateBoard(gameState.currentBoard);
    }
  };

  gameState.ws.onmessage = function(event: MessageEvent) {
    let data: GameMessage;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error('Invalid message payload', event.data);
      return;
    }
    if (data && data.type === 'board' && Array.isArray(data.board)) {
      printBoard(data.board);
      updateBoard(data.board);
      // Fallback: ensure modal is hidden when we receive a valid board
      hideReconnectModal();
      gameState.reconnecting = false;
    }
  };

  gameState.ws.onerror = function() {
    // keep trying
  };

  gameState.ws.onclose = function() {
    // keep trying
  };

  // If still connecting after timeout, abort and let the loop retry next tick
  gameState.connectAttemptTimer = setTimeout(() => {
    if (gameState.ws && gameState.ws.readyState === WebSocket.CONNECTING) {
      safeCloseCurrentSocket();
    }
  }, CONNECT_ATTEMPT_TIMEOUT_MS);
}

function startReconnectLoop(): void {
  gameState.reconnectSucceeded = false;
  gameState.reconnectAttempts = 0;
  clearReconnectTimers();
  beginReconnectUI();
  attemptReconnectOnce();
  const loopStart = performance.now();
  gameState.reconnectLoopTimer = setInterval(() => {
    if (gameState.reconnectSucceeded) {
      stopReconnectLoop();
      return;
    }
    const elapsed = performance.now() - loopStart;
    // Keep attempting every second; ensure we make at least MIN_RECONNECT_ATTEMPTS attempts
    if (gameState.reconnectAttempts < MIN_RECONNECT_ATTEMPTS || elapsed < MIN_RECONNECT_MS) {
      attemptReconnectOnce();
    } else {
      // Past minimums; keep trying until success to ensure reconnection works
      attemptReconnectOnce();
    }
  }, RECONNECT_INTERVAL_MS);
}

// Connect to WebSocket
function connectWebSocket(): void {
  if (gameState.ws && (gameState.ws.readyState === WebSocket.OPEN || gameState.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const wsUrl = getWsUrl();
  if (!wsUrl) return;
  try {
    gameState.ws = new WebSocket(wsUrl);
  } catch (e) {
    finalizeReconnectUI(false);
    return;
  }
  
  gameState.ws.onopen = function() {
    console.log('Connected to chess game');
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      debugElement.innerHTML += 'Connected to chess game' + '\n';
      // ASCII art welcome message
      debugElement.innerHTML += '<div style="color: #666; font-family: monospace; line-height: 1; font-size: 10px; margin: 10px 0;">' +
        '         ,....,<br>' +
        '      ,::::::<&lt;<br>' +
        '     ,::/^\\"``..<br>' +
        '    ,::/, `   e`.<br>' +
        '   ,::; |        \'.<br>' +
        '   ,::|  \\___,-.  c)<br>' +
        '   ;::|     \\   \'-\'<br>' +
        '   ;::|      \\<br>' +
        '   ;::|   _.=`\\<br>' +
        '   `;:|.=` _.=`\\<br>' +
        '     \'|_.=`   __\\<br>' +
        '     `\\_..==`` /<br>' +
        '      .\'.___.-\'.<br>' +
        '     /          \\<br>' +
        '    (\'--......--\')<br>' +
        '    /\'--......--\'\\<br>' +
        '    `"--......--"<br>' +
        '</div>';
      debugElement.innerHTML += '<span style="color: #999;">Rules are simple, whatever the computer allows, try double clicking some squares! :)</span><br>' + '\n';
    }
    if (gameState.reconnecting) {
      finalizeReconnectUI(true);
    } else {
      hideReconnectModal();
    }
  };
  
  gameState.ws.onmessage = function(event: MessageEvent) {
    let data: GameMessage;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error('Invalid message payload', event.data);
      return;
    }
    if (data && data.type === 'board' && Array.isArray(data.board)) {
      printBoard(data.board);
      updateBoard(data.board);
    }
  };
  
  gameState.ws.onclose = function() {
    console.log('Disconnected from chess game');
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      debugElement.innerHTML += 'Disconnected from chess game' + '\n';
    }
    showReconnectModal();
    setReconnectBtnState(false, 'Reconnect');
    gameState.reconnecting = false;
  };
  
  gameState.ws.onerror = function(error: Event) {
    console.error('WebSocket error:', error);
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      debugElement.innerHTML += 'WebSocket error: ' + error + '\n';
    }
    showReconnectModal();
    setReconnectBtnState(false, 'Reconnect');
    gameState.reconnecting = false;
  };
}

function printBoard(board: ChessBoard): void {
  console.log('Board state:');
  for (let row = 0; row < 8; row++) {
    let rowStr = '';
    for (let col = 0; col < 8; col++) {
      const piece = board[row]?.[col];
      if (piece) {
        // Use colored styling for pieces
        if (piece === piece.toUpperCase()) {
          // White pieces - blue color
          rowStr += `<span style="color: #0066cc; font-weight: bold;">${piece}</span> `;
        } else {
          // Black pieces - red color
          rowStr += `<span style="color: #cc0000; font-weight: bold;">${piece}</span> `;
        }
      } else {
        // Empty square
        rowStr += '<span style="color: #999;">.</span> ';
      }
    }
    console.log(`${8 - row}: ${rowStr}`);
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      debugElement.innerHTML += `<div style="font-family: monospace; line-height: 1.2;">${8 - row}: ${rowStr}</div>`;
    }
  }
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += '<div style="font-family: monospace; margin-bottom: 10px;">   a b c d e f g h</div>';
  }
}

function updateBoard(board: ChessBoard): void {
  console.log('Updating board:', board);
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += 'Updating board' + '\n';
  }
  const prevBoard = gameState.currentBoard ? gameState.currentBoard.map(r => r.slice()) : null;
  const newBoard = board.map(r => r.slice());

  // Detect piece movement by comparing boards
  let moveDetected: MoveDetection | null = null;
  if (prevBoard && !isAnimatingMove) {
    // Find where a piece disappeared and where a piece appeared
    let fromPos: (SquarePosition & { piece: ChessPiece }) | null = null;
    let toPos: (SquarePosition & { piece: ChessPiece }) | null = null;
    let movedPiece: ChessPiece = null;
    let capturedPiece: (SquarePosition & { piece: ChessPiece }) | null = null;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const prevPiece = prevBoard[row]?.[col];
        const curPiece = newBoard[row]?.[col];
        
        // Piece disappeared (moved from here or captured)
        if (prevPiece && !curPiece) {
          fromPos = { row, col, piece: prevPiece };
        }
        // Different piece appeared (move destination, possibly with capture)
        else if (curPiece && (!prevPiece || prevPiece !== curPiece)) {
          // Check if this could be a move destination
          if (!toPos || prevPiece) {
            toPos = { row, col, piece: curPiece };
            if (prevPiece && prevPiece !== curPiece) {
              capturedPiece = { row, col, piece: prevPiece };
            }
          }
        }
      }
    }

    // If we found a clear move (piece disappeared from one square, appeared on another)
    if (fromPos && toPos && fromPos.piece === toPos.piece) {
      moveDetected = { from: fromPos, to: toPos, captured: capturedPiece || undefined };
    }
  }

  if (moveDetected) {
    // Animate the move
    animatePieceMove(moveDetected.from, moveDetected.to, moveDetected.captured, () => {
      // After animation, update the actual board state
      gameState.currentBoard = newBoard;
      
      if (pendingBoardRaf) cancelAnimationFrame(pendingBoardRaf);
      pendingBoardRaf = requestAnimationFrame(() => {
        drawCompleteBoard();
        pendingBoardRaf = 0;
      });
    });
  } else {
    // No animation needed, update immediately
    gameState.currentBoard = newBoard;
    
    // Detect captures by comparing prevBoard to currentBoard
    if (prevBoard) {
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const prevPiece = prevBoard[row]?.[col];
          const curPiece = gameState.currentBoard[row]?.[col];
          if (prevPiece && curPiece && prevPiece !== curPiece) {
            spawnFloatingPiece(row, col, prevPiece);
          }
        }
      }
    }

    if (pendingBoardRaf) cancelAnimationFrame(pendingBoardRaf);
    pendingBoardRaf = requestAnimationFrame(() => {
      drawCompleteBoard();
      pendingBoardRaf = 0;
    });
  }
}

function getBoardClientRect(): DOMRect | null {
  if (!canvas) return null;
  return canvas.getBoundingClientRect();
}

function squareToClientPosition(row: number, col: number): { x: number; y: number; size: number } | null {
  const boardRect = getBoardClientRect();
  if (!boardRect) return null;
  return {
    x: boardRect.left + col * CELL_SIZE,
    y: boardRect.top + row * CELL_SIZE,
    size: CELL_SIZE
  };
}

function animatePieceMove(from: SquarePosition & { piece: ChessPiece }, to: SquarePosition & { piece: ChessPiece }, captured: (SquarePosition & { piece: ChessPiece }) | undefined, onComplete: () => void): void {
  isAnimatingMove = true;
  animatingFromSquare = { row: from.row, col: from.col };
  
  // Redraw board to hide the piece from source square
  drawCompleteBoard();
  
  const src = getPieceImageSrc(from.piece);
  if (!src) {
    isAnimatingMove = false;
    animatingFromSquare = null;
    onComplete();
    return;
  }

  const layer = document.getElementById('float-layer');
  if (!layer) {
    isAnimatingMove = false;
    animatingFromSquare = null;
    onComplete();
    return;
  }

  const fromPos = squareToClientPosition(from.row, from.col);
  const toPos = squareToClientPosition(to.row, to.col);
  if (!fromPos || !toPos) {
    isAnimatingMove = false;
    animatingFromSquare = null;
    onComplete();
    return;
  }

  // Spawn captured piece animation if there was a capture
  if (captured) {
    spawnFloatingPiece(captured.row, captured.col, captured.piece);
  }

  // Create moving piece element
  const img = new Image();
  img.src = src;
  img.className = 'moving-piece';
  const containerRect = layer.getBoundingClientRect();
  
  const startX = fromPos.x - containerRect.left;
  const startY = fromPos.y - containerRect.top;
  const endX = toPos.x - containerRect.left;
  const endY = toPos.y - containerRect.top;
  
  img.style.left = startX + 'px';
  img.style.top = startY + 'px';
  layer.appendChild(img);

  const durationMs = 300; // 300ms animation
  const start = performance.now();

  function animate(now: number): void {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    
    // Ease-in-out cubic for smooth motion
    const ease = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
    
    const currentX = startX + (endX - startX) * ease;
    const currentY = startY + (endY - startY) * ease;
    
    img.style.transform = `translate(${currentX - startX}px, ${currentY - startY}px)`;
    
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation complete
      if (img.parentNode) img.parentNode.removeChild(img);
      isAnimatingMove = false;
      animatingFromSquare = null;
      onComplete();
    }
  }

  requestAnimationFrame(animate);
}

function spawnFloatingPiece(row: number, col: number, piece: ChessPiece): void {
  const src = getPieceImageSrc(piece);
  if (!src) return;
  const layer = document.getElementById('float-layer');
  if (!layer) return;
  const pos = squareToClientPosition(row, col);
  if (!pos) return;

  const img = new Image();
  img.src = src;
  img.className = 'float-piece';
  // Position relative to layer; convert client coords to layer-local by subtracting container's client rect
  const containerRect = layer.getBoundingClientRect();
  img.style.left = (pos.x - containerRect.left) + 'px';
  img.style.top = (pos.y - containerRect.top) + 'px';
  img.style.opacity = '1';
  layer.appendChild(img);

  const startY = pos.y - containerRect.top;
  const startX = pos.x - containerRect.left;
  const durationMs = 1200 + Math.random() * 600; // 1.2s - 1.8s
  const driftX = (Math.random() * 16 - 8); // slight lateral drift
  const jitterAmp = 2 + Math.random() * 3; // px
  const start = performance.now();

  function animate(now: number): void {
    const t = Math.min(1, (now - start) / durationMs);
    // ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);
    const jitter = Math.sin(now / 40 + row * 3 + col * 5) * jitterAmp * (1 - t);
    const y = startY - ease * (boardRectHeight() + 60); // move up out of frame
    const x = startX + ease * driftX + jitter * 0.3;
    img.style.transform = `translate(${x - startX}px, ${y - startY}px)`;
    img.style.opacity = String(1 - t);
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      if (img.parentNode) img.parentNode.removeChild(img);
    }
  }

  function boardRectHeight(): number {
    const rect = getBoardClientRect();
    return rect ? rect.height : 320;
  }

  requestAnimationFrame(animate);
}

// One-time initialization of click handler for canvas
function initializeSquareListeners(): void {
  if (gameState.listenersInitialized) return;
  gameState.listenersInitialized = true;
  
  if (!canvas) return;
  
  canvas.addEventListener('click', (event: MouseEvent) => {
    const square = getSquareFromClick(event);
    if (square) {
      const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
      const squareId = `sq-${files[square.col]}${ranks[square.row]}`;
      handleSquareClick(squareId, square.row, square.col);
    }
  }, { passive: true });
  
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += 'Square listeners initialized' + '\n';
  }
}

function handleSquareClick(squareId: string, row: number, col: number): void {
  console.log('handleSquareClick', squareId, row, col);
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += '<span style="color: #00ff88;">handleSquareClick</span> <span style="color: #ffaa00;">' + squareId + '</span> <span style="color: #88aaff;">' + row + '</span> <span style="color: #ff88aa;">' + col + '</span>\n';
  }
  if (!isConnected()) {
    showReconnectModal();
    return;
  }
  if (!gameState.currentBoard) return;

  const clickedPiece = gameState.currentBoard[row]?.[col];

  if (gameState.selectedSquare === squareId) {
    gameState.clickCount++;
  } else {
    if (gameState.selectedSquare && gameState.clickCount > 0) {
      const fromSquare = gameState.selectedSquare;
      const toSquare = squareId;
      const fromMatch = fromSquare.match(/sq-([a-h])([1-8])/);
      const toMatch = toSquare.match(/sq-([a-h])([1-8])/);
      if (fromMatch && toMatch) {
        const fromCol = fromMatch[1]!.charCodeAt(0) - 'a'.charCodeAt(0);
        const fromRow = 8 - parseInt(fromMatch[2]!);
        const toCol = toMatch[1]!.charCodeAt(0) - 'a'.charCodeAt(0);
        const toRow = 8 - parseInt(toMatch[2]!);
        const piece = gameState.currentBoard[fromRow]?.[fromCol];
        if (piece && isValidMove(piece, fromRow, fromCol, toRow, toCol, gameState.clickCount >= 2)) {
          const move: MoveData = { type: 'move', from: fromMatch[1]! + fromMatch[2]!, to: toMatch[1]! + toMatch[2]!, isDoubleMove: gameState.clickCount >= 2 };
          console.log('Sending move:', move);
          if (debugElement) {
            debugElement.innerHTML += '<span style="color: #00ff88;">Sending move:</span> <span style="color: #ffaa00;">' + JSON.stringify(move) + '</span>\n';
          }
          if (gameState.ws && gameState.ws.readyState === WebSocket.OPEN) {
            gameState.ws.send(JSON.stringify(move));
          }
          clearSquareHighlights();
          gameState.selectedSquare = null;
          gameState.clickCount = 0;
          return;
        } else {
          console.log('Invalid move attempted');
          if (debugElement) {
            debugElement.innerHTML += 'Invalid move attempted\n';
          }
          clearSquareHighlights();
          gameState.selectedSquare = squareId;
          gameState.clickCount = 1;
          if (clickedPiece) {
            selectedSquarePos = { row, col };
            doubleClickMode = false;
            highlightPossibleMoves(row, col, false);
          } else {
            gameState.selectedSquare = null;
            gameState.clickCount = 0;
          }
          return;
        }
      }
    }
    clearSquareHighlights();
    gameState.selectedSquare = squareId;
    gameState.clickCount = 1;
  }

  if (clickedPiece) {
    if (gameState.clickCount === 1) {
      selectedSquarePos = { row, col };
      doubleClickMode = false;
      highlightPossibleMoves(row, col, false);
    } else if (gameState.clickCount === 2) {
      selectedSquarePos = { row, col };
      doubleClickMode = true;
      highlightPossibleMoves(row, col, true);
    } else {
      clearSquareHighlights();
      gameState.selectedSquare = null;
      gameState.clickCount = 0;
    }
  } else {
    clearSquareHighlights();
    gameState.selectedSquare = null;
    gameState.clickCount = 0;
  }
}

function isValidMove(piece: ChessPiece, fromRow: number, fromCol: number, toRow: number, toCol: number, isDoubleMove: boolean = false): boolean {
  if (!piece || !gameState.currentBoard) return false;
  if (toRow < 0 || toRow >= 8 || toCol < 0 || toCol >= 8) return false;
  const targetPiece = gameState.currentBoard[toRow]?.[toCol];
  const isWhite = piece === piece.toUpperCase();
  if (targetPiece && (targetPiece === targetPiece.toUpperCase()) === isWhite) {
    return false;
  }
  const possibleMoves = getPossibleMoves(gameState.currentBoard, piece, fromRow, fromCol, isDoubleMove);
  return possibleMoves.some(move => move[0] === toRow && move[1] === toCol);
}

function highlightPossibleMoves(row: number, col: number, isDoubleMove: boolean = false): void {
  if (!gameState.currentBoard) return;
  const piece = gameState.currentBoard[row]?.[col];
  if (!piece) return;
  
  // Clear previous highlights
  highlightedSquares.clear();
  
  // Add selected square
  highlightedSquares.add(`${row},${col}`);
  
  // Add possible move squares
  const moves = getPossibleMoves(gameState.currentBoard, piece, row, col, isDoubleMove);
  for (const move of moves) {
    const [moveRow, moveCol] = move;
    if (moveRow >= 0 && moveRow < BOARD_SIZE && moveCol >= 0 && moveCol < BOARD_SIZE) {
      highlightedSquares.add(`${moveRow},${moveCol}`);
    }
  }
  
  // Redraw board with highlights
  drawCompleteBoard();
}

function clearSquareHighlights(): void {
  highlightedSquares.clear();
  selectedSquarePos = null;
  doubleClickMode = false;
  previewedSquareId = null;
  hoverHandlers.clear();
  drawCompleteBoard();
}

function scrollDebugToBottom(): void {
  const debugPanel = document.querySelector('.debug-panel');
  if (debugPanel) {
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }
}

function addDebugMessage(message: string): void {
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += message + '\n';
    setTimeout(() => {
      scrollDebugToBottom();
    }, 0);
  }
}

// Initialize the application
function initializeApp(): void {
  // Prepare rendering and connect when page loads (initial, no modal shown)
  preloadImages();
  initializeCanvas();
  connectWebSocket();

  const reconnectBtn = document.getElementById('reconnectBtn');
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', () => {
      if (gameState.reconnecting) return;
      gameState.reconnecting = true;
      startReconnectLoop();
    }, { passive: true });
  }

  const originalDebugElement = document.getElementById('debug');
  if (originalDebugElement) {
    const observer = new MutationObserver(() => {
      setTimeout(() => {
        scrollDebugToBottom();
      }, 0);
    });
    observer.observe(originalDebugElement, { childList: true, subtree: true, characterData: true });
  }

  // Initialize listeners once after DOM is ready (canvas exists above this script)
  // Note: canvas is initialized in the preloadImages/initializeCanvas section above
  initializeSquareListeners();
}

// Start the application when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
