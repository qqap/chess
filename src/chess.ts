// Collaborative Chess Worker - Built using Durable Objects!

// @ts-ignore
import HTML from "./chess.html";
// @ts-ignore
import LIST_HTML from "./list.html";
import { getPossibleMoves } from "./getPossibleMoves.js";
import { 
  Session, 
  MoveData, 
  ResetData,
  BoardMessage, 
  NewBoardMessage,
  ErrorMessage, 
  GameMessage, 
  ClientMessage,
  ChessPiece, 
  ChessBoard, 
  GameState, 
  Turn,
  Env, 
  DurableObjectState,
  NewBoardState,
  quantumHarmonicsToBoardState,
  QuantumPiece,
  QuantumHarmonic,
  QuantumBoardState,
  OrdinaryMove,
  QuantumMove,
  CastleMove,
  AssertionException,
  Position,
  MoveInfo,
//   WebSocketRequestResponsePair 
} from "./types";

// Cloudflare Workers types
declare global {
  interface WebSocket {
    serializeAttachment(attachment: any): void;
    deserializeAttachment(): any;
    accept(): void;
  }
}

// Rate limiter for WebSocket connections
export class RateLimiter {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response("Rate limiter", {status: 200});
  }
}

// Helper functions for tracking games in KV
async function registerGame(env: Env, gameId: string, gameState: GameState): Promise<void> {
  const gameInfo = {
    lastAccessed: Date.now(),
    gameState: gameState
  };
  await env.GAMES_TRACKER.put(gameId, JSON.stringify(gameInfo));
}

async function updateGame(env: Env, gameId: string, gameState: GameState): Promise<void> {
  const existing = await env.GAMES_TRACKER.get(gameId);
  if (existing) {
    const gameInfo = {
      lastAccessed: Date.now(),
      gameState: gameState
    };
    await env.GAMES_TRACKER.put(gameId, JSON.stringify(gameInfo));
  }
}

async function unregisterGame(env: Env, gameId: string): Promise<void> {
  await env.GAMES_TRACKER.delete(gameId);
}

async function listGames(env: Env): Promise<Array<{ id: string; lastAccessed: number; gameState: GameState }>> {
  const activeGames: Array<{ id: string; lastAccessed: number; gameState: GameState }> = [];
  
  const list = await env.GAMES_TRACKER.list();
  for (const key of list.keys) {
    const value = await env.GAMES_TRACKER.get(key.name);
    if (value) {
      const gameInfo = JSON.parse(value) as { lastAccessed: number; gameState: GameState };
      activeGames.push({ id: key.name, ...gameInfo });
    }
  }
  
  // Sort by last accessed (most recent first)
  activeGames.sort((a, b) => b.lastAccessed - a.lastAccessed);
  
  return activeGames;
}

// List page HTML
function serveListPage(): Response {
  return new Response(LIST_HTML, {headers: {"Content-Type": "text/html;charset=UTF-8"}});
}

// Error handling utility
async function handleErrors(request: Request, func: () => Promise<Response>): Promise<Response> {
  try {
    return await func();
  } catch (err) {
      if (request.headers.get("Upgrade") == "websocket") {
        let pair = new WebSocketPair();
        pair[1].accept();
        pair[1].send(JSON.stringify({error: (err as Error).stack}));
        pair[1].close(1011, "Uncaught exception during session setup");
        return new Response(null, { status: 101, webSocket: pair[0] } as any);
      } else {
        return new Response((err as Error).stack, {status: 500});
      }
  }
}

// Main Worker handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await handleErrors(request, async () => {
      let url = new URL(request.url);
      let path = url.pathname.slice(1).split('/');

      if (!path[0]) {
        // Redirect to a new game with a unique ID embedded in the URL for sharing/reconnection
        const uuid = crypto.randomUUID().replace(/-/g, "");
        return Response.redirect(`${url.origin}/game/${uuid}`, 302);
      }

      switch (path[0]) {
        case "game": {
          // Serve the chess HTML for any game URL (the client reads the ID from the path)
          if (!path[1]) {
            return new Response("Not found", {status: 404});
          }
          return new Response(HTML, {headers: {"Content-Type": "text/html;charset=UTF-8"}});
        }
        case "list": {
          // Serve the list HTML page
          return serveListPage();
        }
        case "api":
          return handleApiRequest(path.slice(1), request, env);
        default:
          return new Response("Not found", {status: 404});
      }
    });
  }
}

