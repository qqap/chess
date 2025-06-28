# ♟️ Collaborative Chess

A real-time multiplayer chess game built with [Cloudflare Workers](https://workers.cloudflare.com/) and [Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/), styled with [GitHub Primer](https://github.com/primer/primitives) design system.

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
