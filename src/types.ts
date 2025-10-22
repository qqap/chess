// Shared types for the chess game application

// Core chess types
export type ChessPiece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | null;
export type ChessBoard = ChessPiece[][];
export type Position = [number, number]; // [row, col]
export type GameState = 'ongoing' | 'white_victory' | 'black_victory' | 'tie';
export type Turn = 'white' | 'black';

// New board state structure
export interface SquareData {
  player: 'white' | 'black';
  piece: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
  probability: number;
}

export interface NewBoardState {
  gameState: 'game_still_going' | 'white_victory' | 'black_victory' | 'tie';
  activePlayer: 'white' | 'black';
  squares: Record<string, SquareData | null>;
  lastMovePositions?: string[];
}

// WebSocket and session types
export interface Session {
  id: string;
  name: string | null;
}

// Message types
export interface MoveData {
  type: 'move';
  from: string;
  to: string;
  isDoubleMove?: boolean;
}

export interface ResetData {
  type: 'reset';
}

export interface BoardMessage {
  type: 'board';
  board: ChessBoard;
  gameState?: GameState;
  currentTurn?: Turn;
}

export interface NewBoardMessage {
  type: 'board';
  boardState: NewBoardState;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type GameMessage = BoardMessage | NewBoardMessage | ErrorMessage;
export type ClientMessage = MoveData | ResetData;

// Client-side specific types
export interface ClientGameState {
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
  currentTurn: Turn;
  gameState: GameState;
}

export interface SquarePosition {
  row: number;
  col: number;
}

export interface HoverHandler {
  enter: () => void;
  leave: () => void;
}

export interface WidthRatios {
  [key: string]: number;
}

export interface MoveDetection {
  from: SquarePosition & { piece: ChessPiece };
  to: SquarePosition & { piece: ChessPiece };
  captured?: (SquarePosition & { piece: ChessPiece }) | undefined;
}

// // Server-side specific types
// export interface WebSocketRequestResponsePair {
//   request: string;
//   response: string;
// 

export interface Env {
  games: DurableObjectNamespace;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
  getWebSockets(): WebSocket[];
  acceptWebSocket(webSocket: WebSocket): void;
  setWebSocketAutoResponse?(pair: WebSocketRequestResponsePair): void;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

// Internal move calculation types
export interface MoveResult {
  singles: Position[];
  emptyLandings: Position[];
}

// Board conversion utilities
export function chessPieceToSquareData(piece: ChessPiece): SquareData | null {
  if (!piece) return null;
  
  const isWhite = piece === piece.toUpperCase();
  const player = isWhite ? 'white' : 'black';
  const pieceType = piece.toLowerCase();
  
  const pieceMap: Record<string, SquareData['piece']> = {
    'k': 'king',
    'q': 'queen', 
    'r': 'rook',
    'b': 'bishop',
    'n': 'knight',
    'p': 'pawn'
  };
  
  return {
    player,
    piece: pieceMap[pieceType]!,
    probability: 1.0
  };
}

export function squareDataToChessPiece(squareData: SquareData | null): ChessPiece {
  if (!squareData) return null;
  
  const pieceMap: Record<SquareData['piece'], string> = {
    'king': 'k',
    'queen': 'q',
    'rook': 'r', 
    'bishop': 'b',
    'knight': 'n',
    'pawn': 'p'
  };
  
  const pieceType = pieceMap[squareData.piece]!;
  return squareData.player === 'white' ? pieceType.toUpperCase() as ChessPiece : pieceType as ChessPiece;
}

export function chessBoardToNewBoardState(board: ChessBoard, currentTurn: Turn, gameState: GameState): NewBoardState {
  const squares: Record<string, SquareData | null> = {};
  
  // Initialize all squares as null
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
      const squareId = `${files[col]}${ranks[row]}`;
      squares[squareId] = null;
    }
  }
  
  // Fill in pieces
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
      const squareId = `${files[col]}${ranks[row]}`;
      const piece = board[row]?.[col];
      squares[squareId] = chessPieceToSquareData(piece || null);
    }
  }
  
  const gameStateMap: Record<GameState, NewBoardState['gameState']> = {
    'ongoing': 'game_still_going',
    'white_victory': 'white_victory',
    'black_victory': 'black_victory', 
    'tie': 'tie'
  };
  
  return {
    gameState: gameStateMap[gameState],
    activePlayer: currentTurn,
    squares
  };
}

export function newBoardStateToChessBoard(boardState: NewBoardState): ChessBoard {
  const board: ChessBoard = [];
  
  for (let row = 0; row < 8; row++) {
    board[row] = [];
    for (let col = 0; col < 8; col++) {
      const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
      const squareId = `${files[col]}${ranks[row]}`;
      const squareData = boardState.squares[squareId];
      board[row]![col] = squareDataToChessPiece(squareData || null);
    }
  }
  
  return board;
}
