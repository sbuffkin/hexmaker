/**
 * Orbit zones of a star system (Orbits' rule) and the reader for an Orbit
 * cell ("inner, habitable", "2–4"). Pure.
 */

import { readIntRange, type IntRange } from "../../worldgen/cellReaders";

export type OrbitZone = "inner" | "habitable" | "outer";
export const ORBIT_ZONES: readonly OrbitZone[] = ["inner", "habitable", "outer"];

/**
 * The orbit zone of ring `d` when orbits run from ring `first` to `last`:
 * the first 30% inner, up to 60% habitable, the rest outer (Orbits' rule).
 */
export function orbitZone(d: number, first: number, last: number): OrbitZone {
  const t = (d - first) / Math.max(1, last - first);
  return t < 0.3 ? "inner" : t < 0.6 ? "habitable" : "outer";
}

const ZONE_ALIASES: Record<string, OrbitZone> = {
  inner: "inner", hot: "inner", close: "inner",
  habitable: "habitable", hab: "habitable", middle: "habitable", mid: "habitable", goldilocks: "habitable",
  outer: "outer", cold: "outer", far: "outer",
};

/** "inner, habitable", "2–4", "habitable, 3-5" → zones and/or a ring band. */
export function readOrbit(raw: string): { zones?: OrbitZone[]; distance?: IntRange } | undefined {
  const t = raw.trim().toLowerCase();
  if (!t || t === "any") return {};
  const out: { zones?: OrbitZone[]; distance?: IntRange } = {};
  for (const tok of t.split(/\s*[,;/]\s*|\s+and\s+/).filter((p) => p !== "")) {
    const z = ZONE_ALIASES[tok.replace(/\s*zone$/, "")];
    if (z) {
      out.zones = [...(out.zones ?? []).filter((x) => x !== z), z];
      continue;
    }
    const d = readIntRange(tok.replace(/^(?:rings?|distance)\s*/, ""));
    if (!d || out.distance) return undefined;
    out.distance = d;
  }
  if (out.zones) out.zones = ORBIT_ZONES.filter((z) => out.zones!.includes(z));
  return out;
}

