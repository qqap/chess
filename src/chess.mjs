// Collaborative Chess Worker - Built using Durable Objects!

import HTML from "./chess.html";
import { getPossibleMoves } from "./getPossibleMoves.js";
// Rate limiter for WebSocket connections
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new Response("Rate limiter", {status: 200});
  }
}


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
    this.env = env;

    // Track WebSocket sessions
    this.sessions = new Map();
    this.state.getWebSockets().forEach((webSocket) => {
      let meta = webSocket.deserializeAttachment();
      this.sessions.set(webSocket, meta);
    });

    // Initialize basic chess board
    this.board = this.getInitialBoard();
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
      name: null
    };
    
    this.sessions.set(webSocket, session);

    // Send initial board state to new player
    this.sendToSession(webSocket, {
      type: 'board',
      board: this.board
    });
  }


  async webSocketMessage(webSocket, message) {
    try {
      let session = this.sessions.get(webSocket);
      if (!session) return;

      let data = JSON.parse(message);
      console.log('Received message:', data);

      console.log('Processing message from session:', session);
      console.log('Message type:', data.type);
      console.log('Full message data:', JSON.stringify(data, null, 2));

      if (data.type === 'move') {
        const { from, to, isDoubleMove = false } = data;
        console.log('Move request details:');
        console.log('  From square:', from);
        console.log('  To square:', to);
        console.log('  Is double move:', isDoubleMove);

        // Validate coordinates
        const fileToCol = (file) => file.charCodeAt(0) - 'a'.charCodeAt(0);
        const rankToRow = (rank) => 8 - parseInt(rank, 10);

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

        const fromCol = fileToCol(from[0]);
        const fromRow = rankToRow(from[1]);
        const toCol = fileToCol(to[0]);
        const toRow = rankToRow(to[1]);

        console.log('Coordinate conversion:');
        console.log('  From square', from, '-> row:', fromRow, 'col:', fromCol);
        console.log('  To square', to, '-> row:', toRow, 'col:', toCol);

        console.log('Current board state:');
        this.board.forEach((row, rowIndex) => {
          console.log(`  Row ${8 - rowIndex}:`, row.map(piece => piece || '.').join(' '));
        });

        const piece = this.board[fromRow][fromCol];
        console.log('Piece at from-square:', piece);
        
        if (!piece) {
          console.log("MOVE REJECTED: No piece on the from-square");
          console.log('  Board position [' + fromRow + '][' + fromCol + '] is empty');
          this.sendToSession(webSocket, {
            type: 'error',
            message: 'No piece on the from-square'
          });
          return;
        }

        console.log('Getting possible moves for piece:', piece);
        console.log('  Piece position: row', fromRow, 'col', fromCol);
        console.log('  Double move flag:', isDoubleMove);
        
        console.log('Type of getPossibleMoves:', typeof getPossibleMoves);
        console.log("Possible moves:", getPossibleMoves);

        const possibleMoves = getPossibleMoves(this.board, piece, fromRow, fromCol, isDoubleMove);
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

        console.log('MOVE ACCEPTED: Applying move to board');
        console.log('  Before move:');
        console.log('    From square [' + fromRow + '][' + fromCol + ']:', this.board[fromRow][fromCol]);
        console.log('    To square [' + toRow + '][' + toCol + ']:', this.board[toRow][toCol]);

        // Apply the move
        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        console.log('  After move:');
        console.log('    From square [' + fromRow + '][' + fromCol + ']:', this.board[fromRow][fromCol]);
        console.log('    To square [' + toRow + '][' + toCol + ']:', this.board[toRow][toCol]);

        // Log move
        console.log(`Move applied successfully: ${piece} ${from} -> ${to}`);

        console.log('Updated board state:');
        this.board.forEach((row, rowIndex) => {
          console.log(`  Row ${8 - rowIndex}:`, row.map(piece => piece || '.').join(' '));
        });

        console.log('Broadcasting updated board to all players...');
        // Broadcast updated board to all players
        this.broadcast({
          type: 'board',
          board: this.board
        });
        console.log('Board broadcast completed');
        return;
      }

      console.log('Message type not recognized or not handled:', data.type);

    } catch (err) {
      console.log('ERROR in webSocketMessage:');
      console.log('  Error message:', err.message);
      console.log('  Error stack:', err.stack);
      console.log('  Original message:', message);
      this.sendToSession(webSocket, {
        type: 'error',
        message: err.message
      });
    }
  }

  broadcast(message) {
    console.log('Broadcasting message to all sessions:');
    console.log('  Message type:', message.type);
    console.log('  Total sessions:', this.sessions.size);
    
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
        console.log('    Error:', err.message);
        // Remove failed sessions
        this.sessions.delete(webSocket);
      }
    });
    
    console.log(`Broadcast completed: ${successCount} successful, ${failureCount} failed`);
    if (failureCount > 0) {
      console.log(`Cleaned up ${failureCount} dead sessions, remaining: ${this.sessions.size}`);
    }
  }

  
  async webSocketClose(webSocket, code, reason, wasClean) {
    console.log('WebSocket closing:');
    console.log('  Code:', code);
    console.log('  Reason:', reason);
    console.log('  Was clean:', wasClean);
    console.log('  Session existed:', this.sessions.has(webSocket));
    this.sessions.delete(webSocket);
    console.log('  Session deleted, remaining sessions:', this.sessions.size);
  }

  async webSocketError(webSocket, error) {
    console.log('WebSocket error occurred:');
    console.log('  Error:', error);
    console.log('  Session existed:', this.sessions.has(webSocket));
    this.sessions.delete(webSocket);
    console.log('  Session deleted due to error, remaining sessions:', this.sessions.size);
  }

  sendToSession(webSocket, message) {
    console.log('Sending message to session:');
    console.log('  Message type:', message.type);
    console.log('  Full message:', JSON.stringify(message, null, 2));
    try {
      webSocket.send(JSON.stringify(message));
      console.log('  Message sent successfully');
    } catch (err) {
      console.log('  FAILED to send message to session:');
      console.log('    Error:', err.message);
      console.log('    Error stack:', err.stack);
    }
  }
}
