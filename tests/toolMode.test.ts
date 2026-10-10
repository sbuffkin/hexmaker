import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { pathClickOutcome, toolModeLabel, type DrawingMode } from "../src/hex-map/toolMode";

const viewSrc = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");

/** Source of the HexMapView method `name` (up to its closing brace at two-space indent). */
function method(name: string): string {
	const m = new RegExp(`\\n  private (?:async )?${name}\\(`).exec(viewSrc);
	const start = m ? m.index + 1 : -1;
	expect(start).toBeGreaterThan(-1);
	return viewSrc.slice(start, viewSrc.indexOf("\n  }\n", start));
}

describe("pathClickOutcome (fresh-eyes T7)", () => {
	const around = ["2_1", "3_2", "3_3", "2_3", "1_3", "1_2"]; // neighbours of 2_2

	it("starts a path when none is in progress", () => {
		expect(pathClickOutcome(null, "5_5", [])).toBe("start");
	});

	it("extends the path on a neighbour of its end", () => {
		expect(pathClickOutcome("2_2", "3_2", around)).toBe("extend");
	});

	it("ignores a click on the end itself (no stacked dot)", () => {
		expect(pathClickOutcome("2_2", "2_2", around)).toBe("same");
	});

	it("reports a restart for a distant hex so the caller can explain it", () => {
		expect(pathClickOutcome("2_2", "6_6", around)).toBe("restart");
	});
});

