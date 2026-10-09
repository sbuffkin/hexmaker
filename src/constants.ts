import type { TerrainColor, HexmakerPluginSettings, PathType } from "./types";

export const DEFAULT_PALETTE_NAME = "Default"; // kept for migration of legacy saves
export const LIMITED_PALETTE_NAME = "Limited";
export const EXPANDED_PALETTE_NAME = "Expanded";

export const VIEW_TYPE_HEX_MAP = "duckmage-hex-map";
export const VIEW_TYPE_HEX_TABLE = "duckmage-hex-table";
export const VIEW_TYPE_RANDOM_TABLES = "duckmage-random-tables";
export const VIEW_TYPE_SETUP_WIZARD = "duckmage-setup-wizard";
export const VIEW_TYPE_PALETTE_EDITOR = "duckmage-palette-editor";
export const VIEW_TYPE_GENERATOR = "duckmage-terrain-generator";

export const DEFAULT_TERRAIN_PALETTE: TerrainColor[] = [
  // Sea
  { name: "trench", type: "deep-water", color: "#14223d", category: "sea" },
  { name: "ocean", type: "water", color: "#29507f", category: "sea" },
  { name: "shallows", type: "shallows", color: "#4a82a5", category: "sea" },
  // Uncategorised
  { name: "water", type: "water", color: "#60a5fa" },
  { name: "urban", type: "settlement", color: "#888888" },
  // Lowlands
  {
    name: "grass",
    type: "grassland",
    color: "#69a168",
    icon: "bw-grassland.png",
    category: "lowlands",
  },
  {
    name: "hills",
    type: "hills",
    color: "#e0e8a1",
    icon: "bw-hills.png",
    category: "lowlands",
  },
  {
    name: "foothills",
    type: "hills",
    color: "#81c191",
    icon: "bw-hills.png",
    category: "lowlands",
  },
  // Snow
  { name: "snow", type: "snow", color: "#e0f2fe", category: "snow" },
  {
    name: "mountains snow",
    type: "peaks",
    color: "#bfdbfe",
    icon: "bw-mountains-snow.png",
    category: "snow",
  },
  // Desert
  { name: "desert", type: "desert", color: "#ecdba2", category: "desert" },
  {
    name: "desert rocky",
    type: "desert",
    color: "#e6bc60",
    icon: "bw-desert-rocky.png",
    category: "desert",
  },
  { name: "dunes", type: "desert", color: "#eccd7e", icon: "bw-dunes.png", category: "desert" },
  {
    name: "cactus",
    type: "desert",
    color: "#e2b75a",
    icon: "bw-cactus.png",
    category: "desert",
  },
  {
    name: "cactus heavy",
    type: "desert",
    color: "#ddb869",
    icon: "bw-cactus-heavy.png",
    category: "desert",
  },
  {
    name: "badlands",
    type: "badlands",
    color: "#c2410c",
    icon: "bw-badlands.png",
    category: "desert",
  },
  {
    name: "brokenlands",
    type: "badlands",
    color: "#92400e",
    icon: "bw-brokenlands.png",
    category: "desert",
  },
  // Forest
  {
    name: "forest",
    type: "forest",
    color: "#2d9553",
    icon: "bw-forest.png",
    category: "forest",
  },
  {
    name: "forest heavy",
    type: "forest",
    color: "#15803d",
    icon: "bw-forest-heavy.png",
    category: "forest",
  },
  {
    name: "forested hills",
    type: "hills",
    color: "#22c55e",
    icon: "bw-forested-hills.png",
    category: "forest",
  },
  {
    name: "forested mountain",
    type: "mountains",
    color: "#6b9e7c",
    icon: "bw-forested-mountain.png",
    category: "forest",
  },
  {
    name: "forested mountains",
    type: "mountains",
    color: "#466d46",
    icon: "bw-forested-mountains.png",
    iconColor: "#1b1d1c",
    category: "forest",
  },
  {
    name: "mixed forest",
    type: "forest",
    color: "#16a34a",
    icon: "bw-forest-mixed.png",
    category: "forest",
  },
  {
    name: "mixed forest heavy",
    type: "forest",
    color: "#15803d",
    icon: "bw-forest-mixed-heavy.png",
    category: "forest",
  },
  {
    name: "mixed forest hills",
    type: "hills",
    color: "#22c55e",
    icon: "bw-forest-mixed-hills.png",
    category: "forest",
  },
  {
    name: "mixed forest mountain",
    type: "mountains",
    color: "#6b9e7c",
    icon: "bw-forest-mixed-mountain.png",
    category: "forest",
  },
  {
    name: "mixed forest mountains",
    type: "mountains",
    color: "#5e8c6a",
    icon: "bw-forest-mixed-mountains.png",
    category: "forest",
  },
  // Darkwood (evergreen)
  {
    name: "evergreen",
    type: "forest",
    color: "#428a5e",
    icon: "bw-evergreen.png",
    category: "darkwood",
  },
  {
    name: "evergreen heavy",
    type: "forest",
    color: "#257445",
    icon: "bw-evergreen-heavy.png",
    iconColor: "#1f1e1e",
    category: "darkwood",
  },
  {
    name: "evergreen hills",
    type: "hills",
    color: "#328651",
    icon: "bw-evergreen-hills.png",
    iconColor: "#292929",
    category: "darkwood",
  },
  {
    name: "evergreen mountain",
    type: "mountains",
    color: "#6b806b",
    icon: "bw-evergreen-mountain.png",
    category: "darkwood",
  },
  {
    name: "evergreen mountains",
    type: "mountains",
    color: "#8c9d80",
    icon: "bw-evergreen-mountains.png",
    category: "darkwood",
  },
  // Island (jungle / volcanic)
  {
    name: "jungle",
    type: "jungle",
    color: "#15803d",
    icon: "bw-jungle.png",
    category: "island",
  },
  {
    name: "jungle heavy",
    type: "jungle",
    color: "#14532d",
    icon: "bw-jungle-heavy.png",
    iconColor: "#ffffff",
    category: "island",
  },
  {
    name: "jungle hills",
    type: "hills",
    color: "#4ade80",
    icon: "bw-jungle-hills.png",
    category: "island",
  },
  {
    name: "jungle mountain",
    type: "mountains",
    color: "#4d7c0f",
    icon: "bw-jungle-mountain.png",
    category: "island",
  },
  {
    name: "jungle mountains",
    type: "mountains",
    color: "#3f6212",
    icon: "bw-jungle-mountains.png",
    category: "island",
  },
  {
    name: "volcano",
    type: "volcanic",
    color: "#b91c1c",
    icon: "bw-volcano.png",
    category: "island",
  },
  {
    name: "volcano dormant",
    type: "volcanic",
    color: "#78350f",
    icon: "bw-volcano-dormant.png",
    iconColor: "#ffffff",
    category: "island",
  },
  // Mountain
  {
    name: "cliffs",
    type: "mountains",
    color: "#a86f1f",
    icon: "bw-brokenlands.png",
    category: "mountain",
  },
  {
    name: "mountain",
    type: "mountains",
    color: "#a77649",
    icon: "bw-mountain.png",
    category: "mountain",
  },
  {
    name: "mountain ridge",
    type: "mountains",
    color: "#c55f0d",
    icon: "bw-mountains.png",
    category: "mountain",
  },
  {
    name: "peak",
    type: "peaks",
    color: "#78716c",
    icon: "bw-mountain.png",
    category: "mountain",
  },
  // Bog (wetlands)
  { name: "marsh", type: "wetland", color: "#909f23", icon: "bw-marsh.png", category: "bog" },
  {
    name: "swamp",
    type: "wetland",
    color: "#4e5214",
    icon: "bw-swamp.png",
    iconColor: "#f9fbf9",
    category: "bog",
  },
  {
    name: "bog",
    type: "wetland",
    color: "#432e6b",
    icon: "bw-swamp.png",
    iconColor: "#ffffff",
    category: "bog",
  },
  // Coast
  {
    name: "beach",
    type: "coast",
    color: "#cac181",
    icon: "bw-grassland.png",
    category: "coast",
  },
  {
    name: "salt flats",
    type: "coast",
    color: "#f7eaba",
    icon: "bw-dunes.png",
    category: "coast",
  },
];

