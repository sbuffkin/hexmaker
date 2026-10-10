import { hexCenter, mulberry32 } from "../../../packages/hex-wfc/src";
import type { TerrainColor } from "../../types";
import {
  cellKey,
  centerHex,
  distance,
  findByType,
  findTerrain,
  gridKeys,
  inCategory,
  ofType,
  typeIndex,
  untyped,
  weightedPick,
  type GenerationContext,
  type ProcGrid,
  type ProcOption,
  type ProcPath,
  type ProcResult,
} from "./common";

/**
 * Star-system "orbits": a star at the centre, then one body per orbit ring
 * (hex distance from the star), typed by zone — hot inner rocks, a
 * habitable middle, cold giants outside. Belts fill part of a ring; planets
 * may get moons (the palette's moon terrain) on the hexes beside them —
 * giants more often, and up to two; the mainworld may get a station or starport alongside;
 * a comet and a jump point sit out past the last orbit.
 *
 * Works on any palette with a background (type void, or "void" / "empty
 * space" / first `space` terrain) and at least one star and one body — by
 * type (star; world / gas-giant / asteroids), else by name or the `stars`
 * / `bodies` categories.
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

const ZONE_WEIGHTS: Record<Zone, Record<string, number>> = {
  inner: { "molten planet": 4, "rocky planet": 4, "desert planet": 2, "asteroid belt": 0.5 },
  habitable: { "terrestrial planet": 4, "ocean planet": 3, "desert planet": 3, "rocky planet": 2, "asteroid belt": 1 },
  outer: { "gas giant": 4, "ice giant": 3, "ice planet": 3, "asteroid belt": 1.5, "rocky planet": 1 },
};

const BODY_NAMES = [
  "terrestrial planet", "ocean planet", "desert planet", "ice planet", "rocky planet",
  "molten planet", "gas giant", "ice giant", "asteroid belt",
];

type Zone = "inner" | "habitable" | "outer";

/**
 * Zone weights for bodies the tables above don't name, by name hint (the
 * type vocabulary is coarse: "world" covers lava rocks and ocean planets
 * alike), else by type.
 */
const ZONE_HINTS: { re: RegExp; w: Record<Zone, number> }[] = [
  { re: /molten|lava|magma|volcan|inferno|ember|cinder|scorch/i, w: { inner: 4, habitable: 0.5, outer: 0.2 } },
  { re: /\bice|frozen|frost|snow|glacier|\bcold/i, w: { inner: 0.2, habitable: 0.5, outer: 3 } },
  { re: /ocean|water|garden|terra|earth|jungle|green|eden|haven/i, w: { inner: 0.5, habitable: 4, outer: 0.3 } },
  { re: /desert|arid|dune|dust|sand/i, w: { inner: 2, habitable: 3, outer: 0.5 } },
  { re: /\brock|barren|stone/i, w: { inner: 4, habitable: 2, outer: 1 } },
];
const ZONE_TYPE_WEIGHTS: Record<string, Record<Zone, number>> = {
  world: { inner: 2, habitable: 3, outer: 1 },
  "gas-giant": { inner: 0.3, habitable: 0.5, outer: 4 },
  asteroids: { inner: 0.5, habitable: 1, outer: 1.5 },
};

/** Typed bodies that never take an orbit of their own. */
const MOON = /\bmoons?\b|satellite/i;
const COMET = /comet/i;
const DEBRIS = /debris|wreck/i;

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
  /** Bodies drawn as an arc of their ring (asteroid-type bodies, belts). */
  belts: string[];
  /** Bodies that may get a moon (gas-giant type, or "giant" in the name). */
  giants: string[];
  /** Per-zone body weights (lower-case names) for weightedPick. */
  zoneWeights: Record<Zone, Record<string, number>>;
}

/**
 * Roles by type first — void, star, world / gas-giant / asteroids, station
 * — split by name hints where the type is coarse (moon vs planet, comet vs
 * belt, starport vs jump point); untyped terrains fall back to the
 * category and exact-name lookups.
 */
