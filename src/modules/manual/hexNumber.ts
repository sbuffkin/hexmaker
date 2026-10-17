/**
 * Hex numbers for printed hexcrawl material, the usual XXYY form: two digits
 * of column then two of row, counted from the map's top-left hex as 01. So
 * the top-left hex is 0101 and the hex 5 columns right, 11 rows down is 0612.
 * Maps wider or taller than 99 hexes use three digits per axis (001001).
 *
 * Numbering is relative to the map grid, so maps with negative or offset
 * coordinates still read naturally; the manual shows each hex's own note
 * coordinates alongside for finding the note in Obsidian.
 */

export interface HexNumbering {
  /** "0712" for the hex at note coordinates (x, y). */
  number(x: number, y: number): string;
  /** Digits per axis (2 or 3). */
  digits: number;
}

export function hexNumbering(gridOffset: { x: number; y: number }, gridSize: { cols: number; rows: number }): HexNumbering {
  const digits = Math.max(gridSize.cols, gridSize.rows) > 99 ? 3 : 2;
  const pad = (n: number) => String(n).padStart(digits, "0");
  return {
    digits,
    number: (x, y) => pad(x - gridOffset.x + 1) + pad(y - gridOffset.y + 1),
  };
}
