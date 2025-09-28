export function getPossibleMoves(board, piece, row, col, isDoubleMove = false) {
  const moves = [];
  const pieceType = piece.toLowerCase();
  const isWhite = piece === piece.toUpperCase();

  switch (pieceType) {
    case 'p': { // Pawn
      const direction = isWhite ? -1 : 1;
      const startRow = isWhite ? 6 : 1;

      // Forward moves
      if (
        row + direction >= 0 &&
        row + direction < 8 &&
        !board[row + direction][col]
      ) {
        moves.push([row + direction, col]);
        
        // Double move from starting position (only if not a double move turn)
        if (row === startRow && !isDoubleMove &&
            row + 2 * direction >= 0 &&
            row + 2 * direction < 8 &&
            !board[row + 2 * direction][col]) {
          moves.push([row + 2 * direction, col]);
        }
        
        // Additional forward moves for double move turn
        if (isDoubleMove &&
            row + 2 * direction >= 0 &&
            row + 2 * direction < 8 &&
            !board[row + 2 * direction][col]) {
          moves.push([row + 2 * direction, col]);
          
          // Third move if starting from initial position
          if (row === startRow &&
              row + 3 * direction >= 0 &&
              row + 3 * direction < 8 &&
              !board[row + 3 * direction][col]) {
            moves.push([row + 3 * direction, col]);
          }
        }
      }

      // Diagonal captures - only if there's an enemy piece to capture
      for (const dcol of [-1, 1]) {
        const newRow = row + direction;
        const newCol = col + dcol;
        if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
          const targetPiece = board[newRow][newCol];
          // Only allow capture if there's actually an enemy piece there
          if (targetPiece && (targetPiece === targetPiece.toUpperCase()) !== isWhite) {
            moves.push([newRow, newCol]);
          }
        }
      }
      
      break;
    }

    case 'r': { // Rook
      const findRookMoves = (currentRow, currentCol, direction, depth) => {
        if (depth <= 0) return;
        const [dr, dc] = direction;
        const newRow = currentRow + dr;
        const newCol = currentCol + dc;
        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) return;

        const targetPiece = board[newRow][newCol];
        if (!targetPiece) {
          moves.push([newRow, newCol]);
          if (depth > 1) {
            findRookMoves(newRow, newCol, direction, depth - 1);
          }
        } else {
          if ((targetPiece === targetPiece.toUpperCase()) !== isWhite) {
            moves.push([newRow, newCol]);
          }
        }
      };

      for (const direction of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const maxDepth = isDoubleMove ? 16 : 8;
        findRookMoves(row, col, direction, maxDepth);
      }
      break;
    }

    case 'n': { // Knight
      const knightMoves = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];

      const findKnightMoves = (currentRow, currentCol, depth) => {
        if (depth <= 0) return;

        for (const [dr, dc] of knightMoves) {
          const newRow = currentRow + dr;
          const newCol = currentCol + dc;
          if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
            const targetPiece = board[newRow][newCol];
            if (!targetPiece || (targetPiece === targetPiece.toUpperCase()) !== isWhite) {
              moves.push([newRow, newCol]);

              if (isDoubleMove && depth > 1 && !targetPiece) {
                findKnightMoves(newRow, newCol, depth - 1);
              }
            }
          }
        }
      };

      findKnightMoves(row, col, isDoubleMove ? 2 : 1);
      break;
    }

    case 'b': { // Bishop
      const findBishopMoves = (currentRow, currentCol, direction, depth) => {
        if (depth <= 0) return;
        const [dr, dc] = direction;
        const newRow = currentRow + dr;
        const newCol = currentCol + dc;
        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) return;

        const targetPiece = board[newRow][newCol];
        if (!targetPiece) {
          moves.push([newRow, newCol]);
          if (depth > 1) {
            findBishopMoves(newRow, newCol, direction, depth - 1);
          }
        } else {
          if ((targetPiece === targetPiece.toUpperCase()) !== isWhite) {
            moves.push([newRow, newCol]);
          }
        }
      };

      for (const direction of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const maxDepth = isDoubleMove ? 16 : 8;
        findBishopMoves(row, col, direction, maxDepth);
      }
      break;
    }

    case 'q': { // Queen
      const findQueenMoves = (currentRow, currentCol, direction, depth) => {
        if (depth <= 0) return;
        const [dr, dc] = direction;
        const newRow = currentRow + dr;
        const newCol = currentCol + dc;
        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) return;

        const targetPiece = board[newRow][newCol];
        if (!targetPiece) {
          moves.push([newRow, newCol]);
          if (depth > 1) {
            findQueenMoves(newRow, newCol, direction, depth - 1);
          }
        } else {
          if ((targetPiece === targetPiece.toUpperCase()) !== isWhite) {
            moves.push([newRow, newCol]);
          }
        }
      };

      for (const direction of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const maxDepth = isDoubleMove ? 16 : 8;
        findQueenMoves(row, col, direction, maxDepth);
      }
      break;
    }

    case 'k': { // King
      const kingMoves = [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ];

      const findKingMoves = (currentRow, currentCol, depth) => {
        if (depth <= 0) return;

        for (const [dr, dc] of kingMoves) {
          const newRow = currentRow + dr;
          const newCol = currentCol + dc;
          if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
            const targetPiece = board[newRow][newCol];
            if (!targetPiece || (targetPiece === targetPiece.toUpperCase()) !== isWhite) {
              moves.push([newRow, newCol]);

              if (isDoubleMove && depth > 1 && !targetPiece) {
                findKingMoves(newRow, newCol, depth - 1);
              }
            }
          }
        }
      };

      findKingMoves(row, col, isDoubleMove ? 2 : 1);
      break;
    }
  }

  return moves;
}

export default getPossibleMoves;