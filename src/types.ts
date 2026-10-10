import type { MapExportPrefs } from "./export/exportNames";
export type TokenShape = "circle" | "square" | "hexagon";
export type TokenSize  = "sm" | "md" | "lg";

export interface TokenEntry {
	filePath: string;
	title: string;
	icon: string | undefined;
	hex: string;         // "x_y"
	map: string;
	visible: boolean;
	shape: TokenShape;
	size: TokenSize;
	color: string | undefined;   // fill color
	border: string | undefined;  // border/ring color
	tokenLink: string | undefined;    // proxy → original note path
	description: string | undefined;  // token-description frontmatter
}

export type PathLineStyle = "solid" | "dashed" | "dotted";
export type PathRouting   = "through" | "meander" | "edge";

export interface PathType {
	name: string;
	color: string;
	width: number;            // 1–10, direct SVG stroke-width
	lineStyle: PathLineStyle;
	routing: PathRouting;     // "through" = hex centers; "meander" = edge midpoints (curved); "edge" = along hex boundary lines
	/** Auto-route goes around impassable terrain. Unset = yes, except river-like
	 *  names (see pathAvoidsImpassable in src/impassable.ts). */
	avoidImpassable?: boolean;
}

export interface PathChain {
	typeName: string;         // references PathType.name
	hexes: string[];          // "x_y" keys
}

/**
 * Per-map background image. Drawn under the hex grid, sharing the viewport's
 * pan/zoom transform. `offsetX`/`offsetY` translate the image relative to the
 * hex-grid container's natural origin, in CSS pixels at the image's native
 * resolution. `scale` is a uniform multiplier (1 = native pixel size).
 * Rotation in degrees, default 0. Opacity 0..1, default 1.
 */
export interface MapBackgroundImage {
	path: string;
	offsetX: number;
	offsetY: number;
	scale: number;
	rotation?: number;
	opacity?: number;
}

/** See MapData.biome. */
export interface RegionBiome {
	generator: string;
	from?: string[];
}

export interface MapData {
	/** The map's slug: its folder and map note name, and its id everywhere. */
	name: string;
	/** The name as typed ("Barony of Saltmere"), shown in the UI. Unset =
	 *  the slug (maps made before display names). Changing it moves nothing. */
	displayName?: string;
	/** Plugin version that created the map (see src/compat.ts). */
	createdWith?: string;
	paletteName: string;
	terrainType?: string;        // terrain name from the map's palette; used as submap center dot color
	/** The hex this map was opened from as a submap ("x_y" on `map`). Drives
	 *  the breadcrumb and "Up". Set by plugin.linkSubmap; recovered by scanning
	 *  hex notes when missing (maps linked before this existed). */
	parent?: { map: string; hex: string };
	/** Terrain shown on hexes with no terrain of their own (e.g. "void").
	 *  Display only: hex notes are created on use for every map, with or
	 *  without a base terrain. */
	baseTerrain?: string;
	/** Region weather table (vault path), rolled from the hex editor's
	 *  Weather section unless the hex links its own (E2). */
	weatherTable?: string;
	/** Region rumours table (vault path), for Hooks & Rumors (E2). */
	rumorsTable?: string;
	gridSize: { cols: number; rows: number };
	gridOffset: { x: number; y: number };
	pathChains: PathChain[];
	showCoords?: boolean;        // undefined = true (backwards-compatible)
	showTerrainIcons?: boolean;  // undefined = true
	showIconOverrides?: boolean; // undefined = true
	showPaths?: boolean;         // undefined = true
	showFactionOverlay?: boolean; // undefined = false (opt-in)
	showRegionOverlay?: boolean;  // undefined = false (opt-in)
	showGmLayer?: boolean;        // undefined = true (older maps); new maps are created with false
	showTokens?: boolean;         // undefined = true (on by default)
	/** Corner badges per link type (towns, dungeons…). undefined = true. */
	showLinkBadges?: boolean;
	/** Badge types turned off in the layers menu (BADGE_SECTIONS names). */
	hiddenLinkBadges?: string[];
	showHexNames?: boolean;       // undefined = true: hex name labels on the map
	showTokenNames?: boolean;     // undefined = true: name under each token
	staggerOffset?: "odd" | "even"; // undefined = inherit global setting
	/** Slot on a shared grid of neighbouring regions (see src/worldgen/world.ts). */
	world?: { id: string; cx: number; cy: number };
	/** The generator (biome) a region was made from, so later neighbours can
	 *  blend with it. `from` lists the neighbouring biomes it was blended with:
	 *  a transition region between them and `generator`. */
	biome?: RegionBiome;
	backgroundImage?: MapBackgroundImage;
	/** Optional independent transform applied to the hex grid container,
	 *  used during background-image calibration so the user can resize/shift
	 *  the grid to fit features in the underlying image.
	 *  `gridDisplayScale` is the legacy uniform-scale field, retained for
	 *  back-compat; new code reads X/Y separately (falling back to
	 *  `gridDisplayScale` if X/Y are missing). */
	gridDisplayScale?: number;
	gridDisplayScaleX?: number;
	gridDisplayScaleY?: number;
	gridDisplayOffsetX?: number;
	gridDisplayOffsetY?: number;
	/** Persisted viewport state — restored when the view is reopened so a
	 *  calibrated map (whose bg image / grid transforms were sized at a
	 *  specific font-size / zoom) doesn't drift on reload. */
	savedViewport?: {
		zoom: number;
		panX: number;
		panY: number;
		/** Baked font-size as a CSS string (e.g. `"32px"`), or `""` for default. */
		fontSize: string;
	};
}