async function handleApiRequest(path: string[], request: Request, env: Env): Promise<Response> {
  switch (path[0]) {
    case "room": {
      if (!path[1]) {
        if (request.method == "POST") {
          // Create a new chess game room
          let id = env.games.newUniqueId();
          
          // Register the game with the tracker
          try {
            await registerGame(env, id.toString(), 'ongoing');
          } catch (e) {
            console.log('Failed to register new game with tracker:', e);
          }
          
          return new Response(id.toString(), {headers: {"Access-Control-Allow-Origin": "*"}});
        } else {
          return new Response("Method not allowed", {status: 405});
        }
      }

      // Route to specific game room
      let roomName = path[1];
      let id: DurableObjectId;
      
      if (roomName.match(/^[0-9a-f]{64}$/)) {
        id = env.games.idFromString(roomName);
      } else if (roomName.length <= 32) {
        id = env.games.idFromName(roomName);
      } else {
        return new Response("Room name too long", {status: 404});
      }

      let gameObject = env.games.get(id);
      let newUrl = new URL(request.url);
      newUrl.pathname = "/" + path.slice(2).join("/");
      
      return gameObject.fetch(newUrl.toString(), request);
    }

    case "games": {
      if (request.method === "GET") {
        // Fetch list of active games from KV
        const games = await listGames(env);
        return new Response(JSON.stringify(games), {
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      return new Response("Method not allowed", {status: 405});
    }

    default:
      return new Response("Not found", {status: 404});
  }
}

// Chess Game Durable Object
export class ChessGame {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<WebSocket, Session>;
  private quantumBoard: QuantumChessboard;
  private gameState: GameState = 'ongoing';
  private currentTurn: Turn = 'blue';
  private lastAccessed: number = Date.now();
  private lastMove: MoveInfo | null = null;
  
  // Time To Live (TTL) in milliseconds - 48 hours
  private readonly timeToLiveMs = 48 * 60 * 60 * 1000;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Track WebSocket sessions
    this.sessions = new Map();
    this.state.getWebSockets().forEach((webSocket) => {
      let attachment = webSocket.deserializeAttachment?.();
      if (attachment) {
        this.sessions.set(webSocket, { ...attachment });
      } else {
        this.sessions.set(webSocket, { id: '', name: null });
      }
    });

    // Optionally set an auto-response that does not wake hibernated WebSockets.
    if (this.state.setWebSocketAutoResponse) {
      this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }

    // Initialize quantum board from durable storage; ensure ready before handling events
    this.quantumBoard = QuantumChessboard.startingQuantumChessboard();
    this.state.blockConcurrencyWhile(async () => {
      try {
        // Load last accessed time
        const savedLastAccessed = await this.state.storage.get('lastAccessed') as number;
        if (savedLastAccessed) {
          this.lastAccessed = savedLastAccessed;
        }
        
        const savedState = await this.state.storage.get('quantumBoard') as QuantumBoardState;
        if (savedState && savedState.harmonics) {
          // Load quantum board directly
          this.currentTurn = savedState.currentTurn || 'blue';
          this.gameState = savedState.gameState || 'ongoing';
          const harmonics = savedState.harmonics.map(h => new QuantumHarmonic(h.board, h.degeneracy));
          this.quantumBoard = new QuantumChessboard(harmonics, this.gameState);
        } else {
          // Fallback: try to load old format for migration
          const savedBoard = await this.state.storage.get('board') as ChessBoard;
          const initialBoard = (savedBoard && Array.isArray(savedBoard) && savedBoard.length === 8) 
            ? savedBoard 
            : this.getInitialBoard();
          
          // Load current turn from storage
          const savedTurn = await this.state.storage.get('currentTurn') as Turn;
          if (savedTurn === 'blue' || savedTurn === 'red') {
            this.currentTurn = savedTurn;
          } else {
            this.currentTurn = 'blue';
          }
          
          // Load game state from storage
          const savedGameState = await this.state.storage.get('gameState') as GameState;
          if (savedGameState === 'ongoing' || savedGameState === 'blue_victory' || savedGameState === 'red_victory' || savedGameState === 'tie') {
            this.gameState = savedGameState;
          } else {
            this.gameState = 'ongoing';
          }
          
          // Initialize quantum board
          this.quantumBoard = new QuantumChessboard([new QuantumHarmonic(initialBoard, 1)], this.gameState);
          
          // Save in new format
          await this.saveQuantumBoard();
        }
      } catch (e) {
        // Fallback to initial board on any storage error
        this.currentTurn = 'blue';
        this.gameState = 'ongoing';
        this.quantumBoard = QuantumChessboard.startingQuantumChessboard();
      }
      
      // Register with tracker
      this.registerWithTracker();
    });
  }

  private getInitialBoard(): ChessBoard {
    return [
      ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
      ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
      ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    ];
  }

  private getBoardState(): NewBoardState {
    return quantumHarmonicsToBoardState(this.quantumBoard.harmonics, this.currentTurn, this.gameState);
  }

  private async saveQuantumBoard(): Promise<void> {
    const state: QuantumBoardState = {
      harmonics: this.quantumBoard.harmonics.map(h => ({ board: h.board, degeneracy: h.degeneracy })),
      gameState: this.gameState,
      currentTurn: this.currentTurn
    };
    await this.state.storage.put('quantumBoard', state);
  }

  private async registerWithTracker(): Promise<void> {
    try {
      await registerGame(this.env, this.state.id.toString(), this.gameState);
    } catch (e) {
      console.log('Failed to register with tracker:', e);
    }
  }

  private async updateTracker(): Promise<void> {
    try {
      await updateGame(this.env, this.state.id.toString(), this.gameState);
    } catch (e) {
      console.log('Failed to update tracker:', e);
    }
  }

  async fetch(request: Request): Promise<Response> {
    return await handleErrors(request, async () => {
      // Extend the TTL alarm on every fetch request
      await this.state.storage.setAlarm(Date.now() + this.timeToLiveMs);
      
      // Update last accessed time
      this.lastAccessed = Date.now();
      await this.state.storage.put('lastAccessed', this.lastAccessed);
      
      // Update tracker with latest info
      await this.updateTracker();
      
      let url = new URL(request.url);

      switch (url.pathname) {
        case "/websocket": {
          if (request.headers.get("Upgrade") != "websocket") {
            return new Response("expected websocket", {status: 400});
          }
          if (request.method !== "GET") {
            return new Response("expected GET", {status: 400});
          }

          let pair = new WebSocketPair();
          await this.handleSession(pair[1]);
          return new Response(null, { status: 101, webSocket: pair[0] } as any);
        }

        case "/info": {
          // Return game info for listing
          const info = {
            id: this.state.id.toString(),
            gameState: this.gameState,
            currentTurn: this.currentTurn,
            lastAccessed: this.lastAccessed,
            activeConnections: this.sessions.size
          };
          return new Response(JSON.stringify(info), {
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }

        default:
          return new Response("Not found", {status: 404});
      }
    });
  }

  private async handleSession(webSocket: WebSocket): Promise<void> {
    this.state.acceptWebSocket(webSocket);

    // Attach a session id so this connection can be restored if the DO hibernates
    const id = crypto.randomUUID();
    if (webSocket.serializeAttachment) {
      webSocket.serializeAttachment({ id });
    }

    let session: Session = {
      id,
      name: null
    };

    this.sessions.set(webSocket, session);

    // Send initial board state to new player (loaded from storage during startup)
    this.sendToSession(webSocket, {
      type: 'board',
      boardState: this.getBoardState()
    });
  }

  async webSocketMessage(webSocket: WebSocket, message: string): Promise<void> {
    try {
      let session = this.sessions.get(webSocket);
      if (!session) return;

      let data = JSON.parse(message) as ClientMessage;
      console.log('Received message:', data);

      console.log('Processing message from session:', session);
      console.log('Message type:', data.type);
      console.log('Full message data:', JSON.stringify(data, null, 2));

      if (data.type === 'reset') {
        console.log('RESET REQUEST: Resetting game to initial state');
        
        // Reset game state
        this.currentTurn = 'blue';
        this.gameState = 'ongoing';
        this.quantumBoard = QuantumChessboard.startingQuantumChessboard();
        this.lastMove = null; // Clear last move on reset
        
        // Persist reset state
        try {
          await this.saveQuantumBoard();
        } catch (e) {
          console.log('Failed to persist reset state:', e && (e as Error).message ? (e as Error).message : e);
        }
        
        // Broadcast reset board to all players
        this.broadcast({
          type: 'board',
          boardState: this.getBoardState()
        });
        
        console.log('Game reset completed and broadcasted to all players');
        return;
      }

      if (data.type === 'move') {
        const { from, to, isDoubleMove = false } = data;
        console.log('Move request details:');
        console.log('  From square:', from);
        console.log('  To square:', to);
        console.log('  Is double move:', isDoubleMove);

        // Validate coordinates
        const fileToCol = (file: string): number => file.charCodeAt(0) - 'a'.charCodeAt(0);
        const rankToRow = (rank: string): number => 8 - parseInt(rank, 10);

        console.log('Validating square notation...');
        if (!/^([a-h][1-8])$/.test(from) || !/^([a-h][1-8])$/.test(to)) {
          console.log("VALIDATION FAILED: Invalid square notation");
          console.log('  From square format valid:', /^([a-h][1-8])$/.test(from));
          console.log('  To square format valid:', /^([a-h][1-8])$/.test(to));
          this.sendToSession(webSocket, {
            type: 'error',
            message: 'Invalid square notation'
          });
          return;
        }
        console.log('Square notation validation passed');

        const fromCol = fileToCol(from[0]!);
        const fromRow = rankToRow(from[1]!);
        const toCol = fileToCol(to[0]!);
        const toRow = rankToRow(to[1]!);

        console.log('Coordinate conversion:');
        console.log('  From square', from, '-> row:', fromRow, 'col:', fromCol);
        console.log('  To square', to, '-> row:', toRow, 'col:', toCol);

        console.log('Current board state (from quantum board):');
        const currentBoard = this.quantumBoard.harmonics[0]?.board || [];
        currentBoard.forEach((row, rowIndex) => {
          console.log(`  Row ${8 - rowIndex}:`, row.map(piece => piece || '.').join(' '));
        });

        // Check for piece existence using quantum board
        const quantumPiece = this.quantumBoard.getQuantumPiece([fromRow, fromCol]);
        const piece: ChessPiece = quantumPiece.piece || null;
        console.log('Quantum piece at from-square:', quantumPiece);
        
        if (!piece) {
          console.log("MOVE REJECTED: No piece on the from-square");
          console.log('  Board position [' + fromRow + '][' + fromCol + '] is empty');
          this.sendToSession(webSocket, {
            type: 'error',
            message: 'No piece on the from-square'
          });
          return;
        }

        // Check if game is still ongoing
        if (this.gameState !== 'ongoing') {
          console.log("MOVE REJECTED: Game has ended");
          console.log(`  Game state: ${this.gameState}`);
          this.sendToSession(webSocket, {
            type: 'error',
            message: 'Game has ended - no moves allowed'
          });
          return;
        }

        console.log('Getting possible moves for piece:', piece);
        console.log('  Piece position: row', fromRow, 'col', fromCol);
        console.log('  Double move flag:', isDoubleMove);
        
        console.log('Type of getPossibleMoves:', typeof getPossibleMoves);
        console.log("Possible moves:", getPossibleMoves);

        // Use quantum board for move validation
        const boardForValidation = this.quantumBoard.harmonics[0]?.board || [];
        
        const possibleMoves = getPossibleMoves(boardForValidation, piece, fromRow, fromCol, isDoubleMove);
        console.log('Possible moves calculated:', possibleMoves.length, 'moves');
        possibleMoves.forEach((move, index) => {
          console.log(`  Move ${index + 1}: [${move[0]}, ${move[1]}]`);
        });

        const isLegal = possibleMoves.some(([r, c]) => r === toRow && c === toCol);
        console.log('Move legality check:');
        console.log('  Target position: [' + toRow + ', ' + toCol + ']');
        console.log('  Is move legal:', isLegal);

        if (!isLegal) {
          console.log("MOVE REJECTED: Illegal move");
          console.log(`  Attempted move: ${piece} from ${from} (${fromRow},${fromCol}) to ${to} (${toRow},${toCol})`);
          console.log('  This move is not in the list of possible moves');
          this.sendToSession(webSocket, {
            type: 'error',
            message: 'Illegal move'
          });
          console.log(`Illegal move attempted: ${from} -> ${to}`);
          return;
        }

        // Check if it's the correct turn for this piece (after move validation)
        const isWhitePiece = piece === piece.toUpperCase();
        const expectedTurn = isWhitePiece ? 'blue' : 'red';
        
        if (this.currentTurn !== expectedTurn) {
          console.log("MOVE REJECTED: Wrong turn");
          console.log(`  Piece is ${isWhitePiece ? 'blue' : 'red'}, but it's ${this.currentTurn}'s turn`);
          this.sendToSession(webSocket, {
            type: 'error',
            message: `It's ${this.currentTurn}'s turn, not ${expectedTurn}'s`
          });
          return;
        }

        console.log('MOVE ACCEPTED: Applying move to quantum board');
        const boardBefore = this.quantumBoard.harmonics[0]?.board || [];
        console.log('  Before move:');
        console.log('    From square [' + fromRow + '][' + fromCol + ']:', boardBefore[fromRow]?.[fromCol]);
        console.log('    To square [' + toRow + '][' + toCol + ']:', boardBefore[toRow]?.[toCol]);

        // Apply the move using dedicated function
        await this.applyMove(fromRow, fromCol, toRow, toCol, piece, isDoubleMove);

        const boardAfter = this.quantumBoard.harmonics[0]?.board || [];
        console.log('  After move:');
        console.log('    From square [' + fromRow + '][' + fromCol + ']:', boardAfter[fromRow]?.[fromCol]);
        console.log('    To square [' + toRow + '][' + toCol + ']:', boardAfter[toRow]?.[toCol]);

        // Log move
        console.log(`Move applied successfully: ${piece} ${from} -> ${to}`);

        console.log('Updated board state:');
        boardAfter.forEach((row, rowIndex) => {
          console.log(`  Row ${8 - rowIndex}:`, row.map(piece => piece || '.').join(' '));
        });

        // Broadcast updated board to all players
        console.log('Broadcasting updated board to all players...');
        this.broadcast({
          type: 'board',
          boardState: this.getBoardState()
        });
        console.log('Board broadcast completed');
        return;
      }

      console.log('Message type not recognized or not handled:', (data as any).type);

    } catch (err) {
      console.log('ERROR in webSocketMessage:');
      console.log('  Error message:', (err as Error).message);
      console.log('  Error stack:', (err as Error).stack);
      console.log('  Original message:', message);
      this.sendToSession(webSocket, {
        type: 'error',
        message: (err as Error).message
      });
    }
  }

  private async applyMove(fromRow: number, fromCol: number, toRow: number, toCol: number, piece: ChessPiece, isDoubleMove: boolean = false): Promise<void> {
    // Convert coordinates to square notation
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    const fromSquare = `${files[fromCol]}${ranks[fromRow]}`;
    const toSquare = `${files[toCol]}${ranks[toRow]}`;
    
    // Check for captured piece before move
    const boardBefore = this.quantumBoard.harmonics[0]?.board || [];
    const capturedPiece = boardBefore[toRow]?.[toCol] || null;
    
    if (isDoubleMove) {
      // Apply quantum move for double moves
      console.log('Applying quantum move for double move');
      console.log('Is double move:', isDoubleMove);
      
      const quantumMove: QuantumMove = {
        from: [fromRow, fromCol],
        to: [toRow, toCol]
      };
      
      if (this.quantumBoard.checkQuantumMoveApplicable(quantumMove)) {
        this.quantumBoard.applyQuantumMove(quantumMove);
        console.log('Quantum move applied successfully');
        
        // Store move info
        this.lastMove = {
          from: fromSquare,
          to: toSquare,
          piece: piece,
          moveType: 'quantum',
          captured: capturedPiece !== null ? capturedPiece : undefined
        };
        
        // Switch turns after quantum move (only if game is still ongoing)
        if (this.gameState === 'ongoing') {
          this.currentTurn = this.currentTurn === 'blue' ? 'red' : 'blue';
          console.log(`Turn switched to: ${this.currentTurn}`);
        }
        
        // Check game end conditions only if game is still ongoing
        if (this.gameState === 'ongoing') {
          this.updateGameState();
        }
      } else {
        console.log('Quantum move not applicable, falling back to regular move');
        this.applyRegularMove(fromRow, fromCol, toRow, toCol, piece, fromSquare, toSquare, capturedPiece);
      }
    } else {
      // Apply regular move for non-double moves
      console.log('Applying regular move');
      this.applyRegularMove(fromRow, fromCol, toRow, toCol, piece, fromSquare, toSquare, capturedPiece);
    }

    // Persist quantum board state
    try {
      await this.saveQuantumBoard();
    } catch (e) {
      console.log('Failed to persist quantum board:', e && (e as Error).message ? (e as Error).message : e);
    }
  }

  private applyRegularMove(fromRow: number, fromCol: number, toRow: number, toCol: number, piece: ChessPiece, fromSquare: string, toSquare: string, capturedPiece: ChessPiece): void {
    // Apply the move to quantum board as an ordinary move
    const ordinaryMove: OrdinaryMove = {
      from: [fromRow, fromCol],
      to: [toRow, toCol]
    };
    
    if (this.quantumBoard.checkOrdinaryMoveApplicable(ordinaryMove)) {
      this.quantumBoard.applyOrdinaryMove(ordinaryMove);
    }

    // Handle pawn promotion
    if (piece && piece.toLowerCase() === 'p' && (toRow === 0 || toRow === 7)) {
      const promotedPiece = piece === piece.toUpperCase() ? 'Q' : 'q';
      // Apply promotion to quantum board
      const board = this.quantumBoard.harmonics[0]?.board;
      if (board && board[toRow]) {
        board[toRow]![toCol] = promotedPiece;
      }
      console.log(`Pawn promoted to queen: ${piece} -> ${promotedPiece}`);
    }

    // Store move info
    this.lastMove = {
      from: fromSquare,
      to: toSquare,
      piece: piece,
      moveType: 'ordinary',
      captured: capturedPiece !== null ? capturedPiece : undefined
    };

    // Switch turns (only if game is still ongoing)
    if (this.gameState === 'ongoing') {
      this.currentTurn = this.currentTurn === 'blue' ? 'red' : 'blue';
      console.log(`Turn switched to: ${this.currentTurn}`);
    }

    // Check game end conditions only if game is still ongoing
    if (this.gameState === 'ongoing') {
      this.updateGameState();
    }
  }

  private updateGameState(): void {
    let whiteKingPresent = false;
    let blackKingPresent = false;
    
    // Check quantum board for king presence
    const board = this.quantumBoard.harmonics[0]?.board || [];
    
    // Optimized: single loop through board
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const squarePiece = board[row]?.[col];
        if (squarePiece && squarePiece.toLowerCase() === 'k') {
          if (squarePiece === squarePiece.toUpperCase()) {
            whiteKingPresent = true;
          } else {
            blackKingPresent = true;
          }
          // Early exit if both kings found
          if (whiteKingPresent && blackKingPresent) {
            return;
          }
        }
      }
    }

    // Update game state based on king presence
    const oldGameState = this.gameState;
    if (!whiteKingPresent && !blackKingPresent) {
      this.gameState = 'tie';
      console.log('Game ended in tie - both kings captured');
    } else if (!whiteKingPresent) {
      this.gameState = 'red_victory';
      console.log('Game ended - Red victory (blue king captured)');
    } else if (!blackKingPresent) {
      this.gameState = 'blue_victory';
      console.log('Game ended - Blue victory (red king captured)');
    }
    
    // Sync quantum board's game state
    (this.quantumBoard as any).gameState_ = this.gameState;
    
    // Update tracker if game state changed
    if (oldGameState !== this.gameState) {
      this.updateTracker();
    }
  }

  private broadcast(message: GameMessage): void {
    console.log('Broadcasting message to all sessions:');
    console.log('  Message type:', message.type);
    console.log('  Total sessions:', this.sessions.size);
    
    // Add last move info to board messages
    if (message.type === 'board' && 'boardState' in message) {
      const boardMessage = message as NewBoardMessage;
      if (this.lastMove !== null) {
        boardMessage.lastMove = this.lastMove;
        boardMessage.boardState.lastMove = this.lastMove;
        console.log('Sending move info to clients:', this.lastMove);
      }
    }
    
    let successCount = 0;
    let failureCount = 0;
    
    this.sessions.forEach((session, webSocket) => {
      try {
        webSocket.send(JSON.stringify(message));
        successCount++;
        console.log('  ✓ Message sent to session successfully');
      } catch (err) {
        failureCount++;
        console.log('  ✗ Failed to send message to session:');
        console.log('    Error:', (err as Error).message);
        // Remove failed sessions
        this.sessions.delete(webSocket);
      }
    });
    
    console.log(`Broadcast completed: ${successCount} successful, ${failureCount} failed`);
    if (failureCount > 0) {
      console.log(`Cleaned up ${failureCount} dead sessions, remaining: ${this.sessions.size}`);
    }
  }

  async webSocketClose(webSocket: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    console.log('WebSocket closing:');
    console.log('  Code:', code);
    console.log('  Reason:', reason);
    console.log('  Was clean:', wasClean);
    console.log('  Session existed:', this.sessions.has(webSocket));
    this.sessions.delete(webSocket);
    console.log('  Session deleted, remaining sessions:', this.sessions.size);
  }

  async webSocketError(webSocket: WebSocket, error: Error): Promise<void> {
    console.log('WebSocket error occurred:');
    console.log('  Error:', error);
    console.log('  Session existed:', this.sessions.has(webSocket));
    this.sessions.delete(webSocket);
    console.log('  Session deleted due to error, remaining sessions:', this.sessions.size);
  }

  async alarm(): Promise<void> {
    // TTL expired - delete all game data
    console.log('Game TTL expired, deleting all data');
    
    // Unregister from tracker
    try {
      await unregisterGame(this.env, this.state.id.toString());
    } catch (e) {
      console.log('Failed to unregister from tracker:', e);
    }
    
    // Delete all storage
    await this.state.storage.deleteAll();
    
    console.log('Game data deleted successfully');
  }

  private sendToSession(webSocket: WebSocket, message: GameMessage): void {
    console.log('Sending message to session:');
    console.log('  Message type:', message.type);
    console.log('  Full message:', JSON.stringify(message, null, 2));
    try {
      webSocket.send(JSON.stringify(message));
      console.log('  Message sent successfully');
    } catch (err) {
      console.log('  FAILED to send message to session:');
      console.log('    Error:', (err as Error).message);
      console.log('    Error stack:', (err as Error).stack);
    }
  }
}

// Quantum Chess Implementation
export class MeasurementUtils {
  private static readonly random_ = Math.random;

  public static probability(degeneracy: number, total: number): number {
    return degeneracy / total;
  }

  public static decide(probability: number): boolean {
    const rand = Math.random();
    const res = rand < probability;
    // console.log(`Measurement with probability ${probability} rendered ${res}`);
    return res;
  }

  public static decideWithDegeneracy(degeneracy: number, total: number): boolean {
    return this.decide(this.probability(degeneracy, total));
  }
}

export class QuantumChessboard {
  private harmonics_: QuantumHarmonic[] = [];
  private gameState_: GameState = 'tie';

  constructor(harmonics?: QuantumHarmonic[], gameState?: GameState) {
    if (harmonics) {
      this.harmonics_ = harmonics;
    }
    if (gameState) {
      this.gameState_ = gameState;
    }
  }

  public static startingQuantumChessboard(): QuantumChessboard {
    const res = new QuantumChessboard();
    res.gameState_ = 'ongoing';
    res.harmonics_.push(new QuantumHarmonic(this.getInitialBoard(), 1));
    return res;
  }

  private static getInitialBoard(): ChessBoard {
    return [
      ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
      ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
      ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    ];
  }

  private degeneracyNormalization(): number {
    let res = 0;
    for (const harmonic of this.harmonics_) {
      res += harmonic.degeneracy;
    }
    return res;
  }

  private static gcd(a: number, b: number): number {
    while (a !== 0 && b !== 0) {
      if (a > b) {
        a %= b;
      } else if (b > a) {
        b %= a;
      } else {
        return a;
      }
    }
    return a + b;
  }

  private renormalizeDegeneracies(): void {
    let gcd = 0;
    for (const harmonic of this.harmonics_) {
      gcd = QuantumChessboard.gcd(gcd, harmonic.degeneracy);
    }
    for (const harmonic of this.harmonics_) {
      harmonic.degeneracy /= gcd;
    }
  }

  private regroupHarmonics(): void {
    this.removeVanishing();
    AssertionException.assert(this.harmonics_.length > 0, "Empty quantum superposition found");

    this.harmonics_.sort((a, b) => this.getBoardHashCode(a.board) - this.getBoardHashCode(b.board));
    const newHarmonics: QuantumHarmonic[] = [];

    let prevHarmonic = this.harmonics_[0]!;
    for (let i = 1; i < this.harmonics_.length; i++) {
      const currentHarmonic = this.harmonics_[i]!;
      if (this.boardsEqual(currentHarmonic.board, prevHarmonic.board)) {
        prevHarmonic.degeneracy += currentHarmonic.degeneracy;
      } else {
        newHarmonics.push(prevHarmonic);
        prevHarmonic = currentHarmonic;
      }
    }
    newHarmonics.push(prevHarmonic);

    this.harmonics_ = newHarmonics;
    this.harmonics_.sort((a, b) => b.degeneracy - a.degeneracy);
  }

  private boardsEqual(board1: ChessBoard, board2: ChessBoard): boolean {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (board1[row]?.[col] !== board2[row]?.[col]) {
          return false;
        }
      }
    }
    return true;
  }

  private getBoardHashCode(board: ChessBoard): number {
    let hash = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row]?.[col];
        hash = ((hash << 5) - hash + (piece?.charCodeAt(0) || 0)) & 0xffffffff;
      }
    }
    return hash;
  }

  private removeVanishing(): void {
    this.filterBy((h) => h.degeneracy > 0);
  }

  private filterBy(pred: (h: QuantumHarmonic) => boolean): void {
    const newHarmonics: QuantumHarmonic[] = [];
    for (const harmonic of this.harmonics_) {
      if (pred(harmonic)) {
        newHarmonics.push(harmonic);
      }
    }
    AssertionException.assert(newHarmonics.length > 0, "Filtered into empty quantum superposition");
    this.harmonics_ = newHarmonics;
    this.renormalizeDegeneracies();
  }

  private performMeasurement(pos: Position): void {
    const pieceDegeneracies = new Map<ChessPiece, number>();
    let overallDegeneracy = 0;

    for (const harmonic of this.harmonics_) {
      const square = harmonic.board[pos[0]]?.[pos[1]];
      if (square) {
        const current = pieceDegeneracies.get(square) || 0;
        pieceDegeneracies.set(square, current + harmonic.degeneracy);
        overallDegeneracy += harmonic.degeneracy;
      }
    }

    if (pieceDegeneracies.size <= 1) {
      // No measurement is needed
      return;
    }

    for (const [piece, degeneracy] of pieceDegeneracies) {
      if (MeasurementUtils.decideWithDegeneracy(degeneracy, overallDegeneracy)) {
        // Removing all the harmonics with another piece
        this.filterBy((h) => h.board[pos[0]]?.[pos[1]] === null || h.board[pos[0]]?.[pos[1]] === piece);
        return;
      } else {
        overallDegeneracy -= degeneracy;
      }
    }
    AssertionException.assert(false, "One of the pieces has to be chosen");
  }

  private performMeasurements(): void {
    this.removeVanishing();
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      const col = i % 8;
      this.performMeasurement([row, col]);
    }
  }

  public performSpontaneousMeasurement(): void {
    let totalDegeneracy = 0;
    for (const harmonic of this.harmonics_) {
      totalDegeneracy += harmonic.degeneracy;
    }

    for (const harmonic of this.harmonics_) {
      if (MeasurementUtils.decideWithDegeneracy(harmonic.degeneracy, totalDegeneracy)) {
        const newHarmonics: QuantumHarmonic[] = [];
        newHarmonics.push(harmonic);
        this.harmonics_ = newHarmonics;
        return;
      }
      totalDegeneracy -= harmonic.degeneracy;
    }
  }

  private updateGameState(): void {
    if (this.gameState_ !== 'ongoing') {
      return;
    }

    if (this.harmonics_.every((h) => this.getBoardGameState(h.board) !== 'ongoing')) {
      let whiteVictoryDegeneracy = 0;
      let blackVictoryDegeneracy = 0;
      let tieDegeneracy = 0;

      for (const harmonic of this.harmonics_) {
        const boardState = this.getBoardGameState(harmonic.board);
        if (boardState === 'blue_victory') {
          whiteVictoryDegeneracy += harmonic.degeneracy;
        } else if (boardState === 'red_victory') {
          blackVictoryDegeneracy += harmonic.degeneracy;
        } else if (boardState === 'tie') {
          tieDegeneracy += harmonic.degeneracy;
        }
      }

      const totalDegeneracy = whiteVictoryDegeneracy + blackVictoryDegeneracy + tieDegeneracy;
      if (!MeasurementUtils.decideWithDegeneracy(tieDegeneracy, totalDegeneracy)) {
        const remainingDegeneracy = totalDegeneracy - tieDegeneracy;
        if (MeasurementUtils.decideWithDegeneracy(whiteVictoryDegeneracy, remainingDegeneracy)) {
          this.gameState_ = 'blue_victory';
        } else {
          this.gameState_ = 'red_victory';
        }
      } else {
        this.gameState_ = 'tie';
      }
    }
  }

  private getBoardGameState(board: ChessBoard): GameState {
    let whiteKingPresent = false;
    let blackKingPresent = false;
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const squarePiece = board[row]?.[col];
        if (squarePiece && squarePiece.toLowerCase() === 'k') {
          if (squarePiece === squarePiece.toUpperCase()) {
            whiteKingPresent = true;
          } else {
            blackKingPresent = true;
          }
          if (whiteKingPresent && blackKingPresent) {
            return 'ongoing';
          }
        }
      }
    }

    if (!whiteKingPresent && !blackKingPresent) {
      return 'tie';
    } else if (!whiteKingPresent) {
      return 'red_victory';
    } else if (!blackKingPresent) {
      return 'blue_victory';
    }
    
    return 'ongoing';
  }

  private updateQuantumCheckboard(): void {
    this.performMeasurements();
    if (this.harmonics_.length >= 1024) {
      this.performSpontaneousMeasurement();
    }
    this.regroupHarmonics();
    this.renormalizeDegeneracies();
    this.updateGameState();
  }

  public get harmonics(): QuantumHarmonic[] {
    return this.harmonics_;
  }

  public get gameState(): GameState {
    return this.gameState_;
  }

  public checkOrdinaryMoveApplicable(move: OrdinaryMove): boolean {
    return this.harmonics_.some((h) => this.getBoardGameState(h.board) === 'ongoing' &&
      this.checkOrdinaryMoveApplicableOnBoard(h.board, move));
  }

  private checkOrdinaryMoveApplicableOnBoard(board: ChessBoard, move: OrdinaryMove): boolean {
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;
    
    const piece = board[fromRow]?.[fromCol];
    if (!piece) return false;
    
    // Basic validation - check if destination is different and piece exists
    if (fromRow === toRow && fromCol === toCol) return false;
    
    // More complex validation would go here (checking piece movement rules, etc.)
    return true;
  }

  public applyOrdinaryMove(move: OrdinaryMove): void {
    let applied = false;
    for (const harmonic of this.harmonics_) {
      if (this.checkOrdinaryMoveApplicableOnBoard(harmonic.board, move)) {
        this.applyOrdinaryMoveOnBoard(harmonic.board, move);
        applied = true;
      }
    }
    this.updateQuantumCheckboard();
    AssertionException.assert(applied, "Ordinary move couldn't be applied on any harmonic");
  }

  private applyOrdinaryMoveOnBoard(board: ChessBoard, move: OrdinaryMove): void {
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;
    
    const piece = board[fromRow]?.[fromCol];
    if (piece && board[toRow]) {
      board[toRow]![toCol] = piece;
      board[fromRow]![fromCol] = null;
    }
  }

  public checkQuantumMoveApplicable(move: QuantumMove): boolean {
    return this.harmonics_.some((h) => this.getBoardGameState(h.board) === 'ongoing' &&
      this.checkQuantumMoveApplicableOnBoard(h.board, move));
  }

  private checkQuantumMoveApplicableOnBoard(board: ChessBoard, move: QuantumMove): boolean {
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;
    
    const piece = board[fromRow]?.[fromCol];
    if (!piece) return false;
    
    // Basic validation for quantum moves
    if (fromRow === toRow && fromCol === toCol) return false;
    
    return true;
  }

  public applyQuantumMove(move: QuantumMove): void {
    let applied = false;
    const newHarmonics: QuantumHarmonic[] = [];
    for (const harmonic of this.harmonics_) {
      if (this.checkQuantumMoveApplicableOnBoard(harmonic.board, move)) {
        // Passing to the superposition of the original and new harmonics
        const newHarmonic = harmonic.clone();
        this.applyQuantumMoveOnBoard(newHarmonic.board, move);
        newHarmonics.push(harmonic);
        newHarmonics.push(newHarmonic);
        applied = true;
      } else {
        // Keeping the original harmonic with degeneracy doubled
        harmonic.degeneracy *= 2;
        newHarmonics.push(harmonic);
      }
    }
    this.harmonics_ = newHarmonics;
    this.updateQuantumCheckboard();
    AssertionException.assert(applied, "Quantum move couldn't be applied on any harmonic");
  }

  private applyQuantumMoveOnBoard(board: ChessBoard, move: QuantumMove): void {
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;
    
    const piece = board[fromRow]?.[fromCol];
    if (piece && board[toRow]) {
      board[toRow]![toCol] = piece;
      board[fromRow]![fromCol] = null;
    }
  }

  public checkCastleMoveApplicable(move: CastleMove): boolean {
    return this.harmonics_.some((h) => this.getBoardGameState(h.board) === 'ongoing' &&
      this.checkCastleMoveApplicableOnBoard(h.board, move));
  }

  private checkCastleMoveApplicableOnBoard(board: ChessBoard, move: CastleMove): boolean {
    // Basic castle validation - would need more complex logic
    const row = move.player === 'blue' ? 7 : 0;
    const kingCol = 4;
    
    const king = board[row]?.[kingCol];
    if (!king || king.toLowerCase() !== 'k') return false;
    
    return true;
  }

  public applyCastleMove(move: CastleMove): void {
    let applied = false;
    for (const harmonic of this.harmonics_) {
      if (this.checkCastleMoveApplicableOnBoard(harmonic.board, move)) {
        this.applyCastleMoveOnBoard(harmonic.board, move);
        applied = true;
      }
    }
    this.updateQuantumCheckboard();
    AssertionException.assert(applied, "Castle move couldn't be applied on any harmonic");
  }

  private applyCastleMoveOnBoard(board: ChessBoard, move: CastleMove): void {
    const row = move.player === 'blue' ? 7 : 0;
    const kingCol = 4;
    const rookCol = move.type === 'kingside' ? 7 : 0;
    const newKingCol = move.type === 'kingside' ? 6 : 2;
    const newRookCol = move.type === 'kingside' ? 5 : 3;
    
    const king = board[row]?.[kingCol];
    const rook = board[row]?.[rookCol];
    
    if (king && rook && board[row]) {
      board[row][newKingCol] = king;
      board[row][newRookCol] = rook;
      board[row][kingCol] = null;
      board[row][rookCol] = null;
    }
  }

  public registerVictory(player: 'blue' | 'red'): void {
    for (const harmonic of this.harmonics_) {
      if (this.getBoardGameState(harmonic.board) === 'ongoing') {
        // Set the board state to victory - simplified implementation
        // In a real implementation, this would update the board state properly
      }
    }
    this.updateGameState();
  }

  public registerTie(): void {
    for (const harmonic of this.harmonics_) {
      if (this.getBoardGameState(harmonic.board) === 'ongoing') {
        // Set the board state to tie - simplified implementation
      }
    }
    this.updateGameState();
  }

  public getQuantumPiece(pos: Position): QuantumPiece {
    let piece: ChessPiece = null;
    let filled = 0;
    let empty = 0;
    
    for (const harmonic of this.harmonics_) {
      const classical = harmonic.board[pos[0]]?.[pos[1]];
      if (classical) {
        AssertionException.assert(piece === null || piece === classical,
          `The square ${pos} appears in a superposition of two pieces`);
        piece = classical;
        filled += harmonic.degeneracy;
      } else {
        empty += harmonic.degeneracy;
      }
    }
    
    if (piece) {
      return { piece, probability: MeasurementUtils.probability(filled, filled + empty) };
    } else {
      return { piece: null, probability: 1.0 };
    }
  }
}