export function orbitRoles(terrains: TerrainColor[]): OrbitRoles | undefined {
  const loose = untyped(terrains);
  // "jump limit" is void-typed too, but it is a marker, not the background.
  const background = findByType(terrains.filter((t) => !/limit/i.test(t.name)), ["void"], ["void", "empty space", "deep space", "space"])
    ?? findTerrain(loose, ["void", "empty space", "deep space", "space"], "space");
  // A sector's "star system" marker is star-typed but isn't a star.
  let stars = [...ofType(terrains, ["star"]).filter((s) => !/system/i.test(s)), ...inCategory(loose, "stars")];
  if (stars.length === 0) {
    const s = findTerrain(loose, ["yellow star", "star", "sun"]);
    stars = s ? [s] : [];
  }
  const typedBodies = ofType(terrains, ["world", "gas-giant", "asteroids"]);
  let bodies = [
    ...typedBodies.filter((b) => !MOON.test(b) && !COMET.test(b) && !DEBRIS.test(b)),
    ...inCategory(loose, "bodies").filter((b) => !/^(moon|comet)$/i.test(b)),
  ];
  if (bodies.length === 0) bodies = loose.map((t) => t.name).filter((n) => BODY_NAMES.includes(n.toLowerCase()));
  if (!background || stars.length === 0 || bodies.length === 0) return undefined;
  const types = typeIndex(terrains);
  const exact = (n: string) => findTerrain(loose, [n]);
  const station = (want: RegExp | undefined, avoid: RegExp | undefined, prefer: string[]) =>
    findByType(terrains.filter((t) => (!want || want.test(t.name)) && !avoid?.test(t.name)), ["station"], prefer);
  const belts = bodies.filter((b) => types.get(b.toLowerCase()) === "asteroids" || /belt/i.test(b));
  return {
    background,
    stars,
    bodies,
    moon: findByType(terrains.filter((t) => MOON.test(t.name)), ["world"], ["moon"]) ?? exact("moon"),
    comet: findByType(terrains.filter((t) => COMET.test(t.name)), ["asteroids"], ["comet"]) ?? exact("comet"),
    station: station(undefined, /port|jump|gate/i, ["space station", "station"]) ?? exact("space station"),
    starport: station(/port/i, undefined, ["starport"]) ?? exact("starport"),
    jumpPoint: station(/jump|gate/i, undefined, ["jump point"]) ?? exact("jump point"),
    jumpLimit: findByType(terrains.filter((t) => /limit/i.test(t.name)), ["void"], ["jump limit"]) ?? exact("jump limit"),
    belt: belts[0],
    belts,
    giants: bodies.filter((b) => types.get(b.toLowerCase()) === "gas-giant" || /giant/i.test(b)),
    zoneWeights: {
      inner: zoneWeights(bodies, types, "inner"),
      habitable: zoneWeights(bodies, types, "habitable"),
      outer: zoneWeights(bodies, types, "outer"),
    },
  };
}

/**
 * Weights for one zone. The shipped body names keep their table weights
 * (0.5 when the zone doesn't list them); other names go by hint, then type.
 */
