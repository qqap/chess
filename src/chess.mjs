// Collaborative Chess Worker - Built using Durable Objects!

import HTML from "./chess.html";

// Error handling utility
async function handleErrors(request, func) {
  try {
    return await func();
  } catch (err) {
    if (request.headers.get("Upgrade") == "websocket") {
      let pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({error: err.stack}));
      pair[1].close(1011, "Uncaught exception during session setup");
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      return new Response(err.stack, {status: 500});
    }
  }
}

// Main Worker handler
export default {
  async fetch(request, env) {
    return await handleErrors(request, async () => {
      let url = new URL(request.url);
      let path = url.pathname.slice(1).split('/');

      if (!path[0]) {
        // Serve the chess HTML at the root path
        return new Response(HTML, {headers: {"Content-Type": "text/html;charset=UTF-8"}});
      }

      switch (path[0]) {
        case "api":
          return handleApiRequest(path.slice(1), request, env);
        default:
          return new Response("Not found", {status: 404});
      }
    });
  }
}

async function handleApiRequest(path, request, env) {
  switch (path[0]) {
    case "room": {
      if (!path[1]) {
        if (request.method == "POST") {
          // Create a new chess game room
          let id = env.games.newUniqueId();
          return new Response(id.toString(), {headers: {"Access-Control-Allow-Origin": "*"}});
        } else {
          return new Response("Method not allowed", {status: 405});
        }
      }

      // Route to specific game room
      let roomName = path[1];
      let id;
      
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
      
      return gameObject.fetch(newUrl, request);
    }

    default:
      return new Response("Not found", {status: 404});
  }
}

// Chess Game Durable Object
export class ChessGame {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.sql = state.storage.sql;
    this.env = env;

    // Track WebSocket sessions
    this.sessions = new Map();
    this.state.getWebSockets().forEach((webSocket) => {
      let meta = webSocket.deserializeAttachment();
      this.sessions.set(webSocket, meta);
    });

    // Initialize game state
    this.gameState = {
      board: this.getInitialBoard(),
      currentTurn: 'white',
      players: {}, // { playerName: { color: 'white'|'black', connected: true } }
      moves: [],
      gameStatus: 'active', // 'active', 'finished'
      winner: null,
      check: false,
      checkmate: false
    };