export const LIMITED_TERRAIN_PALETTE: TerrainColor[] = [
  { name: "ocean", type: "water",    color: "#29507f",  category: "sea" },
  { name: "grass", type: "grassland",    color: "#69a168",  icon: "bw-grassland.png", category: "lowlands" },
  { name: "hill", type: "hills",     color: "#e0e8a1",  icon: "bw-hills.png",     category: "lowlands" },
  { name: "forest", type: "forest",   color: "#2d9553",  icon: "bw-forest.png",    category: "forest" },
  { name: "mountain", type: "mountains", color: "#a77649",  icon: "bw-mountain.png",  category: "mountain" },
  { name: "desert", type: "desert",   color: "#ecdba2",  category: "desert" },
  { name: "snow", type: "snow",     color: "#e0f2fe",  category: "snow" },
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
  maps: [
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
  staggerOffset: "odd",
  tablesFolder: "world/tables",
  factionsFolder: "",
  regionsFolder: "",
  defaultTableDice: 100,
  hexEditorTerrainCollapsed: false,
  hexEditorFeaturesCollapsed: false,
  hexEditorNotesCollapsed: false,
  rollTableExcludedFolders: ["terrain"],
  encounterTableExcludedFolders: ["terrain"],
  defaultMap: "default",
  defaultNewMapCols: 20,
  defaultNewMapRows: 16,
  defaultSubmapCols: 10,
  defaultSubmapRows: 10,
  workflowsFolder: "",
  exportFolder: "",
  coordPlacement: "bottom",
  coordFontSize: 0.8,
  coordFontFamily: "interface",
  coordFontColor: "#ffffff",
  hiddenIcons: [],
  iconOrder: [],
  setupComplete: false,
  setupDismissed: false,
  palettesFolder: "",
  palettesMigrated: false,
  // Space is opt-in (setup wizard / settings → Map types). Upgrades without
  // the setting get space too if they already have space palettes
  // (resolveMapKinds in src/mapKinds.ts).
  mapKinds: ["world"],
  // Resolved at load from the raw data (resolveFeatureLevel): updates from
  // before feature levels get Advanced, fresh installs start Simple.
  featureLevel: "simple",
  advancedFeatures: [],
  dismissedHints: [],
  terrainTypesSeeded: false,
};
