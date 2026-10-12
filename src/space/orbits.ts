import { hexCenter, mulberry32 } from "../../packages/hex-wfc/src";
import type { TerrainColor } from "../types";
import {
  cellKey,
  centerHex,
  distance,
  gridKeys,
  ofType,
  type GenerationContext,
  type ProcGrid,
  type ProcOption,
  type ProcPath,
  type ProcResult,
  type TuningDef,
  tuned,
} from "../worldgen/procedural/common";
import { ZONE_ROLES, roleOdds, rollRole, type TableSource } from "../worldgen/tableRoles";
import { ORBIT_ZONES, orbitZone } from "./worldTypes";

/**
 * Star-system "orbits": a star at the centre, then one body per orbit ring
 * (hex distance from the star), typed by zone — hot inner rocks, a
 * habitable middle, cold giants outside. Belts fill part of a ring; planets
 * may get moons (the palette's moon terrain) on the hexes beside them —
 * giants more often, and up to two; the mainworld may get a station or starport alongside;
 * a comet and a jump point sit out past the last orbit.
 *
 * Works on any palette with a background (type void), at least one star
 * (type star) and one body (world / gas-giant / asteroids). Every other
 * role has its own type too — moon, comet, station, starport, jump point,
 * jump limit — so it is the Type column, never a terrain's name, that
 * decides what goes where.
 *
 * Which star, and which body on each orbit, are rolled on the Star and
 * Inner / Habitable / Outer orbits roles (tableRoles.ts): the World types
 * table when one is given, else equal odds over the palette's stars and
 * bodies. The sector hex's row says which body is the mainworld (its
 * Mainworld column). No terrain name is special.
 */

export const ORBITS_ID = "procedural:orbits";

