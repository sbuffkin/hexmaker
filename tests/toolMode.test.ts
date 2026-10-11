import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { toolModeLabel, type DrawingMode } from "../src/hex-map/toolMode";

const viewSrc = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
const toolSrc = readFileSync(path.join(process.cwd(), "src", "hex-map", "pathTool.ts"), "utf8").replace(/\r\n/g, "\n");

/** Source of the PathTool method `name`. */
function toolMethod(name: string): string {
	const m = new RegExp(`\\n  (?:private )?(?:async )?${name}\\(`).exec(toolSrc);
	const start = m ? m.index + 1 : -1;
	expect(start).toBeGreaterThan(-1);
	return toolSrc.slice(start, toolSrc.indexOf("\n  }\n", start));
}

/** Source of the HexMapView method `name` (up to its closing brace at two-space indent). */
function method(name: string): string {
	const m = new RegExp(`\\n  private (?:async )?${name}\\(`).exec(viewSrc);
	const start = m ? m.index + 1 : -1;
	expect(start).toBeGreaterThan(-1);
	return viewSrc.slice(start, viewSrc.indexOf("\n  }\n", start));
}

describe("Path tool button (fresh-eyes T7)", () => {
	it("clicking Path while drawing reopens the picker instead of exiting", () => {
		const body = method("handlePathButton");
		expect(body).toMatch(/new PathPickerModal\(/);
		expect(body).not.toMatch(/exitPathMode\(\);\s*this\.drawingMode = null/);
	});

	it("a hex-by-hex click away from the end is routed, and the bar says so (no lonely restart dots)", () => {
		expect(toolMethod("noteGap")).toMatch(/if \(this\.autoRoute\) return;[\s\S]*hexNeighbors\([\s\S]*this\.hint = /);
	});
});

describe("Path tool auto-route (P1, anchored paths)", () => {
	it("a click in path mode goes to the path tool (auto-route or hex by hex is its switch)", () => {
		expect(viewSrc).toMatch(/if \(this\.drawingMode === "path"\) \{\s*this\.pathTool\.click\(x, y, e, this\.isErasingMode\);\s*return;\s*\}/);
	});

	it("a leg avoids impassable terrain unless the type's explicit field or Cross impassable says otherwise", () => {
		const body = toolMethod("legAnchors");
		expect(body).toMatch(/this\.plugin\.paths\.styleOf\(this\.map, typeName\)/);
		expect(body).toMatch(/this\.crossImpassable && style\.avoid/);
		// a crossing is kept by pinning it with anchors the normal router reproduces
		expect(body).toMatch(/anchorsFor\(through\.hexes, routeFnFor\(router, style\)/);
		expect(body).toMatch(/noRouteMessage\(/);
	});

	it("edits are saved through the map store with one undo step, behind the edit gate", () => {
		const body = toolMethod("commit");
		expect(body).toMatch(/canEditPaths\(map, action\)/);
		expect(body).toMatch(/this\.plugin\.mapStore\.setPaths\(map, next\)/);
		expect(body).toMatch(/this\.host\.pushUndo\(map, before, clonePaths\(next\)\)/);
		// nothing else in the tool writes paths
		expect(toolSrc.match(/mapStore\.setPaths\(/g)!.length).toBe(2); // commit + applySnapshot
		expect(toolMethod("applySnapshot")).toMatch(/canEditPaths\(mapName, "history"\)/);
	});
});

describe("Path tool right-click and tokens (fresh-eyes T2)", () => {
	it("right-click on an anchor handle deletes it; on a path the menu gets that path's actions", () => {
		const start = viewSrc.indexOf('"contextmenu",');
		const handler = viewSrc.slice(start, viewSrc.indexOf("{ capture: true }", start));
		expect(handler).toMatch(/this\.drawingMode === "path"[\s\S]*this\.pathTool\.contextMenu\(e\)[\s\S]*"handled" in r\) return;[\s\S]*showPainterContextMenu\(e\.clientX, e\.clientY, hexX, hexY, pathItems\)/);
		const menu = toolMethod("contextMenu");
		for (const label of ["Split here", "Delete path: ", "Rename…", "Change type…", "Reverse"]) expect(menu).toContain(label);
		expect(menu).toMatch(/hit\.anchor !== null\) \{\s*this\.deleteAnchor\(/);
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

	it("names the regions' hexes when painting in an overworld's Regions view", () => {
		expect(toolModeLabel({ mode: "terrain", erasing: false, terrainName: "forest", regionHexes: true })).toBe("Painting region hexes: forest");
		expect(toolModeLabel({ mode: "terrain", erasing: true, regionHexes: true })).toBe("Clearing region hexes");
	});

	it("names what each tool is doing", () => {
		expect(toolModeLabel({ mode: "terrain", erasing: false, terrainName: "forest" })).toBe("Painting terrain: forest");
		expect(toolModeLabel({ mode: "terrain", erasing: false, terrainName: null })).toBe("Clearing terrain");
		expect(toolModeLabel({ mode: "terrain", erasing: false, terrainPick: true })).toMatch(/^Picking terrain/);
		expect(toolModeLabel({ mode: "icon", erasing: false, iconName: "bw-castle.svg" })).toBe("Painting icon: bw-castle");
		expect(toolModeLabel({ mode: "icon", erasing: false, iconName: "x.png", iconGmOnly: true })).toBe("Painting GM icon: x");
		expect(toolModeLabel({ mode: "path", erasing: false, pathTypeName: "Road" })).toBe("Road: click to start a path · click a path to edit it");
		expect(toolModeLabel({ mode: "path", erasing: true })).toMatch(/^Erasing paths: click a path to split it/);
		expect(toolModeLabel({ mode: "path", erasing: false, pathTypeName: "Road", pathAuto: true, pathDrawing: true, pathSelected: "King's Road" })).toBe("King's Road: click to add (auto-routes) · Esc to finish");
		expect(toolModeLabel({ mode: "path", erasing: false, pathTypeName: "Road", pathDrawing: true, pathNote: "not next to the end, so the gap was routed" })).toBe("New Road: click to add (hex by hex) · Esc to finish · not next to the end, so the gap was routed");
		expect(toolModeLabel({ mode: "path", erasing: false, pathTypeName: "Road", pathSelected: "King's Road", pathSummary: "Road, 2 forks" })).toBe("King's Road (Road, 2 forks): drag the line to reshape · click an end to continue · click the line to fork");
		expect(toolModeLabel({ mode: "path", erasing: false, pathTypeName: "Road", pathNew: true })).toBe("New Road: click where it starts");
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

describe("Map navigation buttons say where they go (fresh-eyes T4, owner playtest 2026-10-10)", () => {
	it("shows arrows only, and names the target map in the tooltip and aria-label", () => {
		const nav = method("refreshNavArrows");
		expect(nav).toContain("text: a.glyph");
		expect(nav).toContain('attr: { title: label, "aria-label": label');
		expect(nav).toContain("Back to ${this.plugin.mapLabel(a.target)}");
		expect(nav).toContain("Up to ${this.plugin.mapLabel(a.target)}");
		expect(nav).toContain("Forward to ${this.plugin.mapLabel(a.target)}");
		// Neighbours: a hex flower / d-pad with names in tooltips, no "Next to (6)" text.
		const side = method("refreshSideCrumbs");
		expect(side).not.toContain("Next to (");
		expect(side).toContain("flowerPetals(");
	});
});

describe("Hex right-click menu offers Enter submap (fresh-eyes N3)", () => {
	it("reads the hex's region and locations from the map note, not only when a hex note exists", () => {
		const menu = method("onHexContextMenu");
		expect(menu).toMatch(/submapMenuPlan\(this\.plugin\.mapStore\.get\(this\.activeMapName/);
		expect(menu).not.toMatch(/hexExists \?/);
		expect(menu).toContain("Enter region: ${this.plugin.mapLabel(region)}");
		expect(menu).toContain("Open: ${this.plugin.mapLabel(loc)}");
		expect(menu).toContain("Locations (${childPlan.listCount})…");
		expect(menu).toContain('"New map from this hex…"');
	});
});

describe("Path tool upkeep (anchored paths)", () => {
	it("a path or fork started by one click isn't stored until its second anchor (no one-hex leftovers)", () => {
		const click = toolMethod("click");
		expect(click).toMatch(/this\.pending = \{ kind: "new", hex: key \}/);
		expect(click).not.toMatch(/commit\(/);
		expect(toolMethod("append")).toMatch(/p\.branches\[0\]\.anchors\.push\(\.\.\.leg\)[\s\S]*this\.commit\(/);
	});

	it("Esc steps out one level (drag → branch → selection) before leaving the tool; Backspace deletes an anchor", () => {
		expect(viewSrc).toMatch(/this\.drawingMode === "path" && !this\.isErasingMode && this\.pathTool\.escape\(\)\) return false;\s*this\.exitCurrentMode\(\);/);
		expect(toolMethod("escape")).toMatch(/this\.drag[\s\S]*cancelDrag[\s\S]*this\.done\(\)/);
		expect(viewSrc).toMatch(/for \(const key of \["Backspace", "Delete"\]\)[\s\S]{0,200}this\.pathTool\.deleteKey\(\)/);
	});

	it("a drag previews without saving and commits once on release; dropping it back cancels", () => {
		expect(toolMethod("updatePreview")).toMatch(/this\.plugin\.paths\.setPreview\(this\.map, d\.preview\)/);
		expect(toolMethod("updatePreview")).not.toMatch(/commit\(/);
		expect(toolMethod("dragEnd")).toMatch(/if \(d\.lastHex !== d\.startHex && d\.preview\) this\.commit\(d\.preview\);/);
		// one reroute per animation frame, only on entering a new hex
		expect(toolMethod("dragMove")).toMatch(/hex === d\.lastHex\) return;[\s\S]*requestAnimationFrame/);
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

	it("pulses when a tool starts, without moving the map (round 5)", () => {
		// Round 4 also uncovered the grid here; round 5 found that slid the
		// map under the cursor as a tool started (see safeArea.test.ts).
		expect(view).toMatch(/window\.requestAnimationFrame\(\(\) => bar\.addClass\("is-new"\)\);/);
		expect(r4).toMatch(/\.duckmage-mode-bar\.is-new \{[^}]*animation: duckmage-mode-bar-pulse/);
	});

});
