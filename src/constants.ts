import type { TerrainColor, DuckmagePluginSettings } from "./types";

export const VIEW_TYPE_HEX_MAP = "duckmage-hex-map";
export const VIEW_TYPE_HEX_TABLE = "duckmage-hex-table";
export const VIEW_TYPE_RANDOM_TABLES = "duckmage-random-tables";

export const DEFAULT_TERRAIN_PALETTE: TerrainColor[] = [
  // Open
  { name: "grass", color: "#84cc16", icon: "bw-grassland.png" },
  { name: "hills", color: "#a8a29e", icon: "bw-hills.png" },
  // Desert
  { name: "desert", color: "#eab308", icon: "bw-desert.png" },
  { name: "desert rocky", color: "#d97706", icon: "bw-desert-rocky.png" },
  { name: "dunes", color: "#fbbf24", icon: "bw-dunes.png" },
  { name: "cactus", color: "#ca8a04", icon: "bw-cactus.png" },
  { name: "cactus heavy", color: "#b45309", icon: "bw-cactus-heavy.png" },
  { name: "badlands", color: "#c2410c", icon: "bw-badlands.png" },
  { name: "brokenlands", color: "#92400e", icon: "bw-brokenlands.png" },
  // Forest
  { name: "forest", color: "#16a34a", icon: "bw-forest.png" },
  { name: "forest heavy", color: "#15803d", icon: "bw-forest-heavy.png" },
  { name: "forested hills", color: "#22c55e", icon: "bw-forested-hills.png" },
  { name: "mixed forest", color: "#16a34a", icon: "bw-forest-mixed.png" },
  {
    name: "mixed forest heavy",
    color: "#15803d",
    icon: "bw-forest-mixed-heavy.png",
  },
  {
    name: "mixed forest hills",
    color: "#22c55e",
    icon: "bw-forest-mixed-hills.png",
  },
  // Evergreen
  { name: "evergreen", color: "#166534", icon: "bw-evergreen.png" },
  { name: "evergreen heavy", color: "#14532d", icon: "bw-evergreen-heavy.png" },
  { name: "evergreen hills", color: "#4ade80", icon: "bw-evergreen-hills.png" },
  // Jungle
  { name: "jungle", color: "#15803d", icon: "bw-jungle.png" },
  { name: "jungle heavy", color: "#14532d", icon: "bw-jungle-heavy.png" },
  { name: "jungle hills", color: "#4ade80", icon: "bw-jungle-hills.png" },
  // Mountains
  { name: "mountain", color: "#9ca3af", icon: "bw-mountains.png" },
  { name: "mountain peak", color: "#78716c", icon: "bw-mountain.png" },
  { name: "mountains snow", color: "#bfdbfe", icon: "bw-mountains-snow.png" },
  { name: "snow", color: "#e0f2fe", icon: "bw-mountain-snow.png" },
  {
    name: "forested mountain",
    color: "#6b9e7c",
    icon: "bw-forested-mountain.png",
  },
  {
    name: "forested mountains",
    color: "#5e8c6a",
    icon: "bw-forested-mountains.png",
  },
  {
    name: "mixed forest mountain",
    color: "#6b9e7c",
    icon: "bw-forest-mixed-mountain.png",
  },
  {
    name: "mixed forest mountains",
    color: "#5e8c6a",
    icon: "bw-forest-mixed-mountains.png",
  },
  {
    name: "evergreen mountain",
    color: "#6b7280",
    icon: "bw-evergreen-mountain.png",
  },
  {
    name: "evergreen mountains",
    color: "#4b5563",
    icon: "bw-evergreen-mountains.png",
  },
  { name: "jungle mountain", color: "#4d7c0f", icon: "bw-jungle-mountain.png" },
  {
    name: "jungle mountains",
    color: "#3f6212",
    icon: "bw-jungle-mountains.png",
  },
  // Volcanic
  { name: "volcano", color: "#b91c1c", icon: "bw-volcano.png" },
  { name: "volcano dormant", color: "#78350f", icon: "bw-volcano-dormant.png" },
  // Wetlands
  { name: "marsh", color: "#4d7c0f", icon: "bw-marsh.png" },
  { name: "swamp", color: "#365314", icon: "bw-swamp.png" },
  // Water / cliffs (no icons)
  { name: "water", color: "#60a5fa" },
  { name: "cliffs", color: "#a16207" },
];

export const DEFAULT_SETTINGS: DuckmagePluginSettings = {
  mySetting: "default",
  worldFolder: "world",
  hexFolder: "world/hexes",
  townsFolder: "",
  dungeonsFolder: "",
  iconsFolder: "",
  templatePath: "",
  hexGap: "0.15",
  terrainPalette: DEFAULT_TERRAIN_PALETTE,
  gridSize: { cols: 20, rows: 16 },
  gridOffset: { x: 0, y: 0 },
  zoomLevel: 1,
  roadChains: [],
  riverChains: [],
  roadColor: "#a16207",
  riverColor: "#3b82f6",
  hexOrientation: "flat",
  tablesFolder: "world/tables",
  defaultTableDice: 100,
};
