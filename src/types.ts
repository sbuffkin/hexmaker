import type { MapExportPrefs } from "./export/exportNames";
import type { MapKind } from "./mapKinds";
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
	/** The party token (`token-party: true`): click a neighbouring hex to move it in Play; marks hexes visited. */
	party?: boolean;
	/** This party's own play log folder (`token-log:`), else the campaign's (src/play/playLog.ts). */
	logFolder?: string;
}

export type PathLineStyle = "solid" | "dashed" | "dotted";
export type PathRouting   = "through" | "meander" | "edge";
/** How auto-route picks hexes: "direct" keeps to the straight line, "winding" wanders. */
export type PathAutoRoute = "direct" | "winding";

/**
 * A kind of path. Every behaviour is one of these fields; none follows the
 * type's name, so a palette built from scratch can make any look (PA5).
 */
export interface PathType {
	name: string;
	color: string;
	/** A colour typed in the palette note that can't be read: `color` is the
	 *  grey it's drawn with (UNREAD_GREY) and this is the text as typed,
	 *  written back to the note while `color` is still that grey, so the
	 *  plugin's rewrites never lose it. Set only by the note reader. */
	unreadColor?: string;
	width: number;            // 1–10, direct SVG stroke-width
	lineStyle: PathLineStyle;
	/** How the line is drawn: "through" = smooth curve through hex centres;
	 *  "meander" = smooth curve through the midpoints of the edges between
	 *  hexes; "edge" = straight segments along hex borders. */
	routing: PathRouting;
	/** Auto-route goes around impassable terrain (and, for generated submaps,
	 *  avoids water; off = prefers low ground and water, like a river). */
	avoidImpassable: boolean;
	/** Auto-route keeps to the straight line ("direct") or wanders ("winding"). */
	autoRoute: PathAutoRoute;
	/** When an overworld path of this type is confirmed into its regions, the
	 *  hexes it crosses there become this terrain: a terrain's name, or a
	 *  terrain type ("water": the palette's first water terrain). Unset =
	 *  terrain is left alone. Locked hexes are never repainted. */
	carves?: string;
	/** How wide the carve is: 0 = the path's own hexes, 1 = those and the
	 *  hexes beside them. Unset = 0. */
	carveWidth?: number;
}

export interface PathChain {
	typeName: string;         // references PathType.name
	hexes: string[];          // "x_y" keys
	/** Paths-table columns this build doesn't know (header → value), kept and written back as-is. */
	extra?: Record<string, string>;
}

/** A hex key "x_y" (offset coordinates), as everywhere else. */
export type HexKey = string;

/**
 * One branch of a path: an ordered list of anchors. Between consecutive
 * anchors the hexes are the deterministic route (src/paths/router.ts).
 * branches[0] of a path is its main line; a later branch whose first anchor
 * lies on the path is a fork from there (derived, never stored).
 */
export interface PathBranch {
	/** Branch column: "main", "to Saltmere"... Optional, user-owned text. */
	label?: string;
	/** In order. One anchor = a path that's still being started. */
	anchors: HexKey[];
	/** Path-routes columns this build doesn't know (header → value), kept as-is. */
	extra?: Record<string, string>;
}

/**
 * A named path of one type, stored as anchors + branches (the anchored model
 * that replaces every-hex PathChains). PathChain stays as the *resolved* shape.
 */
