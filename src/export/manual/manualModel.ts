/**
 * Data for a printed hexcrawl manual (gazetteer): everything the HTML builder
 * needs, already read from the vault. Text fields hold HTML rendered from the
 * note's markdown (links, emphasis, lists), never raw user markdown.
 */

export interface ManualLegendEntry {
  name: string;
  color: string;
  /** Data URI of the terrain icon, if any. */
  iconUri?: string;
  iconTint?: string;
  hexCount: number;
}

export interface ManualPathType {
  name: string;
  color: string;
  width: number;
  dash?: string;
  count: number;
}

export interface ManualLinks {
  towns: string[];
  dungeons: string[];
  features: string[];
  quests: string[];
  factions: string[];
}

/** One keyed hex: a hex with something worth printing beyond its terrain. */
export interface ManualHex {
  /** "0712" */
  number: string;
  /** The note's own coordinates, for finding it in Obsidian. */
  x: number;
  y: number;
  /** The hex's own name (map note), if it has one. */
  name?: string;
  terrain: string;
  terrainColor?: string;
  region?: string;
  /** Rendered HTML per text section ("" when empty). */
  landmark: string;
  description: string;
  hidden: string;
  secret: string;
  weather: string;
  hooks: string;
  links: ManualLinks;
}

export interface ManualSection {
  label: string;
  /** "0101–1306" */
  range: string;
  mapUri: string;
  hexes: ManualHex[];
}

export interface ManualTable {
  name: string;
  /** "d8", "d100", or "" for weighted tables shown as percentages. */
  die: string;
  rows: { roll: string; result: string }[];
  /** Hex count that link to this table. */
  usedBy: number;
}

export interface ManualFaction {
  name: string;
  hexCount: number;
  regions: string[];
}

export interface ManualIndexEntry {
  name: string;
  hexes: string[];
}

export interface ManualData {
  title: string;
  /** Plugin version, e.g. "1.5.6". */
  version: string;
  /** ISO date. */
  date: string;
  hexCount: number;
  keyedCount: number;
  /** Player version: hidden and secret text left out. */
  player: boolean;
  numberDigits: number;
  overviewMapUri: string;
  legend: ManualLegendEntry[];
  paths: ManualPathType[];
  tables: ManualTable[];
  factions: ManualFaction[];
  regions: { name: string; hexCount: number }[];
  sections: ManualSection[];
  index: { category: string; entries: ManualIndexEntry[] }[];
  /** Front/back matter the user left out of this handout. */
  omit?: ManualPart[];
}

/** Optional parts of the manual (the title page and hex key always print). */
export type ManualPart = "legend" | "tables" | "factions" | "index";

export const MANUAL_PARTS: { key: ManualPart; label: string }[] = [
  { key: "legend", label: "Map legend" },
  { key: "tables", label: "Encounter tables" },
  { key: "factions", label: "Factions and regions" },
  { key: "index", label: "Index" },
];
