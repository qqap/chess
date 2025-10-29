// Import shared types
import { ChessPiece, ChessBoard, Position, MoveResult, CastlingRights } from './types.js';

export function getPossibleMoves(
  board: ChessBoard, 
  piece: ChessPiece, 
  row: number, 
  col: number, 
  isDoubleMove: boolean = false,
  harmonics?: Array<{ board: ChessBoard; degeneracy: number }>,
  castlingRights?: CastlingRights
): Position[] {
  console.log('=== getPossibleMoves START ===');
  console.log('Piece:', piece, 'Position:', [row, col], 'Double move:', isDoubleMove);
  console.log('Harmonics count:', harmonics?.length || 0);
  
  if (!piece) return [];
  
  const pieceType = piece.toLowerCase() as 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
  const isWhite = piece === piece.toUpperCase();
  console.log('Piece type:', pieceType, 'Is white:', isWhite);

  // If no harmonics provided, calculate moves for the single board
  if (!harmonics || harmonics.length === 0) {
    return calculateMovesForBoard(board, piece, row, col, isDoubleMove, pieceType, isWhite, castlingRights);
  }

  // Filter harmonics to only those where the piece exists at the starting position
  const filteredHarmonics = harmonics.filter(h => {
    const pieceAtStart = h.board[row]?.[col];
    const matches = pieceAtStart === piece;
    console.log(`  Harmonic ${harmonics.indexOf(h)}: piece at [${row},${col}] = ${pieceAtStart}, matches: ${matches}`);
    return matches;
  });
  console.log(`Filtered harmonics: ${filteredHarmonics.length} out of ${harmonics.length} have piece at starting position`);

  // Calculate moves for each harmonic individually and union the results
  const allMoves = new Set<string>();
  
  for (let i = 0; i < filteredHarmonics.length; i++) {
    const harmonic = filteredHarmonics[i];
    if (!harmonic) continue;
    
    console.log(`Calculating moves for harmonic ${i}:`);
    const moves = calculateMovesForBoard(harmonic.board, piece, row, col, isDoubleMove, pieceType, isWhite, castlingRights);
    for (const move of moves) {
      allMoves.add(`${move[0]},${move[1]}`);
    }
  }
  
  const result = Array.from(allMoves).map(key => {
    const [r, c] = key.split(',').map(Number);
    return [r, c] as Position;
  });
  
  console.log('=== getPossibleMoves END ===');
  console.log('Total possible moves:', result.length);
  console.log('Moves:', result);
  return result;
}

// Helper function to calculate moves for a single board state
function calculateMovesForBoard(
  board: ChessBoard,
  piece: ChessPiece,
  row: number,
  col: number,
  isDoubleMove: boolean,
  pieceType: 'k' | 'q' | 'r' | 'b' | 'n' | 'p',
  isWhite: boolean,
  castlingRights?: CastlingRights
): Position[] {
  const inBounds = (r: number, c: number): boolean => r >= 0 && r < 8 && c >= 0 && c < 8;
  
  // Check if a square is empty (for the current board being evaluated)
  const isEmpty = (r: number, c: number): boolean => {
    if (!inBounds(r, c)) return false;
    return !board[r]?.[c];
  };
  
  // Check if a square has an enemy piece
  const isEnemy = (r: number, c: number): boolean => {
    if (!inBounds(r, c)) return false;
    const squarePiece = board[r]?.[c];
    return !!squarePiece && (squarePiece === squarePiece.toUpperCase()) !== isWhite;
  };

  // Collect all legal single-move targets for a piece at (r, c), and which of those are empty landings
  function collectSingleMoves(r: number, c: number, type: string): MoveResult {
    const singles: Position[] = [];
    const emptyLandings: Position[] = [];

    const pushEmpty = (nr: number, nc: number): void => {
      singles.push([nr, nc]);
      emptyLandings.push([nr, nc]);
    };
    const pushCapture = (nr: number, nc: number): void => {
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
      const deltas: Position[] = [
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
      const deltas: Position[] = [
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
      
      // Add castling moves if king is at starting position
      const startRow = isWhite ? 7 : 0;
      const startCol = 4;
      if (r === startRow && c === startCol && castlingRights) {
        // Kingside castling
        const kingsideRight = isWhite ? castlingRights.blueKingside : castlingRights.redKingside;
        if (kingsideRight) {
          const rookCol = 7;
          const rookPiece = board[startRow]?.[rookCol];
          const expectedRook = isWhite ? 'R' : 'r';
          
          // Check if rook is in position and squares are empty
          if (rookPiece === expectedRook && 
              isEmpty(startRow, 5) && 
              isEmpty(startRow, 6)) {
            // Check if king is not in check, doesn't pass through check, and doesn't end in check
            if (!isSquareUnderAttack(board, startRow, startCol, isWhite) &&
                !isSquareUnderAttack(board, startRow, 5, isWhite) &&
                !isSquareUnderAttack(board, startRow, 6, isWhite)) {
              pushEmpty(startRow, 6); // King moves to g1/g8
            }
          }
        }
        
        // Queenside castling
        const queensideRight = isWhite ? castlingRights.blueQueenside : castlingRights.redQueenside;
        if (queensideRight) {
          const rookCol = 0;
          const rookPiece = board[startRow]?.[rookCol];
          const expectedRook = isWhite ? 'R' : 'r';
          
          // Check if rook is in position and squares are empty
          if (rookPiece === expectedRook && 
              isEmpty(startRow, 1) && 
              isEmpty(startRow, 2) && 
              isEmpty(startRow, 3)) {
            // Check if king is not in check, doesn't pass through check, and doesn't end in check
            if (!isSquareUnderAttack(board, startRow, startCol, isWhite) &&
                !isSquareUnderAttack(board, startRow, 3, isWhite) &&
                !isSquareUnderAttack(board, startRow, 2, isWhite)) {
              pushEmpty(startRow, 2); // King moves to c1/c8
            }
          }
        }
      }
      
      return { singles, emptyLandings };
    }

    // Sliding pieces: rook, bishop, queen
    const directions: Position[] = [];
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
  console.log('Single moves:', singles.length, 'Empty landings:', emptyLandings.length);
  const result = singles.slice();

  // 2) If double-move mode, compose a second single move from each empty landing
  if (isDoubleMove && emptyLandings.length > 0) {
    console.log('Processing double moves...');
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

  console.log('=== getPossibleMoves END ===');
  console.log('Total possible moves:', result.length);
  console.log('Moves:', result);
  return result;
}

// Helper function to check if a square is under attack by enemy pieces
function isSquareUnderAttack(board: ChessBoard, row: number, col: number, isWhite: boolean): boolean {
  // Check all squares on the board to see if any enemy piece can attack this square
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r]?.[c];
      if (!piece) continue;
      
      const pieceIsWhite = piece === piece.toUpperCase();
      if (pieceIsWhite === isWhite) continue; // Skip friendly pieces
      
      // Get possible moves for this enemy piece (without castling to avoid recursion)
      const enemyMoves = calculateMovesForBoard(board, piece, r, c, false, piece.toLowerCase() as 'k' | 'q' | 'r' | 'b' | 'n' | 'p', pieceIsWhite, undefined);
      
      // Check if any move targets the square we're checking
      if (enemyMoves.some(([mr, mc]) => mr === row && mc === col)) {
        return true;
      }
    }
  }
  
  return false;
}

export default getPossibleMoves;
