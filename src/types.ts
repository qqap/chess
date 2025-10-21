// Shared types for the chess game application

// Core chess types
export type ChessPiece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | null;
export type ChessBoard = ChessPiece[][];
export type Position = [number, number]; // [row, col]
export type GameState = 'ongoing' | 'white_victory' | 'black_victory' | 'tie';

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

export interface BoardMessage {
  type: 'board';
  board: ChessBoard;
  gameState?: GameState;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type GameMessage = BoardMessage | ErrorMessage;

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
