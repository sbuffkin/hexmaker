// Fresh-eyes pass 8 (solo space player, 2026-10-11): F8–F16, C3, C11.
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultSubmapLabel } from "../src/hex-map/submapNav";
import { newMapItemTitle, parentHexTerrain, type ParentHexHost } from "../src/maps/submaps";
import { CHILD_KIND_TEXT, childKindText } from "../src/hex-map/newChildMap";
import { registry } from "../src/modules";

const SPACE_CHILD_KIND_TEXT = registry.kindInfo("space")!.childKindText!;
import { allows, MENU_ACTIONS } from "../src/workMode";
import { readSurface } from "./helpers/source";

const src = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("F14: default submap names are short and unique", () => {
	it("uses the hex's terrain and this level's coordinates, never a chain", () => {
		expect(defaultSubmapLabel(undefined, "The Drift 2, 7", 12, 5, { terrain: "barren world" })).toBe("Barren world 12, 5");
		// No terrain: the parent's own trailing coordinates are dropped.
		expect(defaultSubmapLabel(undefined, "The Drift 2, 7", 12, 5)).toBe("The Drift 12, 5");
		expect(defaultSubmapLabel(undefined, "The Drift", 12, 5)).toBe("The Drift 12, 5");
		// The hex's own name still wins.
		expect(defaultSubmapLabel("Kessia", "The Drift 2, 7", 12, 5, { terrain: "garden world" })).toBe("Kessia");
	});

	it("stays unique among the maps (case and spacing ignored)", () => {
		const taken = ["barren world 12, 5", "Barren world 12, 5 (2)", "Kessia"];
		expect(defaultSubmapLabel(undefined, "X", 12, 5, { terrain: "barren world", taken })).toBe("Barren world 12, 5 (3)");
		expect(defaultSubmapLabel(" Kessia ", "X", 1, 1, { taken })).toBe("Kessia (2)");
		expect(defaultSubmapLabel(undefined, "X", 1, 1, { terrain: "ocean world", taken })).toBe("Ocean world 1, 1");
	});
});

describe("F11: the parent hex's terrain, from the parent's map data", () => {
	const host = (hex: { terrain?: string; name?: string } | undefined, base?: string): ParentHexHost => ({
		parentOf: (m) => (m === "system" ? { map: "sector", hex: "2_7" } : undefined),
		getMap: (m) => (m === "sector" ? { baseTerrain: base } : undefined),
		mapLabel: (m) => (m === "sector" ? "The Drift" : m),
		mapStore: { get: (m, k) => (m === "sector" && k === "2_7" ? hex : undefined) },
	});

	it("reads the hex's terrain and labels the hex", () => {
		expect(parentHexTerrain(host({ terrain: "barren world" }), "system")).toEqual({ terrain: "barren world", label: "The Drift 2, 7" });
		expect(parentHexTerrain(host({ terrain: "garden world", name: "Kessia" }), "system")).toEqual({ terrain: "garden world", label: "Kessia" });
	});

	it("falls back to the parent's base terrain; nothing for top maps or bare hexes", () => {
		// No hex entry at all (most hexes have no note): still found via the map's base terrain.
		expect(parentHexTerrain(host(undefined, "empty space"), "system")?.terrain).toBe("empty space");
		expect(parentHexTerrain(host(undefined), "system")).toBeUndefined();
		expect(parentHexTerrain(host({ terrain: "x" }), "sector")).toBeUndefined();
	});

	it("the map view shows it in the breadcrumb", () => {
		const view = readSurface("map-view");
		expect(view).toContain("parentHexTerrain(this.plugin, this.activeMapName)");
		expect(view).toContain("text: `from: ${from.terrain}`");
	});
});

describe("C11: a hex that has a map offers it first, not a re-make", () => {
	it("names the make-a-map item for what it does", () => {
		expect(newMapItemTitle(undefined)).toBe("New map from this hex…");
		expect(newMapItemTitle({ locations: [] })).toBe("New map from this hex…");
		expect(newMapItemTitle({ locations: ["planet"] })).toBe("Add another map…");
		expect(newMapItemTitle({ regionMap: "r" })).toBe("Add another map…");
	});

	it("the hex editor's + menu and the New map dialog list the existing maps", () => {
		expect(readSurface("hex-editor")).toContain('"editor.new-map", newMapItemTitle(');
		const dialog = readSurface("new-child-map");
		expect(dialog).toContain("This hex already has:");
		expect(dialog.indexOf("This hex already has:")).toBeLessThan(dialog.indexOf('card("region", why)'));
	});
});