export const ORBITS_OPTIONS: ProcOption[] = [
  {
    key: "star",
    label: "Star",
    // The palette's own stars are added per palette (orbitsOptions).
    choices: [{ value: "random", label: "Random" }],
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

/** Orbits' tuning sliders (setup wizard Advanced). */
export const ORBITS_TUNING: readonly TuningDef[] = [
  { key: "firstOrbit", label: "First orbit", help: "Rings out from the star where the first planet may orbit.", min: 1, max: 4, step: 1, default: 2 },
  { key: "emptyOrbits", label: "More empty orbits", help: "Percentage points added to (or taken from) the chance a ring has no planet.", min: -40, max: 40, step: 5, default: 0 },
  { key: "moons", label: "Moons", help: "Chance a planet (other than a gas giant) has a moon.", min: 0, max: 1, step: 0.05, default: 0.3 },
  { key: "giantMoons", label: "Gas giant moons", help: "Chance a gas giant has a moon.", min: 0, max: 1, step: 0.05, default: 0.7 },
  { key: "beltLength", label: "Belt length", help: "The shortest share of its ring an asteroid belt fills.", min: 0, max: 0.6, step: 0.05, default: 0.3 },
  { key: "station", label: "Station", help: "Chance of a station beside the mainworld.", min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: "comet", label: "Comet", help: "Chance of a comet past the last orbit.", min: 0, max: 1, step: 0.05, default: 0.6 },
];

/**
 * Orbits' options for a palette: the Star choice lists that palette's own
 * stars (star-typed terrains), so it only offers what it can place. With
 * no palette given, only Random.
 */
export function orbitsOptions(terrains?: TerrainColor[]): ProcOption[] {
  if (!terrains) return ORBITS_OPTIONS;
  const stars = ofType(terrains, ["star"]);
  return ORBITS_OPTIONS.map((o) => o.key !== "star" ? o : {
    ...o,
    choices: [{ value: "random", label: "Random" }, ...stars.map((s) => ({ value: s.toLowerCase(), label: s.charAt(0).toUpperCase() + s.slice(1) }))],
  });
}

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
  /** Bodies drawn as an arc of their ring (asteroid-belt type). */
  belts: string[];
  /** Bodies that may get two moons (gas-giant type). */
  giants: string[];
}

/**
 * Roles by terrain type only: void (background), star, world / gas-giant /
 * asteroids (bodies that take an orbit), and one terrain each for moon,
 * comet, station, starport, jump point and jump limit. A terrain's name
 * plays no part, so a custom palette ("Luna" typed moon) works the same as
 * the shipped one, and an untyped terrain is never placed.
 */
export function orbitRoles(terrains: TerrainColor[]): OrbitRoles | undefined {
  const background = ofType(terrains, ["void"])[0];
  const stars = ofType(terrains, ["star"]);
  const bodies = ofType(terrains, ["world", "gas-giant", "asteroids"]);
  if (!background || stars.length === 0 || bodies.length === 0) return undefined;
  const first = (type: string) => ofType(terrains, [type])[0];
  const belts = ofType(terrains, ["asteroids"]);
  return {
    background,
    stars,
    bodies,
    moon: first("moon"),
    comet: first("comet"),
    station: first("station"),
    starport: first("starport"),
    jumpPoint: first("jump-point"),
    jumpLimit: first("jump-limit"),
    belt: belts[0],
    belts,
    giants: ofType(terrains, ["gas-giant"]),
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
  /** The sector hex this system sits in: its row's Mainworld picks the mainworld. */
  context?: GenerationContext,
  /** The role tables (World types); none = equal odds over the palette's stars and bodies, said in the warnings. */
  tables?: TableSource,
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
  const star = wanted ?? rollRole(tables, "star", { rand, where: cellKey(center[0], center[1]) }, roles.stars)?.terrain ?? roles.stars[0];
  set(center, star);
  // The 100-diameter limit hugs the star: mark the first ring.
  if (roles.jumpLimit && fullRing >= 3) for (const h of ring(1)) set(h, roles.jumpLimit);

  // Orbits from ring 2 out to the last full ring.
  const first = Math.max(1, Math.round(tuned(options, "firstOrbit", 2)));
  const last = Math.max(first, fullRing);
  const baseSkip = options.bodies === "few" ? 0.45 : options.bodies === "crowded" ? 0.05 : 0.2;
  const moreEmpty = tuned(options, "emptyOrbits", 0);
  const skip = moreEmpty ? Math.min(1, Math.max(0, baseSkip + moreEmpty / 100)) : baseSkip;
  const warnings: string[] = [];
  // Rows that can't be placed, and roles with no table, are said (never dropped silently).
  const notes = new Set<string>();
  if (!wanted) for (const n of roleOdds(tables, "star", {}, roles.stars).notes) notes.add(n);
  for (const z of ORBIT_ZONES) for (const n of roleOdds(tables, ZONE_ROLES[z], { zone: z, star }, roles.bodies).notes) notes.add(n);
  warnings.push(...notes);
  if (fullRing < 2) warnings.push("Map is too small for orbits — try Medium or Large.");
  let mainworld: [number, number] | undefined;
  const paths: ProcPath[] = [];
  // The sector hex's row says what the mainworld is (its Mainworld: "ocean
  // world" → an ocean planet), placed in the habitable zone; that orbit is
  // never skipped.
  const mainBody = mainworldFor(context?.parent?.terrain, roles.bodies, tables);
  const mainRing = mainBody ? first + Math.round(0.45 * (last - first)) : -1;
  /** Planets placed (not belts), for the moon guarantee below. */
  const planets: { pos: [number, number]; body: string }[] = [];
  let moonCount = 0;
  for (let d = first; d <= last; d++) {
    if (d !== mainRing && rand() < skip) continue;
    const zone = orbitZone(d, first, last);
    const pick = d === mainRing ? { terrain: mainBody! } : rollRole(tables, ZONE_ROLES[zone], { rand, zone, ring: d, star }, roles.bodies);
    // A (nothing) row: an empty orbit.
    if (!pick?.terrain) continue;
    const body = pick.terrain;
    // Draw the orbit itself: the ring, in order around the star, closed.
    if (orbitPathType) {
      const around = sortAround(ring(d), center, grid).map((h) => cellKey(h[0], h[1]));
      if (around.length > 2) paths.push({ type: orbitPathType, hexes: [...around, around[0]] });
    }
    const hexesOnRing = ring(d);
    if (hexesOnRing.length === 0) continue;
    // A moon from the orbit inside may sit on this ring: leave it be.
    const isFree = (h: [number, number]) => cells.get(cellKey(h[0], h[1])) === roles.background;
    if (roles.belts.includes(body)) {
      // Belts sweep an arc of the ring rather than sitting on one hex.
      const start = Math.floor(rand() * hexesOnRing.length);
      const span = Math.max(2, Math.floor(hexesOnRing.length * (tuned(options, "beltLength", 0.3) + rand() * 0.4)));
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
      let moons = rand() < (giant ? tuned(options, "giantMoons", 0.7) : tuned(options, "moons", 0.3)) ? 1 : 0;
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
    if (roles.station && free.length && rand() < tuned(options, "station", 0.5)) set(pickFree(), roles.station);
  }

  // Out past the last orbit: a jump point and maybe a comet.
  const outer = hexes.filter((h) => (dist.get(cellKey(h[0], h[1])) ?? 0) > last
    && cells.get(cellKey(h[0], h[1])) === roles.background);
  const takeOuter = () => outer.splice(Math.floor(rand() * outer.length), 1)[0];
  if (roles.jumpPoint && outer.length) set(takeOuter(), roles.jumpPoint);
  if (roles.comet && outer.length && rand() < tuned(options, "comet", 0.6)) set(takeOuter(), roles.comet);
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

/**
 * The body that should be the system's mainworld: the Mainworld of the
 * sector hex's row in the tables ("ocean world" → "ocean planet"), else
 * the sector terrain itself; only when it is one of the palette's bodies.
 * Data, not names: nothing here knows what an ocean is.
 */
export function mainworldFor(parentTerrain: string | undefined, bodies: string[], tables?: TableSource): string | undefined {
  if (!parentTerrain?.trim()) return undefined;
  const want = tables?.rowAttrs("sector-hexes", parentTerrain)?.Mainworld?.trim() || parentTerrain.trim();
  return bodies.find((b) => b.toLowerCase() === want.toLowerCase());
}
