import { describe, it } from "node:test";
import expect from "expect";
import { fakeRoot } from "./helpers/fakeDom";
import { readSurface, readSource } from "./helpers/source";
import { drawPartyControls, PARTY_CONTROLS_CLS } from "../src/hex-map/view/partyControls";
import { ToolState } from "../src/hex-map/view/toolState";
import { toolModeLabel } from "../src/hex-map/toolMode";
import { TOOL_ACTIONS } from "../src/workMode";
import { manualExportOptions } from "../src/modules/manual/exportForm";
import type { HexBrush } from "../src/modules/types";
import { MemVault } from "./helpers/memVault";
import { FogService } from "../src/hexflower/FogService";
import { setFog } from "../src/hexflower/context";

/**
 * HF11's core seams: the party controls' selected
 * state and brush buttons, the hexBrush tool, the step in place, and fog
 * as a filter in every layer that draws a hex's own things.
 */

const brush: HexBrush = { id: "b.pick", label: "Picking hexes", stroke: async () => [] };

describe("party controls: a selected choice and a brush button", () => {
	function setup(active: string | null) {
		const { root, el } = fakeRoot();
		const toggled: string[] = [];
		const map: Record<string, unknown> = { name: "m", workMode: "play", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, exploreFog: "on", exploreReveal: "2 rings", exploreSeen: ["2: 2"] };
		const vault = new MemVault();
		const plugin = { app: vault.app(), settings: { hexOrientation: "flat", staggerOffset: "odd" }, getMap: (n: string) => (n === "m" ? map : undefined), saveSettings: async () => {} };
		setFog(plugin as never, new FogService(plugin as never, () => {}));
		const host = {
			controlsEl: () => el, pushUndo: () => {}, renderGrid: () => {}, keepViewStill: () => {},
			activeBrush: () => active, toggleBrush: (b: HexBrush) => toggled.push(b.id),
		};
		return { root, plugin, host, toggled, map };
	}
	const party = { map: "m", hex: "2_2", token: "p.md", title: "Party" };

	it("the current choice is marked (aria-pressed); a brush button says whether its brush is on, and a click toggles it", () => {
		const s = setup(null);
		drawPartyControls(s.plugin as never, s.host, party);
		const bar = s.root.find(PARTY_CONTROLS_CLS)!;
		const sees = bar.all((e) => e.attrs["data-control"] === "explore.sees")[0].buttons();
		expect(sees.map((b) => b.attrs["aria-pressed"])).toEqual(["false", "false", "true", "false", "false"]);
		expect(sees[2].classes.has("is-active")).toBe(true);
		const pick = bar.all((e) => e.attrs["data-control"] === "explore.pick")[0].buttons()[0];
		expect(pick.attrs["data-brush"]).toBe("explore.pick");
		expect(pick.attrs["aria-pressed"]).toBe("false");
		pick.fire("click");
		expect(s.toggled).toEqual(["explore.pick"]);
		const on = setup("explore.pick");
		drawPartyControls(on.plugin as never, on.host, party);
		const pickOn = on.root.find(PARTY_CONTROLS_CLS)!.all((e) => e.attrs["data-control"] === "explore.pick")[0].buttons()[0];
		expect(pickOn.attrs["aria-pressed"]).toBe("true");
	});
});

