export interface RegionData {
	name: string;
	gridSize: { cols: number; rows: number };
	gridOffset: { x: number; y: number };
	roadChains: string[][];
	riverChains: string[][];
}

export interface TerrainColor {
	name: string;
	color: string;
	icon?: string;
	iconColor?: string; // CSS colour to tint the icon; undefined = no tint (render as-is)
	category?: string;
}

export interface DuckmagePluginSettings {
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
	terrainPalette: TerrainColor[];
	regions: RegionData[];
	zoomLevel: number;
	roadColor: string;
	riverColor: string;
	hexOrientation: "pointy" | "flat";
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
}

export const LINK_SECTIONS = ["Towns", "Dungeons", "Features", "Quests", "Factions", "Encounters Table"] as const;
export type LinkSection = typeof LINK_SECTIONS[number];

export const TEXT_SECTIONS = [
	{ key: "description", label: "Description" },
	{ key: "landmark",    label: "Landmark" },
	{ key: "hidden",      label: "Hidden" },
	{ key: "secret",      label: "Secret" },
] as const;
