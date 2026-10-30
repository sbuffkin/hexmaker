/**
 * A hex flower (plan-hex-flower): 19 cells in a hex of radius 2, each
 * holding a result, walked one step at a time by a dice roll on a Moves
 * table. The walk remembers where it is, so what comes next depends on
 * what came before (weather drifts, terrain clumps).
 *
 * Geometry: flat-topped cells in five columns of 3, 4, 5, 4 and 3, numbered
 * down each column from the left: 1–3, 4–7, 8–12 (10 is the centre),
 * 13–16, 17–19. "Up" is the cell above in the same column.
 *
 * Moves: the commonly published navigation hex for 2d6 (Goblin's
 * Henchman's Hex Flower Game Engine, as reproduced in hex flower guides):
 * 2–3 up-right, 4–5 down-right, 6–7 down, 8–9 down-left, 10–11 up-left,
 * 12 up. A walk drifts down and to the left. DEFAULT_MOVES is the one
 * place it's written.
 *
 * Edges: "wrap" (default) comes back in on the opposite side, in line with
 * the move (the published rule); "stay" stays put. A "(blocked)" cell is
 * never entered: a move into it stays.
 *
 * Pure: no Obsidian imports.
 */

export const CELL_COUNT = 19;
/** The cell a new flower starts on. */
export const CENTRE = 10;
/** Cells per column, left to right. */
const COLUMNS = [3, 4, 5, 4, 3] as const;

export type Dir = "up" | "down" | "up-right" | "down-right" | "up-left" | "down-left";
export type Move = Dir | "stay";
export type Edges = "wrap" | "stay";

export const DIRS: readonly Dir[] = ["up", "up-right", "down-right", "down", "down-left", "up-left"];

/** Axial steps (q right, r down the column) for flat-topped cells. */
const VEC: Record<Dir, [number, number]> = {
  "up": [0, -1],
  "down": [0, 1],
  "up-right": [1, -1],
  "down-right": [1, 0],
  "up-left": [-1, 0],
  "down-left": [-1, 1],
};

/** Words a Moves table may use for each move (any case). */
const MOVE_WORDS: Record<Move, readonly string[]> = {
  "up": ["up", "n", "north", "↑"],
  "down": ["down", "s", "south", "↓"],
  "up-right": ["up-right", "up right", "upright", "ne", "north-east", "northeast", "↗"],
  "down-right": ["down-right", "down right", "downright", "se", "south-east", "southeast", "↘"],
  "up-left": ["up-left", "up left", "upleft", "nw", "north-west", "northwest", "↖"],
  "down-left": ["down-left", "down left", "downleft", "sw", "south-west", "southwest", "↙"],
  "stay": ["stay", "none", "no move", "stay put", "-", "–", "0", "·"],
};

/** A move read from a table cell, or undefined. */
export function parseMove(raw: string): Move | undefined {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  for (const [m, words] of Object.entries(MOVE_WORDS) as [Move, readonly string[]][]) if (words.includes(t)) return m;
  return undefined;
}

/** Each cell's axial coordinates, by cell number - 1. */
export const CELL_COORDS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  COLUMNS.forEach((count, c) => {
    const q = c - 2;
    const top = Math.max(-2, -q - 2);
    for (let i = 0; i < count; i++) out.push([q, top + i]);
  });
  return out;
})();

const BY_COORD = new Map(CELL_COORDS.map(([q, r], i) => [`${q},${r}`, i + 1]));

/** The cell at axial (q, r), or undefined off the flower. */
export function cellAt(q: number, r: number): number | undefined {
  return BY_COORD.get(`${q},${r}`);
}

/** Whether `n` is a cell number (1–19). */
export const isCell = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= CELL_COUNT;

/** The cell one step from `cell` in `dir`, ignoring the edge (undefined off the flower). */
export function neighbour(cell: number, dir: Dir): number | undefined {
  const [q, r] = CELL_COORDS[cell - 1];
  const [dq, dr] = VEC[dir];
  return cellAt(q + dq, r + dr);
}

