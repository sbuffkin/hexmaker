import { hexCenter, mulberry32 } from "../../../packages/hex-wfc/src";
import type { TerrainColor } from "../../types";
import {
  cellKey,
  centerHex,
  distance,
  findTerrain,
  gridKeys,
  inCategory,
  weightedPick,
  type ProcGrid,
  type ProcOption,
  type ProcPath,
  type ProcResult,
} from "./common";

/**
 * Star-system "orbits": a star at the centre, then one body per orbit ring
 * (hex distance from the star), typed by zone — hot inner rocks, a
 * habitable middle, cold giants outside. Belts fill part of a ring; giants
 * may get a moon; the mainworld may get a station or starport alongside;
 * a comet and a jump point sit out past the last orbit.
 *
 * Works on any palette with a background ("void" / "empty space" / first
 * `space` terrain) and at least one star and one body — by name, or the
 * `stars` / `bodies` categories.
 */

export const ORBITS_ID = "procedural:orbits";

export const ORBITS_OPTIONS: ProcOption[] = [
  {
    key: "star",
    label: "Star",
    choices: [
      { value: "random", label: "Random" },
      { value: "yellow star", label: "Yellow star" },
      { value: "red dwarf", label: "Red dwarf" },
      { value: "blue giant", label: "Blue giant" },
      { value: "white dwarf", label: "White dwarf" },
      { value: "brown dwarf", label: "Brown dwarf" },
    ],
    default: "random",
  },
  {
    key: "bodies",
    label: "Planets",
    choices: [
      { value: "few", label: "Few" },
      { value: "normal", label: "Normal" },
      { value: "crowded", label: "Crowded" },
    ],
    default: "normal",
  },
];

/** Galactic mix: red dwarfs dominate. */
const STAR_WEIGHTS: Record<string, number> = {
  "red dwarf": 6,
  "yellow star": 3,
  "brown dwarf": 1.5,
  "white dwarf": 1,
  "blue giant": 0.5,
};

const ZONE_WEIGHTS: Record<"inner" | "habitable" | "outer", Record<string, number>> = {
  inner: { "molten planet": 4, "rocky planet": 4, "desert planet": 2, "asteroid belt": 0.5 },
  habitable: { "terrestrial planet": 4, "ocean planet": 3, "desert planet": 3, "rocky planet": 2, "asteroid belt": 1 },
  outer: { "gas giant": 4, "ice giant": 3, "ice planet": 3, "asteroid belt": 1.5, "rocky planet": 1 },
};

const BODY_NAMES = [
  "terrestrial planet", "ocean planet", "desert planet", "ice planet", "rocky planet",
  "molten planet", "gas giant", "ice giant", "asteroid belt",
];

export interface OrbitRoles {
  background: string;
  stars: string[];
  bodies: string[];
  moon?: string;
  comet?: string;
  station?: string;
  starport?: string;
  jumpPoint?: string;
  jumpLimit?: string;
  belt?: string;
}

export function orbitRoles(terrains: TerrainColor[]): OrbitRoles | undefined {
  const background = findTerrain(terrains, ["void", "empty space", "deep space", "space"], "space");
  let stars = inCategory(terrains, "stars");
  if (stars.length === 0) {
    const s = findTerrain(terrains, ["yellow star", "star", "sun"]);
    stars = s ? [s] : [];
  }
  const names = new Set(terrains.map((t) => t.name.toLowerCase()));
  let bodies = inCategory(terrains, "bodies").filter((b) => !/^(moon|comet)$/i.test(b));
  if (bodies.length === 0) bodies = terrains.map((t) => t.name).filter((n) => BODY_NAMES.includes(n.toLowerCase()));
  if (!background || stars.length === 0 || bodies.length === 0) return undefined;
  const pick = (n: string) => (names.has(n) ? terrains.find((t) => t.name.toLowerCase() === n)!.name : undefined);
  return {
    background,
    stars,
    bodies,
    moon: pick("moon"),
    comet: pick("comet"),
    station: pick("space station"),
    starport: pick("starport"),
    jumpPoint: pick("jump point"),
    jumpLimit: pick("jump limit"),
    belt: bodies.find((b) => /belt/i.test(b)),
  };
}

export function orbitsFits(terrains: TerrainColor[]): boolean {
  return orbitRoles(terrains) !== undefined;
}

