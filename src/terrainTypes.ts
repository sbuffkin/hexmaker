import type { MapKind } from "./mapKinds";

/**
 * Terrain types: a fixed vocabulary every palette terrain can be tagged
 * with ("dark forest" → forest, "glass desert" → desert). Unlike the free
 * text `category` (a picker grouping the user owns), types have meaning
 * the plugin can rely on — generators place terrain by type, the hex table
 * filters by type — so custom names keep working everywhere.
 */

/**
 * Type groups: broad families of terrain types. Defaults that should hold
 * for any palette (custom ones too) hang off a group rather than terrain
 * names, e.g. the whole water group is impassable to roads (PA4).
 */
export type TerrainGroup = "water" | "land" | "space";

export const TERRAIN_GROUPS: { id: TerrainGroup; label: string }[] = [
  { id: "water", label: "Water" },
  { id: "land", label: "Land" },
  { id: "space", label: "Space" },
];

export interface TerrainTypeInfo {
  id: string;
  label: string;
  kind: MapKind;
  /** Type group (water types, land types, space types). */
  group: TerrainGroup;
  /** Lower-case words that suggest this type in a terrain's name. */
  keywords: string[];
}

type TypeDef = Omit<TerrainTypeInfo, "group"> & { group?: TerrainGroup };

const TYPE_DEFS: TypeDef[] = [
  // World — water
  { id: "deep-water", label: "Deep water", kind: "world", group: "water", keywords: ["trench", "abyss", "deep"] },
  { id: "water", label: "Water", kind: "world", group: "water", keywords: ["ocean", "sea", "water", "lake", "river"] },
  { id: "shallows", label: "Shallows", kind: "world", group: "water", keywords: ["shallow", "reef", "shoal"] },
  { id: "coast", label: "Coast", kind: "world", keywords: ["beach", "coast", "shore", "salt flat", "sand"] },
  // World — land
  { id: "grassland", label: "Grassland", kind: "world", keywords: ["grass", "plain", "meadow", "steppe", "prairie", "savanna", "field", "farm"] },
  { id: "forest", label: "Forest", kind: "world", keywords: ["forest", "wood", "evergreen", "pine", "taiga", "grove"] },
  { id: "jungle", label: "Jungle", kind: "world", keywords: ["jungle", "rainforest"] },
  { id: "wetland", label: "Wetland", kind: "world", keywords: ["swamp", "marsh", "bog", "fen", "mire"] },
  { id: "hills", label: "Hills", kind: "world", keywords: ["hill", "highland", "downs"] },
  { id: "mountains", label: "Mountains", kind: "world", keywords: ["mountain", "cliff", "ridge", "crag"] },
  { id: "peaks", label: "Peaks", kind: "world", keywords: ["peak", "summit", "alpine"] },
  { id: "snow", label: "Snow / ice", kind: "world", keywords: ["snow", "ice", "glacier", "tundra", "frozen"] },
  { id: "desert", label: "Desert", kind: "world", keywords: ["desert", "dune", "cactus", "arid"] },
  { id: "badlands", label: "Badlands", kind: "world", keywords: ["badland", "brokenland", "waste", "canyon", "mesa"] },
  { id: "volcanic", label: "Volcanic", kind: "world", keywords: ["volcan", "lava", "ash", "magma"] },
  { id: "settlement", label: "Settlement", kind: "world", keywords: ["urban", "city", "town", "village", "ruin"] },
  // Space. The generators place by type (Orbits puts moons beside planets
  // and a jump point past the last orbit), so each of those roles has its
  // own type instead of being told apart by name.
  { id: "void", label: "Void / empty space", kind: "space", keywords: ["void", "empty space", "deep space"] },
  { id: "jump-limit", label: "Jump limit (ring)", kind: "space", keywords: ["jump limit"] },
  { id: "nebula", label: "Nebula / cloud", kind: "space", keywords: ["nebula", "dust", "cloud"] },
  { id: "rift", label: "Rift", kind: "space", keywords: ["rift"] },
  { id: "star", label: "Star", kind: "space", keywords: ["star", "sun", "dwarf", "giant star"] },
  { id: "star-system", label: "Star system (sector marker)", kind: "space", keywords: ["star system"] },
  { id: "world", label: "World / planet", kind: "space", keywords: ["world", "planet"] },
  { id: "moon", label: "Moon", kind: "space", keywords: ["moon", "satellite"] },
  { id: "gas-giant", label: "Gas giant", kind: "space", keywords: ["gas giant", "ice giant"] },
  { id: "asteroids", label: "Asteroid belt", kind: "space", keywords: ["asteroid", "belt", "meteor"] },
  { id: "comet", label: "Comet", kind: "space", keywords: ["comet"] },
  { id: "debris", label: "Debris field", kind: "space", keywords: ["debris", "wreck"] },
  { id: "station", label: "Station", kind: "space", keywords: ["station", "outpost"] },
  { id: "starport", label: "Starport", kind: "space", keywords: ["starport", "spaceport", "port"] },
  { id: "jump-point", label: "Jump point / gate", kind: "space", keywords: ["jump point", "gate"] },
  { id: "anomaly", label: "Anomaly / hazard", kind: "space", keywords: ["anomaly", "black hole", "radiation", "hazard"] },
];

