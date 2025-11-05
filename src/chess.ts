// Collaborative Chess Worker - Built using Durable Objects!

// @ts-ignore
import HTML from "./chess.html";
// @ts-ignore
import LIST_HTML from "./list.html";
// @ts-ignore
import INDEX_HTML from "./index.html";
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
  LineageStep,
  LineageEdge,
  LineageNode,
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

// Settings
const GAME_TTL_SECONDS = 48 * 60 * 60; // 48 hours

// Helper functions for tracking games in KV
async function registerGame(env: Env, gameId: string, gameState: GameState): Promise<void> {
  const gameInfo = {
    lastAccessed: Date.now(),
    gameState: gameState
  };
  await env.GAMES_TRACKER.put(gameId, JSON.stringify(gameInfo), { expirationTtl: GAME_TTL_SECONDS });
}

async function updateGame(env: Env, gameId: string, gameState: GameState): Promise<void> {
  const existing = await env.GAMES_TRACKER.get(gameId);
  if (existing) {
    const gameInfo = {
      lastAccessed: Date.now(),
      gameState: gameState
    };
    await env.GAMES_TRACKER.put(gameId, JSON.stringify(gameInfo), { expirationTtl: GAME_TTL_SECONDS });
  }
}

async function unregisterGame(env: Env, gameId: string): Promise<void> {
  await env.GAMES_TRACKER.delete(gameId);
}

async function listGames(env: Env, limit: number = 50, offset: number = 0): Promise<Array<{ id: string; lastAccessed: number; gameState: GameState }>> {
  const activeGames: Array<{ id: string; lastAccessed: number; gameState: GameState }> = [];
  
  const list = await env.GAMES_TRACKER.list();
  
  // Use batch get instead of individual gets to improve performance
  if (list.keys.length > 0) {
    const keyNames = list.keys.map(key => key.name);
    const values = await env.GAMES_TRACKER.get(keyNames);
    
    for (const keyName of keyNames) {
      const value = values.get(keyName);
      if (value) {
        const gameInfo = JSON.parse(value) as { lastAccessed: number; gameState: GameState };
        activeGames.push({ id: keyName, ...gameInfo });
      }
    }
  }
  
  // Sort by last accessed (most recent first)
  activeGames.sort((a, b) => b.lastAccessed - a.lastAccessed);
  
  // Apply pagination
  return activeGames.slice(offset, offset + limit);
}