export function orbits(
  terrains: TerrainColor[],
  grid: ProcGrid,
  seed: number,
  options: Record<string, string> = {},
  /** Path type to draw occupied orbits with (e.g. "Orbit"); none = no rings. */
  orbitPathType?: string,
): ProcResult {
  const roles = orbitRoles(terrains);
  if (!roles) {
    return { cells: new Map(), paths: [], warnings: ["This palette has no void, star, or planet terrains."] };
  }
  const rand = mulberry32(seed);
  const hexes = gridKeys(grid);
  const center = centerHex(grid);
  const cells = new Map<string, string>();
  const dist = new Map<string, number>();
  let maxD = 0;
  for (const h of hexes) {
    const k = cellKey(h[0], h[1]);
    cells.set(k, roles.background);
    const d = distance(center, h, grid);
    dist.set(k, d);
    maxD = Math.max(maxD, d);
  }
  // The largest ring that is complete on this grid — orbits beyond it would
  // be clipped by the map edge.
  const fullRing = Math.min(
    ...hexes.filter((h) => h[0] === grid.offset.x || h[1] === grid.offset.y
      || h[0] === grid.offset.x + grid.cols - 1 || h[1] === grid.offset.y + grid.rows - 1)
      .map((h) => distance(center, h, grid)),
  );
  const ring = (d: number) => hexes.filter((h) => dist.get(cellKey(h[0], h[1])) === d);
  const set = (h: [number, number], t: string | undefined) => { if (t) cells.set(cellKey(h[0], h[1]), t); };

  // Star.
  const wanted = options.star && options.star !== "random"
    ? roles.stars.find((s) => s.toLowerCase() === options.star)
    : undefined;
  const star = wanted ?? weightedPick(rand, roles.stars, STAR_WEIGHTS)!;
  set(center, star);
  // The 100-diameter limit hugs the star: mark the first ring.
  if (roles.jumpLimit && fullRing >= 3) for (const h of ring(1)) set(h, roles.jumpLimit);

  // Orbits from ring 2 out to the last full ring.
  const first = 2;
  const last = Math.max(first, fullRing);
  const skip = options.bodies === "few" ? 0.45 : options.bodies === "crowded" ? 0.05 : 0.2;
  const warnings: string[] = [];
  if (fullRing < 2) warnings.push("Map is too small for orbits — try Medium or Large.");
  let mainworld: [number, number] | undefined;
  const paths: ProcPath[] = [];
  for (let d = first; d <= last; d++) {
    if (rand() < skip) continue;
    // Draw the orbit itself: the ring, in order around the star, closed.
    if (orbitPathType) {
      const around = sortAround(ring(d), center, grid).map((h) => cellKey(h[0], h[1]));
      if (around.length > 2) paths.push({ type: orbitPathType, hexes: [...around, around[0]] });
    }
    const t = (d - first) / Math.max(1, last - first);
    const zone = t < 0.3 ? "inner" : t < 0.6 ? "habitable" : "outer";
    const body = weightedPick(rand, roles.bodies, ZONE_WEIGHTS[zone], 0.5)!;
    const hexesOnRing = ring(d);
    if (hexesOnRing.length === 0) continue;
    if (roles.belt && body === roles.belt) {
      // Belts sweep an arc of the ring rather than sitting on one hex.
      const start = Math.floor(rand() * hexesOnRing.length);
      const span = Math.max(2, Math.floor(hexesOnRing.length * (0.3 + rand() * 0.4)));
      const sorted = sortAround(hexesOnRing, center, grid);
      for (let i = 0; i < span; i++) set(sorted[(start + i) % sorted.length], body);
      continue;
    }
    const pos = hexesOnRing[Math.floor(rand() * hexesOnRing.length)];
    set(pos, body);
    if (zone === "habitable" && !mainworld) mainworld = pos;
    // Giants get a moon on a free neighbouring hex.
    if (roles.moon && /giant/i.test(body) && rand() < 0.7) {
      const free = hexes.filter((h) => distance(h, pos, grid) === 1
        && cells.get(cellKey(h[0], h[1])) === roles.background);
      if (free.length) set(free[Math.floor(rand() * free.length)], roles.moon);
    }
  }

  // Installations beside the mainworld (or the first body if none was habitable).
  const anchor = mainworld ?? hexes.find((h) => roles.bodies.includes(cells.get(cellKey(h[0], h[1]))!));
  if (anchor) {
    const free = hexes.filter((h) => distance(h, anchor, grid) === 1
      && cells.get(cellKey(h[0], h[1])) === roles.background);
    const pickFree = () => free.splice(Math.floor(rand() * free.length), 1)[0];
    if (roles.starport && free.length) set(pickFree(), roles.starport);
    if (roles.station && free.length && rand() < 0.5) set(pickFree(), roles.station);
  }

  // Out past the last orbit: a jump point and maybe a comet.
  const outer = hexes.filter((h) => (dist.get(cellKey(h[0], h[1])) ?? 0) > last
    && cells.get(cellKey(h[0], h[1])) === roles.background);
  const takeOuter = () => outer.splice(Math.floor(rand() * outer.length), 1)[0];
  if (roles.jumpPoint && outer.length) set(takeOuter(), roles.jumpPoint);
  if (roles.comet && outer.length && rand() < 0.6) set(takeOuter(), roles.comet);
  if (maxD > last + 1 && outer.length === 0) warnings.push("No room outside the orbits for a jump point.");

  return { cells, paths, warnings };
}

/** Order hexes on a ring by angle around the centre, so arcs are contiguous. */
function sortAround(hexes: [number, number][], center: [number, number], grid: ProcGrid): [number, number][] {
  const [cx, cy] = hexCenter(center[0], center[1], grid.orientation, grid.stagger);
  const angle = (h: [number, number]) => {
    const [px, py] = hexCenter(h[0], h[1], grid.orientation, grid.stagger);
    return Math.atan2(py - cy, px - cx);
  };
  return [...hexes].sort((a, b) => angle(a) - angle(b));
}
