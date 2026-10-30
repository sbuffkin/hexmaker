import type { PathAutoRoute, PathRouting, PathType, TerrainPalette } from "../types";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-path-types-explicit",
  from: "1.5.x",
  to: "1.6",
  phase: "palettes",
  change: "Path types got every behaviour written out (avoid impassable, auto-route, routing), as they behaved before.",
  recordedBy: "pathTypesExplicit",
};

// MIGRATION ONLY (PA5; also the reader of blank cells in palette notes
// written before then, see pathTypeTable.ts). Before path types carried every behaviour as an
// explicit option, some behaviour followed a type's name: an unset "avoid
// impassable" was no for river-like names, auto-routes wound for them, and a
// blank routing was meander for them. Path types saved by those builds are
// filled in from the same rules, once, so no map changes look. Nothing else
// may call these: at run time every behaviour comes from the type's fields.

const WATERY_PATH = /\b(river|stream|creek|brook|canal|waterway|sea lane|shipping)\b/i;
const RIVER_PATH = /\b(river|stream|creek)s?\b/i;

/** What older builds did for an unset avoid-impassable. */
export function legacyAvoidsImpassable(name: string): boolean {
  return !WATERY_PATH.test(name);
}

/** What older builds' auto-route did: wind for types that cross impassable terrain or are named like a river. */
export function legacyAutoRoute(name: string, avoidImpassable: boolean): PathAutoRoute {
  return !avoidImpassable || RIVER_PATH.test(name) ? "winding" : "direct";
}

/** What older builds read a blank routing cell as. */
export function legacyRouting(name: string): PathRouting {
  return RIVER_PATH.test(name) ? "meander" : "through";
}

/**
 * Fill the behaviour fields a path type saved by an older build lacks, from
 * the old name rules. Returns true when anything was filled.
 */
export function fillLegacyPathType(pt: Partial<PathType> & { name: string }): boolean {
  let changed = false;
  if (typeof pt.avoidImpassable !== "boolean") {
    pt.avoidImpassable = legacyAvoidsImpassable(pt.name);
    changed = true;
  }
  if (pt.autoRoute !== "direct" && pt.autoRoute !== "winding") {
    pt.autoRoute = legacyAutoRoute(pt.name, pt.avoidImpassable);
    changed = true;
  }
  if (pt.routing !== "through" && pt.routing !== "meander" && pt.routing !== "edge") {
    pt.routing = legacyRouting(pt.name);
    changed = true;
  }
  return changed;
}

/** Fill every palette's (and the old plugin-wide list's) path types. Returns how many were filled. */
export function fillLegacyPathTypes(palettes: TerrainPalette[], legacy?: PathType[]): number {
  let n = 0;
  for (const list of [...palettes.map((p) => p.pathTypes), legacy]) {
    for (const pt of list ?? []) if (fillLegacyPathType(pt)) n++;
  }
  return n;
}
