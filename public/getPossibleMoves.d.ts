export type ChessPiece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | null;
export type ChessBoard = ChessPiece[][];
export type Position = [number, number];
export declare function getPossibleMoves(board: ChessBoard, piece: ChessPiece, row: number, col: number, isDoubleMove?: boolean): Position[];
export default getPossibleMoves;
//# sourceMappingURL=getPossibleMoves.d.ts.map