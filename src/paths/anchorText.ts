/**
 * The text form of a branch's anchors, as written in a map note's
 * `## Path routes` table: `0, 8 → 9, 8 → 13, 8`. Pure, no Obsidian imports.
 *
 * Reading is forgiving (plan-path-anchors section 2):
 * - a coordinate may be written `3, 4`, `3,4`, `3 4`, `3_4` or `(3, 4)`, negatives too;
 * - anchors are separated by `→`, `->`, `>` or `;`;
 * - with no separators at all, the numbers are paired in order
 *   (`3, 4  9, 4` → two anchors); an odd count is an error.
 * A cell is never half-read: any problem returns an error and no anchors.
 * Writing is always the canonical `x, y → x, y`.
 */

import type { HexKey } from "../types";
import { hexKey } from "../hexKey";

export type ParseAnchorsResult = { anchors: HexKey[] } | { error: string };

/** The separator written between anchors. */
export const ANCHOR_SEPARATOR = " → ";

const SEPARATORS = /→|->|>|;/;

/** One anchor as text: "3_4" → "3, 4". */
export function formatAnchor(key: HexKey): string {
  const [x, y] = key.split("_");
  return `${x}, ${y}`;
}

/** A branch's anchors as text, in the canonical form `x, y → x, y`. */
export function formatAnchors(anchors: readonly HexKey[]): string {
  return anchors.map(formatAnchor).join(ANCHOR_SEPARATOR);
}

/**
 * The numbers in a piece of a cell, or an error message when the piece holds
 * anything but integers, commas, underscores, brackets and spaces.
 */
function readNumbers(text: string): number[] | string {
  const token = /\s*(?:(-?\d+)|[(),_])\s*/y;
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    token.lastIndex = i;
    const m = token.exec(text);
    if (!m || m[0].length === 0) {
      const at = text.slice(i).trim();
      return `can't read "${at.length > 12 ? at.slice(0, 12) + "…" : at}"`;
    }
    if (m[1] !== undefined) {
      const n = Number(m[1]);
      if (!Number.isSafeInteger(n)) return `"${m[1]}" is too large`;
      out.push(n === 0 ? 0 : n); // -0 → 0
    }
    i = token.lastIndex;
  }
  return out;
}

/**
 * Read a Path routes `Anchors` cell. Returns the anchors as hex keys, or an
 * error message (for the map note's warning callout) when the cell can't be
 * read in full.
 */
export function parseAnchors(cell: string): ParseAnchorsResult {
  const text = cell.trim();
  if (!text) return { error: "no anchors" };

  if (SEPARATORS.test(text)) {
    const anchors: HexKey[] = [];
    for (const raw of text.split(SEPARATORS)) {
      const piece = raw.trim();
      // A stray separator (leading, trailing, doubled) is harmless.
      if (!piece) continue;
      const nums = readNumbers(piece);
      if (typeof nums === "string") return { error: nums };
      if (nums.length !== 2) {
        return { error: `"${piece}" isn't one coordinate (expected x, y)` };
      }
      anchors.push(hexKey(nums[0], nums[1]));
    }
    if (!anchors.length) return { error: "no anchors" };
    return { anchors };
  }

  const nums = readNumbers(text);
  if (typeof nums === "string") return { error: nums };
  if (!nums.length) return { error: "no anchors" };
  if (nums.length % 2 !== 0) {
    return { error: `an odd number of coordinates (${nums.length}): every anchor needs an x and a y` };
  }
  const anchors: HexKey[] = [];
  for (let i = 0; i < nums.length; i += 2) anchors.push(hexKey(nums[i], nums[i + 1]));
  return { anchors };
}