export interface TerrainPalette {
	name: string;
	terrains: TerrainColor[];
	/** Palette suggested for submaps created from this palette's maps
	 *  (e.g. "Space - Sector" → "Space - System"). Stored as `child-palette`
	 *  in the palette note's frontmatter. Unset = same palette as the parent. */
	childPalette?: string;
	/** Per-terrain setup for submaps made from hexes of that terrain
	 *  ("ocean world" → Space - System, 13×13, Orbits…). Stored as the
	 *  "Submap defaults" table in the palette note. */
	submapDefaults?: Record<string, SubmapDefault>;
}

/** Saved choices for new submaps of one terrain. Every field is optional. */
export interface SubmapDefault {
	palette?: string;
	cols?: number;
	rows?: number;
	/** Generator id from src/worldgen/registry.ts ("blank", "procedural:orbits", "wfc:<path>"). */
	generator?: string;
	options?: Record<string, string>;
	baseTerrain?: string;
}

export interface TerrainColor {
	name: string;
	color: string;
	icon?: string;
	iconColor?: string; // CSS colour to tint the icon; undefined = no tint (render as-is)
	category?: string;
	/** Terrain type id from src/terrainTypes.ts ("forest", "water", "star"…):
	 *  what this terrain *is*, whatever it's called. Used by generators and
	 *  the hex table. Unset = unknown (inferred from the name where needed). */
	type?: string;
	/** Auto-routed paths go around this terrain. Unset = by type (water types
	 *  are impassable, see src/impassable.ts). Stored as the palette note's
	 *  Impassable column. */
	impassable?: boolean;
}

