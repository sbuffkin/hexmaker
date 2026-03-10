export interface TerrainColor {
	name: string;
	color: string;
	icon?: string;
}

export interface DuckmagePluginSettings {
	mySetting: string;
	worldFolder: string;
	hexFolder: string;
	townsFolder: string;
	dungeonsFolder: string;
	iconsFolder: string;
	templatePath: string;
	hexGap: string;
	terrainPalette: TerrainColor[];
	gridSize: { cols: number; rows: number };
	gridOffset: { x: number; y: number };
	zoomLevel: number;
	roadChains: string[][];
	riverChains: string[][];
	roadColor: string;
	riverColor: string;
	hexOrientation: "pointy" | "flat";
	tablesFolder: string;
	defaultTableDice: number;
}

export const LINK_SECTIONS = ["Towns", "Dungeons", "Features", "Encounters Table"] as const;
export type LinkSection = typeof LINK_SECTIONS[number];

export const TEXT_SECTIONS = [
	{ key: "description",    label: "Description" },
	{ key: "landmark",       label: "Landmark" },
	{ key: "hidden",         label: "Hidden" },
	{ key: "secret",         label: "Secret" },
	{ key: "encounters",     label: "Encounters" },
	{ key: "weather",        label: "Weather" },
	{ key: "hooks & rumors", label: "Hooks & Rumors" },
] as const;
