// Client-side TypeScript code for the chess game

import { getPossibleMoves } from './getPossibleMoves.js';
import { 
  ChessBoard, 
  ChessPiece, 
  Position, 
  MoveData, 
  BoardMessage, 
  NewBoardMessage,
  ErrorMessage, 
  GameMessage, 
  SquarePosition, 
  HoverHandler, 
  WidthRatios, 
  MoveDetection,
  Turn,
  GameState,
  NewBoardState,
  SquareData,
  newBoardStateToChessBoard,
  chessBoardToNewBoardState,
  squareDataToChessPiece,
  MoveInfo,
  DebugToggleData
} from './types.js';

// Client-specific game state interface
interface ClientGameState {
  ws: WebSocket | null;
  currentBoard: ChessBoard | null;
  currentBoardState: NewBoardState | null;
  selectedSquare: string | null;
  clickCount: number;
  listenersInitialized: boolean;
  reconnecting: boolean;
  reconnectStartAt: number;
  reconnectAttempts: number;
  reconnectLoopTimer: number | null;
  connectAttemptTimer: number | null;
  reconnectSucceeded: boolean;
  currentTurn: Turn;
  gameState: GameState;
  debugMode: boolean;
}

// Constants
const MIN_RECONNECT_MS = 10000; 
const MIN_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL_MS = 1000;
const CONNECT_ATTEMPT_TIMEOUT_MS = 900;

// Piece image maps
const PIECES: Record<string, string> = {
  'K': '/pieces/simple/blue_king_alive.png',
  'Q': '/pieces/simple/blue_queen_alive.png', 
  'R': '/pieces/simple/blue_rook_alive.png',
  'B': '/pieces/simple/blue_bishop_alive.png',
  'N': '/pieces/simple/blue_knight_alive.png',
  'P': '/pieces/simple/blue_pawn_alive.png',
  'k': '/pieces/simple/red_king_alive.png',
  'q': '/pieces/simple/red_queen_alive.png',
  'r': '/pieces/simple/red_rook_alive.png',
  'b': '/pieces/simple/red_bishop_alive.png',
  'n': '/pieces/simple/red_knight_alive.png',
  'p': '/pieces/simple/red_pawn_alive.png'
};

const PIECES_DEAD: Record<string, string> = {
  'K': '/pieces/simple/blue_king_dead.png',
  'Q': '/pieces/simple/blue_queen_dead.png',
  'R': '/pieces/simple/blue_rook_dead.png',
  'B': '/pieces/simple/blue_bishop_dead.png',
  'N': '/pieces/simple/blue_knight_dead.png',
  'P': '/pieces/simple/blue_pawn_dead.png',
  'k': '/pieces/simple/red_king_dead.png',
  'q': '/pieces/simple/red_queen_dead.png',
  'r': '/pieces/simple/red_rook_dead.png',
  'b': '/pieces/simple/red_bishop_dead.png',
  'n': '/pieces/simple/red_knight_dead.png',
  'p': '/pieces/simple/red_pawn_dead.png'
};

