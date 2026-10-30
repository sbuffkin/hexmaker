/**
 * Realms of influence (plan-hf6-generator-realms, HF8 step 3): an explored
 * map's terrain comes from generators, each with a realm around its centre.
 * The first realm is "home", centred on the party's start; more can lie
 * near, far or really far in one of the six hex directions. Each hex is
 * rolled on one realm's flower (a flower made from that generator's terrain
 * shares, realmFlowers.ts), picked by the realms' influence there:
 *
 *   w_r(p) = exp(−k · (d(p, c_r) / D_r)²), normalised over the realms
 *
 * with D_r from the reach (near 8, far 15, really far 30, home and here 10),
 * k from the borders (narrow 6, normal 3.5, wide 2; the overworld blend's
 * widths) and a light warp of d that depends on position only, so borders
 * aren't straight lines. Everything is seeded by position: coming back to an
 * area always gives the realm it had.
 *
 * In the map note:
 *
 *   explore-realms:
 *     - "Overland: procedural:overland at 10_10, home"
 *     - "Coastal fjord: builtin:biome-coastal-fjord at 21_2, far"
 *     - "Fen: [[generators/swamp]] 2 + [[generators/taiga]] 1 at 4_18, near"
 *   explore-blend: normal          (narrow | normal | wide | sharp)
 *   explore-with: ["(realms) -> terrain"]
 *
 * A source is a generator id (procedural:…, builtin:…) or a link to a
 * generator note; a number after it is its weight in a blend. Lines that
 * can't be read are kept as they are (parseRealms reports them).
 *
 * Pure: no Obsidian imports.
 */

import { fromAxial, hexCenter, hexDistance, toAxial } from "../../packages/hex-wfc/src/grid";
import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import { hashSeed } from "../arrival/arrival";
import { bearingWord } from "../maps/compass";
import { hexKey, hexPair } from "../hexKey";

/** The rule source that rolls each hex on its realm's flower. */
export const REALMS_SOURCE = "(realms)";
export const REALMS_RULE = `${REALMS_SOURCE} -> terrain`;

export type Reach = "home" | "here" | "near" | "far" | "really far";
export const REACHES: readonly Reach[] = ["home", "here", "near", "far", "really far"];

/** How far a realm reaches (D_r, in hexes). */
export const REACH_RADIUS: Readonly<Record<Reach, number>> = { home: 10, here: 10, near: 8, far: 15, "really far": 30 };
/** Where a realm's centre goes from the party, in hexes (the owner's "near (5–8), far (10–15), really far (20+)"). */
export const REACH_BAND: Readonly<Record<Reach, readonly [number, number]>> = {
  home: [0, 0], here: [0, 0], near: [5, 8], far: [10, 15], "really far": [20, 30],
};
/** The words for a reach in the setup and the Change area modal. */
export const REACH_LABEL: Readonly<Record<Reach, string>> = {
  home: "Home", here: "Here", near: "Near (5–8 hexes)", far: "Far (10–15 hexes)", "really far": "Really far (20+ hexes)",
};

export type Borders = "narrow" | "normal" | "wide" | "sharp";
/** k per border width (the overworld blend's widths; sharp: the strongest realm always wins). */
export const BORDER_K: Readonly<Record<Exclude<Borders, "sharp">, number>> = { narrow: 6, normal: 3.5, wide: 2 };
/** How much the warp stretches or shrinks a distance (± this share). */
export const REALM_WARP = 0.2;

export interface RealmSource {
  /** A generator id, or a generator note link's target (as written, no brackets). */
  ref: string;
  /** Written as a link ([[…]]). */
  link: boolean;
  weight: number;
}

export interface Realm {
  name: string;
  from: RealmSource[];
  /** Its centre hex ("x_y"; may lie off the map). */
  centre: string;
  reach: Reach;
  /** A flower note to roll on instead of one made from the generators. */
  flower?: string;
}