    this.initializeDatabase();
    this.loadGameState();
  }

  getInitialBoard() {
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

  async initializeDatabase() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS chess_games (
        id INTEGER PRIMARY KEY,
        game_state TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS chess_moves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        move_number INTEGER NOT NULL,
        player TEXT NOT NULL,
        from_row INTEGER NOT NULL,
        from_col INTEGER NOT NULL,
        to_row INTEGER NOT NULL,
        to_col INTEGER NOT NULL,
        piece TEXT NOT NULL,
        captured_piece TEXT,
        notation TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async loadGameState() {
    try {
      const result = this.sql.exec(`SELECT game_state FROM chess_games WHERE id = 1`).one();
      if (result) {
        const saved = JSON.parse(result.game_state);
        this.gameState = { ...this.gameState, ...saved };
      }
    } catch (err) {
      console.log("No saved game state, starting fresh");
    }
  }

  async saveGameState() {
    this.sql.exec(`
      INSERT OR REPLACE INTO chess_games (id, game_state, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
    `, JSON.stringify(this.gameState));
  }

  async fetch(request) {
    return await handleErrors(request, async () => {
      let url = new URL(request.url);

      switch (url.pathname) {
        case "/websocket": {
          if (request.headers.get("Upgrade") != "websocket") {
            return new Response("expected websocket", {status: 400});
          }

          let pair = new WebSocketPair();
          await this.handleSession(pair[1]);
          return new Response(null, { status: 101, webSocket: pair[0] });
        }

        default:
          return new Response("Not found", {status: 404});
      }
    });
  }

  async handleSession(webSocket) {
    this.state.acceptWebSocket(webSocket);

    let session = { 
      name: null, 
      color: null, 
      blockedMessages: [] 
    };
    
    this.sessions.set(webSocket, session);

    // Send current game state to new player
    this.sendToSession(webSocket, {
      type: 'gameState',
      gameState: this.gameState
    });
  }

  async webSocketMessage(webSocket, message) {
    try {
      let session = this.sessions.get(webSocket);
      if (!session) return;

      let data = JSON.parse(message);

      switch (data.type) {
        case 'join':
          await this.handlePlayerJoin(webSocket, data.name);
          break;
        case 'move':
          await this.handleMove(webSocket, data.move);
          break;
        default:
          this.sendToSession(webSocket, {
            type: 'error',
            message: 'Unknown message type'
          });
      }
    } catch (err) {
      this.sendToSession(webSocket, {
        type: 'error',
        message: err.message
      });
    }
  }

  async handlePlayerJoin(webSocket, playerName) {
    let session = this.sessions.get(webSocket);
    session.name = playerName;

    // Assign color to player
    if (!this.gameState.players[playerName]) {
      const assignedColors = Object.values(this.gameState.players).map(p => p.color);
      let color = null;
      
      if (!assignedColors.includes('white')) {
        color = 'white';
      } else if (!assignedColors.includes('black')) {
        color = 'black';
      }

      if (color) {
        this.gameState.players[playerName] = { color, connected: true };
        session.color = color;
      } else {
        // Game is full - player becomes spectator
        session.color = 'spectator';
      }
    } else {
      // Returning player
      this.gameState.players[playerName].connected = true;
      session.color = this.gameState.players[playerName].color;
    }

    // Serialize session data for hibernation
    webSocket.serializeAttachment({
      name: session.name,
      color: session.color
    });

    // Send player joined message to this specific player first
    this.sendToSession(webSocket, {
      type: 'playerJoined',
      player: { name: playerName, color: session.color }
    });

    // Send current game state to this player
    this.sendToSession(webSocket, {
      type: 'gameState',
      gameState: this.gameState
    });

    // Then broadcast to others
    this.sessions.forEach((otherSession, otherWebSocket) => {
      if (otherWebSocket !== webSocket && otherSession.name) {
        this.sendToSession(otherWebSocket, {
          type: 'playerJoined',
          player: { name: playerName, color: session.color }
        });
      }
    });

    await this.saveGameState();
  }

  async handleMove(webSocket, move) {
    let session = this.sessions.get(webSocket);
    
    console.log(`Move attempt by ${session.name}: ${JSON.stringify(move)}`);
    console.log(`Session color: ${session.color}, Current turn: ${this.gameState.currentTurn}`);
    
    if (!session.name || session.color === 'spectator') {
      this.sendToSession(webSocket, {
        type: 'error',
        message: 'You are not a player in this game'
      });
      return;
    }

    if (this.gameState.gameStatus !== 'active') {
      this.sendToSession(webSocket, {
        type: 'error',
        message: `Game is not active (status: ${this.gameState.gameStatus})`
      });
      return;
    }

    // Players can move any piece regardless of color

    // Validate and execute move
    if (this.isValidMove(move)) {
      console.log('Move is valid, executing...');
      await this.executeMove(move, session.name);
    } else {
      console.log('Move is invalid');
      this.sendToSession(webSocket, {
        type: 'error',
        message: 'Invalid move - check piece movement rules'
      });
    }
  }

  isValidMove(move) {
    const { from, to } = move;
    const piece = this.gameState.board[from.row][from.col];
    
    if (!piece) return false;

    // Basic boundary checks
    if (to.row < 0 || to.row > 7 || to.col < 0 || to.col > 7) return false;
    
    // Can't capture own piece (same color)
    const targetPiece = this.gameState.board[to.row][to.col];
    if (targetPiece) {
      const pieceColor = piece === piece.toUpperCase() ? 'white' : 'black';
      const targetColor = targetPiece === targetPiece.toUpperCase() ? 'white' : 'black';
      if (targetColor === pieceColor) return false;
    }

    // Basic piece movement validation (simplified)
    return this.validatePieceMovement(piece.toLowerCase(), from, to);
  }

  validatePieceMovement(piece, from, to) {
    const rowDiff = Math.abs(to.row - from.row);
    const colDiff = Math.abs(to.col - from.col);
    
    switch (piece) {
      case 'p': // Pawn
        return this.validatePawnMove(from, to);
      case 'r': // Rook
        return (rowDiff === 0 || colDiff === 0) && this.isPathClear(from, to);
      case 'n': // Knight
        return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
      case 'b': // Bishop
        return rowDiff === colDiff && this.isPathClear(from, to);
      case 'q': // Queen
        return ((rowDiff === 0 || colDiff === 0) || (rowDiff === colDiff)) && 
               this.isPathClear(from, to);
      case 'k': // King
        return rowDiff <= 1 && colDiff <= 1;
      default:
        return false;
    }
  }

  validatePawnMove(from, to) {
    const piece = this.gameState.board[from.row][from.col];
    const isWhite = piece === piece.toUpperCase();
    const direction = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;
    
    // Forward move
    if (from.col === to.col) {
      if (to.row === from.row + direction && !this.gameState.board[to.row][to.col]) {
        return true; // One square forward
      }
      if (from.row === startRow && to.row === from.row + 2 * direction && 
          !this.gameState.board[to.row][to.col]) {
        return true; // Two squares from start
      }
    }
    
    // Diagonal capture
    if (Math.abs(from.col - to.col) === 1 && to.row === from.row + direction) {
      return !!this.gameState.board[to.row][to.col]; // Must capture piece
    }
    
    return false;
  }

  isPathClear(from, to) {
    const rowDir = Math.sign(to.row - from.row);
    const colDir = Math.sign(to.col - from.col);
    
    let currentRow = from.row + rowDir;
    let currentCol = from.col + colDir;
    
    while (currentRow !== to.row || currentCol !== to.col) {
      if (this.gameState.board[currentRow][currentCol]) {
        return false; // Path blocked
      }
      currentRow += rowDir;
      currentCol += colDir;
    }
    
    return true;
  }

  async executeMove(move, playerName) {
    const { from, to } = move;
    const piece = this.gameState.board[from.row][from.col];
    const capturedPiece = this.gameState.board[to.row][to.col];
    
    // Execute the move
    this.gameState.board[to.row][to.col] = piece;
    this.gameState.board[from.row][from.col] = null;
    
    // Record the move
    const moveRecord = {
      moveNumber: this.gameState.moves.length + 1,
      player: playerName,
      from: from,
      to: to,
      piece: piece,
      capturedPiece: capturedPiece,
      notation: this.getMoveNotation(from, to, piece, capturedPiece)
    };
    
    this.gameState.moves.push(moveRecord);
    
    // Save move to database
    this.sql.exec(`
      INSERT INTO chess_moves 
      (move_number, player, from_row, from_col, to_row, to_col, piece, captured_piece, notation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, moveRecord.moveNumber, playerName, from.row, from.col, to.row, to.col, 
       piece, capturedPiece, moveRecord.notation);
    
    // Switch turns
    this.gameState.currentTurn = this.gameState.currentTurn === 'white' ? 'black' : 'white';
    
    // Check for game end conditions (simplified)
    this.checkGameStatus();
    
    // Broadcast the move
    this.broadcast({
      type: 'move',
      move: moveRecord
    });
    
    // Broadcast updated game state
    this.broadcast({
      type: 'gameState',
      gameState: this.gameState
    });
    
    await this.saveGameState();
  }

  getMoveNotation(from, to, piece, capturedPiece) {
    const files = 'abcdefgh';
    const fromSquare = files[from.col] + (8 - from.row);
    const toSquare = files[to.col] + (8 - to.row);
    const capture = capturedPiece ? 'x' : '';
    return `${fromSquare}${capture}${toSquare}`;
  }

  checkGameStatus() {
    // Simplified game end detection
    // In a full implementation, you'd check for checkmate, stalemate, etc.
    
    // Check if king is captured (simplified checkmate detection)
    let whiteKing = false, blackKing = false;
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = this.gameState.board[row][col];
        if (piece === 'K') whiteKing = true;
        if (piece === 'k') blackKing = true;
      }
    }
    
    if (!whiteKing) {
      this.gameState.gameStatus = 'finished';
      this.gameState.winner = 'black';
      this.gameState.checkmate = true;
    } else if (!blackKing) {
      this.gameState.gameStatus = 'finished';
      this.gameState.winner = 'white';
      this.gameState.checkmate = true;
    }
  }

  async webSocketClose(webSocket, code, reason, wasClean) {
    await this.handleDisconnect(webSocket);
  }

  async webSocketError(webSocket, error) {
    await this.handleDisconnect(webSocket);
  }

  async handleDisconnect(webSocket) {
    let session = this.sessions.get(webSocket);
    if (session && session.name && this.gameState.players[session.name]) {
      this.gameState.players[session.name].connected = false;
      
      this.broadcast({
        type: 'playerLeft',
        player: { name: session.name, color: session.color }
      });
    }
    
    this.sessions.delete(webSocket);
    await this.saveGameState();
  }

  sendToSession(webSocket, message) {
    try {
      webSocket.send(JSON.stringify(message));
    } catch (err) {
      console.log('Failed to send message to session:', err);
    }
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    let disconnected = [];
    
    this.sessions.forEach((session, webSocket) => {
      try {
        webSocket.send(messageStr);
      } catch (err) {
        disconnected.push(webSocket);
      }
    });
    
    // Clean up disconnected sessions
    disconnected.forEach(webSocket => {
      this.sessions.delete(webSocket);
    });
  }
}

// Rate Limiter (reused from chat app)
export class RateLimiter {
  constructor(state, env) {
    this.nextAllowedTime = 0;
  }

  async fetch(request) {
    return await handleErrors(request, async () => {
      let now = Date.now() / 1000;
      this.nextAllowedTime = Math.max(now, this.nextAllowedTime);

      if (request.method == "POST") {
        this.nextAllowedTime += 2; // 2 second cooldown for chess moves
      }

      let cooldown = Math.max(0, this.nextAllowedTime - now - 10);
      return new Response(cooldown);
    });
  }
} 