// Global state
const gameState: ClientGameState = {
  ws: null,
  currentBoard: null,
  currentBoardState: null,
  selectedSquare: null,
  clickCount: 0,
  listenersInitialized: false,
  reconnecting: false,
  reconnectStartAt: 0,
  reconnectAttempts: 0,
  reconnectLoopTimer: null,
  connectAttemptTimer: null,
  reconnectSucceeded: false,
  currentTurn: 'blue',
  gameState: 'ongoing',
  debugMode: false
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
let animatingToSquare: SquarePosition | null = null;
let pendingImageLoads = new Set<HTMLImageElement>();
let isAnimatingQuantumSplit = false;
let animatingQuantumSquares = new Set<string>(); // Set of "row,col" strings being animated
let shakingSquares = new Set<string>(); // Set of "row,col" strings currently shaking

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

function preloadImages(): Promise<void> {
  return new Promise((resolve) => {
    const totalImages = Object.keys(PIECES).length + Object.keys(PIECES_DEAD).length;
    let loadedCount = 0;
    
    const checkComplete = () => {
      loadedCount++;
      if (loadedCount === totalImages) {
        resolve();
      }
    };
    
    // Preload alive pieces
    Object.keys(PIECES).forEach((key) => {
      if (!imageCache.has(key)) {
        const img = new Image();
        img.onload = checkComplete;
        img.onerror = checkComplete; // Also count errors as "loaded" to avoid hanging
        img.src = PIECES[key]!;
        imageCache.set(key, img);
      } else {
        // Already cached, count as loaded
        checkComplete();
      }
    });
    
    // Preload dead pieces with proper key mapping
    Object.keys(PIECES_DEAD).forEach((key) => {
      const deadKey = key + '_dead';
      if (!imageCache.has(deadKey)) {
        const img = new Image();
        img.onload = checkComplete;
        img.onerror = checkComplete; // Also count errors as "loaded" to avoid hanging
        img.src = PIECES_DEAD[key]!;
        imageCache.set(deadKey, img);
      } else {
        // Already cached, count as loaded
        checkComplete();
      }
    });
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

// Reusable function to draw a probabilistic piece on a canvas context
function drawProbabilisticPiece(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, piece: ChessPiece, probability: number): void {
  if (!piece) return;
  
  if (probability >= 1.0) {
    // Normal piece drawing for full probability
    const img = imageCache.get(piece);
    if (img && img.complete) {
      ctx.drawImage(img, x, y, width, height);
    }
  } else {
    // Probabilistic piece drawing
    const pieceType = piece.replace(/^[wb]/, ''); // Remove color prefix to get piece type
    const piece_ratio = WidthRatios[pieceType] || 0.8; // Use specific ratio or default
    
    // Get alive and dead piece images
    const img_alive = imageCache.get(piece);
    const img_dead = imageCache.get(piece + '_dead');
    
    if (!img_alive || !img_alive.complete) return;
    
    // Draw alive portion
    const alive_width = real_width(width, probability, piece_ratio);
    ctx.drawImage(img_alive, 
      0, 0, real_width(img_alive.width, probability, piece_ratio), img_alive.height,
      x, y, alive_width, height);
    
    // Draw dead portion (only if dead image exists and probability < 1.0)
    if (img_dead && img_dead.complete && probability < 1.0) {
      const dead_start_x = real_width(width, probability, piece_ratio);
      const dead_width = real_width(width, 1.0 - probability, piece_ratio);
      ctx.drawImage(img_dead,
        real_width(img_dead.width, probability, piece_ratio), 0, 
        real_width(img_dead.width, 1.0 - probability, piece_ratio), img_dead.height,
        x + dead_start_x, y, dead_width, height);
    }
  }
}

function drawPieceAt(row: number, col: number, piece: ChessPiece, probability: number = 1.0): void {
  if (!ctx || !piece) return;
  
  // Skip drawing if this square is currently being animated
  if (animatingFromSquare && animatingFromSquare.row === row && animatingFromSquare.col === col) {
    return;
  }
  
  // Skip drawing at destination square during animation
  if (animatingToSquare && animatingToSquare.row === row && animatingToSquare.col === col) {
    return;
  }
  
  // Skip drawing quantum pieces only if they're being animated
  if (isAnimatingQuantumSplit && probability < 1.0) {
    const squareKey = `${row},${col}`;
    if (animatingQuantumSquares.has(squareKey)) {
      return;
    }
  }
  
  if (probability >= 1.0) {
    // Normal piece drawing for full probability
    const img = imageCache.get(piece);
    if (!img) return;
    
    if (img.complete) {
      ctx.drawImage(img, col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    } else {
      // Track this image as pending and redraw when it loads
      pendingImageLoads.add(img);
      img.onload = () => {
        pendingImageLoads.delete(img);
        if (ctx) {
          // Schedule redraw of the entire board to ensure all pieces are visible
          if (pendingBoardRaf) cancelAnimationFrame(pendingBoardRaf);
          pendingBoardRaf = requestAnimationFrame(() => {
            drawCompleteBoard();
            pendingBoardRaf = 0;
          });
        }
      };
    }
  } else {
    // Use reusable probabilistic rendering function
    const img_alive = imageCache.get(piece);
    const img_dead = imageCache.get(piece + '_dead');
    
    if (!img_alive) return;
    
    const x = col * CELL_SIZE;
    const y = row * CELL_SIZE;
    
    if (img_alive.complete && (!img_dead || img_dead.complete)) {
      drawProbabilisticPiece(ctx, x, y, CELL_SIZE, CELL_SIZE, piece, probability);
    } else {
      let loadedCount = 0;
      const checkAndDraw = () => {
        loadedCount++;
        if (loadedCount >= 2 || (img_alive.complete && (!img_dead || img_dead.complete))) {
          if (ctx) {
            drawProbabilisticPiece(ctx, x, y, CELL_SIZE, CELL_SIZE, piece, probability);
          }
        }
      };
      
      if (!img_alive.complete) {
        pendingImageLoads.add(img_alive);
        img_alive.onload = () => {
          pendingImageLoads.delete(img_alive);
          checkAndDraw();
          // Schedule redraw of entire board when image loads
          if (ctx) {
            if (pendingBoardRaf) cancelAnimationFrame(pendingBoardRaf);
            pendingBoardRaf = requestAnimationFrame(() => {
              drawCompleteBoard();
              pendingBoardRaf = 0;
            });
          }
        };
      }
      if (img_dead && !img_dead.complete) {
        pendingImageLoads.add(img_dead);
        img_dead.onload = () => {
          pendingImageLoads.delete(img_dead);
          checkAndDraw();
          // Schedule redraw of entire board when image loads
          if (ctx) {
            if (pendingBoardRaf) cancelAnimationFrame(pendingBoardRaf);
            pendingBoardRaf = requestAnimationFrame(() => {
              drawCompleteBoard();
              pendingBoardRaf = 0;
            });
          }
        };
      }
    }
  }
}

function drawSquare(row: number, col: number, piece: ChessPiece, backgroundColor: string | null = null, probability: number = 1.0): void {
  drawSquareBackground(row, col, backgroundColor);
  if (piece) {
    drawPieceAt(row, col, piece, probability);
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
      
      // Get piece and probability from new board state
      let piece: ChessPiece = null;
      let probability = 1.0;
      
      if (gameState.currentBoardState) {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        const squareId = `${files[col]}${ranks[row]}`;
        const squareData = gameState.currentBoardState.squares[squareId];
        
        if (squareData) {
          // Convert square data back to chess piece for rendering
          const pieceMap: Record<SquareData['piece'], string> = {
            'king': 'k',
            'queen': 'q',
            'rook': 'r', 
            'bishop': 'b',
            'knight': 'n',
            'pawn': 'p'
          };
          
          const pieceType = pieceMap[squareData.piece]!;
          piece = squareData.player === 'blue' ? pieceType.toUpperCase() as ChessPiece : pieceType as ChessPiece;
          probability = squareData.probability;
        }
      } else if (gameState.currentBoard) {
        // Fallback to old format
        piece = gameState.currentBoard[row]?.[col] || null;
      }
      
      if (piece) {
        drawSquare(row, col, piece, bgColor, probability);
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

function getPieceProbability(row: number, col: number): number {
  if (gameState.currentBoardState) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    const squareId = `${files[col]}${ranks[row]}`;
    const squareData = gameState.currentBoardState.squares[squareId];
    return squareData?.probability ?? 1.0;
  }
  return 1.0;
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

function showWinModal(winner: 'blue' | 'red' | 'tie'): void {
  console.log('showWinModal called with winner:', winner);
  const modal = document.getElementById('winModal');
  const message = document.getElementById('winMessage');
  if (modal && message) {
    if (winner === 'tie') {
      message.textContent = 'Game Tied!';
    } else {
      message.textContent = `${winner === 'blue' ? 'Blue' : 'Red'} Wins!`;
    }
    modal.style.display = 'flex';
    console.log('Win modal should now be visible');
  } else {
    console.error('Could not find win modal elements');
  }
}

function hideWinModal(): void {
  const modal = document.getElementById('winModal');
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
    
    // Send debug toggle message if debug mode is enabled
    if (gameState.debugMode && gameState.ws) {
      gameState.ws.send(JSON.stringify({ type: 'debug_toggle', enabled: true }));
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
    
    // Handle error messages
    if (data && data.type === 'error') {
      console.log('Received error from server during reconnect:', data.message);
      const debugElement = document.getElementById('debug');
      if (debugElement) {
        debugElement.innerHTML += `<div style="color: #ff6666; font-weight: bold; background: rgba(255, 102, 102, 0.1); padding: 4px 8px; border-radius: 4px; margin: 4px 0;">Error: ${data.message}</div>`;
        setTimeout(() => {
          scrollDebugToBottom();
        }, 0);
      }
      return;
    }
    
    // Handle board updates
    if (data && data.type === 'board') {
      if ('boardState' in data && data.boardState) {
        // New format
        console.log('Received new board state format during reconnect');
        const boardMessage = data as NewBoardMessage;
        updateBoardFromNewState(boardMessage.boardState, boardMessage.lastMove);
        
        // Display harmonics if debug mode is enabled
        if (boardMessage.harmonics && gameState.debugMode) {
          displayHarmonics(boardMessage.harmonics);
        } else if (!boardMessage.harmonics && gameState.debugMode) {
          hideHarmonics();
        }
      } else if ('board' in data && Array.isArray(data.board)) {
        // Old format
        console.log('Received old board format during reconnect');
        printBoard(data.board);
        updateBoard(data.board, data.currentTurn, data.gameState);
      }
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
    
    // Send debug toggle message if debug mode is enabled
    if (gameState.debugMode && gameState.ws) {
      gameState.ws.send(JSON.stringify({ type: 'debug_toggle', enabled: true }));
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
    
    // Handle error messages
    if (data && data.type === 'error') {
      console.log('Received error from server:', data.message);
      const debugElement = document.getElementById('debug');
      if (debugElement) {
        debugElement.innerHTML += `<div style="color: #ff6666; font-weight: bold; background: rgba(255, 102, 102, 0.1); padding: 4px 8px; border-radius: 4px; margin: 4px 0;">Error: ${data.message}</div>`;
        setTimeout(() => {
          scrollDebugToBottom();
        }, 0);
      }
      return;
    }
    
    // Handle board updates
    if (data && data.type === 'board') {
      if ('boardState' in data && data.boardState) {
        // New format
        console.log('Received new board state format');
        const boardMessage = data as NewBoardMessage;
        updateBoardFromNewState(boardMessage.boardState, boardMessage.lastMove);
        
        // Display harmonics if debug mode is enabled
        if (boardMessage.harmonics && gameState.debugMode) {
          displayHarmonics(boardMessage.harmonics);
        } else if (!boardMessage.harmonics && gameState.debugMode) {
          hideHarmonics();
        }
      } else if ('board' in data && Array.isArray(data.board)) {
        // Old format
        console.log('Received old board format');
        printBoard(data.board);
        updateBoard(data.board, data.currentTurn, data.gameState);
      }
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

function updateBoardFromNewState(boardState: NewBoardState, lastMove?: MoveInfo): void {
  console.log('Updating board from new state:', boardState);
  console.log('Last move from server:', lastMove);
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += 'Updating board from new state' + '\n';
    if (lastMove) {
      const moveDesc = `${lastMove.piece} ${lastMove.from} -> ${lastMove.to} (${lastMove.moveType}${lastMove.captured ? `, captured ${lastMove.captured}` : ''})`;
      debugElement.innerHTML += `<div style="color: #88aaff; font-weight: bold; margin: 5px 0;">Last Move: ${moveDesc}</div>`;
    }
  }
  
  // Update game state
  const gameStateMap: Record<NewBoardState['gameState'], GameState> = {
    'game_still_going': 'ongoing',
    'blue_victory': 'blue_victory',
    'red_victory': 'red_victory',
    'tie': 'tie'
  };
  
  const prevBoardState = gameState.currentBoardState;
  gameState.currentTurn = boardState.activePlayer;
  gameState.gameState = gameStateMap[boardState.gameState];
  gameState.currentBoardState = boardState;
  
  // Convert to old format for compatibility with existing logic
  const newBoard = newBoardStateToChessBoard(boardState);
  
  // Update UI to reflect current turn and game state
  updateGameStatus();
  
  // Print board for debugging
  printBoard(newBoard);
  
  // Use explicit move info from server if available
  if (lastMove) {
    console.log('Using explicit move info from server for animation');
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    
    // Parse from square
    const fromMatch = lastMove.from.match(/^([a-h])([1-8])$/);
    const toMatch = lastMove.to.match(/^([a-h])([1-8])$/);
    
    if (fromMatch && toMatch) {
      const fromCol = fromMatch[1]!.charCodeAt(0) - 'a'.charCodeAt(0);
      const fromRow = 8 - parseInt(fromMatch[2]!, 10);
      const toCol = toMatch[1]!.charCodeAt(0) - 'a'.charCodeAt(0);
      const toRow = 8 - parseInt(toMatch[2]!, 10);
      
      const fromPos: SquarePosition & { piece: ChessPiece } = { row: fromRow, col: fromCol, piece: lastMove.piece };
      const toPos: SquarePosition & { piece: ChessPiece } = { row: toRow, col: toCol, piece: lastMove.piece };
      
      // Handle captured piece
      let capturedPos: (SquarePosition & { piece: ChessPiece }) | undefined = undefined;
      if (lastMove.captured) {
        capturedPos = { row: toRow, col: toCol, piece: lastMove.captured };
      }
      
      // Use updateBoard with explicit move detection
      if (lastMove.moveType === 'quantum') {
        console.log('Processing quantum move:', lastMove);
        // For quantum moves, use only source and destination squares
        const quantumPositions: Array<SquarePosition & { piece: ChessPiece; probability: number }> = [];
        let quantumSource: (SquarePosition & { piece: ChessPiece; probability?: number }) | null = null;
        
        if (prevBoardState) {
          // Get the probability from the PREVIOUS board state (before the move)
          const prevFromSquareData = prevBoardState.squares[lastMove.from];
          const sourceProbability = prevFromSquareData?.probability ?? 1.0;
          
          quantumSource = { ...fromPos, probability: sourceProbability };
          
          // Get probabilities for source and destination squares in NEW board state
          const fromSquareData = boardState.squares[lastMove.from];
          const toSquareData = boardState.squares[lastMove.to];
          
          // Add source square if it has reduced probability
          if (fromSquareData && fromSquareData.probability < 1.0 && fromSquareData.probability > 0) {
            quantumPositions.push({ row: fromRow, col: fromCol, piece: lastMove.piece, probability: fromSquareData.probability });
            console.log(`Quantum source: ${lastMove.piece} at (${fromRow},${fromCol}) with probability ${fromSquareData.probability}`);
          }
          
          // Add destination square if it has reduced probability
          if (toSquareData && toSquareData.probability < 1.0 && toSquareData.probability > 0) {
            quantumPositions.push({ row: toRow, col: toCol, piece: lastMove.piece, probability: toSquareData.probability });
            console.log(`Quantum destination: ${lastMove.piece} at (${toRow},${toCol}) with probability ${toSquareData.probability}`);
          }
        }
        
        console.log(`Total quantum positions found: ${quantumPositions.length}`);
        updateBoard(newBoard, gameState.currentTurn, gameState.gameState, quantumPositions.length > 0 ? quantumPositions : null, quantumSource);
      } else {
        // For ordinary moves, use move detection with explicit from/to positions
        // Look up probability from previous board state
        let probability = 1.0;
        if (prevBoardState) {
          const prevFromSquareData = prevBoardState.squares[lastMove.from];
          probability = prevFromSquareData?.probability ?? 1.0;
        }
        const moveDetected: MoveDetection = { from: { ...fromPos, probability }, to: toPos, captured: capturedPos };
        updateBoardWithMove(newBoard, moveDetected, gameState.currentTurn, gameState.gameState);
      }
      
      return;
    }
  }
  
  // Fallback to old detection logic if no explicit move info
  // Check for quantum split before converting
  const quantumPositions: Array<SquarePosition & { piece: ChessPiece; probability: number }> = [];
  let quantumSource: (SquarePosition & { piece: ChessPiece; probability?: number }) | null = null;
  
  if (prevBoardState) {
    // Find pieces that appeared on NEW squares with reduced probability
    // This happens when a quantum move creates superposition
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    
    const quantumPieceGroups = new Map<string, Array<SquarePosition & { piece: ChessPiece; probability: number }>>();
    
    // Convert to chess boards for comparison
    const prevBoard = newBoardStateToChessBoard(prevBoardState);
    
    // First, find where a piece disappeared (the source of the quantum move)
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const prevPiece = prevBoard[row]?.[col];
        const curPiece = newBoard[row]?.[col];
        
        // Piece disappeared (source of quantum move)
        if (prevPiece && !curPiece) {
          // Get the probability from the previous board state
          const squareId = `${files[col]}${ranks[row]}`;
          const prevSquareData = prevBoardState.squares[squareId];
          const sourceProbability = prevSquareData?.probability ?? 1.0;
          
          quantumSource = { row, col, piece: prevPiece, probability: sourceProbability };
          console.log(`Quantum source detected: ${prevPiece} at row=${row}, col=${col} with probability ${sourceProbability}`);
        }
      }
    }
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const squareId = `${files[col]}${ranks[row]}`;
        
        const prevPiece = prevBoard[row]?.[col];
        const curSquareData = boardState.squares[squareId];
        
        // Find squares where:
        // 1. A NEW piece appeared with reduced probability, OR
        // 2. The same piece now has reduced probability (< 1.0)
        if (curSquareData && curSquareData.probability < 1.0 && curSquareData.probability > 0) {
          const piece = squareDataToChessPiece(curSquareData);
          if (piece) {
            // Only include if it's a new square OR the probability dropped
            const prevSquareData = prevBoardState.squares[squareId];
            const prevProb = prevSquareData?.probability ?? 0;
            
            if (!prevPiece || prevProb === 1.0) {
              const key = piece;
              if (!quantumPieceGroups.has(key)) {
                quantumPieceGroups.set(key, []);
              }
              quantumPieceGroups.get(key)!.push({ row, col, piece, probability: curSquareData.probability });
              console.log(`Quantum split detected: ${piece} at row=${row}, col=${col}, prob=${curSquareData.probability}`);
            }
          }
        }
      }
    }
    
    // Find the first group with 2+ positions (actual split)
    for (const [piece, positions] of quantumPieceGroups) {
      if (positions.length >= 2) {
        quantumPositions.push(...positions);
        console.log(`Animating quantum split for ${piece} with ${positions.length} positions`);
        break; // Only animate the first quantum split found
      }
    }
  }
  
  // Use updateBoard to enable animations
  updateBoard(newBoard, gameState.currentTurn, gameState.gameState, quantumPositions.length > 0 ? quantumPositions : null, quantumSource);
}

function updateBoardWithMove(board: ChessBoard, moveDetected: MoveDetection, currentTurn?: Turn, gameStateParam?: GameState): void {
  console.log('Updating board with explicit move:', moveDetected);
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += 'Updating board with explicit move' + '\n';
  }
  
  // Update turn and game state if provided
  if (currentTurn !== undefined) {
    gameState.currentTurn = currentTurn;
  }
  if (gameStateParam !== undefined) {
    gameState.gameState = gameStateParam;
  }
  
  // Update UI to reflect current turn and game state
  updateGameStatus();
  
  const prevBoard = gameState.currentBoard ? gameState.currentBoard.map(r => r.slice()) : null;
  const newBoard = board.map(r => r.slice());

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
}

function updateBoard(board: ChessBoard, currentTurn?: Turn, gameStateParam?: GameState, quantumPositions?: Array<SquarePosition & { piece: ChessPiece; probability: number }> | null, quantumSource?: (SquarePosition & { piece: ChessPiece; probability?: number }) | null): void {
  console.log('Updating board:', board);
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML += 'Updating board' + '\n';
  }
  
  // Update turn and game state if provided
  if (currentTurn !== undefined) {
    gameState.currentTurn = currentTurn;
  }
  if (gameStateParam !== undefined) {
    gameState.gameState = gameStateParam;
  }
  
  // Update UI to reflect current turn and game state
  updateGameStatus();
  
  const prevBoard = gameState.currentBoard ? gameState.currentBoard.map(r => r.slice()) : null;
  const newBoard = board.map(r => r.slice());

  // Detect piece movement by comparing boards
  let moveDetected: MoveDetection | null = null;
  let quantumSplitDetected: Array<SquarePosition & { piece: ChessPiece; probability: number }> | null = null;
  
  // Use provided quantum positions if available
  if (quantumPositions && quantumPositions.length > 0) {
    console.log('Setting quantumSplitDetected from quantumPositions:', quantumPositions);
    quantumSplitDetected = quantumPositions;
  }
  
  if (prevBoard && !isAnimatingMove && !isAnimatingQuantumSplit && !quantumSplitDetected) {
    // Regular move detection
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
      // Look up probability from previous board state
      let probability = 1.0;
      if (gameState.currentBoardState) {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        const squareId = `${files[fromPos.col]}${ranks[fromPos.row]}`;
        const squareData = gameState.currentBoardState.squares[squareId];
        if (squareData) {
          probability = squareData.probability;
        }
      }
      moveDetected = { from: { ...fromPos, probability }, to: toPos, captured: capturedPiece || undefined };
    }
  }

  if (quantumSplitDetected) {
    console.log('Found quantum split, animating...', quantumSplitDetected);
    // Animate quantum split
    animateQuantumSplit(quantumSplitDetected, quantumSource || undefined, () => {
      // After animation, update the actual board state
      gameState.currentBoard = newBoard;
      
      if (pendingBoardRaf) cancelAnimationFrame(pendingBoardRaf);
      pendingBoardRaf = requestAnimationFrame(() => {
        drawCompleteBoard();
        pendingBoardRaf = 0;
      });
    });
  } else if (moveDetected) {
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

function animatePieceMove(from: SquarePosition & { piece: ChessPiece; probability?: number }, to: SquarePosition & { piece: ChessPiece }, captured: (SquarePosition & { piece: ChessPiece }) | undefined, onComplete: () => void): void {
  isAnimatingMove = true;
  animatingFromSquare = { row: from.row, col: from.col };
  animatingToSquare = { row: to.row, col: to.col };
  
  // Redraw board to hide the piece from source square
  drawCompleteBoard();
  
  const src = getPieceImageSrc(from.piece);
  if (!src) {
    isAnimatingMove = false;
    animatingFromSquare = null;
    animatingToSquare = null;
    onComplete();
    return;
  }

  const layer = document.getElementById('float-layer');
  if (!layer) {
    isAnimatingMove = false;
    animatingFromSquare = null;
    animatingToSquare = null;
    onComplete();
    return;
  }

  const fromPos = squareToClientPosition(from.row, from.col);
  const toPos = squareToClientPosition(to.row, to.col);
  if (!fromPos || !toPos) {
    isAnimatingMove = false;
    animatingFromSquare = null;
    animatingToSquare = null;
    onComplete();
    return;
  }

  // Spawn captured piece animation if there was a capture
  if (captured) {
    spawnFloatingPiece(captured.row, captured.col, captured.piece);
  }

  const probability = from.probability ?? 1.0;
  const containerRect = layer.getBoundingClientRect();
  
  const startX = fromPos.x - containerRect.left;
  const startY = fromPos.y - containerRect.top;
  const endX = toPos.x - containerRect.left;
  const endY = toPos.y - containerRect.top;
  
  // Use canvas for partial pieces, regular img for full pieces
  if (probability < 1.0) {
    // Create canvas element for partial piece
    const moveCanvas = document.createElement('canvas');
    moveCanvas.width = CELL_SIZE * DPR;
    moveCanvas.height = CELL_SIZE * DPR;
    moveCanvas.style.width = CELL_SIZE + 'px';
    moveCanvas.style.height = CELL_SIZE + 'px';
    moveCanvas.className = 'moving-piece';
    moveCanvas.style.left = startX + 'px';
    moveCanvas.style.top = startY + 'px';
    moveCanvas.style.position = 'absolute';
    
    const moveCtx = moveCanvas.getContext('2d', { alpha: true });
    if (moveCtx && from.piece) {
      moveCtx.scale(DPR, DPR);
      moveCtx.imageSmoothingEnabled = true;
      moveCtx.imageSmoothingQuality = 'high';
      
      // Use reusable probabilistic rendering function
      drawProbabilisticPiece(moveCtx, 0, 0, CELL_SIZE, CELL_SIZE, from.piece, probability);
    }
    
    layer.appendChild(moveCanvas);
    
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
      
      moveCanvas.style.transform = `translate(${currentX - startX}px, ${currentY - startY}px)`;
      
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        // Animation complete
        if (moveCanvas.parentNode) moveCanvas.parentNode.removeChild(moveCanvas);
        isAnimatingMove = false;
        animatingFromSquare = null;
        animatingToSquare = null;
        onComplete();
      }
    }
    
    requestAnimationFrame(animate);
  } else {
    // Create moving piece element for full piece
    const img = new Image();
    img.src = src;
    img.className = 'moving-piece';
    
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
        animatingToSquare = null;
        onComplete();
      }
    }

    requestAnimationFrame(animate);
  }
}

function animateQuantumSplit(splitPositions: Array<SquarePosition & { piece: ChessPiece; probability: number }>, source: (SquarePosition & { piece: ChessPiece; probability?: number }) | undefined, onComplete: () => void): void {
  console.log('animateQuantumSplit called with', splitPositions.length, 'positions');
  isAnimatingQuantumSplit = true;
  
  // Track which squares are being animated
  animatingQuantumSquares.clear();
  for (const pos of splitPositions) {
    animatingQuantumSquares.add(`${pos.row},${pos.col}`);
  }
  
  // Draw board without the quantum pieces initially
  drawCompleteBoard();
  
  const layer = document.getElementById('float-layer');
  if (!layer) {
    console.log('float-layer not found!');
    isAnimatingQuantumSplit = false;
    animatingQuantumSquares.clear();
    onComplete();
    return;
  }
  
  const piece = splitPositions[0]!.piece;
  const src = getPieceImageSrc(piece);
  if (!src) {
    isAnimatingQuantumSplit = false;
    animatingQuantumSquares.clear();
    onComplete();
    return;
  }
  
  const containerRect = layer.getBoundingClientRect();
  
  // If we have a source, first move to the first destination, then split
  if (source && splitPositions.length > 0) {
    const firstDest = splitPositions[0]!;
    const sourcePos = squareToClientPosition(source.row, source.col);
    const destPos = squareToClientPosition(firstDest.row, firstDest.col);
    
    if (!sourcePos || !destPos) {
      isAnimatingQuantumSplit = false;
      animatingQuantumSquares.clear();
      onComplete();
      return;
    }
    
    // Get the probability from the SOURCE (what it was before the move)
    const probability = source.probability ?? 1.0;
    
    // Animate moving to first destination
    const moveDurationMs = 300;
    const moveStart = performance.now();
    
    // Use canvas to draw partial piece instead of full image
    const moveCanvas = document.createElement('canvas');
    moveCanvas.width = CELL_SIZE * DPR;
    moveCanvas.height = CELL_SIZE * DPR;
    moveCanvas.style.width = CELL_SIZE + 'px';
    moveCanvas.style.height = CELL_SIZE + 'px';
    moveCanvas.className = 'moving-piece';
    moveCanvas.style.left = (sourcePos.x - containerRect.left) + 'px';
    moveCanvas.style.top = (sourcePos.y - containerRect.top) + 'px';
    moveCanvas.style.position = 'absolute';
    
    const moveCtx = moveCanvas.getContext('2d', { alpha: true });
    if (moveCtx && piece) {
      moveCtx.scale(DPR, DPR);
      moveCtx.imageSmoothingEnabled = true;
      moveCtx.imageSmoothingQuality = 'high';
      
      // Use reusable probabilistic rendering function
      drawProbabilisticPiece(moveCtx, 0, 0, CELL_SIZE, CELL_SIZE, piece, probability);
    }
    
    layer.appendChild(moveCanvas);
    
    function animateMove(now: number): void {
      const elapsed = now - moveStart;
      const t = Math.min(1, elapsed / moveDurationMs);
      
      const startX = sourcePos!.x - containerRect.left;
      const startY = sourcePos!.y - containerRect.top;
      const endX = destPos!.x - containerRect.left;
      const endY = destPos!.y - containerRect.top;
      
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      
      const x = startX + (endX - startX) * ease;
      const y = startY + (endY - startY) * ease;
      
      moveCanvas.style.left = x + 'px';
      moveCanvas.style.top = y + 'px';
      
      if (t < 1) {
        requestAnimationFrame(animateMove);
      } else {
        // Move complete, remove moving piece and start split animation
        if (moveCanvas.parentNode) moveCanvas.parentNode.removeChild(moveCanvas);
        animateSplit();
      }
    }
    
    requestAnimationFrame(animateMove);
  } else {
    // No source provided, animate split from center
    animateSplit();
  }
  
  function animateSplit(): void {
    // Calculate center of all positions for the split source
    let avgRow = 0;
    let avgCol = 0;
    for (const pos of splitPositions) {
      avgRow += pos.row;
      avgCol += pos.col;
    }
    avgRow /= splitPositions.length;
    avgCol /= splitPositions.length;
    
    const centerPos = squareToClientPosition(Math.round(avgRow), Math.round(avgCol));
    if (!centerPos) {
      isAnimatingQuantumSplit = false;
      animatingQuantumSquares.clear();
      onComplete();
      return;
    }
    
    const centerX = centerPos.x - containerRect.left;
    const centerY = centerPos.y - containerRect.top;
    
    // Get piece type for width ratio calculation
    if (!piece) {
      isAnimatingQuantumSplit = false;
      animatingQuantumSquares.clear();
      onComplete();
      return;
    }
    
    // Create multiple canvas elements for the split animation
    const canvases: HTMLCanvasElement[] = [];
    for (const pos of splitPositions) {
      const canvas = document.createElement('canvas');
      canvas.width = CELL_SIZE * DPR;
      canvas.height = CELL_SIZE * DPR;
      canvas.style.width = CELL_SIZE + 'px';
      canvas.style.height = CELL_SIZE + 'px';
      canvas.className = 'quantum-split-piece';
      canvas.style.left = centerX + 'px';
      canvas.style.top = centerY + 'px';
      canvas.style.opacity = '0';
      canvas.style.position = 'absolute';
      
      const ctx = canvas.getContext('2d', { alpha: true });
      if (ctx) {
        ctx.scale(DPR, DPR);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Use reusable probabilistic rendering function
        drawProbabilisticPiece(ctx, 0, 0, CELL_SIZE, CELL_SIZE, piece, pos.probability);
      }
      
      layer!.appendChild(canvas);
      canvases.push(canvas);
    }
    
    const durationMs = 600; // 600ms for quantum split animation
    const start = performance.now();
    
    function animate(now: number): void {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      
      // Create a pulsing quantum effect
      const quantumPulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 4);
      
      for (let i = 0; i < splitPositions.length; i++) {
        const pos = splitPositions[i]!;
        const canvas = canvases[i]!;
        
        const targetPos = squareToClientPosition(pos.row, pos.col);
        if (!targetPos) continue;
        
        const targetX = targetPos.x - containerRect.left;
        const targetY = targetPos.y - containerRect.top;
        
        // Split animation with easing
        const ease = t < 0.5 
          ? 2 * t * t 
          : 1 - Math.pow(-2 * t + 2, 2) / 2;
        
        const x = centerX + (targetX - centerX) * ease;
        const y = centerY + (targetY - centerY) * ease;
        
        // Fade in opacity
        const opacity = Math.min(1, t * 2);
        
        // Add quantum shimmer effect
        const shimmer = quantumPulse * 0.3;
        
        canvas.style.transform = `translate(${x - centerX}px, ${y - centerY}px) scale(${1 + shimmer})`;
        canvas.style.opacity = String(opacity);
        
        // Add blur effect for quantum-ness
        if (t < 0.7) {
          const blur = (1 - t / 0.7) * 8;
          canvas.style.filter = `blur(${blur}px)`;
        } else {
          canvas.style.filter = 'none';
        }
      }
      
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        // Animation complete
        canvases.forEach(canvas => {
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        });
        isAnimatingQuantumSplit = false;
        animatingQuantumSquares.clear();
        onComplete();
      }
    }
    
    requestAnimationFrame(animate);
  }
}

function shakePiece(row: number, col: number, piece: ChessPiece, probability: number = 1.0): void {
  const squareKey = `${row},${col}`;
  
  // Prevent double shake on the same piece
  if (shakingSquares.has(squareKey)) {
    return;
  }
  
  const layer = document.getElementById('float-layer');
  if (!layer) return;
  const pos = squareToClientPosition(row, col);
  if (!pos) return;

  if (!ctx) return;
  
  // Mark this square as shaking
  shakingSquares.add(squareKey);
  
  // Temporarily erase the piece from the canvas by drawing the square background
  const bgColor = isLightSquare(row, col) ? LIGHT_SQUARE : DARK_SQUARE;
  ctx.fillStyle = bgColor;
  ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  
  // Create shaking piece canvas overlay
  const shakeCanvas = document.createElement('canvas');
  shakeCanvas.width = CELL_SIZE * DPR;
  shakeCanvas.height = CELL_SIZE * DPR;
  shakeCanvas.style.width = CELL_SIZE + 'px';
  shakeCanvas.style.height = CELL_SIZE + 'px';
  shakeCanvas.className = 'shake-piece';
  shakeCanvas.style.position = 'absolute';
  
  const containerRect = layer.getBoundingClientRect();
  shakeCanvas.style.left = (pos.x - containerRect.left) + 'px';
  shakeCanvas.style.top = (pos.y - containerRect.top) + 'px';
  
  const shakeCtx = shakeCanvas.getContext('2d', { alpha: true });
  if (shakeCtx) {
    shakeCtx.scale(DPR, DPR);
    shakeCtx.imageSmoothingEnabled = true;
    shakeCtx.imageSmoothingQuality = 'high';
    
    // Use reusable probabilistic rendering function
    drawProbabilisticPiece(shakeCtx, 0, 0, CELL_SIZE, CELL_SIZE, piece, probability);
  }
  
  layer.appendChild(shakeCanvas);

  // Remove the element and restore the board after animation completes
  setTimeout(() => {
    if (shakeCanvas.parentNode) shakeCanvas.parentNode.removeChild(shakeCanvas);
    // Unmark this square as shaking
    shakingSquares.delete(squareKey);
    // Redraw the complete board to restore the piece
    drawCompleteBoard();
  }, 500);
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
  
  // Check if game is still active
  if (!isGameActive()) {
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      debugElement.innerHTML += '<span style="color: #ff6666;">Game has ended - no moves allowed</span>\n';
    }
    return;
  }

  const clickedPiece = gameState.currentBoard[row]?.[col];
  
  // Check if clicked piece belongs to the current player
  // Only shake if there's no piece already selected (initial click)
  if (clickedPiece && !gameState.selectedSquare) {
    const isWhitePiece = clickedPiece === clickedPiece.toUpperCase();
    const isBlueTurn = gameState.currentTurn === 'blue';
    
    // If it's not the player's piece, show shake animation
    if (isWhitePiece !== isBlueTurn) {
      const probability = getPieceProbability(row, col);
      shakePiece(row, col, clickedPiece, probability);
      return;
    }
  }

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
          // Send move to server - server will validate turn and legality
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
    
    // Check if this piece has valid moves BEFORE clearing highlights
    // This prevents unnecessary board redraw when shaking
    if (clickedPiece) {
      const moves = getPossibleMoves(gameState.currentBoard, clickedPiece, row, col, false);
      const doubleMoves = getPossibleMoves(gameState.currentBoard, clickedPiece, row, col, true);
      
      // If no valid moves at all, shake the piece and return early
      if (moves.length === 0 && doubleMoves.length === 0) {
        // Clear highlights without redrawing (to avoid drawing duplicate piece)
        highlightedSquares.clear();
        selectedSquarePos = null;
        doubleClickMode = false;
        previewedSquareId = null;
        hoverHandlers.clear();
        gameState.selectedSquare = null;
        gameState.clickCount = 0;
        const probability = getPieceProbability(row, col);
        shakePiece(row, col, clickedPiece, probability);
        return;
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

function isGameActive(): boolean {
  return gameState.gameState === 'ongoing';
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

function renderHarmonicBoard(board: ChessBoard, degeneracy: number, index: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'harmonic-board-canvas';
  canvas.width = 8 * 15; // 15px per square for small boards
  canvas.height = 8 * 15;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  // Draw the board
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const isLight = (row + col) % 2 === 0;
      ctx.fillStyle = isLight ? '#f0d9b5' : '#b58863';
      ctx.fillRect(col * 15, row * 15, 15, 15);
      
      const piece = board[row]?.[col];
      if (piece) {
        const img = imageCache.get(piece);
        if (img && img.complete) {
          ctx.drawImage(img, col * 15, row * 15, 15, 15);
        }
      }
    }
  }
  
  return canvas;
}

function displayHarmonics(harmonics: Array<{ board: ChessBoard; degeneracy: number }>): void {
  const harmonicsDisplay = document.getElementById('harmonics-display');
  const harmonicsContent = harmonicsDisplay?.querySelector('.harmonics-display-content');
  if (!harmonicsDisplay || !harmonicsContent) return;
  
  // Clear existing harmonic boards but keep the summary
  const summary = harmonicsContent.querySelector('.harmonics-summary');
  harmonicsContent.innerHTML = '';
  if (summary) {
    harmonicsContent.appendChild(summary);
  }
  
  // Calculate total degeneracy
  const totalDegeneracy = harmonics.reduce((sum, h) => sum + h.degeneracy, 0);
  
  // Update summary
  const harmonicCount = document.getElementById('harmonic-count');
  const degeneracyTotal = document.getElementById('degeneracy-total');
  if (harmonicCount) harmonicCount.textContent = harmonics.length.toString();
  if (degeneracyTotal) degeneracyTotal.textContent = totalDegeneracy.toString();
  
  // Display each harmonic
  harmonics.forEach((harmonic, index) => {
    const container = document.createElement('div');
    container.className = 'harmonic-board';
    
    const title = document.createElement('h4');
    title.textContent = `Harmonic ${index + 1}`;
    container.appendChild(title);
    
    const degenerayInfo = document.createElement('div');
    degenerayInfo.className = 'harmonic-degeneracy';
    const probability = (harmonic.degeneracy / totalDegeneracy * 100).toFixed(1);
    degenerayInfo.textContent = `Degeneracy: ${harmonic.degeneracy} (${probability}%)`;
    container.appendChild(degenerayInfo);
    
    const canvas = renderHarmonicBoard(harmonic.board, harmonic.degeneracy, index);
    container.appendChild(canvas);
    
    harmonicsContent.appendChild(container);
  });
  
  harmonicsDisplay.classList.add('show');
}

function hideHarmonics(): void {
  const harmonicsDisplay = document.getElementById('harmonics-display');
  if (harmonicsDisplay) {
    harmonicsDisplay.classList.remove('show');
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

function updateGameStatus(): void {
  const debugElement = document.getElementById('debug');
  if (!debugElement) return;
  
  console.log('updateGameStatus called with gameState:', gameState.gameState);
  const turnText = gameState.currentTurn === 'blue' ? "Blue's Turn" : "Red's Turn";
  let stateText = '';
  switch (gameState.gameState) {
    case 'ongoing':
      stateText = 'Game Ongoing';
      break;
    case 'blue_victory':
      stateText = 'Blue Wins!';
      console.log('Showing blue victory modal');
      showWinModal('blue');
      break;
    case 'red_victory':
      stateText = 'Red Wins!';
      console.log('Showing red victory modal');
      showWinModal('red');
      break;
    case 'tie':
      stateText = 'Game Tied';
      console.log('Showing tie modal');
      showWinModal('tie');
      break;
    default:
      stateText = 'Game Ongoing';
  }
  
  // Add status to debug logs with styling
  debugElement.innerHTML += `<div style="color: #88aaff; font-weight: bold; margin: 5px 0;">${turnText} - ${stateText}</div>`;
}

function resetGame(): void {
  // Hide any open modals
  hideWinModal();
  hideReconnectModal();
  
  // Clear game state
  gameState.currentBoard = null;
  gameState.currentBoardState = null;
  gameState.selectedSquare = null;
  gameState.clickCount = 0;
  gameState.currentTurn = 'blue';
  gameState.gameState = 'ongoing';
  
  // Clear highlights and selection
  clearSquareHighlights();
  
  // Clear animation states
  shakingSquares.clear();
  
  // Send reset request to server
  if (gameState.ws && gameState.ws.readyState === WebSocket.OPEN) {
    gameState.ws.send(JSON.stringify({ type: 'reset' }));
  }
  
  // Clear debug panel
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.innerHTML = '';
  }
}

// Initialize the application
async function initializeApp(): Promise<void> {
  // Check for debug query parameter and set initial state
  const urlParams = new URLSearchParams(window.location.search);
  const debugParam = urlParams.get('debug');
  if (debugParam === 'true') {
    gameState.debugMode = true;
  }
  
  // Prepare rendering and connect when page loads (initial, no modal shown)
  await preloadImages();
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

  const newGameBtn = document.getElementById('newGameBtn');
  if (newGameBtn) {
    newGameBtn.addEventListener('click', () => {
      resetGame();
    }, { passive: true });
  }

  const debugToggleBtn = document.getElementById('debugToggle') as HTMLButtonElement;
  if (debugToggleBtn) {
    // Set initial button state based on URL parameter
    debugToggleBtn.textContent = gameState.debugMode ? 'DEBUG ON' : 'DEBUG';
    debugToggleBtn.classList.toggle('active', gameState.debugMode);
    
    debugToggleBtn.addEventListener('click', () => {
      gameState.debugMode = !gameState.debugMode;
      debugToggleBtn.textContent = gameState.debugMode ? 'DEBUG ON' : 'DEBUG';
      debugToggleBtn.classList.toggle('active', gameState.debugMode);
      
      // Update URL query parameter
      const url = new URL(window.location.href);
      if (gameState.debugMode) {
        url.searchParams.set('debug', 'true');
      } else {
        url.searchParams.delete('debug');
      }
      window.history.replaceState({}, '', url.toString());
      
      // Send debug toggle message to server
      if (gameState.ws && gameState.ws.readyState === WebSocket.OPEN) {
        gameState.ws.send(JSON.stringify({ type: 'debug_toggle', enabled: gameState.debugMode }));
      }
      
      // Hide harmonics if debug mode is disabled
      if (!gameState.debugMode) {
        hideHarmonics();
      }
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
