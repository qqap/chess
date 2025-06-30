# Quantum Chess - Collaborative Chess with Quantum Mechanics

A collaborative chess game built with Cloudflare Workers and Durable Objects, featuring quantum chess mechanics inspired by quantum physics principles.

## Features

### Classical Chess
- Standard chess rules and piece movements
- Real-time multiplayer gameplay
- Move validation and game state tracking
- Database persistence for game history

### Quantum Chess Mechanics
- **Quantum Moves**: Pieces can exist in superposition, creating multiple possible board states
- **Superposition Visualization**: Squares with pieces in superposition are highlighted with special effects
- **Measurement**: Players can measure quantum states to collapse superpositions
- **Quantum Harmonics**: The game tracks multiple parallel board states (harmonics)
- **Spontaneous Measurement**: When too many harmonics exist, the system automatically collapses to one state

## How to Play

### Setup
1. Deploy to Cloudflare Workers:
   ```bash
   npm install -g wrangler
   wrangler login
   wrangler deploy
   ```

2. Open the deployed URL in your browser

### Gameplay

#### Classical Mode
- Click "Classical" button to switch to classical chess mode
- Select a piece and see valid moves highlighted in green
- Click on a valid move destination to execute the move

#### Quantum Mode
- Click "Quantum" button to switch to quantum chess mode
- Select a piece to see quantum-valid moves (highlighted in pink)
- Quantum moves cannot capture pieces
- For long moves, you can specify a middle point to create more complex quantum paths
- Squares with pieces in superposition are highlighted with a gradient effect

#### Measurement
- In quantum mode, click on a square to measure its quantum state
- This collapses any superposition at that position
- The measurement button appears when a square is selected

## Technical Implementation

### Quantum Chess Engine
The implementation includes a JavaScript quantum chess engine that mimics the C# kernel:

- **QuantumHarmonic**: Represents a single board state with a degeneracy value
- **QuantumChessboard**: Manages multiple harmonics and quantum operations
- **Superposition**: Pieces can exist in multiple states simultaneously
- **Measurement**: Collapses superpositions based on probability

### Key Classes

#### QuantumChessboard
- Manages multiple board harmonics
- Handles quantum moves and classical moves
- Performs measurements and spontaneous collapse
- Tracks game state across all harmonics

#### ChessGame (Durable Object)
- Manages WebSocket connections
- Handles both classical and quantum moves
- Persists game state to SQLite database
- Broadcasts updates to all connected players

### Database Schema
The game uses SQLite to store:
- Game state and quantum state information
- Move history with move types (classical/quantum)
- Player information and game metadata

## Quantum Chess Rules

1. **Quantum Moves**: Pieces can move to empty squares without capturing
2. **Superposition**: After a quantum move, the piece exists in both original and new positions
3. **Measurement**: Players can measure squares to collapse superpositions
4. **Harmonics**: Each possible board state is called a harmonic
5. **Spontaneous Collapse**: When too many harmonics exist, the system randomly selects one

## Development

### Local Development
```bash
wrangler dev
```

### Testing
Open multiple browser tabs to test multiplayer functionality. Each tab can represent a different player.

### Customization
- Modify piece images in `public/pieces/simple/`
- Adjust quantum mechanics parameters in the `QuantumChessboard` class
- Customize UI styling in `src/chess.html`

## Architecture

- **Frontend**: HTML5 Canvas with JavaScript
- **Backend**: Cloudflare Workers with Durable Objects
- **Database**: Cloudflare D1 (SQLite)
- **Real-time**: WebSocket connections
- **Assets**: Static piece images served from public directory

## License

This project is open source and available under the MIT License.

## ✨ Features

- **Real-time multiplayer chess** - Play chess with friends in real-time
- **Persistent game state** - Games are saved using Durable Objects with SQLite
- **Move validation** - Complete chess rule validation on the server
- **Move history** - Track all moves with algebraic notation
- **Responsive design** - Works on desktop and mobile devices
- **GitHub Primer styling** - Beautiful, accessible UI using GitHub's design system
- **Private rooms** - Create private games with shareable links
- **Spectator mode** - Watch games in progress

