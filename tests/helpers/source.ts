/**
 * Source-text access for tests that assert on what the code says (wiring,
 * labels, call shapes) rather than on what it does.
 *
 * Tests read a SURFACE, not a file: a surface is a god file plus the folder its
 * code is being split into. When a refactor moves a method out of, say,
 * HexMapView.ts into src/hex-map/view/, the text is still on the "map-view"
 * surface and no test has to change. A lane that extracts code from a surface
 * file must put it in that surface's folder (or add its new file/folder to the
 * surface below in the same commit).
 *
 * Text is returned with CRLF normalised to LF (git checks out CRLF on Windows).
 * Files are joined primary-file first, then the rest in sorted path order, with
 * a newline between them, so the result is deterministic.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

export interface Surface {
	/** The file the surface is named after (always read first). */
	file: string;
	/** Extra files or folders (walked recursively for .ts) that belong to it. */
	more: string[];
}

/** Every declared surface. Paths are repo-relative with forward slashes. */
export const SURFACES = {
	/** The hex map view and the controllers split out of it. */
	"map-view": { file: "src/hex-map/HexMapView.ts", more: ["src/hex-map/view"] },
	/** The plugin class plus the services/commands split out of it. */
	"plugin": { file: "src/HexmakerPlugin.ts", more: ["src/plugin", "src/services"] },
	/** The right-click hex editor and its section renderers. */
	"hex-editor": { file: "src/hex-map/HexEditorModal.ts", more: ["src/hex-map/editor"] },
	/** The generator page (GeneratorPanel) and its section renderers / page state. */
	"generator-page": { file: "src/worldgen/GeneratorPanel.ts", more: ["src/worldgen/genPage"] },
	/** The New map dialog. */
	"new-map-setup": { file: "src/worldgen/NewMapSetupModal.ts", more: ["src/worldgen/newMapSetup"] },
	/** The first-run setup wizard. */
	"setup-wizard": { file: "src/SetupWizardView.ts", more: ["src/setupWizard"] },
	/** The map side panel (layers menu, legend). */
	"side-panel": { file: "src/hex-map/HexSidePanel.ts", more: ["src/hex-map/sidePanel"] },
	/** The Maps modal (map tree, map properties). */
	"map-modal": { file: "src/hex-map/MapModal.ts", more: ["src/hex-map/mapModal"] },
	/** The settings tab. */
	"settings-tab": { file: "src/HexmakerSettingTab.ts", more: ["src/settings"] },
	/** The shared modal base class. */
	"modal-base": { file: "src/HexmakerModal.ts", more: [] },
	/** The hex table view. */
	"hex-table": { file: "src/hex-table/HexTableView.ts", more: ["src/hex-table/view"] },
	/** The random tables / workflows view. */
	"table-view": { file: "src/random-tables/RandomTableView.ts", more: ["src/random-tables/view"] },
	/** The table editor modal. */
	"table-editor": { file: "src/random-tables/RandomTableEditorModal.ts", more: [] },
	/** The PNG map renderer used by exports. */
	"png-renderer": { file: "src/export/mapPngRenderer.ts", more: ["src/export/png"] },
	/** The map export dialog. */
	"export-modal": { file: "src/export/MapExportModal.ts", more: [] },
	/** The note link picker (hex table, hex editor link sections). */
	"link-picker": { file: "src/hex-table/LinkPickerModal.ts", more: [] },
	/** The faction / region area pickers (to be merged into one AreaNotePickerModal). */
	"faction-picker": { file: "src/hex-map/FactionPickerModal.ts", more: ["src/hex-map/AreaNotePickerModal.ts"] },
	"region-area-picker": { file: "src/hex-map/GeoRegionPickerModal.ts", more: ["src/hex-map/AreaNotePickerModal.ts"] },
	/** The workflow runner. */
	"workflow-wizard": { file: "src/random-tables/WorkflowWizardModal.ts", more: [] },
	/** The biome library modal. */
	"biome-library": { file: "src/overworld/BiomeLibraryModal.ts", more: [] },
	/** The token create/edit modal. */
	"token-modal": { file: "src/hex-map/TokenModal.ts", more: [] },
	/** The path drawing tool. */
	"path-tool": { file: "src/hex-map/pathTool.ts", more: [] },
	/** The new child map / region dialog helpers. */
	"new-child-map": { file: "src/hex-map/newChildMap.ts", more: [] },
	/** Overworld modals (New world map, …). */
	"overworld-modals": { file: "src/overworld/OverworldModals.ts", more: [] },
	/** The biome page. */
	"biome-page": { file: "src/overworld/BiomePanel.ts", more: [] },
	/** The arrival service. */
	"arrival": { file: "src/arrival/ArrivalService.ts", more: [] },
	/** World types modal (space). */
	"world-types-modal": { file: "src/space/WorldTypesModal.ts", more: [] },
} satisfies Record<string, Surface>;

export type SurfaceName = keyof typeof SURFACES;

const norm = (text: string) => text.replace(/\r\n/g, "\n");
const posix = (p: string) => p.replace(/\\/g, "/");

function walk(rel: string): string[] {
	const abs = path.join(ROOT, rel);
	if (!existsSync(abs)) return [];
	if (!statSync(abs).isDirectory()) return [rel];
	return readdirSync(abs).flatMap((name) => {
		const child = `${rel}/${name}`;
		if (statSync(path.join(ROOT, child)).isDirectory()) return walk(child);
		return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [child] : [];
	});
}

/**
 * Repo-relative files making up a surface: its file first, then the rest sorted.
 * The named file may be gone once all its code has moved into the surface's
 * other paths; a surface with no files at all is an error.
 */
export function surfaceFiles(name: SurfaceName): string[] {
	const s: Surface = SURFACES[name];
	if (!s) throw new Error(`unknown source surface "${String(name)}"`);
	const rest = [...new Set(s.more.flatMap(walk))].filter((f) => f !== s.file).sort();
	const files = [...walk(s.file), ...rest];
	if (!files.length) throw new Error(`source surface "${name}" has no files (${s.file})`);
	return files;
}

const cache = new Map<string, string>();

/** The concatenated, LF-normalised source text of a surface. */
export function readSurface(name: SurfaceName): string {
	let text = cache.get(name);
	if (text === undefined) {
		text = surfaceFiles(name).map((f) => norm(readFileSync(path.join(ROOT, f), "utf8"))).join("\n");
		cache.set(name, text);
	}
	return text;
}

/** The surface a repo-relative file is the named file of, if any. */
export function surfaceOf(file: string): SurfaceName | undefined {
	const rel = posix(file);
	return (Object.keys(SURFACES) as SurfaceName[]).find((n) => SURFACES[n].file === rel);
}

/**
 * For tests that scan every src file and report file paths: the surface file a
 * repo-relative path belongs to (itself, or the file of the surface whose
 * folder holds it), so a reported path stays stable when code moves.
 */
export function ownerFile(file: string): string {
	const rel = posix(file);
	for (const s of Object.values(SURFACES) as Surface[]) {
		if (s.file === rel || s.more.some((m) => rel === m || rel.startsWith(m + "/"))) return s.file;
	}
	return rel;
}

/**
 * Read a repo file as LF text. A surface's named file reads the whole surface,
 * so loops over file lists keep working when code moves. Segments are joined
 * like path.join and taken relative to the repo root.
 */
export function readSource(...segments: string[]): string {
	const rel = posix(path.relative(ROOT, path.resolve(ROOT, ...segments)));
	const surface = surfaceOf(rel);
	return surface ? readSurface(surface) : norm(readFileSync(path.join(ROOT, rel), "utf8"));
}