export interface MapPath {
	/** Unique within the map (compared case-insensitively). Links the Paths and Path routes tables. */
	name: string;
	/** References PathType.name in the map's palette. Unknown types draw grey. */
	typeName: string;
	/** Free text, user-owned. */
	notes?: string;
	/** branches[0] is the main line. Never empty once written. */
	branches: PathBranch[];
	/** Paths-table columns this build doesn't know, kept as-is. */
	extra?: Record<string, string>;
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

/**
 * A child map's role under its parent hex (plan-overworld-regions §1).
 * Named to avoid clashing with src/mapKinds.ts `MapKind` ("world" | "space").
 * - region: the parent hex itself, at the scale the parent picked once;
 *   at most one per hex.
 * - location: a separate place (town, dungeon, ship) with its own size; any
 *   number per hex. Every submap made before regions is a location.
 */
export type SubmapKind = "region" | "location";

/** How a map's regions cover its hexes. Set once, fixed once a region exists. */
export interface RegionSettings {
	/** "hex": a hex of hexes (hex flower); "rect": an n×n block per hex. */
	footprint: "hex" | "rect";
	/** hex: radius r (1..5 → 7/19/37/61/91 hexes); rect: n (n×n). */
	size: number;
	/** How far neighbouring regions blend into each other. Unset = "normal".
	 *  Stays editable: it only affects regions made afterwards. */
	blend?: "narrow" | "normal" | "wide";
	/** Palette every region uses (fixed with the rest). */
	palette?: string;
	/** World id the regions share (phase 2 meshing). */
	worldId?: string;
	/** Stagger of the regions' shared grid (phase 2 meshing). */
	stagger?: "odd" | "even";
	/** Default generator for new regions; unset = match the hex's terrain. */
	generator?: string;
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
	/** Role under `parent`. Unset with a parent = "location" (every older submap). */
	submapKind?: SubmapKind;
	/** How this map's regions cover its hexes, once set up (see RegionSettings).
	 *  Locked while any region of this map exists (regionsLocked). */
	regions?: RegionSettings;
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
	/**
	 * The map's paths, as stored (anchors + branches; map note format 5).
	 * The model: MapStore keeps it, and pathChains in step with it.
	 */
	paths?: MapPath[];
	/**
	 * COMPATIBILITY VIEW of `paths` for code not yet switched to them: one
	 * chain per resolved branch (every hex). MapStore keeps it in step both
	 * ways: it's rebuilt when `paths` change (load, hand edit, migration), and
	 * edits made to it (the path tool, generators, type renames) are folded
	 * back into `paths` on the next save (see src/paths/chainView.ts).
	 */
	pathChains: PathChain[];
	showCoords?: boolean;        // undefined = true (backwards-compatible)
	showTerrainIcons?: boolean;  // undefined = true
	showIconOverrides?: boolean; // undefined = true
	showPaths?: boolean;         // undefined = true
	showFactionOverlay?: boolean; // undefined = false (opt-in)
	showRegionOverlay?: boolean;  // undefined = false (opt-in)
	showGmLayer?: boolean;        // undefined = true (older maps); new maps are created with false
	showTokens?: boolean;         // undefined = true (on by default)
	/** The "?" on hexes with an On arrival roll still to come. undefined = true. */
	showUncharted?: boolean;
	/** Corner badges per link type (towns, dungeons…). undefined = true. */
	showLinkBadges?: boolean;
	/** Badge types turned off in the layers menu (BADGE_SECTIONS names). */
	hiddenLinkBadges?: string[];
	/** Link badge size, "s" | "m" | "l"; undefined = DEFAULT_BADGE_SIZE (linkBadges.ts). */
	linkBadgeSize?: string;
	showHexNames?: boolean;       // undefined = true: hex name labels on the map
	showTokenNames?: boolean;     // undefined = true: name under each token
	/** Hexes a party token has stood on, first visit first ("x_y"; `visited:` in the map note). */
	visited?: string[];
	/** The visited marks (layers menu → Labels). undefined = true. */
	showVisited?: boolean;
	/** Hex-name font (NM3): "theme" | "serif" | "sans" | "handwritten"; unset = the plugin default. */
	hexNameFont?: string;
	/** Hex-name size: "small" | "medium" | "large" | "huge" (or a multiplier); unset = the plugin default. */
	hexNameSize?: string;
	/** Hex-name style: "bold" | "bold italic" | "regular" | "italic"; unset = the plugin default. */
	hexNameStyle?: string;
	staggerOffset?: "odd" | "even"; // undefined = inherit global setting
	/** Slot on a shared grid of neighbouring regions (see src/worldgen/world.ts). */
	world?: { id: string; cx: number; cy: number };
	/** The generator (biome) a region was made from, so later neighbours can
	 *  blend with it. `from` lists the neighbouring biomes it was blended with:
	 *  a transition region between them and `generator`. */
	biome?: RegionBiome;
	/** Region maps: the seed its terrain was last generated with (Reroll picks a new one). */
	regionSeed?: number;
	/** Region maps: weight on its biome's neighbour influence (`neighbour-influence:`, 0–2; unset = 1, the biome's tuning as-is). */
	neighbourInfluence?: number;
	/** The map's own seed (`seed:`): places made on arrival from its hexes
	 *  are seeded from it, so they don't depend on the map's name. */
	seed?: number;
	/** Generator tables per role (`sector-hexes-table: "[[…]]"`, T11): role
	 *  id (worldgen/tableRoles.ts) → table note path. Inherited by every map
	 *  under this one unless that map sets its own. */
	roleTables?: Record<string, string>;
	/** "When you arrive somewhere new" (`on-arrival:`), as written: "make
	 *  places" or "off". Unset = the parent map's, else off. Read with
	 *  arrival/arrival.ts parseArrivalMode. */
	arrivalMode?: string;
	/** A place made on arrival (`arrival:`): "open" while Play may still
	 *  reroll it, "locked" once the user locked it (then only God may). */
	arrival?: string;
	/** How often a place made on arrival was rerolled (`arrival-rerolls:`). */
	arrivalRerolls?: number;
	/** A map made by New map → Generate (SF7, worldgen/freshMap.ts): the
	 *  generator's id (`generator:`), its options as "key=value, …"
	 *  (`generator-options:`) and seed (`generator-seed:`), so Reroll can
	 *  make it again while it's open. */
	generator?: string;
	generatorOptions?: string;
	generatorSeed?: number;
	/** Overworlds: "regions" shows every region's hexes stitched together on
	 *  the map (the full view); "biomes" shows the overworld's own hexes, one
	 *  biome each. Unset = regions once the map has any. */
	overworldView?: "regions" | "biomes";
	/** Overworlds and their regions: the small overworld panel. Unset = shown. */
	showMinimap?: boolean;
	/** Overworlds, Regions view: region paths that cross region seams. Unset = shown. */
	showRegionPaths?: boolean;
	/** Work mode (Play / Build / God, src/workMode.ts), as written in the
	 *  map note (`mode: god`). Unset = Build. */
	workMode?: string;
	/** Overworlds made by World biomes: the river's hexes, source to mouth,
	 *  as "x,y > x,y > …" (biome data drawn on the overworld; not a path). */
	biomeRiver?: string;
	/** Overworlds: the biome pool note (vault path) its biomes were placed from (`biome-pool: "[[…]]"`). */
	biomePool?: string;
	/** Overworlds: what generating does with the pool's biomes that have no
	 *  climate (BC2), as written: "fill gaps" (default) or "never"
	 *  (`no-climate-biomes: never`). Read with worldBiomes.parseUnclimated. */
	biomeGaps?: string;
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
	/** Paths maps on this palette can draw (roads, rivers, jump routes…), in
	 *  picker order. Stored as the "Path types" table in the palette note.
	 *  Every palette has them once the palette store has loaded. */
	pathTypes?: PathType[];
	/** Map type the palette is for: `map-kind` in its note's frontmatter.
	 *  Unset = worked out from its terrain types (paletteKind in
	 *  mapKinds.ts). The shipped palettes set it, so a land palette made for
	 *  planet surfaces (Space - Planet) counts as space content. */
	kind?: MapKind;
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
	/** A colour typed in the palette note that can't be read: `color` is the
	 *  grey it's drawn with (UNREAD_GREY) and this is the text as typed,
	 *  written back to the note while `color` is still that grey, so the
	 *  plugin's rewrites never lose it. Set only by the note reader. */
	unreadColor?: string;
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
	/** Data format stamp (src/migrations/stamp.ts): 1 or absent = 1.5.x and earlier. */
	dataFormat?: number;
	/** Migrations that changed this vault, by id, in the order they ran (src/migrations/registry.ts). */
	migrationsRun?: string[];
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
	/** Play log folder (one dated note per day). Blank = `<world>/log` (src/play/playLog.ts). */
	logFolder?: string;
	/** Icon a link section's "Show on map" offers, by section (blank = none). Unset = src/play/linkIcons.ts defaults. */
	linkSectionIcons?: Partial<Record<string, string>>;
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
	/** Vault folder holding biome notes (#50). Empty = "{worldFolder}/biomes". */
	biomesFolder?: string;
	/** Shipped biomes already written into biome notes (ids): each is written once, so a deleted one stays deleted. */
	biomesSeeded?: string[];
	/** Shipped biomes whose notes got their climate added (ids): once each, so a climate cleared by hand stays cleared. */
	biomeClimatesSeeded?: string[];
	/** Vault folder for biome pool notes; blank = `<worldFolder>/biome-pools`. */
	biomePoolsFolder?: string;
	/** True once the shipped "All biomes" pool note was written (once, so a deleted one stays deleted). */
	biomePoolSeeded?: boolean;
	/** True once every overworld's Biome column was filled (BC1 migration, once per vault). */
	biomeColumnsFilled?: boolean;
	/** One-time note-format rewrites already done in this vault (src/migrations/ (noteRewrites.ts and the v1.5-*.ts note steps): NF1–NF3). */
	noteFormatUpgrades?: string[];
	/** Hex notes carry their hex's terrain, area, icon and name as properties (MG4; src/maps/hexProps.ts). Unset = on. */
	hexNoteProperties?: boolean;
	/** Vault folder for world types notes (which worlds space generators place); blank = `<worldFolder>/world-types`. */
	worldTypesFolder?: string;
	/** True once the shipped "Default space" world types note was written (once, so a deleted one stays deleted). */
	worldTypesSeeded?: boolean;
	/** True once settings-only palettes were written out as notes. */
	palettesMigrated: boolean;
	/**
	 * The palette notes the plugin has written or read (SM-DEL): the folder,
	 * and each palette's note path by palette name. A palette counts as
	 * deleted at startup only when it's recorded here, in the same folder,
	 * and its note is gone; without a record its note is written again.
	 */
	paletteNotes?: { folder: string; notes: Record<string, string> };
	/**
	 * True once every path type's behaviour (avoid impassable, auto-route,
	 * routing) was written out explicitly (PA5). Before that, blank cells in
	 * palette notes are read with the old name rules (src/migrations/v1.5-path-types-explicit.ts).
	 */
	pathTypesExplicit?: boolean;
	/**
	 * True once palette notes' colours were written as inline code
	 * (`` `#14223d` ``, not a tag), after a backup of the notes.
	 */
	paletteColorsCode?: boolean;
	/** Enabled map types (see src/mapKinds.ts). Unset = all. */
	mapKinds: string[];
	/**
	 * Map types whose shipped content (palettes, biome notes, world types)
	 * is installed (src/kindContent.ts). A type's content goes in once, when
	 * it is first on (setup wizard, or Map types in settings), so a deleted
	 * palette or biome note stays deleted. null = a fresh install whose
	 * setup hasn't picked its map types yet: no biome notes or world types
	 * are written until it does (saved as null so a restart still knows).
	 */
	kindContent?: string[] | null;
	/** True once the one-time silent "add roll ranges to older tables" upgrade ran (DJ-Q6). */
	tableRangesUpgraded?: boolean;
	/** True once existing palettes got terrain types (one-time seeding). */
	terrainTypesSeeded: boolean;
	/** Default hex-name font for maps without their own (NM3; see hexNameFont.ts). Unset = theme font, medium, bold. */
	hexNameFont?: string;
	hexNameSize?: string;
	hexNameStyle?: string;
	/** Bundled-palette terrains already offered to installed copies ("expanded/savanna"); see presetUpdates.ts. */
	presetTerrainsAdded?: string[];
	/** Shipped path-type fields already offered to palettes ("river/carves"); see presetUpdates.ts. */
	presetPathFieldsAdded?: string[];
	/** Terrain legend on the map and generator previews. Unset = shown. */
	showTerrainLegend?: boolean;
	/** The map export form's last choices, per map name (round 6 S9). */
	mapExportPrefs?: Record<string, MapExportPrefs>;
	/** Terrain legend size. Unset = "m". */
	terrainLegendSize?: "s" | "m" | "l";
	/** On-map legend folded to a small "Legend" chip. */
	terrainLegendCollapsed?: boolean;
	/** New maps default to the Expanded palette: true on fresh installs,
	 *  false for installs that predate it (GEN1; see resolveExpandedDefault).
	 *  Only seeds `defaultPalette` now. */
	expandedByDefault?: boolean;
	/** "Palette for new maps": a palette name; "" or unset = the first
	 *  palette of an enabled map type (see defaultPaletteFor). Seeded once
	 *  by resolveDefaultPalette. */
	defaultPalette?: string;
	/** One-time upgrades of palette data that used to be inferred from
	 *  names at run time (see PaletteStore.load): space role types (moon,
	 *  comet, starport…) and a preset's child palette / submap defaults
	 *  copied into same-named installed palettes. */
	paletteDataUpgraded?: boolean;
	/** Folder holding the plugin's note templates (hex, town). Empty =
	 *  "{worldFolder}/templates" (see src/noteTemplates.ts). */
	templatesFolder: string;
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
	/** Turns the map's GM layer on (offered when Hidden/Secret are hidden because it's off). */
	onEnableGmLayer?: () => void;
	/** Called when the user clicks a neighbour tile to navigate to an adjacent hex. */
	onNavigate?: (x: number, y: number) => void;
	/** Called when the modal closes (e.g. to clear the selected-hex highlight). */
	onModalClose?: () => void;
	/** Called when the user picks a map from the hex's Maps strip (or the flower's centre dot). */
	onSwitchMap?: (mapName: string) => void;
	/** "New map from this hex…" (Region or Location) for hex (x, y). */
	onNewChildMap?: (x: number, y: number) => void;
	/** "Link existing map…" for hex (x, y). */
	onLinkExistingMap?: (x: number, y: number) => void;
	/** The hex's Locations list (reorder, unlink). */
	onManageLocations?: (x: number, y: number) => void;
	/** Called after the user agrees to step from the hex flower into a neighbouring region's hex. */
	onCrossToRegion?: (mapName: string, x: number, y: number) => void;
}