describe("the hexBrush tool", () => {
	class Tools extends ToolState {
		updates = 0;
		updateToolbarButtonStates(): void { this.updates++; }
		clearSwapHighlights(): void {}
	}
	const tools = (allowed = true) => new Tools({ modeAllows: () => allowed } as never);

	it("toggles a module's brush on and off; another tool is put down first; a mode that refuses keeps it off", () => {
		const t = tools();
		expect(t.activeBrush()).toBeNull();
		t.toggleBrush(brush);
		expect(t.drawingMode).toBe("hexBrush");
		expect(t.activeBrush()).toBe("b.pick");
		t.toggleBrush(brush);
		expect(t.drawingMode).toBeNull();
		expect(t.brush).toBeNull();
		t.toggleBrush(brush);
		t.exitCurrentMode();
		expect(t.activeBrush()).toBeNull();
		const locked = tools(false);
		locked.toggleBrush(brush);
		expect(locked.activeBrush()).toBeNull();
	});

	it("the mode bar says the brush's own words; every mode may hold it (its writes are gated by the module)", () => {
		expect(toolModeLabel({ mode: "hexBrush", erasing: false, brushLabel: "Revealing hexes" })).toBe("Revealing hexes");
		expect(toolModeLabel({ mode: "hexBrush", erasing: false })).toMatch(/^Brush/);
		expect(TOOL_ACTIONS.hexBrush).toBe("view");
	});

	it("a press and drag is one stroke (one undo, then a redraw); right-click on a hex erases it; Esc leaves it", () => {
		const input = readSurface("map-view");
		expect(input).toMatch(/if \(this\.host\.drawingMode\(\) === "hexBrush"\) \{\n\s*brushStroke = \[\];/);
		expect(input).toMatch(/if \(undo\.length\) this\.host\.undos\(\)\.pushUndo\(undo\.length === 1 \? undo\[0\] : \{ kind: "group", items: undo \}, map\);/);
		expect(input).toMatch(/\.finally\(\(\) => this\.host\.renderGrid\(\)\);/);
		// A stroke that ends without a click doesn't leave the next click swallowed.
		expect(input).toMatch(/brushStroke = null;\n[^\n]*\n[^\n]*\n\s*window\.setTimeout\(\(\) => \{ hasDragged = false; \}, 0\);/);
		expect(input).toMatch(/if \(this\.host\.drawingMode\(\) === "hexBrush" && hexX !== null && hexY !== null\) \{\n\s*brushCommit\(\[hexKey\(hexX, hexY\)\], true\);/);
		expect(input).toMatch(/else if \(this\.drawingMode === "hexBrush"\) this\.exitBrushMode\(\);/);
	});
});

describe("the party's own hex: a step in place", () => {
	it("the map view asks the modules; a look runs onLook with no move, no visited mark and no travel log", () => {
		const view = readSurface("map-view");
		expect(view).toMatch(/if \(party && click && await this\.tokens\.partyClicked\(party, click\)\) return;/);
		const look = /async lookAround\(party: TokenEntry\): Promise<void> \{[\s\S]*?\n {2}\}/.exec(view)![0];
		expect(look).toMatch(/runPartyLooked\(this\.plugin, \{ map: party\.map, hex: party\.hex, token: party\.filePath \}\)/);
		expect(look).not.toMatch(/setTokenHex|runPartyStep|runPartyEntered/);
		const runtime = readSource("src/modules/runtime.ts");
		expect(runtime).toMatch(/return said\.includes\("move"\) \? "move" : said\.includes\("look"\) \? "look" : "none";/);
	});
});

describe("fog hides a hidden hex's own things in every layer (PlayHooks.fog)", () => {
	it("the grid asks once per render, then marks hidden hexes and draws nothing of theirs (faded with the peek)", () => {
		const grid = readSource("src/hex-map/view/gridRenderer.ts");
		const ask = grid.indexOf("const fog = moduleFog(this.plugin, region);");
		expect(ask).toBeGreaterThan(0);
		expect(ask).toBeLessThan(grid.indexOf("const addHex = "));
		expect(grid).toMatch(/if \(fogged\) hexEl\.addClass\("duckmage-hex-fogged"\);\n\s*if \(regionsView \|\| \(fogged && !fog\?\.peek\)\) \{/);
		expect(grid).toMatch(/if \(!fogged\) hexEl\.dataset\.iconOverride = iconOverride;/);
		expect(grid).toMatch(/if \(gmIcons\.length > 0 && !fogged\) hexEl\.dataset\.gmIcons/);
	});

	it("areas and factions skip hidden hexes; labels, badges, names and the legend too; paths stop at the fog; other tokens hide", () => {
		const areas = readSource("src/hex-map/view/areaOverlay.ts");
		expect(areas.match(/querySelectorAll<HTMLElement>\("\.duckmage-hex:not\(\.duckmage-hex-fogged\)"\)/g)?.length).toBe(2);
		const labels = readSource("src/hex-map/view/gridLabels.ts");
		expect(labels.match(/const hidden = this\.hiddenByFog\(\);/g)?.length).toBe(4);
		const paths = readSource("src/hex-map/view/pathOverlay.ts");
		expect(paths).toMatch(/\.\.\.\(fog \? \{ visible: \(hex: string\) => !fog\.hidden\(hex\) \} : \{\}\),/);
		const tokens = readSource("src/hex-map/view/tokenLayer.ts");
		const read = tokens.indexOf('querySelectorAll<HTMLElement>(".duckmage-hex-fogged")');
		expect(read).toBeGreaterThan(0);
		// Read before the layer is written (read-then-write).
		expect(read).toBeLessThan(tokens.indexOf('const layer = gridContainer.createDiv({ cls: "duckmage-token-layer" });'));
		expect(tokens).toMatch(/if \(fogged\.has\(token\.hex\) && !isParty\(token\)\) continue;/);
		// The hover tooltip says nothing of a hidden hex (unless the GM peeks).
		const painter = readSource("src/hex-map/view/hexPainter.ts");
		expect(painter).toMatch(/if \(hexEl\.hasClass\("duckmage-hex-fogged"\) && !hexEl\.hasClass\("duckmage-hex-peek"\)\) \{\n\s*if \(hexEl\.title !== "Not seen yet"\)/);
	});

	it("exports: As the party has seen it blanks hidden hexes (PNG, PDF table, manual)", () => {
		const form = readSource("src/export/MapExportModal.ts");
		expect(form).toMatch(/asSeen\.createEl\("option", \{ value: "seen", text: "As the party has seen it \(a player handout\)" \}\);/);
		expect(form).toMatch(/\.\.\.\(fog && asSeen\?\.value === "seen" \? \{ hidden: \(hex: string\) => fog\.hidden\(hex\) \} : \{\}\),/);
		const png = readSource("src/export/mapPngRenderer.ts");
		expect(png).toMatch(/if \(opts\.hidden\?\.\(key\)\) \{ hexes\.push\(\{ key, cx: c\.cx, cy: c\.cy, factions: \[\], badges: \[\], hidden: true \}\); continue; \}/);
		expect(png).toMatch(/if \(showCoords && !hex\.hidden\) \{/);
		const hidden = (h: string) => h === "1_1";
		expect(manualExportOptions({ hidden } as never, "x.pdf", false, []).hidden).toBe(hidden);
		expect("hidden" in manualExportOptions({} as never, "x.pdf", false, [])).toBe(false);
	});
});