/** The cell a move off the edge wraps to: the far end of the line back through `cell`. */
export function wrapTarget(cell: number, dir: Dir): number {
  const [q, r] = CELL_COORDS[cell - 1];
  const [dq, dr] = VEC[dir];
  let at = cell;
  for (let k = 1; ; k++) {
    const back = cellAt(q - dq * k, r - dr * k);
    if (back === undefined) return at;
    at = back;
  }
}

// ── results ──────────────────────────────────────────────────────────────

/** "(blocked)": a cell the walk never enters. */
export const BLOCKED = "(blocked)";
/** "(nothing)": a cell that gives nothing. */
export const NOTHING = "(nothing)";

export const isBlocked = (result: string): boolean => /^\(?\s*blocked\s*\)?$/i.test(result.trim());

export interface FlowerCell {
  /** As written: a palette terrain, text, a [[note]] or [[table]], (nothing) or (blocked). */
  result: string;
  notes?: string;
}

/** One row of a Moves table: a range of dice totals and the move. */
export interface MoveRow {
  from: number;
  to: number;
  move: Move;
}

export interface Flower {
  /** The note's name. */
  name: string;
  /** The palette its terrains come from (may be unset). */
  palette?: string;
  /** Where a walk starts (cell number). */
  start: number;
  edges: Edges;
  /** Dice rolled per step ("2d6"). */
  dice: string;
  /** 19 cells, cell n at index n - 1. */
  cells: FlowerCell[];
  moves: MoveRow[];
}

/** The published 2d6 navigation hex (see the top of this file). */
export const DEFAULT_MOVES: readonly MoveRow[] = [
  { from: 2, to: 3, move: "up-right" },
  { from: 4, to: 5, move: "down-right" },
  { from: 6, to: 7, move: "down" },
  { from: 8, to: 9, move: "down-left" },
  { from: 10, to: 11, move: "up-left" },
  { from: 12, to: 12, move: "up" },
];
export const DEFAULT_DICE = "2d6";

/** An empty flower: every cell "(nothing)", the default moves. */
export function emptyFlower(name: string, palette?: string): Flower {
  return {
    name,
    ...(palette ? { palette } : {}),
    start: CENTRE,
    edges: "wrap",
    dice: DEFAULT_DICE,
    cells: Array.from({ length: CELL_COUNT }, () => ({ result: NOTHING })),
    moves: DEFAULT_MOVES.map((m) => ({ ...m })),
  };
}

// ── dice ─────────────────────────────────────────────────────────────────

/** "2d6" → { count, sides }; undefined when it can't be read. */
export function parseDice(raw: string): { count: number; sides: number } | undefined {
  const m = /^\s*(\d*)\s*d\s*(\d+)\s*$/i.exec(raw);
  if (!m) return undefined;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  if (count < 1 || count > 6 || sides < 2 || sides > 100) return undefined;
  return { count, sides };
}

/** Each total's chance for `dice` (a map total → probability). */
export function diceOdds(dice: string): Map<number, number> {
  const d = parseDice(dice) ?? parseDice(DEFAULT_DICE)!;
  let dist = new Map<number, number>([[0, 1]]);
  for (let i = 0; i < d.count; i++) {
    const next = new Map<number, number>();
    for (const [t, p] of dist) for (let f = 1; f <= d.sides; f++) next.set(t + f, (next.get(t + f) ?? 0) + p / d.sides);
    dist = next;
  }
  return dist;
}

/** Roll `dice` with `rand` (0 ≤ rand() < 1). */
export function rollDice(dice: string, rand: () => number): number {
  const d = parseDice(dice) ?? parseDice(DEFAULT_DICE)!;
  let t = 0;
  for (let i = 0; i < d.count; i++) t += 1 + Math.floor(rand() * d.sides);
  return t;
}

/** The move for a dice total (a total no row covers: stay). */
export function moveFor(moves: readonly MoveRow[], total: number): Move {
  return moves.find((m) => total >= m.from && total <= m.to)?.move ?? "stay";
}