describe("F10: Region vs Location says which fits on a space map", () => {
	it("space cards name star systems and planets as Locations", () => {
		expect(childKindText(undefined)).toBe(CHILD_KIND_TEXT);
		expect(childKindText("world")).toBe(CHILD_KIND_TEXT);
		expect(childKindText("space")).toBe(SPACE_CHILD_KIND_TEXT);
		expect(SPACE_CHILD_KIND_TEXT.location.desc).toMatch(/star system/i);
		expect(SPACE_CHILD_KIND_TEXT.location.desc).toMatch(/planet/i);
		expect(SPACE_CHILD_KIND_TEXT.region.desc).toMatch(/not for a single star system or planet/i);
	});

	it("keys off the map's palette (space terrain types), not terrain names", () => {
		const dialog = readSurface("new-child-map");
		expect(dialog).toContain("childKindText(plugin.kindFor(this.parentMap))");
	});
});

describe("F8: a token's menu also has its hex's items", () => {
	const view = readSurface("map-view");
	it("adds the hex's items after the token's, under a label", () => {
		const at = view.indexOf("private showTokenContextMenu");
		const body = view.slice(at, view.indexOf("\n  }\n", at));
		expect(body.indexOf('"token.remove"')).toBeLessThan(body.indexOf("this.addHexMenuItems(menu, hx, hy, true)"));
		expect(body).toContain("menu.addLabel(");
		expect(body).toContain("this.addOverworldMenuItems(menu, evt, hx, hy)");
	});
});

describe("C3: Play can enter existing maps; only making new ones needs Build", () => {
	it("entering and opening a hex's maps are allowed in Play", () => {
		for (const id of ["hex.enter-region", "hex.open-location", "hex.locations", "ow.enter-region", "ow.locations"] as const) {
			expect(allows("play", MENU_ACTIONS[id])).toBe(true);
		}
		expect(allows("play", MENU_ACTIONS["hex.new-map"])).toBe(false);
		expect(allows("build", MENU_ACTIONS["hex.new-map"])).toBe(true);
	});
});

describe("F12: no notices for expected, harmless cases", () => {
	it("generated paths with no path type on the new map are skipped quietly", () => {
		const setup = readSurface("new-map-setup");
		expect(setup).not.toContain("new Notice(`Skipped paths with no matching path type");
		expect(setup).toMatch(/if \(missing\.length\) console\.warn\(/);
	});

	it("a palette installed for a new map is quiet; Add palette still says so", () => {
		const plugin = readSurface("plugin");
		expect(plugin).toMatch(/async ensurePaletteInstalled[\s\S]*?installPalettePreset\(name, undefined, \{ quiet: true \}\)/);
		expect(plugin).toContain("if (!opts.quiet) new Notice(`Added palette");
		expect(src("src", "palettes", "AddPaletteModal.ts")).toMatch(/installPalettePreset\(preset\.name\)/);
	});
});

describe("F15: the token form doesn't jump when note suggestions close", () => {
	it("the suggestion list drops down out of flow", () => {
		expect(readSurface("token-modal")).toContain('resultsAnchor.createDiv({ cls: "duckmage-note-picker-results is-dropdown" })');
		const css = src("styles.css");
		expect(css).toMatch(/\.duckmage-note-picker-anchor \{\s*position: relative;\s*height: 0;/);
		expect(css).toMatch(/\.duckmage-note-picker-results\.is-dropdown \{\s*position: absolute;/);
	});
});

describe("F16: the palette editor's title follows the palette shown", () => {
	it("updates the header on every render", () => {
		const view = src("src", "palettes", "PaletteEditorView.ts");
		const at = view.indexOf("private render(): void {");
		expect(view.slice(at, at + 400)).toContain("this.refreshHeader();");
		expect(view).toContain("updateHeader?.()");
	});
});

describe("F9: world types rows: a new row shows and takes focus; a delete doesn't shift rows", () => {
	const modal = readSurface("world-types-modal");
	it("Add row focuses the new row's first field", () => {
		expect(modal).toContain('this.renderRows({ row: this.cells[this.tab].length - 1, target: "first" })');
		expect(modal).toContain('rowEl.scrollIntoView({ block: "nearest" })');
	});
	it("a delete keeps scroll and height, and focuses the list, not a field", () => {
		expect(modal).toContain("el.scrollTop = scrollTop;");
		expect(modal).toContain('() => ({ row: i, target: "list" }), true)');
		expect(modal).toContain('el.addEventListener("mouseleave", () => spacer.remove(), { once: true })');
	});
});
