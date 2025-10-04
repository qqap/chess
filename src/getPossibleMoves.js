export function getPossibleMoves(board, piece, row, col, isDoubleMove = false) {
  const pieceType = piece.toLowerCase();
  const isWhite = piece === piece.toUpperCase();

  const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const isEmpty = (r, c) => inBounds(r, c) && !board[r][c];
  const isEnemy = (r, c) => inBounds(r, c) && board[r][c] && (board[r][c] === board[r][c].toUpperCase()) !== isWhite;

  // Collect all legal single-move targets for a piece at (r, c), and which of those are empty landings
  function collectSingleMoves(r, c, type) {
    const singles = [];
    const emptyLandings = [];

    const pushEmpty = (nr, nc) => {
      singles.push([nr, nc]);
      emptyLandings.push([nr, nc]);
    };
    const pushCapture = (nr, nc) => {
      singles.push([nr, nc]);
    };

    if (type === 'p') {
      const direction = isWhite ? -1 : 1;
      const startRow = isWhite ? 6 : 1;

      // One forward
      const oneR = r + direction;
      if (isEmpty(oneR, c)) {
        pushEmpty(oneR, c);
        // Two forward from start (path must be clear)
        const twoR = r + 2 * direction;
        if (r === startRow && isEmpty(twoR, c)) {
          pushEmpty(twoR, c);
        }
      }

      // Diagonal captures
      for (const dc of [-1, 1]) {
        const cr = r + direction;
        const cc = c + dc;
        if (isEnemy(cr, cc)) {
          pushCapture(cr, cc);
        }
      }

      return { singles, emptyLandings };
    }

    if (type === 'n') {
      const deltas = [
        [-2, -1], [-2, 1],
        [-1, -2], [-1, 2],
        [1, -2],  [1, 2],
        [2, -1],  [2, 1],
      ];
      for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        if (isEmpty(nr, nc)) pushEmpty(nr, nc);
        else if (isEnemy(nr, nc)) pushCapture(nr, nc);
      }
      return { singles, emptyLandings };
    }

    if (type === 'k') {
      const deltas = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1],
      ];
      for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        if (isEmpty(nr, nc)) pushEmpty(nr, nc);
        else if (isEnemy(nr, nc)) pushCapture(nr, nc);
      }
      return { singles, emptyLandings };
    }

    // Sliding pieces: rook, bishop, queen
    const directions = [];
    if (type === 'r' || type === 'q') {
      directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }
    if (type === 'b' || type === 'q') {
      directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }
    for (const [dr, dc] of directions) {
      let step = 1;
      while (true) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (!inBounds(nr, nc)) break;
        if (isEmpty(nr, nc)) {
          pushEmpty(nr, nc);
          step++;
          continue;
        }
        if (isEnemy(nr, nc)) {
          pushCapture(nr, nc);
        }
        break; // blocked after encountering any piece
      }
    }

    return { singles, emptyLandings };
  }

  // 1) Always include all single moves
  const { singles, emptyLandings } = collectSingleMoves(row, col, pieceType);
  const result = singles.slice();

  // 2) If double-move mode, compose a second single move from each empty landing
  if (isDoubleMove && emptyLandings.length > 0) {
    const seen = new Set(result.map(([r, c]) => `${r},${c}`));
    for (const [er, ec] of emptyLandings) {
      const { singles: secondLegSingles } = collectSingleMoves(er, ec, pieceType);
      for (const [r2, c2] of secondLegSingles) {
        const key = `${r2},${c2}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push([r2, c2]);
        }
      }
    }
  }

  return result;
}

export default getPossibleMoves;