// List page HTML
function serveListPage(request: Request): Response {
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
        // Serve the home page with "New Game" button
        return new Response(INDEX_HTML, {headers: {"Content-Type": "text/html;charset=UTF-8"}});
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
          return serveListPage(request);
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
      // Forward the original room name as a query parameter so the DO can persist the friendly id
      try {
        if (roomName) {
          newUrl.searchParams.set('room', roomName);
        }
      } catch (e) {
        // noop
      }
      
      return gameObject.fetch(newUrl.toString(), request);
    }

    case "games": {
      if (request.method === "GET") {
        // Fetch list of active games from KV with pagination
        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        
        // Validate and clamp limits
        const validLimit = Math.min(Math.max(limit, 1), 100);
        const validOffset = Math.max(offset, 0);
        
        const games = await listGames(env, validLimit, validOffset);
        return new Response(JSON.stringify(games), {
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      return new Response("Method not allowed", {status: 405});
    }

    case "purge": {
      if (request.method === "DELETE") {
        // Delete all games from KV storage
        try {
          const list = await env.GAMES_TRACKER.list();
          if (list.keys.length > 0) {
            // Delete keys individually since KV delete() only accepts single keys
            for (const key of list.keys) {
              await env.GAMES_TRACKER.delete(key.name);
            }
          }
          return new Response(JSON.stringify({ deleted: list.keys.length }), {
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        } catch (error) {
          console.error('Error purging games:', error);
          return new Response(JSON.stringify({ error: 'Failed to purge games' }), {
            status: 500,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }
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
  private friendlyId: string | null = null;
  private trackerKey: string = "";
  private debugMode: boolean = false;
  private castlingRights: import("./types").CastlingRights = {
    blueKingside: true,
    blueQueenside: true,
    redKingside: true,
    redQueenside: true
  };
  
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
    this.trackerKey = this.state.id.toString();
    this.state.blockConcurrencyWhile(async () => {
      try {
        // Load last accessed time
        const savedLastAccessed = await this.state.storage.get('lastAccessed') as number;
        if (savedLastAccessed) {
          this.lastAccessed = savedLastAccessed;
        }
        // Load friendlyId and trackerKey if present
        const savedFriendlyId = await this.state.storage.get('friendlyId') as string | undefined;
        if (savedFriendlyId) {
          this.friendlyId = savedFriendlyId;
        }
        const savedTrackerKey = await this.state.storage.get('trackerKey') as string | undefined;
        if (savedTrackerKey) {
          this.trackerKey = savedTrackerKey;
        }
        
        const savedState = await this.state.storage.get('quantumBoard') as QuantumBoardState;
        if (savedState && savedState.harmonics) {
          // Load quantum board directly
          this.currentTurn = savedState.currentTurn || 'blue';
          this.gameState = savedState.gameState || 'ongoing';
          console.log(`Loading quantum board: ${savedState.harmonics.length} harmonics, degeneracies:`, 
            savedState.harmonics.map(h => h.degeneracy));
          // Deep clone boards when loading to ensure independence
          const harmonics = savedState.harmonics.map((h, idx) => {
            const clonedBoard = h.board.map(row => [...row]);
            return new QuantumHarmonic(clonedBoard, h.degeneracy, h.id || crypto.randomUUID());
          });
          this.quantumBoard = new QuantumChessboard(harmonics, this.gameState);
          console.log(`Loaded quantum board with ${harmonics.length} harmonics`);
          
          // Load castling rights if present
          if (savedState.castlingRights) {
            this.castlingRights = savedState.castlingRights;
          }
        }
      } catch (e) {
        console.log('Error loading game state:', e);
        throw e;
      }
      
      // Register with tracker
      this.registerWithTracker();
    });
  }

  private getBoardState(): NewBoardState {
    const boardState = quantumHarmonicsToBoardState(this.quantumBoard.harmonics, this.currentTurn, this.gameState);
    boardState.castlingRights = this.castlingRights;
    return boardState;
  }

  private async saveQuantumBoard(): Promise<void> {
    const state: QuantumBoardState = {
      harmonics: this.quantumBoard.harmonics.map(h => ({ 
        board: h.board.map(row => [...row]), // Deep clone the board
        degeneracy: h.degeneracy,
        id: h.id
      })),
      gameState: this.gameState,
      currentTurn: this.currentTurn,
      castlingRights: this.castlingRights
    };
    console.log(`Saving quantum board: ${state.harmonics.length} harmonics, degeneracies:`, 
      state.harmonics.map(h => h.degeneracy));
    await this.state.storage.put('quantumBoard', state);
  }

  private async registerWithTracker(): Promise<void> {
    try {
      const key = this.trackerKey || this.state.id.toString();
      await registerGame(this.env, key, this.gameState);
    } catch (e) {
      console.log('Failed to register with tracker:', e);
    }
  }

  private async updateTracker(): Promise<void> {
    try {
      const key = this.trackerKey || this.state.id.toString();
      await updateGame(this.env, key, this.gameState);
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

      // Capture friendly room id from forwarded URL or header and migrate tracker key if needed
      const incomingFriendly = url.searchParams.get('room') || request.headers.get('X-Room-Name') || null;
      if (incomingFriendly && incomingFriendly !== this.friendlyId) {
        const previousKey = this.trackerKey || this.state.id.toString();
        this.friendlyId = incomingFriendly;
        const newKey = incomingFriendly;
        if (newKey !== previousKey) {
          try {
            await unregisterGame(this.env, previousKey);
          } catch (e) {
            console.log('Failed to unregister old tracker key:', e);
          }
          try {
            await registerGame(this.env, newKey, this.gameState);
          } catch (e) {
            console.log('Failed to register new tracker key:', e);
          }
          this.trackerKey = newKey;
          try {
            await this.state.storage.put('friendlyId', this.friendlyId);
            await this.state.storage.put('trackerKey', this.trackerKey);
          } catch (e) {
            console.log('Failed to persist friendly/tracker key:', e);
          }
        }
      }

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
            id: this.friendlyId || this.state.id.toString(),
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
    // Always include harmonics for move validation, regardless of debug mode
    this.sendToSession(webSocket, {
      type: 'board',
      boardState: this.getBoardState()
    }, true);
  }

  async webSocketMessage(webSocket: WebSocket, message: string): Promise<void> {
    try {
      // Extend the TTL alarm on each WebSocket message
      await this.state.storage.setAlarm(Date.now() + this.timeToLiveMs);

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
        this.castlingRights = {
          blueKingside: true,
          blueQueenside: true,
          redKingside: true,
          redQueenside: true
        };
        
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

      if (data.type === 'debug_toggle') {
        console.log('DEBUG TOGGLE REQUEST:', data.enabled);
        // Update session debug mode
        session.debugMode = data.enabled;
        // Update global debug mode if any session has it enabled
        this.debugMode = Array.from(this.sessions.values()).some(s => s.debugMode);
        // Update quantum board debug mode
        this.quantumBoard.setDebugMode(this.debugMode);
        // Always send harmonics for move validation; client will decide whether to display them
        this.sendToSession(webSocket, {
          type: 'board',
          boardState: this.getBoardState()
        }, true);
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
        
        // Pass all harmonics for move validation
        const harmonics = this.quantumBoard.harmonics.map(h => ({
          board: h.board,
          degeneracy: h.degeneracy
        }));
        
        console.log('Server calling getPossibleMoves with:');
        console.log('  Harmonics:', harmonics.length);
        for (let i = 0; i < harmonics.length; i++) {
          console.log(`  Harmonic ${i} degeneracy:`, harmonics[i]!.degeneracy);
        }
        
        const possibleMoves = getPossibleMoves(boardForValidation, piece, fromRow, fromCol, isDoubleMove, harmonics, this.castlingRights);
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
    
    // Detect castling move (king moving 2 squares horizontally)
    const isCastlingMove = piece && piece.toLowerCase() === 'k' && Math.abs(toCol - fromCol) === 2;
    
    if (isCastlingMove) {
      console.log('Castling move detected!');
      const isKingside = toCol > fromCol;
      const castlingSide = isKingside ? 'kingside' : 'queenside';
      const player = piece === piece.toUpperCase() ? 'blue' : 'red';
      
      // Apply castling move
      this.applyCastlingMove(fromRow, fromCol, toRow, toCol, piece, isKingside);
      
      // Store move info
      this.lastMove = {
        from: fromSquare,
        to: toSquare,
        piece: piece,
        moveType: 'castle',
        castlingSide: castlingSide
      };
      
      // Update castling rights - player loses both after castling
      if (player === 'blue') {
        this.castlingRights.blueKingside = false;
        this.castlingRights.blueQueenside = false;
      } else {
        this.castlingRights.redKingside = false;
        this.castlingRights.redQueenside = false;
      }
      
      // Switch turns
      if (this.gameState === 'ongoing') {
        this.currentTurn = this.currentTurn === 'blue' ? 'red' : 'blue';
        console.log(`Turn switched to: ${this.currentTurn}`);
      }
      
      // Persist quantum board state
      try {
        await this.saveQuantumBoard();
      } catch (e) {
        console.log('Failed to persist quantum board:', e && (e as Error).message ? (e as Error).message : e);
      }
      
      return;
    }
    
    // Update castling rights if king or rook moves
    this.updateCastlingRights(piece, fromRow, fromCol);
    
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

  private applyCastlingMove(fromRow: number, fromCol: number, toRow: number, toCol: number, piece: ChessPiece, isKingside: boolean): void {
    if (!piece) return;
    
    console.log(`Applying ${isKingside ? 'kingside' : 'queenside'} castling for ${piece === piece.toUpperCase() ? 'blue' : 'red'}`);
    
    // Calculate rook positions
    const rookFromCol = isKingside ? 7 : 0;
    const rookToCol = isKingside ? 5 : 3;
    
    // Apply moves to all harmonics
    for (const harmonic of this.quantumBoard.harmonics) {
      const board = harmonic.board;
      
      // Move king
      if (board[fromRow]) {
        board[fromRow]![toCol] = piece;
        board[fromRow]![fromCol] = null;
      }
      
      // Move rook
      const rook = board[fromRow]?.[rookFromCol];
      if (rook && board[fromRow]) {
        board[fromRow]![rookToCol] = rook;
        board[fromRow]![rookFromCol] = null;
      }
    }
    
    // Update game state
    if (this.gameState === 'ongoing') {
      this.updateGameState();
    }
  }

  private updateCastlingRights(piece: ChessPiece, fromRow: number, fromCol: number): void {
    if (!piece) return;
    
    const pieceType = piece.toLowerCase();
    const isWhite = piece === piece.toUpperCase();
    
    // If king moves, lose both castling rights
    if (pieceType === 'k') {
      if (isWhite) {
        this.castlingRights.blueKingside = false;
        this.castlingRights.blueQueenside = false;
      } else {
        this.castlingRights.redKingside = false;
        this.castlingRights.redQueenside = false;
      }
      console.log(`King moved, castling rights updated for ${isWhite ? 'blue' : 'red'}`);
    }
    
    // If rook moves from starting position, lose that side's castling right
    if (pieceType === 'r') {
      if (isWhite && fromRow === 7) {
        if (fromCol === 0) {
          this.castlingRights.blueQueenside = false;
          console.log('Blue queenside rook moved, castling right lost');
        } else if (fromCol === 7) {
          this.castlingRights.blueKingside = false;
          console.log('Blue kingside rook moved, castling right lost');
        }
      } else if (!isWhite && fromRow === 0) {
        if (fromCol === 0) {
          this.castlingRights.redQueenside = false;
          console.log('Red queenside rook moved, castling right lost');
        } else if (fromCol === 7) {
          this.castlingRights.redKingside = false;
          console.log('Red kingside rook moved, castling right lost');
        }
      }
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
        // Always include harmonics for move validation, regardless of debug mode
        // The client will only display them if debug mode is enabled
        const includeHarmonics = true;
        this.sendToSession(webSocket, message, includeHarmonics);
        successCount++;
        console.log('  [SUCCESS] Message sent to session successfully');
      } catch (err) {
        failureCount++;
        console.log('  [ERROR] Failed to send message to session:');
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
    
    // Update debug mode based on remaining sessions
    this.debugMode = Array.from(this.sessions.values()).some(s => s.debugMode);
    this.quantumBoard.setDebugMode(this.debugMode);
  }

  async webSocketError(webSocket: WebSocket, error: Error): Promise<void> {
    console.log('WebSocket error occurred:');
    console.log('  Error:', error);
    console.log('  Session existed:', this.sessions.has(webSocket));
    this.sessions.delete(webSocket);
    console.log('  Session deleted due to error, remaining sessions:', this.sessions.size);
    
    // Update debug mode based on remaining sessions
    this.debugMode = Array.from(this.sessions.values()).some(s => s.debugMode);
    this.quantumBoard.setDebugMode(this.debugMode);
  }

  async alarm(): Promise<void> {
    // TTL expired - delete all game data
    console.log('Game TTL expired, deleting all data');
    
    // Unregister from tracker
    try {
      const key = this.trackerKey || this.state.id.toString();
      await unregisterGame(this.env, key);
    } catch (e) {
      console.log('Failed to unregister from tracker:', e);
    }
    
    // Delete all storage
    await this.state.storage.deleteAll();
    
    console.log('Game data deleted successfully');
  }

  private sendToSession(webSocket: WebSocket, message: GameMessage, includeHarmonics: boolean = false): void {
    console.log('Sending message to session:');
    console.log('  Message type:', message.type);
    console.log('  Full message:', JSON.stringify(message, null, 2));
    
    // Add harmonics data if requested
    if (includeHarmonics && message.type === 'board' && 'boardState' in message) {
      const boardMessage = message as NewBoardMessage;
      boardMessage.harmonics = this.quantumBoard.harmonics.map(h => ({
        board: h.board.map(row => [...row]),
        degeneracy: h.degeneracy
      }));
      // Attach lineage steps for debug visualization
      boardMessage.lineageSteps = this.quantumBoard.lineage;
    }
    
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
  private lineageSteps: LineageStep[] = [];
  private pendingEdges: LineageEdge[] = [];
  private currentStepType: 'init' | 'ordinary' | 'quantum' | 'measurement' | 'merge' = 'init';
  private currentStepMeta: any = null;
  private debugMode: boolean = false;

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
    const initId = crypto.randomUUID();
    const initHarmonic = new QuantumHarmonic(this.getInitialBoard(), 1, initId);
    res.harmonics_.push(initHarmonic);
    // Initial lineage step is skipped - will be created on first move if debug mode is enabled
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

    // Track pre-merge state
    const preMergeHarmonics = this.harmonics_.map(h => ({
      id: h.id,
      degeneracy: h.degeneracy,
      boardHash: this.getBoardHashCode(h.board)
    }));
    const preMergeTotalDegeneracy = preMergeHarmonics.reduce((sum, h) => sum + h.degeneracy, 0);

    this.harmonics_.sort((a, b) => this.getBoardHashCode(a.board) - this.getBoardHashCode(b.board));
    const newHarmonics: QuantumHarmonic[] = [];
    
    let mergeCount = 0;
    const mergeDetails: any[] = [];

    // Clone the first harmonic to avoid mutating the original
    let prevHarmonic = this.harmonics_[0]!.clone();
    for (let i = 1; i < this.harmonics_.length; i++) {
      const currentHarmonic = this.harmonics_[i]!;
      if (this.boardsEqual(currentHarmonic.board, prevHarmonic.board)) {
        // Track merge edge
        this.pendingEdges.push({
          fromId: currentHarmonic.id,
          toId: prevHarmonic.id,
          kind: 'merge'
        });
        mergeDetails.push({
          fromId: currentHarmonic.id,
          fromDegeneracy: currentHarmonic.degeneracy,
          toId: prevHarmonic.id,
          toDegeneracy: prevHarmonic.degeneracy,
          resultDegeneracy: prevHarmonic.degeneracy + currentHarmonic.degeneracy,
          explanation: `Harmonics ${currentHarmonic.id.substring(0, 8)} (deg=${currentHarmonic.degeneracy}) and ${prevHarmonic.id.substring(0, 8)} (deg=${prevHarmonic.degeneracy}) had identical boards, merged to deg=${prevHarmonic.degeneracy + currentHarmonic.degeneracy}`
        });
        // Combine degeneracies into a new harmonic
        prevHarmonic.degeneracy += currentHarmonic.degeneracy;
        mergeCount++;
      } else {
        newHarmonics.push(prevHarmonic);
        // Clone the current harmonic to avoid mutating the original
        prevHarmonic = currentHarmonic.clone();
      }
    }
    newHarmonics.push(prevHarmonic);

    this.harmonics_ = newHarmonics;
    this.harmonics_.sort((a, b) => b.degeneracy - a.degeneracy);
    
    // Track post-merge state
    const postMergeHarmonics = this.harmonics_.map(h => ({
      id: h.id,
      degeneracy: h.degeneracy
    }));
    const postMergeTotalDegeneracy = postMergeHarmonics.reduce((sum, h) => sum + h.degeneracy, 0);
    
    // Track merge metadata if merges occurred
    if (mergeCount > 0 && !this.currentStepMeta) {
      this.currentStepMeta = { 
        merges: mergeDetails,
        preMergeHarmonics,
        preMergeTotalDegeneracy,
        postMergeHarmonics,
        postMergeTotalDegeneracy
      };
    } else if (mergeCount > 0 && this.currentStepMeta) {
      this.currentStepMeta.merges = mergeDetails;
      this.currentStepMeta.preMergeHarmonics = preMergeHarmonics;
      this.currentStepMeta.preMergeTotalDegeneracy = preMergeTotalDegeneracy;
      this.currentStepMeta.postMergeHarmonics = postMergeHarmonics;
      this.currentStepMeta.postMergeTotalDegeneracy = postMergeTotalDegeneracy;
    }
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

    // Track harmonics by piece for detailed logging
    const harmonicsByPiece = new Map<ChessPiece, Array<{id: string, degeneracy: number}>>();
    
    for (const harmonic of this.harmonics_) {
      const square = harmonic.board[pos[0]]?.[pos[1]];
      if (square) {
        const current = pieceDegeneracies.get(square) || 0;
        pieceDegeneracies.set(square, current + harmonic.degeneracy);
        overallDegeneracy += harmonic.degeneracy;
        
        if (!harmonicsByPiece.has(square)) {
          harmonicsByPiece.set(square, []);
        }
        harmonicsByPiece.get(square)!.push({id: harmonic.id, degeneracy: harmonic.degeneracy});
      }
    }

    if (pieceDegeneracies.size <= 1) {
      // No measurement is needed
      return;
    }

    // Track prior harmonics for measurement edges (with full board state)
    const priorHarmonics = this.harmonics_.map(h => ({
      id: h.id,
      degeneracy: h.degeneracy,
      board: h.board.map(row => [...row]), // Deep clone the full board
      piece: (h.board[pos[0]]?.[pos[1]] || null) as ChessPiece
    }));
    const priorTotalDegeneracy = priorHarmonics.reduce((sum, h) => sum + h.degeneracy, 0);
    this.currentStepType = 'measurement';
    
    let chosenPiece: ChessPiece | null = null;
    const measurementOptions: Array<{piece: ChessPiece, degeneracy: number, probability: number}> = [];
    
    for (const [piece, degeneracy] of pieceDegeneracies) {
      const probability = degeneracy / overallDegeneracy;
      measurementOptions.push({piece, degeneracy, probability});
      
      if (MeasurementUtils.decideWithDegeneracy(degeneracy, overallDegeneracy)) {
        chosenPiece = piece;
        
        // Track which harmonics survive vs get filtered (with full board state)
        const survivingHarmonics: Array<{id: string, degeneracy: number, board: ChessBoard}> = [];
        const filteredHarmonics: Array<{id: string, degeneracy: number, piece: ChessPiece, board: ChessBoard}> = [];

        for (const h of this.harmonics_) {
          const squarePiece = h.board[pos[0]]?.[pos[1]];
          if (squarePiece === null || squarePiece === undefined || squarePiece === piece) {
            survivingHarmonics.push({
              id: h.id,
              degeneracy: h.degeneracy,
              board: h.board.map(row => [...row]) // Deep clone board
            });
          } else {
            filteredHarmonics.push({
              id: h.id,
              degeneracy: h.degeneracy,
              piece: squarePiece as ChessPiece,
              board: h.board.map(row => [...row]) // Deep clone board
            });
          }
        }
        
        // Removing all the harmonics with another piece
        this.filterBy((h) => h.board[pos[0]]?.[pos[1]] === null || h.board[pos[0]]?.[pos[1]] === piece);
        
        // Track measurement edges
        const postFilterHarmonics = this.harmonics_.map(h => h.id);
        for (const priorId of priorHarmonics.map(h => h.id)) {
          for (const survivingId of postFilterHarmonics) {
            this.pendingEdges.push({
              fromId: priorId,
              toId: survivingId,
              kind: 'measurement'
            });
          }
        }
        
        // Enhanced metadata with full measurement details
        this.currentStepMeta = { 
          square: pos, 
          chosenPiece: piece,
          priorHarmonics,
          priorTotalDegeneracy,
          measurementOptions,
          survivingHarmonics,
          filteredHarmonics,
          postFilterTotalDegeneracy: this.harmonics_.reduce((sum, h) => sum + h.degeneracy, 0)
        };
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
    
    // Commit lineage step
    this.commitLineageStep();
  }

  private commitLineageStep(): void {
    // Only track lineage if debug mode is enabled
    if (!this.debugMode) {
      // Clear pending state even if not tracking
      this.pendingEdges = [];
      this.currentStepMeta = null;
      return;
    }
    
    const nodes: LineageNode[] = this.harmonics_.map(h => ({
      id: h.id,
      degeneracy: h.degeneracy,
      board: h.board.map(row => [...row])
    }));
    
    this.lineageSteps.push({
      index: this.lineageSteps.length,
      type: this.currentStepType,
      nodes,
      edges: [...this.pendingEdges],
      meta: this.currentStepMeta
    });
    
    // Clear pending state
    this.pendingEdges = [];
    this.currentStepMeta = null;
  }
  
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  public get harmonics(): QuantumHarmonic[] {
    return this.harmonics_;
  }

  public get gameState(): GameState {
    return this.gameState_;
  }

  public get lineage(): LineageStep[] {
    return this.lineageSteps;
  }

  private generateHarmonicId(): string {
    return crypto.randomUUID();
  }

  private cloneWithNewId(harmonic: QuantumHarmonic): QuantumHarmonic {
    const clonedBoard: ChessBoard = harmonic.board.map(row => [...row]);
    return new QuantumHarmonic(clonedBoard, harmonic.degeneracy, this.generateHarmonicId());
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
    
    // Validate move using getPossibleMoves with only this single board (no harmonics)
    // This checks if the move is legal on this specific harmonic
    const possibleMoves = getPossibleMoves(board, piece, fromRow, fromCol, false, undefined);
    return possibleMoves.some(([r, c]) => r === toRow && c === toCol);
  }

  public applyOrdinaryMove(move: OrdinaryMove): void {
    console.log('applyOrdinaryMove: checking harmonics...');
    this.currentStepType = 'ordinary';
    let applied = false;
    for (let i = 0; i < this.harmonics_.length; i++) {
      const harmonic = this.harmonics_[i];
      if (!harmonic) continue;
      const isApplicable = this.checkOrdinaryMoveApplicableOnBoard(harmonic.board, move);
      console.log(`  Harmonic ${i}: applicable =`, isApplicable);
      if (isApplicable) {
        this.applyOrdinaryMoveOnBoard(harmonic.board, move);
        // Track update edge
        this.pendingEdges.push({
          fromId: harmonic.id,
          toId: harmonic.id,
          kind: 'update'
        });
        applied = true;
        console.log(`  Harmonic ${i}: move applied`);
      }
    }
    this.updateQuantumCheckboard();
    console.log('applyOrdinaryMove: applied to', applied ? 'at least one' : 'zero', 'harmonics');
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
    this.currentStepType = 'quantum';
    for (const harmonic of this.harmonics_) {
      if (this.checkQuantumMoveApplicableOnBoard(harmonic.board, move)) {
        // Passing to the superposition of the original and new harmonics
        const newHarmonic = this.cloneWithNewId(harmonic);
        this.applyQuantumMoveOnBoard(newHarmonic.board, move);
        
        // Track split edges
        this.pendingEdges.push({
          fromId: harmonic.id,
          toId: harmonic.id,
          kind: 'update'
        });
        this.pendingEdges.push({
          fromId: harmonic.id,
          toId: newHarmonic.id,
          kind: 'split'
        });
        
        newHarmonics.push(harmonic);
        newHarmonics.push(newHarmonic);
        applied = true;
      } else {
        // Create a new harmonic with doubled degeneracy instead of mutating the original
        const modifiedHarmonic = harmonic.clone();
        modifiedHarmonic.degeneracy *= 2;
        newHarmonics.push(modifiedHarmonic);
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