## 🚀 Live Demo

[Visit the live demo](https://collaborative-chess.your-domain.workers.dev)

## 🏗️ Architecture


This application demonstrates several advanced Cloudflare Workers concepts:

- **Durable Objects** for persistent, real-time game state management
- **WebSockets** for real-time communication between players
- **SQLite** for persistent storage of games and move history
- **Rate limiting** to prevent abuse
- **Hibernation** for cost-effective scaling

### How it works

1. **Game Creation**: Players can create public rooms by name or generate private rooms with unique IDs
2. **Real-time Updates**: All game state changes are synchronized in real-time via WebSockets
3. **Move Validation**: Chess moves are validated server-side using comprehensive rule checking
4. **Persistence**: Game state and move history are stored in SQLite for durability
5. **Scaling**: Durable Objects ensure each game runs in a single location for consistency

## 🎮 How to Play

1. Enter your name
2. Join an existing game room or create a new private game
3. Wait for another player to join (or play as both players for testing)
4. Click on a piece to select it, then click on a destination square to move
5. Game follows standard chess rules with basic move validation

## 🛠️ Development

### Prerequisites

- [Bun](https://bun.sh/) - Fast JavaScript runtime and package manager
- [Wrangler CLI](https://developers.cloudflare.com/workers/cli-wrangler/) (installed via Bun)

### Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/collaborative-chess
   cd collaborative-chess
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Start the development server:
   ```bash
   bun run dev
   # or directly: bunx wrangler dev
   ```

4. Open your browser to `http://localhost:8787`

### Deployment

1. Authenticate with Cloudflare:
   ```bash
   bunx wrangler login
   ```

2. Deploy to Cloudflare Workers:
   ```bash
   bun run deploy
   # or directly: bunx wrangler deploy
   ```

## 🏛️ Code Structure

```
src/
├── chess.html      # Frontend UI with GitHub Primer styling
├── chess.mjs       # Main Worker script with Durable Objects
wrangler.toml       # Cloudflare Workers configuration
package.json        # Node.js dependencies
```

### Key Components

- **ChessGame Durable Object**: Manages individual game state, move validation, and WebSocket connections
- **RateLimiter Durable Object**: Prevents abuse by limiting move frequency per IP
- **Frontend**: Single-page application with responsive chess board and real-time updates

## 🎨 Styling

The application uses GitHub Primer design primitives including:

- **Color system**: Semantic color variables for consistent theming
- **Typography**: System font stack with proper weight and sizing
- **Spacing**: Consistent spacing scale based on 4px units  
- **Components**: Form controls, buttons, and panels following Primer patterns
- **Responsive design**: Mobile-first approach with breakpoints

Based on the [Primer Primitives](https://github.com/primer/primitives) design token system.

## 🔧 Configuration

The application is configured via `wrangler.toml`:

```toml
name = "collaborative-chess"
main = "src/chess.mjs"

[durable_objects]
bindings = [
  { name = "games", class_name = "ChessGame" },
  { name = "limiters", class_name = "RateLimiter" }
]
```

## 🎯 Future Enhancements

- [ ] Complete chess rule implementation (castling, en passant, promotion)
- [ ] Check and checkmate detection
- [ ] Player ratings and matchmaking
- [ ] Game replay functionality  
- [ ] Tournament mode
- [ ] Enhanced spectator features
- [ ] Mobile app using the same backend

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📚 Learn More

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/workers/learning/using-durable-objects/)
- [GitHub Primer Design System](https://primer.style/)
- [WebSocket API in Workers](https://developers.cloudflare.com/workers/examples/websockets/)

---

Built with ❤️ using Cloudflare's edge computing platform and GitHub's design system.