function zoneWeights(bodies: string[], types: Map<string, string>, zone: Zone): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bodies) {
    const k = b.toLowerCase();
    if (BODY_NAMES.includes(k)) {
      out[k] = ZONE_WEIGHTS[zone][k] ?? 0.5;
      continue;
    }
    const type = types.get(k);
    // Giants go by type first: "ice giant" belongs outside, not with ice planets.
    const w = (type === "gas-giant" ? ZONE_TYPE_WEIGHTS[type] : undefined)
      ?? ZONE_HINTS.find((h) => h.re.test(b))?.w
      ?? ZONE_TYPE_WEIGHTS[type ?? ""];
    if (w) out[k] = w[zone];
  }
  return out;
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
  /** The sector hex this system sits in: its terrain picks the mainworld. */
  context?: GenerationContext,
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
  // The sector says what the mainworld is ("ocean world" → an ocean planet
  // in the habitable zone); that orbit is never skipped.
  const mainBody = mainworldFor(context?.parent?.terrain, roles.bodies);
  const mainRing = mainBody ? first + Math.round(0.45 * (last - first)) : -1;
  /** Planets placed (not belts), for the moon guarantee below. */
  const planets: { pos: [number, number]; body: string }[] = [];
  let moonCount = 0;
  for (let d = first; d <= last; d++) {
    if (d !== mainRing && rand() < skip) continue;
    // Draw the orbit itself: the ring, in order around the star, closed.
    if (orbitPathType) {
      const around = sortAround(ring(d), center, grid).map((h) => cellKey(h[0], h[1]));
      if (around.length > 2) paths.push({ type: orbitPathType, hexes: [...around, around[0]] });
    }
    const t = (d - first) / Math.max(1, last - first);
    const zone = t < 0.3 ? "inner" : t < 0.6 ? "habitable" : "outer";
    const body = d === mainRing ? mainBody! : weightedPick(rand, roles.bodies, roles.zoneWeights[zone], 0.5)!;
    const hexesOnRing = ring(d);
    if (hexesOnRing.length === 0) continue;
    // A moon from the orbit inside may sit on this ring: leave it be.
    const isFree = (h: [number, number]) => cells.get(cellKey(h[0], h[1])) === roles.background;
    if (roles.belts.includes(body)) {
      // Belts sweep an arc of the ring rather than sitting on one hex.
      const start = Math.floor(rand() * hexesOnRing.length);
      const span = Math.max(2, Math.floor(hexesOnRing.length * (0.3 + rand() * 0.4)));
      const sorted = sortAround(hexesOnRing, center, grid);
      for (let i = 0; i < span; i++) {
        const h = sorted[(start + i) % sorted.length];
        if (isFree(h)) set(h, body);
      }
      if (d === mainRing) mainworld = sorted[start];
      continue;
    }
    const open = hexesOnRing.filter(isFree);
    const choices = open.length ? open : hexesOnRing;
    const pos = choices[Math.floor(rand() * choices.length)];
    set(pos, body);
    planets.push({ pos, body });
    if (d === mainRing) mainworld = pos;
    else if (zone === "habitable" && !mainworld && mainRing < 0) mainworld = pos;
    // Moons sit on free hexes next to their planet: giants often have one
    // or two, rocky worlds sometimes one.
    if (roles.moon) {
      const giant = roles.giants.includes(body);
      let moons = rand() < (giant ? 0.7 : 0.3) ? 1 : 0;
      if (giant && moons && rand() < 0.35) moons++;
      const free = hexes.filter((h) => distance(h, pos, grid) === 1 && isFree(h));
      for (; moons > 0 && free.length; moons--) {
        set(free.splice(Math.floor(rand() * free.length), 1)[0], roles.moon);
        moonCount++;
      }
    }
  }

  // The description promises moons: a system with a planet always gets at
  // least one (round 7: a generated system had none). Giants first, then
  // the other planets, in a seeded order; the first with a free neighbour.
  if (roles.moon && moonCount === 0 && planets.length) {
    const giants = planets.filter((p) => roles.giants.includes(p.body));
    const pool = giants.length ? giants : planets;
    const start = Math.floor(rand() * pool.length);
    const tryOrder = [...pool.slice(start), ...pool.slice(0, start), ...planets.filter((p) => !pool.includes(p))];
    for (const { pos } of tryOrder) {
      const free = hexes.filter((h) => distance(h, pos, grid) === 1
        && cells.get(cellKey(h[0], h[1])) === roles.background);
      if (!free.length) continue;
      set(free[Math.floor(rand() * free.length)], roles.moon);
      break;
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

/** Parent-terrain words → body-name words, most specific first. */
const MAINWORLD_HINTS: [string, string][] = [
  ["gas giant", "gas giant"],
  ["ice giant", "ice giant"],
  ["asteroid", "belt"],
  ["ocean", "ocean"],
  ["water", "ocean"],
  ["garden", "terrestrial"],
  ["terrestrial", "terrestrial"],
  ["earth", "terrestrial"],
  ["desert", "desert"],
  ["ice", "ice"],
  ["frozen", "ice"],
  ["molten", "molten"],
  ["lava", "molten"],
  ["barren", "rocky"],
  ["rocky", "rocky"],
];

/** The body that should be the system's mainworld, given the sector hex's terrain name. */
export function mainworldFor(parentTerrain: string | undefined, bodies: string[]): string | undefined {
  if (!parentTerrain) return undefined;
  const p = parentTerrain.toLowerCase();
  for (const [from, to] of MAINWORLD_HINTS) {
    if (!p.includes(from)) continue;
    const hit = bodies.find((b) => b.toLowerCase().includes(to));
    if (hit) return hit;
  }
  return undefined;
}
