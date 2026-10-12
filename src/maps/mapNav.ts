/**
 * Map navigation in the toolbar, the pure part (owner playtest 2026-10-10):
 *
 * - Back / Up / Forward are arrow glyphs only, always ← ↑ → in that order.
 *   When any of them applies all three show (the others disabled) so they
 *   never move around; the map each goes to is in its tooltip.
 * - A region of an overworld gets a small hex flower: itself in the middle,
 *   the regions of its six neighbouring overworld hexes around it, each in
 *   its fixed direction (empty petals where there's no region yet).
 * - Maps on a world grid get the same idea with four sides (a d-pad).
 *
 * Pure: no Obsidian imports.
 */

import { hexCenter, hexNeighbors, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";
import { bearingWord } from "./compass";

export type NavArrowId = "back" | "up" | "forward";

export interface NavArrow {
  id: NavArrowId;
  glyph: "←" | "↑" | "→";
  /** The map it goes to (undefined: not available now, shown disabled). */
  target?: string;
}

const ARROWS: [NavArrowId, NavArrow["glyph"]][] = [["back", "←"], ["up", "↑"], ["forward", "→"]];

/** The three arrows in their fixed order, or [] when none applies. */
export function navArrows(t: { back?: string; up?: string; forward?: string }): NavArrow[] {
  if (!t.back && !t.up && !t.forward) return [];
  return ARROWS.map(([id, glyph]) => ({ id, glyph, target: t[id] }));
}

/** Browser-style map history: Back and Forward stacks. */
export class MapHistory {
  private back: string[] = [];
  private fwd: string[] = [];

  constructor(private limit = 50) {}

  /** A normal move from `from`: remember it for Back; Forward is cleared. */
  visit(from: string): void {
    this.back.push(from);
    if (this.back.length > this.limit) this.back.shift();
    this.fwd = [];
  }

  /** The map Back goes to (skipping `current` and maps that are gone), without moving. */
  peekBack(current: string, exists: (m: string) => boolean): string | undefined {
    return peek(this.back, current, exists);
  }

  peekForward(current: string, exists: (m: string) => boolean): string | undefined {
    return peek(this.fwd, current, exists);
  }

  /** Step back from `current`: returns the map to show, and puts `current` on Forward. */
  goBack(current: string, exists: (m: string) => boolean): string | undefined {
    return step(this.back, this.fwd, current, exists, this.limit);
  }

  goForward(current: string, exists: (m: string) => boolean): string | undefined {
    return step(this.fwd, this.back, current, exists, this.limit);
  }
}

function peek(stack: string[], current: string, exists: (m: string) => boolean): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] !== current && exists(stack[i])) return stack[i];
  }
  return undefined;
}

function step(from: string[], to: string[], current: string, exists: (m: string) => boolean, limit: number): string | undefined {
  while (from.length) {
    const m = from.pop()!;
    if (m === current || !exists(m)) continue;
    to.push(current);
    if (to.length > limit) to.shift();
    return m;
  }
  return undefined;
}

export interface FlowerPetal {
  /** Compass word for the direction ("north-east"). */
  bearing: string;
  /** The neighbouring overworld hex. */
  hex: [number, number];
  /** Unit offset from the middle on screen (y down). */
  dx: number;
  dy: number;
}

/**
 * The six petals around overworld hex (px, py), clockwise from the one
 * nearest north. Same order and places for every hex of a map (the stagger
 * changes which hex is which, not where its petal sits).
 */
export function flowerPetals(orientation: Orientation, stagger: Stagger, px: number, py: number): FlowerPetal[] {
  const [cx, cy] = hexCenter(px, py, orientation, stagger);
  const out = hexNeighbors(px, py, orientation, stagger).map(([qx, qy]) => {
    const [x, y] = hexCenter(qx, qy, orientation, stagger);
    const len = Math.hypot(x - cx, y - cy) || 1;
    const dx = (x - cx) / len, dy = (y - cy) / len;
    // Clockwise from north; a hair of slack so the petal at -30° sorts first.
    const angle = (Math.atan2(dx, -dy) + 2 * Math.PI + 1e-6) % (2 * Math.PI);
    return { bearing: bearingWord(dx, dy), hex: [qx, qy] as [number, number], dx, dy, angle };
  });
  out.sort((a, b) => a.angle - b.angle);
  return out.map(({ bearing, hex, dx, dy }) => ({ bearing, hex, dx, dy }));
}

/**
 * What one neighbour button (a flower petal or a d-pad side) does:
 * - go: a map is there, click to go to it;
 * - new: nothing there yet, a "+" that walks into new land (pick or roll
 *   its biome, see WalkRegionModal); `grows` when the overworld must grow
 *   by that hex first;
 * - locked: the "+" is there but the map's work mode is Play;
 * - none: nothing there and nothing can be made (shown disabled).
 */
export type NeighbourAction =
  | { kind: "go"; target: string }
  | { kind: "new"; grows: boolean }
  | { kind: "locked"; hint: string }
  | { kind: "none" };

export interface NeighbourButton {
  action: NeighbourAction;
  /** Show a "+": an empty spot that can take a new region (now or in another mode). */
  plus: boolean;
  disabled: boolean;
  title: string;
}

/**
 * The button for the neighbour in `direction` ("north-east"). `there` is
 * the map in that spot. With nothing there, `canMake` says whether new land
 * can be made in that spot at all, `canAdd` whether the work mode allows it
 * now (Build and God; src/workMode.ts), `inGrid` whether the spot is inside
 * the overworld's grid (false: making it grows the overworld).
 */
export function neighbourButton(
  direction: string,
  there: { name: string; label: string } | undefined,
  opts: { canMake: boolean; canAdd: boolean; lockedHint: string; inGrid?: boolean; emptyTitle?: string },
): NeighbourButton {
  const word = direction[0].toUpperCase() + direction.slice(1);
  if (there) return { action: { kind: "go", target: there.name }, plus: false, disabled: false, title: `${word}: ${there.label}` };
  if (!opts.canMake) return { action: { kind: "none" }, plus: false, disabled: true, title: `${word}: ${opts.emptyTitle ?? "nothing there"}` };
  const title = `New region to the ${direction}`;
  if (!opts.canAdd) return { action: { kind: "locked", hint: opts.lockedHint }, plus: true, disabled: true, title: `${title}. ${opts.lockedHint}` };
  return { action: { kind: "new", grows: opts.inGrid === false }, plus: true, disabled: false, title };
}

/** The four sides of a world-grid map, always in this order (a d-pad: ◀ ▲ ▼ ▶). */
export const PAD_SIDES = [
  { side: "west", glyph: "◀" },
  { side: "north", glyph: "▲" },
  { side: "south", glyph: "▼" },
  { side: "east", glyph: "▶" },
] as const;