describe("Path tool button (fresh-eyes T7)", () => {
	it("clicking Path while drawing reopens the picker instead of exiting", () => {
		const body = method("handlePathButton");
		expect(body).toMatch(/new PathPickerModal\(/);
		expect(body).not.toMatch(/exitPathMode\(\);\s*this\.drawingMode = null/);
	});

	it("a restart on a non-adjacent hex shows a hint", () => {
		const body = method("onHexPathDrawClick");
		expect(body).toMatch(/outcome === "restart"[\s\S]*new Notice\(/);
	});
});

describe("Path tool right-click and tokens (fresh-eyes T2)", () => {
	it("right-click on a hex of the path being drawn removes it instead of opening the menu", () => {
		const start = viewSrc.indexOf('"contextmenu",');
		const handler = viewSrc.slice(start, viewSrc.indexOf("{ capture: true }", start));
		expect(handler).toMatch(/this\.drawingMode === "path"[\s\S]*pathChainWithHex\([\s\S]*onHexPathDeleteClick\(hexX, hexY, this\.activePathTypeName\)[\s\S]*return;[\s\S]*showPainterContextMenu/);
	});

	it("the delete only touches chains of the given path type", () => {
		expect(method("onHexPathDeleteClick")).toMatch(/typeName !== null && chains\[ci\]\.typeName !== typeName\) continue/);
	});

	it("tokens let clicks through while a drawing tool is active", () => {
		const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\s+/g, " ");
		expect(css).toContain(".duckmage-hex-map-viewport.duckmage-draw-mode .duckmage-token { pointer-events: none; }");
	});
});

describe("toolModeLabel (fresh-eyes T3: sticky modes need an indicator)", () => {
	it("is null when no tool is active", () => {
		expect(toolModeLabel({ mode: null, erasing: false })).toBeNull();
	});

	it("names what each tool is doing", () => {
		expect(toolModeLabel({ mode: "terrain", erasing: false, terrainName: "forest" })).toBe("Painting terrain: forest");
		expect(toolModeLabel({ mode: "terrain", erasing: false, terrainName: null })).toBe("Clearing terrain");
		expect(toolModeLabel({ mode: "terrain", erasing: false, terrainPick: true })).toMatch(/^Picking terrain/);
		expect(toolModeLabel({ mode: "icon", erasing: false, iconName: "bw-castle.svg" })).toBe("Painting icon: bw-castle");
		expect(toolModeLabel({ mode: "icon", erasing: false, iconName: "x.png", iconGmOnly: true })).toBe("Painting GM icon: x");
		expect(toolModeLabel({ mode: "path", erasing: false, pathTypeName: "Road" })).toBe("Drawing Road: click neighbouring hexes");
		expect(toolModeLabel({ mode: "path", erasing: true })).toMatch(/^Erasing paths/);
		expect(toolModeLabel({ mode: "regionLink", erasing: false, regionPath: "world/regions/Kerrigan.md" })).toBe("Painting region: Kerrigan");
		expect(toolModeLabel({ mode: "factionLink", erasing: true })).toBe("Erasing factions");
		expect(toolModeLabel({ mode: "tableLink", erasing: false, tablePath: "world/tables/ocean.md" })).toBe("Linking table: ocean");
		expect(toolModeLabel({ mode: "submapLink", erasing: false, submapName: "deep" })).toBe("Linking submap: deep");
		expect(toolModeLabel({ mode: "swap", erasing: false })).toMatch(/^Swapping hexes/);
		expect(toolModeLabel({ mode: "placeToken", erasing: false })).toMatch(/^Placing token/);
	});

	it("the map view refreshes the bar with the toolbar and Esc exits the tool", () => {
		expect(method("updateToolbarButtonStates")).toMatch(/this\.updateModeBar\(\);/);
		expect(viewSrc).toMatch(/this\.scope\.register\(\[\], "Escape"[\s\S]{0,600}this\.exitCurrentMode\(\)/);
	});
});

describe("Map navigation buttons say where they go (fresh-eyes T4)", () => {
	it("labels Up/Back as parent/previous map and names the target map", () => {
		expect(viewSrc).toContain('text: "↑ parent map"');
		expect(viewSrc).toContain('text: "← previous map"');
		const nav = method("refreshMapNav");
		expect(nav).toMatch(/backBtn\.setAttr\("aria-label", label\)/);
		expect(nav).toMatch(/upBtn\.setAttr\("aria-label", label\)/);
		expect(nav).toMatch(/previous map: \$\{prev\}/);
		expect(nav).toMatch(/parent map: \$\{parent\.map\}/);
	});
});

describe("Hex right-click menu offers Enter submap (fresh-eyes N3)", () => {
	it("reads the submap from the map note, not only when a hex note exists", () => {
		const menu = method("onHexContextMenu");
		expect(menu).toMatch(/const submap = getSubmapFromFile\(this\.app, hexPath\);/);
		expect(menu).not.toMatch(/hexExists \?/);
		expect(menu).toContain("Enter submap: ${submap}");
	});
});

describe("Path chain upkeep (fresh-eyes T7/T2 follow-up)", () => {
	it("a restart drops the abandoned one-hex start (never drawn, would linger in the data)", () => {
		expect(method("onHexPathDrawClick")).toMatch(/abandoned && abandoned\.hexes\.length === 1[\s\S]*pathChains\.splice\(i, 1\)/);
	});

	it("removing the end of the path being drawn steps the end back one hex", () => {
		expect(method("onHexPathDeleteClick")).toMatch(/const stepBack = pos === chain\.hexes\.length && chain\.hexes\.length > 0;/);
	});
});

describe("Esc with the tool menu open (fresh-eyes T3 follow-up)", () => {
	it("closes the menu first and keeps the tool", () => {
		expect(viewSrc).toMatch(/"Escape", \(\) => \{[\s\S]{0,300}this\.painterMenu\?\.isOpen\(\)[\s\S]{0,80}this\.painterMenu\.close\(\);\s*return false;/);
	});
});

describe("the tool mode bar (round 4)", () => {
	it("has a label for every drawing tool", () => {
		const modes: DrawingMode[] = ["path", "terrain", "icon", "tableLink", "submapLink", "factionLink", "regionLink", "swap", "placeToken"];
		for (const mode of modes) {
			for (const erasing of [false, true]) {
				expect(toolModeLabel({ mode, erasing })).toEqual(expect.any(String));
			}
		}
		expect(toolModeLabel({ mode: null, erasing: false })).toBeNull();
	});

	const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
	const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\r\n/g, "\n");
	const r4 = css.slice(css.indexOf("Fresh-eyes r4"));

	it("sits in the toolbar band, not over the bottom row", () => {
		expect(r4).toMatch(/\.duckmage-hex-map-controls \.duckmage-mode-bar \{[^}]*top: 42px;[^}]*bottom: auto;/);
		expect(view).toMatch(/this\.topBandEls = \[tableBtn, rtBtn, mapNavGroup, this\.undoBtn, this\.redoBtn\];\n\s+if \(this\.modeBarEl\) this\.topBandEls\.push\(this\.modeBarEl\);/);
	});

	it("pulses when a tool starts and keeps hexes out from under it", () => {
		expect(view).toMatch(/bar\.addClass\("is-new"\);\n\s+if \(!wasShown\) this\.uncoverGrid\(\);/);
		expect(r4).toMatch(/\.duckmage-mode-bar\.is-new \{[^}]*animation: duckmage-mode-bar-pulse/);
	});

});
