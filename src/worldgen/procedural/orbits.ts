import { hexCenter, mulberry32 } from "../../../packages/hex-wfc/src";
import type { TerrainColor } from "../../types";
import { effectiveTerrainType, normalizeTerrainType } from "../../terrainTypes";
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
} from "./common";
import { ZONE_ROLES, readCount, roleOdds, roleValueOdds, rollRole, rollRoleEach, rollRoleValue, type TableSource } from "../tableRoles";
import { ORBIT_ZONES, orbitZone } from "../../space/worldTypes";

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
 *
 * How many moons each planet gets, and the system's extras (starport,
 * station, jump point, comet), are rolled on the Moons and System extras
 * roles: the shipped tables (src/modules/space/tables, today's odds) unless
 * a map or setup names its own (T12). An extra's Result is a terrain or a
 * terrain type (the palette's first terrain of that type), so the shipped
 * table works on any palette.
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
  const bodyType = new Map(terrains.map((t) => [t.name, effectiveTerrainType(t)]));
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
  const first = 2;
  const last = Math.max(first, fullRing);
  const skip = options.bodies === "few" ? 0.45 : options.bodies === "crowded" ? 0.05 : 0.2;
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
    // Moons sit on free hexes next to their planet, as many as the Moons
    // table says for the planet's type (shipped: giants often one or two,
    // rocky worlds sometimes one).
    if (roles.moon) {
      const rolled = rollRoleValue(tables, "moons", { rand, type: bodyType.get(body), zone, ring: d, star });
      let moons = readCount(rolled) ?? 0;
      if (rolled && readCount(rolled) === undefined) notes.add(`Moons: "${rolled.value}" isn't a number of moons, so none.`);
      const free = hexes.filter((h) => distance(h, pos, grid) === 1 && isFree(h));
      for (; moons > 0 && free.length; moons--) {
        set(free.splice(Math.floor(rand() * free.length), 1)[0], roles.moon);
        moonCount++;
      }
    }
  }

  // The description promises moons: a system with a planet always gets at
  // least one (round 7: a generated system had none), unless the Moons
  // table never gives one to any planet here. Giants first, then the other
  // planets, in a seeded order; the first with a free neighbour.
  const canHaveMoons = (body: string) => roleValueOdds(tables, "moons", { type: bodyType.get(body), star })
    .some((o) => o.odds > 0 && (readCount(o) ?? 0) > 0);
  if (roles.moon && moonCount === 0 && planets.length && planets.some((p) => canHaveMoons(p.body))) {
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

  // System extras, each on its own Chance: beside the mainworld (or the
  // first body if none was habitable), or out past the last orbit.
  const anchor = mainworld ?? hexes.find((h) => roles.bodies.includes(cells.get(cellKey(h[0], h[1]))!));
  const isBackground = (h: [number, number]) => cells.get(cellKey(h[0], h[1])) === roles.background;
  const spots = {
    beside: () => (anchor ? hexes.filter((h) => distance(h, anchor, grid) === 1 && isBackground(h)) : []),
    outside: () => hexes.filter((h) => (dist.get(cellKey(h[0], h[1])) ?? 0) > last && isBackground(h)),
  };
  for (const extra of rollRoleEach(tables, "system-extras", { rand, star })) {
    if (extra.kind === "nothing") continue;
    const terrain = terrainOrType(extra.value, terrains);
    if (!terrain) {
      // A terrain type the palette has no terrain of is skipped quietly (no comets on this palette).
      if (!normalizeTerrainType(extra.value)) notes.add(`System extras: "${extra.value}" isn't a terrain or terrain type of this palette, so it isn't placed.`);
      continue;
    }
    const where = extraWhere(extra.attrs);
    if (!where) notes.add(`System extras: Where "${extra.attrs.Where ?? ""}" should be beside mainworld or outside; ${terrain} goes outside.`);
    const free = spots[where ?? "outside"]();
    if (free.length) set(free[Math.floor(rand() * free.length)], terrain);
    else if ((where ?? "outside") === "outside" && maxD > last + 1) warnings.push(`No room outside the orbits for ${terrain}.`);
  }
  for (const n of notes) if (!warnings.includes(n)) warnings.push(n);

  return { cells, paths, warnings };
}

/**
 * A System extras result as a palette terrain: a terrain of that name (any
 * case), else the first terrain of the terrain type it names ("jump point"
 * → the palette's jump-point terrain). Undefined when neither.
 */
export function terrainOrType(value: string, terrains: readonly TerrainColor[]): string | undefined {
  const v = value.trim().toLowerCase();
  const named = terrains.find((t) => t.name.trim().toLowerCase() === v);
  if (named) return named.name;
  const type = normalizeTerrainType(value);
  return type ? terrains.find((t) => effectiveTerrainType(t) === type)?.name : undefined;
}

/** Where a System extras row goes: its Where cell (blank: outside); undefined when it can't be read. */
export function extraWhere(attrs: Record<string, string>): "beside" | "outside" | undefined {
  const raw = Object.entries(attrs).find(([k]) => k.trim().toLowerCase() === "where")?.[1]?.trim().toLowerCase() ?? "";
  if (raw === "" || /\b(?:outside|outer|past|beyond|edge)\b/.test(raw)) return "outside";
  if (/\b(?:mainworld|beside|near|next)\b/.test(raw)) return "beside";
  return undefined;
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