// ── walking ──────────────────────────────────────────────────────────────

export interface StepOutcome {
  /** Where the walk is now. */
  cell: number;
  move: Move;
  /** The dice total (undefined when no dice were rolled). */
  total?: number;
  wrapped?: boolean;
  /** A move into a "(blocked)" cell or off a "stay" edge: it stayed. */
  stayed?: boolean;
}

/** Where a move from `cell` lands on `flower`. */
export function applyMove(flower: Pick<Flower, "cells" | "edges">, cell: number, move: Move): StepOutcome {
  if (move === "stay") return { cell, move };
  let to = neighbour(cell, move);
  let wrapped = false;
  if (to === undefined) {
    if (flower.edges === "stay") return { cell, move, stayed: true };
    to = wrapTarget(cell, move);
    wrapped = true;
  }
  if (to === cell || isBlocked(flower.cells[to - 1]?.result ?? "")) return { cell, move, stayed: true };
  return { cell: to, move, ...(wrapped ? { wrapped } : {}) };
}

/** One step: roll the dice, look up the move, apply it. */
export function step(flower: Flower, cell: number, rand: () => number): StepOutcome {
  const total = rollDice(flower.dice, rand);
  return { ...applyMove(flower, cell, moveFor(flower.moves, total)), total };
}

/** `n` steps from `from`: the cells visited (not including `from`). */
export function walk(flower: Flower, from: number, n: number, rand: () => number): StepOutcome[] {
  const out: StepOutcome[] = [];
  let at = from;
  for (let i = 0; i < n; i++) {
    const s = step(flower, at, rand);
    out.push(s);
    at = s.cell;
  }
  return out;
}

/** Each cell's chances of being next: matrix[from - 1][to - 1]. */
export function transitionMatrix(flower: Flower): number[][] {
  const odds = diceOdds(flower.dice);
  return Array.from({ length: CELL_COUNT }, (_, i) => {
    const row = new Array<number>(CELL_COUNT).fill(0);
    for (const [total, p] of odds) row[applyMove(flower, i + 1, moveFor(flower.moves, total)).cell - 1] += p;
    return row;
  });
}

/**
 * The share of time a long walk from the start spends on each cell (by
 * cell - 1). Averaged over the walk, so a walk that cycles still settles.
 */
export function longRunOdds(flower: Flower, steps = 2000): number[] {
  const m = transitionMatrix(flower);
  let at = new Array<number>(CELL_COUNT).fill(0);
  at[(isCell(flower.start) ? flower.start : CENTRE) - 1] = 1;
  const sum = new Array<number>(CELL_COUNT).fill(0);
  for (let s = 0; s < steps; s++) {
    const next = new Array<number>(CELL_COUNT).fill(0);
    for (let i = 0; i < CELL_COUNT; i++) {
      if (!at[i]) continue;
      for (let j = 0; j < CELL_COUNT; j++) next[j] += at[i] * m[i][j];
    }
    at = next;
    for (let j = 0; j < CELL_COUNT; j++) sum[j] += at[j];
  }
  return sum.map((v) => v / steps);
}

/** The odds of landing on each cell from `cell` in one step (by cell - 1). */
export function landingOdds(flower: Flower, cell: number): number[] {
  return transitionMatrix(flower)[cell - 1];
}

/** Cells (numbers) whose result is `result` (any case, trimmed). */
export function cellsShowing(flower: Pick<Flower, "cells">, result: string): number[] {
  const want = result.trim().toLowerCase();
  return flower.cells.flatMap((c, i) => (c.result.trim().toLowerCase() === want ? [i + 1] : []));
}

/** Steps between two cells on the flower (no wrapping), for "nearest". */
export function cellDistance(a: number, b: number): number {
  const [q1, r1] = CELL_COORDS[a - 1];
  const [q2, r2] = CELL_COORDS[b - 1];
  return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
}