export interface Geometry {
  orientation: "flat" | "pointy";
  stagger: "odd" | "even";
}

// ── reading and writing ──────────────────────────────────────────────────

const lc = (s: string) => s.trim().toLowerCase();

function parseReach(raw: string): Reach | undefined {
  const t = lc(raw).replace(/\s+/g, " ").replace(/-/g, " ");
  return REACHES.find((r) => r === t);
}

/** One `explore-realms` entry → a realm, or undefined when it can't be read. */
export function parseRealm(raw: string): Realm | undefined {
  const text = String(raw ?? "").trim();
  const m = /^(.+?):\s+(.+?)\s+at\s+(-?\d+)_(-?\d+)\s*(?:,\s*(.*))?$/i.exec(text);
  if (!m) return undefined;
  const name = m[1].trim();
  const from: RealmSource[] = [];
  for (const part of m[2].split(/\s+\+\s+/)) {
    const s = /^(?:\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|([^\s[\]]+))(?:\s+(\d+(?:\.\d+)?))?$/.exec(part.trim());
    if (!s) return undefined;
    const weight = s[3] === undefined ? 1 : Number(s[3]);
    if (!(weight > 0)) return undefined;
    from.push({ ref: (s[1] ?? s[2]).trim(), link: s[1] !== undefined, weight });
  }
  let reach: Reach = "near";
  let flower: string | undefined;
  for (const bit of (m[5] ?? "").split(",").map((b) => b.trim()).filter(Boolean)) {
    const f = /^flower\s+\[\[([^\]|#]+)/i.exec(bit);
    if (f) { flower = f[1].trim(); continue; }
    const r = parseReach(bit);
    if (r) reach = r;
  }
  if (!name || !from.length) return undefined;
  return { name, from, centre: hexKey(Number(m[3]), Number(m[4])), reach, ...(flower ? { flower } : {}) };
}

/** A realm back as its `explore-realms` entry. */
export function formatRealm(r: Realm): string {
  const from = r.from.map((s) => `${s.link ? `[[${s.ref}]]` : s.ref}${s.weight !== 1 ? ` ${s.weight}` : ""}`).join(" + ");
  return `${r.name}: ${from} at ${r.centre}, ${r.reach}${r.flower ? `, flower [[${r.flower}]]` : ""}`;
}

/** Every readable realm of a map, and the entries that couldn't be read (kept as they are). */
export function parseRealms(list: readonly string[] | undefined): { realms: Realm[]; unread: string[] } {
  const realms: Realm[] = [];
  const unread: string[] = [];
  for (const raw of list ?? []) {
    if (!String(raw ?? "").trim()) continue;
    const r = parseRealm(raw);
    if (r) realms.push(r);
    else unread.push(String(raw));
  }
  return { realms, unread };
}

/** `explore-blend` → borders (unset or junk: normal). */
export function parseBorders(raw: string | undefined): Borders {
  const t = lc(raw ?? "");
  return t === "narrow" || t === "wide" || t === "sharp" ? t : "normal";
}

/** A name for a new realm that no other realm has ("Overland", then "Overland 2"). */
export function uniqueRealmName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(lc));
  const clean = base.trim() || "Area";
  if (!used.has(lc(clean))) return clean;
  for (let i = 2; ; i++) if (!used.has(lc(`${clean} ${i}`))) return `${clean} ${i}`;
}

// ── geometry ─────────────────────────────────────────────────────────────

/** One of the six hex sides, by its compass word, at a screen angle (radians, y down). */
export interface Direction {
  word: string;
  angle: number;
}

/** The six directions out of a hex's sides, clockwise from the top. */
export function directions(orientation: "flat" | "pointy"): Direction[] {
  // Flat-top hexes have sides north and south; pointy-top ones east and west.
  const degrees = orientation === "flat" ? [-90, -30, 30, 90, 150, 210] : [-60, 0, 60, 120, 180, 240];
  return degrees.map((d) => {
    const angle = (d * Math.PI) / 180;
    return { word: bearingWord(Math.cos(angle), Math.sin(angle)), angle };
  });
}

/** The direction `word` names (north-east, …), undefined when it isn't a side of these hexes. */
export function directionOf(word: string, orientation: "flat" | "pointy"): Direction | undefined {
  const t = lc(word).replace(/\s+/g, "-");
  return directions(orientation).find((d) => d.word === t);
}

/** Steps between two hexes. */
export function distanceBetween(a: string, b: string, g: Geometry): number {
  return hexDistance(hexPair(a), hexPair(b), g.orientation, g.stagger);
}

/** The hex whose centre is nearest a point of hexCenter's space. */
export function hexNear(px: number, py: number, g: Geometry): string {
  // A first guess from the axial coordinates, then the best of it and its ring.
  const r3 = Math.sqrt(3);
  const [q, r] = g.orientation === "flat"
    ? [px / 1.5, py / r3 - px / 3]
    : [px / r3 - py / 3, py / 1.5];
  const [gx, gy] = fromAxial(Math.round(q), Math.round(r), g.orientation, g.stagger);
  let best = hexKey(gx, gy);
  let bestD = Infinity;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const [cx, cy] = hexCenter(gx + dx, gy + dy, g.orientation, g.stagger);
      const d = (cx - px) ** 2 + (cy - py) ** 2;
      if (d < bestD - 1e-9) { bestD = d; best = hexKey(gx + dx, gy + dy); }
    }
  }
  return best;
}

