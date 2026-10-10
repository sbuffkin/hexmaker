import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { mapExportFileNames, mapExportStem, sanitiseFilename } from "../src/export/exportNames";

/**
 * Fresh-eyes round 3: the export form said "Output: kerrigan.png" but wrote
 * "kerrigan-region.png" (ticking an overlay by its label didn't refresh the
 * preview). The preview and the exporters now share these names.
 */
describe("map export file names", () => {
	it("defaults to the map name", () => {
		expect(mapExportFileNames({ base: "", mapName: "kerrigan" })).toEqual({
			png: "kerrigan.png",
			pdf: "kerrigan.pdf",
			manual: "kerrigan manual.pdf",
		});
	});

	it("adds overlay suffixes to the PNG and PDF, faction before region", () => {
		const n = mapExportFileNames({ base: "kerrigan", mapName: "kerrigan", showRegionOverlay: true, showFactionOverlay: true });
		expect(n.png).toBe("kerrigan-faction-region.png");
		expect(n.pdf).toBe("kerrigan-faction-region.pdf");
		// The manual keeps the plain name.
		expect(n.manual).toBe("kerrigan manual.pdf");
	});

	it("uses the typed name, trimmed, and names the player manual", () => {
		const n = mapExportFileNames({ base: "  barony-players ", mapName: "barony", player: true });
		expect(n.png).toBe("barony-players.png");
		expect(n.manual).toBe("barony-players player.pdf");
	});

	it("the stem the exporters get matches the previewed PNG name", () => {
		const o = { base: "sweep", mapName: "kerrigan", showRegionOverlay: true };
		expect(`${sanitiseFilename(mapExportStem(o))}.png`).toBe(mapExportFileNames(o).png);
	});

	it("strips characters a vault file name can't hold", () => {
		expect(mapExportFileNames({ base: 'a/b:c?"d', mapName: "m" }).png).toBe("a_b_c__d.png");
	});
});

describe("PNG export carries no GM-only content", () => {
	// A player handout is safe because the renderer never reads the GM
	// layer or note sections. Fails loudly if someone adds them. Tokens are
	// an export option (X1, owner decision 2026-10-10), but hidden ones are
	// never drawn.
	const src = readFileSync(new URL("../src/export/mapPngRenderer.ts", import.meta.url), "utf8");

	it("never reads GM icons or hidden/secret sections", () => {
		expect(src).not.toMatch(/gmIcons|gm-icons|getGmIcon/i);
		expect(src).not.toMatch(/["'](Hidden|Secret)["']/);
	});

	it("draws tokens only when asked, and never hidden ones", () => {
		expect(src).toMatch(/const showTokens = opts\.showTokens \?\? false;/);
		expect(src).toMatch(/!t\.visible/);
	});
});
