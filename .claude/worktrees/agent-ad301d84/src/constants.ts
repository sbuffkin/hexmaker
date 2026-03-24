import type { TerrainColor, DuckmagePluginSettings } from "./types";

export const VIEW_TYPE_HEX_MAP = "duckmage-hex-map";
export const VIEW_TYPE_HEX_TABLE = "duckmage-hex-table";
export const VIEW_TYPE_RANDOM_TABLES = "duckmage-random-tables";

export const DEFAULT_TERRAIN_PALETTE: TerrainColor[] = [
  // Water
  { name: "ocean", color: "#29507f" },
  { name: "shallows", color: "#4a82a5" },
  { name: "water", color: "#60a5fa" },
  // Open
  { name: "grass", color: "#638c7b", icon: "bw-grassland.png" },
  { name: "hills", color: "#e0e8a1", icon: "bw-hills.png" },
  { name: "foothills", color: "#81c191", icon: "bw-hills.png" },
  { name: "snow", color: "#e0f2fe" },
  { name: "beach", color: "#cac181", icon: "bw-grassland.png" },
  { name: "urban", color: "#888888" },
  // Desert
  { name: "desert", color: "#ecdba2" },
  { name: "desert rocky", color: "#e6bc60", icon: "bw-desert-rocky.png" },
  { name: "dunes", color: "#eccd7e", icon: "bw-dunes.png" },
  { name: "cactus", color: "#e2b75a", icon: "bw-cactus.png" },
  { name: "cactus heavy", color: "#ddb869", icon: "bw-cactus-heavy.png" },
  { name: "badlands", color: "#c2410c", icon: "bw-badlands.png" },
  { name: "brokenlands", color: "#92400e", icon: "bw-brokenlands.png" },
  { name: "cliffs", color: "#a86f1f", icon: "bw-brokenlands.png" },
  { name: "salt flats", color: "#f7eaba", icon: "bw-dunes.png" },
  // Forest
  { name: "forest", color: "#2d9553", icon: "bw-forest-heavy.png" },
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
  { name: "evergreen", color: "#428a5e", icon: "bw-evergreen.png" },
  { name: "evergreen heavy", color: "#257445", icon: "bw-evergreen-heavy.png" },
  { name: "evergreen hills", color: "#328651", icon: "bw-evergreen-hills.png" },
  // Jungle
  { name: "jungle", color: "#15803d", icon: "bw-jungle.png" },
  { name: "jungle heavy", color: "#14532d", icon: "bw-jungle-heavy.png" },
  { name: "jungle hills", color: "#4ade80", icon: "bw-jungle-hills.png" },
  // Mountains
  { name: "mountain", color: "#a77649", icon: "bw-mountain.png" },
  { name: "peak", color: "#78716c", icon: "bw-mountain.png" },
  { name: "mountains snow", color: "#bfdbfe", icon: "bw-mountains-snow.png" },
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
    color: "#6b806b",
    icon: "bw-evergreen-mountain.png",
  },
  {
    name: "evergreen mountains",
    color: "#8c9d80",
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
  { name: "bog", color: "#432e6b", icon: "bw-swamp.png" },
];

export const DEFAULT_SETTINGS: DuckmagePluginSettings = {
  mySetting: "default",
  worldFolder: "world",
  hexFolder: "world/hexes",
  townsFolder: "",
  dungeonsFolder: "",
  questsFolder: "",
  featuresFolder: "",
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
  factionsFolder: "",
  defaultTableDice: 100,
  hexEditorTerrainCollapsed: false,
  hexEditorFeaturesCollapsed: false,
  hexEditorNotesCollapsed: false,
  rollTableExcludedFolders: ["terrain"],
  encounterTableExcludedFolders: ["terrain"],
};
