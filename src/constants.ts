import type { TerrainColor, HexmakerPluginSettings, PathType } from "./types";

export const DEFAULT_PALETTE_NAME = "Default"; // kept for migration of legacy saves
export const LIMITED_PALETTE_NAME = "Limited";
export const EXPANDED_PALETTE_NAME = "Expanded";

export const VIEW_TYPE_HEX_MAP = "duckmage-hex-map";
export const VIEW_TYPE_HEX_TABLE = "duckmage-hex-table";
export const VIEW_TYPE_RANDOM_TABLES = "duckmage-random-tables";

export const DEFAULT_TERRAIN_PALETTE: TerrainColor[] = [
  // Sea
  { name: "trench", color: "#14223d", category: "sea" },
  { name: "ocean", color: "#29507f", category: "sea" },
  { name: "shallows", color: "#4a82a5", category: "sea" },
  // Uncategorised
  { name: "water", color: "#60a5fa" },
  { name: "urban", color: "#888888" },
  // Lowlands
  {
    name: "grass",
    color: "#69a168",
    icon: "bw-grassland.png",
    category: "lowlands",
  },
  {
    name: "hills",
    color: "#e0e8a1",
    icon: "bw-hills.png",
    category: "lowlands",
  },
  {
    name: "foothills",
    color: "#81c191",
    icon: "bw-hills.png",
    category: "lowlands",
  },
  // Snow
  { name: "snow", color: "#e0f2fe", category: "snow" },
  {
    name: "mountains snow",
    color: "#bfdbfe",
    icon: "bw-mountains-snow.png",
    category: "snow",
  },
  // Desert
  { name: "desert", color: "#ecdba2", category: "desert" },
  {
    name: "desert rocky",
    color: "#e6bc60",
    icon: "bw-desert-rocky.png",
    category: "desert",
  },
  { name: "dunes", color: "#eccd7e", icon: "bw-dunes.png", category: "desert" },
  {
    name: "cactus",
    color: "#e2b75a",
    icon: "bw-cactus.png",
    category: "desert",
  },
  {
    name: "cactus heavy",
    color: "#ddb869",
    icon: "bw-cactus-heavy.png",
    category: "desert",
  },
  {
    name: "badlands",
    color: "#c2410c",
    icon: "bw-badlands.png",
    category: "desert",
  },
  {
    name: "brokenlands",
    color: "#92400e",
    icon: "bw-brokenlands.png",
    category: "desert",
  },
  // Forest
  {
    name: "forest",
    color: "#2d9553",
    icon: "bw-forest.png",
    category: "forest",
  },
  {
    name: "forest heavy",
    color: "#15803d",
    icon: "bw-forest-heavy.png",
    category: "forest",
  },
  {
    name: "forested hills",
    color: "#22c55e",
    icon: "bw-forested-hills.png",
    category: "forest",
  },
  {
    name: "forested mountain",
    color: "#6b9e7c",
    icon: "bw-forested-mountain.png",
    category: "forest",
  },
  {
    name: "forested mountains",
    color: "#466d46",
    icon: "bw-forested-mountains.png",
    iconColor: "#1b1d1c",
    category: "forest",
  },
  {
    name: "mixed forest",
    color: "#16a34a",
    icon: "bw-forest-mixed.png",
    category: "forest",
  },
  {
    name: "mixed forest heavy",
    color: "#15803d",
    icon: "bw-forest-mixed-heavy.png",
    category: "forest",
  },
  {
    name: "mixed forest hills",
    color: "#22c55e",
    icon: "bw-forest-mixed-hills.png",
    category: "forest",
  },
  {
    name: "mixed forest mountain",
    color: "#6b9e7c",
    icon: "bw-forest-mixed-mountain.png",
    category: "forest",
  },
  {
    name: "mixed forest mountains",
    color: "#5e8c6a",
    icon: "bw-forest-mixed-mountains.png",
    category: "forest",
  },
  // Darkwood (evergreen)
  {
    name: "evergreen",
    color: "#428a5e",
    icon: "bw-evergreen.png",
    category: "darkwood",
  },
  {
    name: "evergreen heavy",
    color: "#257445",
    icon: "bw-evergreen-heavy.png",
    iconColor: "#1f1e1e",
    category: "darkwood",
  },
  {
    name: "evergreen hills",
    color: "#328651",
    icon: "bw-evergreen-hills.png",
    iconColor: "#292929",
    category: "darkwood",
  },
  {
    name: "evergreen mountain",
    color: "#6b806b",
    icon: "bw-evergreen-mountain.png",
    category: "darkwood",
  },
  {
    name: "evergreen mountains",
    color: "#8c9d80",
    icon: "bw-evergreen-mountains.png",
    category: "darkwood",
  },
  // Island (jungle / volcanic)
  {
    name: "jungle",
    color: "#15803d",
    icon: "bw-jungle.png",
    category: "island",
  },
  {
    name: "jungle heavy",
    color: "#14532d",
    icon: "bw-jungle-heavy.png",
    iconColor: "#ffffff",
    category: "island",
  },
  {
    name: "jungle hills",
    color: "#4ade80",
    icon: "bw-jungle-hills.png",
    category: "island",
  },
  {
    name: "jungle mountain",
    color: "#4d7c0f",
    icon: "bw-jungle-mountain.png",
    category: "island",
  },
  {
    name: "jungle mountains",
    color: "#3f6212",
    icon: "bw-jungle-mountains.png",
    category: "island",
  },
  {
    name: "volcano",
    color: "#b91c1c",
    icon: "bw-volcano.png",
    category: "island",
  },
  {
    name: "volcano dormant",
    color: "#78350f",
    icon: "bw-volcano-dormant.png",
    iconColor: "#ffffff",
    category: "island",
  },
  // Mountain
  {
    name: "cliffs",
    color: "#a86f1f",
    icon: "bw-brokenlands.png",
    category: "mountain",
  },
  {
    name: "mountain",
    color: "#a77649",
    icon: "bw-mountain.png",
    category: "mountain",
  },
  {
    name: "mountain ridge",
    color: "#c55f0d",
    icon: "bw-mountains.png",
    category: "mountain",
  },
  {
    name: "peak",
    color: "#78716c",
    icon: "bw-mountain.png",
    category: "mountain",
  },
  // Bog (wetlands)
  { name: "marsh", color: "#909f23", icon: "bw-marsh.png", category: "bog" },
  {
    name: "swamp",
    color: "#4e5214",
    icon: "bw-swamp.png",
    iconColor: "#f9fbf9",
    category: "bog",
  },
  {
    name: "bog",
    color: "#432e6b",
    icon: "bw-swamp.png",
    iconColor: "#ffffff",
    category: "bog",
  },
  // Coast
  {
    name: "beach",
    color: "#cac181",
    icon: "bw-grassland.png",
    category: "coast",
  },
  {
    name: "salt flats",
    color: "#f7eaba",
    icon: "bw-dunes.png",
    category: "coast",
  },
];

