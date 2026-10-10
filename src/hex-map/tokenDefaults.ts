/**
 * Token-form defaults, DOM- and Obsidian-free for unit tests.
 */

/** The fill a token gets when it has none (matches the CSS fallback). */
export const DEFAULT_TOKEN_FILL = "#4a90e2";

/** Fills new tokens rotate through, so two tokens are told apart at a
 *  glance (round-3 testers: "A and C and H all look the same"). Mid-tone
 *  colours that keep the token's white letter / icon readable. */
export const TOKEN_FILL_PALETTE = [
  DEFAULT_TOKEN_FILL, // blue
  "#d9534f", // red
  "#3e9d57", // green
  "#d98a1f", // orange
  "#8e5cc7", // purple
  "#1f9c9a", // teal
  "#c94f8f", // pink
  "#6d7a86", // slate
];

/**
 * Fill for a new token: the palette colour used least by the tokens already
 * on the map (earliest in the palette on a tie), so each new token differs
 * from the last ones placed. Tokens without a fill count as the default.
 */
export function pickTokenFill(
  usedFills: (string | undefined)[],
  palette: string[] = TOKEN_FILL_PALETTE,
): string {
  const counts = new Map(palette.map((c) => [c.toLowerCase(), 0]));
  for (const fill of usedFills) {
    const key = (fill ?? DEFAULT_TOKEN_FILL).toLowerCase();
    const n = counts.get(key);
    if (n !== undefined) counts.set(key, n + 1);
  }
  let best = palette[0];
  let bestCount = Infinity;
  for (const c of palette) {
    const n = counts.get(c.toLowerCase()) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

const inFolder = (path: string, folder: string): boolean => path.startsWith(folder + "/");

/**
 * Whether a note belongs in the token form's note picker: a world note
 * (town, dungeon, faction, character, the tokens folder, …) — not a random
 * table, workflow, generator, palette, hex or map note, export, or a
 * `_`-prefixed note. `include` and `exclude` are normalised folder paths
 * (empty entries ignored); with no include folders, anything not excluded
 * counts.
 */
export function isTokenNoteCandidate(
  path: string,
  basename: string,
  include: string[],
  exclude: string[],
): boolean {
  if (basename.startsWith("_")) return false;
  if (exclude.some((f) => f && inFolder(path, f))) return false;
  const inc = include.filter(Boolean);
  return inc.length === 0 || inc.some((f) => inFolder(path, f));
}

// Returns [dx, dy] unit offsets (multiply by spread radius) for N tokens on one hex.
// Presets keep 1-5 tokens visually distinct; 6+ use an even radial ring.
export function tokenGroupOffsets(n: number): [number, number][] {
  const PRESETS: [number, number][][] = [
    [[0, 0]],
    [[-0.55, 0], [0.55, 0]],
    [[0, -0.6], [-0.55, 0.4], [0.55, 0.4]],
    [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]],
    [[0, -0.65], [-0.6, -0.15], [0.6, -0.15], [-0.38, 0.55], [0.38, 0.55]],
  ];
  if (n >= 1 && n <= 5) return PRESETS[n - 1];
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return [Math.cos(a) * 0.65, Math.sin(a) * 0.65];
  });
}

/**
 * Where a token's name label goes, as unit offsets like tokenGroupOffsets
 * plus a line number. A lone token's name sits under it; tokens sharing a
 * hex list their names one per line under the whole group, since names
 * side by side overlap.
 */
export function tokenNamePlacement(offsets: [number, number][], i: number): { dx: number; dy: number; line: number } {
  if (offsets.length <= 1) {
    const [dx, dy] = offsets[0] ?? [0, 0];
    return { dx, dy, line: 0 };
  }
  return { dx: 0, dy: Math.max(...offsets.map(([, dy]) => dy)), line: i };
}

/** The largest size among tokens sharing a hex (where their name list starts). */
export function groupSize(tokens: { size?: "sm" | "md" | "lg" }[]): "sm" | "md" | "lg" {
  if (tokens.some((t) => t.size === "lg")) return "lg";
  return tokens.some((t) => (t.size ?? "md") === "md") ? "md" : "sm";
}
