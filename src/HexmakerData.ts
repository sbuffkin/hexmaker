export interface HexmakerData {
  mySetting: string;
  worldFolder: string;
  hexFolder: string;
  townsFolder: string;
  dungeonsFolder: string;
  questsFolder: string;
  featuresFolder: string;
  iconsFolder: string;
  templatePath: string;
  hexGap: string;
  terrainPalettes: TerrainPalette[];
  regions: Region[];
  zoomLevel: number;
  pathTypes: PathType[];
  hexOrientation: "flat" | "pointy";
  tablesFolder: string;
  factionsFolder: string;
  defaultTableDice: number;
  hexEditorTerrainCollapsed: boolean;
  hexEditorFeaturesCollapsed: boolean;
  hexEditorNotesCollapsed: boolean;
  rollTableExcludedFolders: string[];
  encounterTableExcludedFolders: string[];
  defaultRegion: string;
  workflowsFolder: string;
  roadColor: string;
  riverColor: string;
  gridSize: {
    cols: number;
    rows: number;
  };
  gridOffset: {
    x: number;
    y: number;
  };
  hexEditorStartCollapsed: boolean;
}

export interface PathType {
  name: string;
  color: string;
  width: number;
  lineStyle: "solid" | "dashed" | "dotted";
  routing: "through" | "around";
}
export interface Terrain {
  name: string;
  color: string;
  category: string;
}

export interface TerrainPalette {
  name: string;
  terrains: Terrain[];
}

export interface GridSize {
  cols: number;
  rows: number;
}

export interface GridOffset {
  x: number;
  y: number;
}

export interface Region {
  name: string;
  paletteName: string;
  gridSize: GridSize;
  gridOffset: GridOffset;
  pathChains: PathChain[];
}
export interface PathChain {
  typeName: string;
  hexes: string[];
}