export interface HexmakerPluginSettings {
	mySetting: string;
	/** Plugin version that last saved data.json (see src/compat.ts). */
	savedWith?: string;
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
	maps: MapData[];
	zoomLevel: number;
	pathTypes: PathType[];
	hexOrientation: "pointy" | "flat";
	staggerOffset: "odd" | "even";
	tablesFolder: string;
	factionsFolder: string;
	regionsFolder: string;
	defaultTableDice: number;
	hexEditorTerrainCollapsed: boolean;
	/** No longer read (round 6: expanding Terrain is per hex). Kept so old data.json files type-check. */
	hexEditorTerrainExpanded?: boolean;
	hexEditorFeaturesCollapsed: boolean;
	hexEditorNotesCollapsed: boolean;
	/** Hex editor "Icons" group collapsed. Unset = open. */
	hexEditorIconsCollapsed?: boolean;
	rollTableExcludedFolders: string[];
	encounterTableExcludedFolders: string[];
	defaultMap: string;
	defaultNewMapCols: number;
	defaultNewMapRows: number;
	defaultSubmapCols: number;
	defaultSubmapRows: number;
	workflowsFolder: string;
	exportFolder: string;
	coordPlacement: "top" | "middle" | "bottom";
	/** Size of the hex coordinate label, in em units relative to the hex. */
	coordFontSize: number;
	/** Which font the coord label uses. */
	coordFontFamily: "interface" | "monospace" | "serif";
	/** Coord label text color (CSS hex). */
	coordFontColor: string;
	hiddenIcons: string[];
	iconOrder: string[];
	setupComplete: boolean;
	setupDismissed: boolean;
	/** Vault folder holding palette notes. Empty = "{worldFolder}/palettes". */
	palettesFolder: string;
	/** True once settings-only palettes were written out as notes. */
	palettesMigrated: boolean;
	/** Enabled map types (see src/mapKinds.ts). Unset = all. */
	mapKinds: string[];
	/** Simple or Advanced (see src/featureLevel.ts). */
	featureLevel: "simple" | "advanced";
	/** Advanced features turned on one by one while in Simple. */
	advancedFeatures: string[];
	/** Advanced hints the user closed, by spot id. */
	dismissedHints: string[];
	/** When the plugin first ran (ISO date), for the "ready for more?" check-in. */
	installedAt?: string;
	/** Last time the check-in was shown (ISO date). */
	advancedNudgeAt?: string;
	/** "Don't ask again" on the check-in. */
	advancedNudgeOff?: boolean;
	/** True once existing palettes got terrain types (one-time seeding). */
	terrainTypesSeeded: boolean;
	/** Terrain legend on the map and generator previews. Unset = shown. */
	showTerrainLegend?: boolean;
	/** The map export form's last choices, per map name (round 6 S9). */
	mapExportPrefs?: Record<string, MapExportPrefs>;
	/** Terrain legend size. Unset = "m". */
	terrainLegendSize?: "s" | "m" | "l";
}

export const LINK_SECTIONS = ["Towns", "Dungeons", "Features", "Quests", "Factions", "Encounters Table"] as const;
export type LinkSection = typeof LINK_SECTIONS[number];

export const TEXT_SECTIONS = [
	{ key: "description", label: "Description" },
	{ key: "landmark",    label: "Landmark" },
	{ key: "hidden",      label: "Hidden" },
	{ key: "secret",      label: "Secret" },
] as const;

/** Text sections rolled from region tables (E2): shown collapsed under Notes. */
export const ROLLED_TEXT_SECTIONS = [
	{ key: "weather",        label: "Weather" },
	{ key: "hooks & rumors", label: "Hooks & Rumors" },
] as const;

/**
 * Session-only flags passed from HexMapView into HexEditorModal.
 * All fields are optional — modal defaults missing keys to false.
 * Add new session-layer flags here; no constructor signature changes needed.
 */
export interface HexEditorOptions {
	/** GM layer is active: force Notes open, highlight Hidden/Secret sections. */
	gmLayerActive?: boolean;
	/** Called when the user clicks a neighbour tile to navigate to an adjacent hex. */
	onNavigate?: (x: number, y: number) => void;
	/** Called when the modal closes (e.g. to clear the selected-hex highlight). */
	onModalClose?: () => void;
	/** Called when the user clicks the submap centre-dot to drill into another map. */
	onSwitchMap?: (mapName: string) => void;
	/** Called after the user agrees to step from the hex flower into a neighbouring region's hex. */
	onCrossToRegion?: (mapName: string, x: number, y: number) => void;
}