/** The hex `distance` steps (rounded) from `from` toward screen angle `angle` (radians). */
export function hexToward(from: string, angle: number, distance: number, g: Geometry): string {
  const [x, y] = hexPair(from);
  const [cx, cy] = hexCenter(x, y, g.orientation, g.stagger);
  const steps = Math.round(distance);
  // Neighbouring centres are √3 apart in hexCenter's space; off the hex axes
  // a straight line takes more steps than its length, so come back to `steps`.
  let len = distance * Math.sqrt(3);
  let at = hexNear(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, g);
  while (len > 0 && distanceBetween(from, at, g) > steps) {
    len -= 0.25;
    at = hexNear(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, g);
  }
  return at;
}

/**
 * Where a new realm's centre goes: in direction `dir` (± 30°) from the
 * party, at a distance in its reach's band, both seeded (`roll` picks again:
 * "Reroll the spot"). Home and here: the party's hex.
 */
export function placeCentre(party: string, dir: Direction | undefined, reach: Reach, seed: number, g: Geometry, roll = 0): string {
  const [lo, hi] = REACH_BAND[reach];
  if (hi <= 0 || !dir) return party;
  const rand = mulberry32(hashSeed(seed >>> 0, party, "realm-centre", dir.word, reach, roll));
  const angle = dir.angle + (rand() * 2 - 1) * (Math.PI / 6);
  const distance = lo + rand() * (hi - lo);
  return hexToward(party, angle, distance, g);
}

// ── influence ────────────────────────────────────────────────────────────