/** Every type; ones without an explicit group are land (world) or space. */
export const TERRAIN_TYPES: TerrainTypeInfo[] = TYPE_DEFS.map((t) => ({
  ...t,
  group: t.group ?? (t.kind === "space" ? "space" : "land"),
}));

const BY_ID = new Map(TERRAIN_TYPES.map((t) => [t.id, t]));

export function terrainTypeInfo(id: string | undefined): TerrainTypeInfo | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** The group of a terrain type, or undefined for an unknown / unset type. */
export function terrainTypeGroup(id: string | undefined): TerrainGroup | undefined {
  return terrainTypeInfo(id)?.group;
}

/** The type ids in a group, in list order. */
export function typesInGroup(group: TerrainGroup): string[] {
  return TERRAIN_TYPES.filter((t) => t.group === group).map((t) => t.id);
}

/**
 * The type a terrain counts as: its own Type when that is a known type id,
 * else none. Behaviour never guesses from the name (an untyped "Black
 * Lake" is not water): the Type column is the one place that says what a
 * terrain is, so what the palette editor shows is what the plugin does.
 * Name guesses (inferTerrainType) only fill the Type column as a visible
 * suggestion: the one-time seeding of old palettes, the editor's "Guess
 * types from names" button, and a new terrain's name.
 */
export function effectiveTerrainType(t: { type?: string }): string | undefined {
  return isTerrainType(t.type) ? t.type : undefined;
}

/**
 * A terrain type as typed by a person in a palette note: an id in any case
 * ("Deep-Water"), a label ("Deep water", "Snow / ice", "snow"), or the id
 * with spaces ("deep water"). Returns the id, or undefined if none matches.
 */
export function normalizeTerrainType(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return undefined;
  const dashed = v.replace(/[\s_]+/g, "-");
  for (const t of TERRAIN_TYPES) {
    const label = t.label.toLowerCase();
    if (t.id === v || t.id === dashed || label === v || label.split(/\s*\/\s*/).includes(v)) return t.id;
  }
  return undefined;
}

export function isTerrainType(id: string | undefined): boolean {
  return !!id && BY_ID.has(id);
}

/**
 * Best-guess type from a terrain's name (and category as a fallback),
 * e.g. "dark forest" → forest, "forested hills" → hills. Longest keyword
 * wins so "gas giant" beats "giant star" and "mountains snow" picks
 * mountains over snow only if that keyword is longer. Returns undefined
 * when nothing matches.
 */
export function inferTerrainType(name: string, category?: string, kind?: MapKind): string | undefined {
  const scan = (text: string): string | undefined => {
    const t = text.toLowerCase();
    let best: { id: string; len: number; pos: number } | undefined;
    for (const type of TERRAIN_TYPES) {
      if (kind && type.kind !== kind) continue;
      for (const kw of type.keywords) {
        const pos = t.lastIndexOf(kw);
        if (pos < 0) continue;
        // Prefer the keyword nearest the end ("forested hills" is hills),
        // then the longest.
        const end = pos + kw.length;
        if (!best || end > best.pos || (end === best.pos && kw.length > best.len)) {
          best = { id: type.id, len: kw.length, pos: end };
        }
      }
    }
    return best?.id;
  };
  return scan(name) ?? (category ? scan(category) : undefined);
}

/**
 * One-time upgrade for palettes typed before the space roles got their own
 * types (moon, comet, debris, starport, jump point, jump limit, star
 * system). Back then Orbits and Star scatter told those apart by name
 * inside a coarser type; this turns the same name rule into the terrain's
 * Type once, so from then on the Type column alone decides (and can be
 * changed). Returns the refined type, or undefined to leave it as is.
 */
export function refinedSpaceType(t: { name: string; type?: string }): string | undefined {
  const n = t.name;
  switch (t.type) {
    case "world": return /\bmoons?\b|satellite/i.test(n) ? "moon" : undefined;
    case "asteroids":
      if (/comet/i.test(n)) return "comet";
      return /debris|wreck/i.test(n) ? "debris" : undefined;
    case "station":
      if (/jump|gate/i.test(n)) return "jump-point";
      return /port/i.test(n) ? "starport" : undefined;
    case "void": return /limit/i.test(n) ? "jump-limit" : undefined;
    case "star": return /system/i.test(n) ? "star-system" : undefined;
    default: return undefined;
  }
}
