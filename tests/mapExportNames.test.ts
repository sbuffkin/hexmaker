import { describe, it } from "node:test";
import expect from "expect";
import { mapExportBase, mapExportFileNames, mapExportStem, sanitiseFilename } from "../src/export/exportNames";
import { manualFileName } from "../src/modules/manual/manualModel";
import { describeWith } from "./helpers/slices";

/**
 * Fresh-eyes round 3: the export form said "Output: kerrigan.png" but wrote
 * "kerrigan-region.png" (ticking an overlay by its label didn't refresh the
 * preview). The preview and the exporters now share these names.
 */
describe("map export file names", () => {
	it("defaults to the map name; no module parts, no other files", () => {
		expect(mapExportFileNames({ base: "", mapName: "kerrigan" })).toEqual({
			png: "kerrigan.png",
			pdf: "kerrigan.pdf",
			parts: {},
		});
	});

	it("adds overlay suffixes to the PNG and PDF, faction before region", () => {
		const n = mapExportFileNames({ base: "kerrigan", mapName: "kerrigan", showRegionOverlay: true, showFactionOverlay: true });
		expect(n.png).toBe("kerrigan-faction-area.png");
		expect(n.pdf).toBe("kerrigan-faction-area.pdf");
	});

	it("uses the typed name, trimmed", () => {
		expect(mapExportFileNames({ base: "  barony-players ", mapName: "barony" }).png).toBe("barony-players.png");
	});

	it("names each module part's file by its id, from the base name (typed, else the map name)", () => {
		const parts = [
			{ id: "a", fileName: (base: string) => `${base} a.pdf` },
			{ id: "b" },
		];
		expect(mapExportFileNames({ base: "", mapName: "kerrigan", showRegionOverlay: true }, parts).parts).toEqual({ a: "kerrigan a.pdf" });
		expect(mapExportFileNames({ base: " barony ", mapName: "kerrigan" }, parts).parts).toEqual({ a: "barony a.pdf" });
		expect(mapExportBase({ base: "  ", mapName: "m" })).toBe("m");
	});

	it("the stem the exporters get matches the previewed PNG name", () => {
		const o = { base: "sweep", mapName: "kerrigan", showRegionOverlay: true };
		expect(`${sanitiseFilename(mapExportStem(o))}.png`).toBe(mapExportFileNames(o).png);
	});

	it("strips characters a vault file name can't hold", () => {
		expect(mapExportFileNames({ base: 'a/b:c?"d', mapName: "m" }).png).toBe("a_b_c__d.png");
	});
});

describeWith("manual", "hexcrawl manual file name", () => {
	it("keeps the plain name (no overlay suffix) and names the player version", () => {
		expect(manualFileName("kerrigan", false)).toBe("kerrigan manual.pdf");
		expect(manualFileName("barony-players", true)).toBe("barony-players player.pdf");
		expect(manualFileName('a/b', false)).toBe("a_b manual.pdf");
	});
});

describe("PNG export carries no GM-only content", () => {
	// A player handout is safe because the renderer never reads the GM
	// layer or note sections. Fails loudly if someone adds them. Tokens are
	// an export option (X1, owner decision 2026-10-10), but hidden ones are
	// never drawn.
	const src = readSurface("png-renderer");

	it("never reads GM icons or hidden/secret sections", () => {
		expect(src).not.toMatch(/gmIcons|gm-icons|getGmIcon/i);
		expect(src).not.toMatch(/["'](Hidden|Secret)["']/);
	});

	it("draws tokens only when asked, and never hidden ones", () => {
		expect(src).toMatch(/const showTokens = opts\.showTokens \?\? false;/);
		expect(src).toMatch(/!t\.visible/);
	});
});

// ── Round 6 S9/S10: the form starts from the view and remembers ────────────
import { EXPORT_LAYER_KEYS, exportLayerDefaults } from "../src/export/exportNames";
import { exportedMessage } from "../src/export/exportFolder";
import { readSurface, readSource } from "./helpers/source";

describe("export form defaults (round 6 S9)", () => {
	it("follows the map view's toggles when nothing was saved", () => {
		const d = exportLayerDefaults({ showCoords: false, showHexNames: true, showTokens: false, showLinkBadges: false, showLegend: true });
		expect(d.showCoords).toBe(false);
		expect(d.showHexNames).toBe(true);
		expect(d.showTokens).toBe(false);
		expect(d.showLinkBadges).toBe(false);
		expect(d.showLegend).toBe(true);
		// Unset view toggles are on, like the map.
		expect(exportLayerDefaults({}).showPaths).toBe(true);
	});

	it("keeps the faction and region overlays off unless ticked before", () => {
		expect(exportLayerDefaults({}).showFactionOverlay).toBe(false);
		expect(exportLayerDefaults({}, { layers: { showFactionOverlay: true } }).showFactionOverlay).toBe(true);
	});

	it("prefers the last choices for the map over the view", () => {
		const d = exportLayerDefaults({ showCoords: true }, { layers: { showCoords: false } });
		expect(d.showCoords).toBe(false);
		expect(Object.keys(d).sort()).toEqual([...EXPORT_LAYER_KEYS].sort());
	});

	it("offers Link badges and Legend ticks and remembers the choices", () => {
		const src = readSurface("export-modal");
		expect(src).toContain(`"Link badges"`);
		expect(src).toContain(`"Legend"`);
		expect(src).toContain("mapExportPrefs");
	});
});

describe("re-exporting says so (round 6 S10)", () => {
	it("reads Replaced for an overwrite", () => {
		expect(exportedMessage("world/exports/a.png", true)).toBe("Replaced world/exports/a.png");
		expect(exportedMessage("world/exports/a.png", false)).toBe("Exported to world/exports/a.png");
	});

	it("no exporter opens a fresh leaf without checking for an open one", () => {
		for (const f of ["mapPngRenderer.ts", "exporters/mapWithTable.ts", "exporters/singleHex.ts", "exporters/singleNote.ts", "exporters/workflow.ts", "exporters/randomTable.ts"]) {
			expect(readSource("src/export", f)).not.toContain("getLeaf(false).openFile");
		}
	});
});