function hash01(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise in [−1, 1] over hex positions (a few hexes across), by seed. */
function warpNoise(seed: number, x: number, y: number): number {
  const s = 0.25;
  const fx = x * s, fy = y * s;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const u = fx - x0, v = fy - y0;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const a = hash01(seed, x0, y0), b = hash01(seed, x0 + 1, y0);
  const c = hash01(seed, x0, y0 + 1), d = hash01(seed, x0 + 1, y0 + 1);
  const su = sm(u), sv = sm(v);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}

/** Each realm's raw weight at `hex` (0–1, before normalising). */
export function rawInfluence(hex: string, realms: readonly Realm[], g: Geometry, opts: { seed: number; borders?: Borders }): number[] {
  const k = BORDER_K[opts.borders === "sharp" || !opts.borders ? "normal" : opts.borders];
  const [x, y] = hexPair(hex);
  return realms.map((r) => {
    const d = distanceBetween(hex, r.centre, g);
    const warp = 1 + REALM_WARP * warpNoise(hashSeed(opts.seed >>> 0, "realm-warp", lc(r.name)), x, y);
    const t = (d * warp) / REACH_RADIUS[r.reach];
    return Math.exp(-k * t * t);
  });
}

/** Each realm's share of hex `hex` (sums to 1; all equal when every weight is ~0). */
export function influence(hex: string, realms: readonly Realm[], g: Geometry, opts: { seed: number; borders?: Borders }): number[] {
  const raw = rawInfluence(hex, realms, g, opts);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 1e-12)) {
    // Far from every centre: the nearest one.
    const d = realms.map((r) => distanceBetween(hex, r.centre, g));
    const near = d.indexOf(Math.min(...d));
    return realms.map((_, i) => (i === near ? 1 : 0));
  }
  return raw.map((w) => w / sum);
}

/**
 * The realm hex `hex` is rolled on: a seeded pick weighted by influence
 * (borders mix, interiors are pure), or the strongest with sharp borders.
 * A realm's own centre is always that realm (the party starts at home).
 * The same hex always gives the same realm, whatever the walk.
 */
export function realmAt(hex: string, realms: readonly Realm[], g: Geometry, opts: { seed: number; borders?: Borders }): Realm | undefined {
  if (realms.length <= 1) return realms[0];
  const centred = realms.find((r) => r.centre === hex);
  if (centred) return centred;
  const w = influence(hex, realms, g, opts);
  if (opts.borders === "sharp") return realms[w.indexOf(Math.max(...w))];
  let roll = mulberry32(hashSeed(opts.seed >>> 0, hex, "realm"))();
  for (let i = 0; i < realms.length; i++) {
    roll -= w[i];
    if (roll < 0) return realms[i];
  }
  return realms[realms.length - 1];
}

/**
 * Directions a new realm can't go from `party` at `reach`: those where, at
 * the middle of the band, another realm (not home: it's everywhere at the
 * start) already holds most of the land. Each with that realm's name, for
 * the tooltip ("Coastal fjord lies that way"). Here is never blocked.
 */
export function blockedDirections(party: string, reach: Reach, realms: readonly Realm[], g: Geometry, seed: number): Map<string, string> {
  const out = new Map<string, string>();
  const [lo, hi] = REACH_BAND[reach];
  if (hi <= 0) return out;
  const others = realms.filter((r) => r.reach !== "home" && r.reach !== "here");
  if (!others.length) return out;
  for (const d of directions(g.orientation)) {
    const probe = hexToward(party, d.angle, (lo + hi) / 2, g);
    const raw = rawInfluence(probe, others, g, { seed });
    const best = raw.indexOf(Math.max(...raw));
    if (raw[best] > 0.5) out.set(d.word, others[best].name);
  }
  return out;
}

/** "12 hexes north-east of the party" (for the Areas list). */
export function describeCentre(centre: string, from: string, g: Geometry): string {
  const d = distanceBetween(from, centre, g);
  if (d === 0) return "here";
  const [ax, ay] = hexCenter(...hexPair(from), g.orientation, g.stagger);
  const [bx, by] = hexCenter(...hexPair(centre), g.orientation, g.stagger);
  return `${d} hex${d === 1 ? "" : "es"} ${bearingWord(bx - ax, by - ay)}`;
}

/** Axial delta of two hexes (for tests and the debug layer). */
export function axialDelta(a: string, b: string, g: Geometry): [number, number] {
  const [q1, r1] = toAxial(...hexPair(a), g.orientation, g.stagger);
  const [q2, r2] = toAxial(...hexPair(b), g.orientation, g.stagger);
  return [q2 - q1, r2 - r1];
}