export const LIMITED_TERRAIN_PALETTE: TerrainColor[] = [
  { name: "ocean",    color: "#29507f",  category: "sea" },
  { name: "grass",    color: "#69a168",  icon: "bw-grassland.png", category: "lowlands" },
  { name: "hill",     color: "#e0e8a1",  icon: "bw-hills.png",     category: "lowlands" },
  { name: "forest",   color: "#2d9553",  icon: "bw-forest.png",    category: "forest" },
  { name: "mountain", color: "#a77649",  icon: "bw-mountain.png",  category: "mountain" },
  { name: "desert",   color: "#ecdba2",  category: "desert" },
  { name: "snow",     color: "#e0f2fe",  category: "snow" },
];

export const DEFAULT_PATH_TYPES: PathType[] = [
  { name: "Road",  color: "#a16207", width: 4, lineStyle: "solid", routing: "through" },
  { name: "River", color: "#3b82f6", width: 3, lineStyle: "solid", routing: "meander" },
];

export const DEFAULT_SETTINGS: HexmakerPluginSettings = {
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
  terrainPalettes: [
    { name: LIMITED_PALETTE_NAME,  terrains: LIMITED_TERRAIN_PALETTE },
    { name: EXPANDED_PALETTE_NAME, terrains: DEFAULT_TERRAIN_PALETTE },
  ],
  regions: [
    {
      name: "default",
      paletteName: LIMITED_PALETTE_NAME,
      gridSize: { cols: 20, rows: 16 },
      gridOffset: { x: 0, y: 0 },
      pathChains: [],
    },
  ],
  zoomLevel: 1,
  pathTypes: DEFAULT_PATH_TYPES,
  hexOrientation: "flat",
  tablesFolder: "world/tables",
  factionsFolder: "",
  defaultTableDice: 100,
  hexEditorTerrainCollapsed: false,
  hexEditorFeaturesCollapsed: false,
  hexEditorNotesCollapsed: false,
  rollTableExcludedFolders: ["terrain"],
  encounterTableExcludedFolders: ["terrain"],
  defaultRegion: "default",
  workflowsFolder: "",
};
