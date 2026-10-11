import { describe, it } from "node:test";
import expect from "expect";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ACTION_POLICY,
	allows,
	COMMAND_ACTIONS,
	lockedHint,
	lockedSummary,
	MENU_ACTIONS,
	MODE_ACTIONS,
	modeFor,
	TOOL_ACTIONS,
	type ModeAction,
} from "../src/workMode";

/**
 * Regression guard for the work modes (plan-work-modes §2.6): every
 * registered command, every drawing tool and every item of the map view's
 * menus must be classified in src/workMode.ts, so a new feature can't ship
 * without saying which modes may use it.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");

function sources(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(join(root, dir))) {
		const rel = `${dir}/${name}`;
		if (statSync(join(root, rel)).isDirectory()) out.push(...sources(rel));
		else if (name.endsWith(".ts")) out.push(rel);
	}
	return out;
}

const src = sources("src");

describe("work mode classification covers every entry point", () => {
	it("every registered command is classified (and none is stale)", () => {
		const ids = [
			...src.flatMap((f) => [...read(f).matchAll(/addCommand\(\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1])),
			// Modules' command contributions (src/modules/<id>/runtime.ts).
			...src.filter((f) => /^src\/modules\/[^/]+\/runtime\.ts$/.test(f))
				.flatMap((f) => [...read(f).matchAll(/\{\s*id:\s*"([^"]+)",\s*name:\s*"/g)].map((m) => m[1])),
		];
		expect(ids.length).toBeGreaterThan(10);
		const missing = ids.filter((id) => !(id in COMMAND_ACTIONS));
		expect(missing).toEqual([]);
		const stale = Object.keys(COMMAND_ACTIONS).filter((id) => !ids.includes(id));
		expect(stale).toEqual([]);
	});

	it("every drawing tool is classified (and none is stale)", () => {
		const union = /export type DrawingMode =([^;]+);/.exec(read("src/hex-map/toolMode.ts"))![1];
		const tools = [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
		expect(tools.length).toBeGreaterThan(5);
		expect(Object.keys(TOOL_ACTIONS).sort()).toEqual(tools);
	});

	it("the map view builds its menus only through ModeMenu, with classified ids", () => {
		const files = ["src/hex-map/HexMapView.ts", "src/hex-map/HexEditorModal.ts"];
		const used = new Set<string>();
		for (const f of files) {
			const text = read(f);
			// A raw Obsidian Menu would bypass the mode table.
			expect({ file: f, rawMenus: (text.match(/new Menu\(|\.addItem\(/g) ?? []).length }).toEqual({ file: f, rawMenus: 0 });
			for (const m of text.matchAll(/\bmenu\.add\(\s*"([^"]+)"/g)) used.add(m[1]);
		}
		// The overworld menu's ids come from overworldMenu() as `ow.<id>`.
		const owIds = /id:\s*("[^;]+?");/.exec(read("src/overworld/overworldInput.ts"))![1];
		for (const m of owIds.matchAll(/"([^"]+)"/g)) used.add(`ow.${m[1]}`);
		const unclassified = [...used].filter((id) => !(id in MENU_ACTIONS));
		expect(unclassified).toEqual([]);
		const stale = Object.keys(MENU_ACTIONS).filter((id) => !used.has(id));
		expect(stale).toEqual([]);
	});

	it("every mapping points at a real action", () => {
		for (const a of [...Object.values(COMMAND_ACTIONS), ...Object.values(TOOL_ACTIONS), ...Object.values(MENU_ACTIONS)]) {
			expect(MODE_ACTIONS).toContain(a);
		}
	});
});

describe("work mode policy", () => {
	it("God may do everything; every action is allowed somewhere", () => {
		for (const a of MODE_ACTIONS) {
			expect(allows("god", a)).toBe(true);
			expect(ACTION_POLICY[a].modes.length).toBeGreaterThan(0);
		}
	});

	it("each mode allows everything the mode below it does (Play ⊂ Build ⊂ God)", () => {
		for (const a of MODE_ACTIONS) {
			if (allows("play", a)) expect(allows("build", a)).toBe(true);
			if (allows("build", a)) expect(allows("god", a)).toBe(true);
		}
	});

	it("Play is what a GM does during a game: tokens, notes, rolls, looking around", () => {
		const play: ModeAction[] = ["view", "navigate", "open-note", "edit-note", "link-note", "roll", "token", "export", "switch-mode"];
		for (const a of play) expect(allows("play", a)).toBe(true);
	});

	it("Play locks map data: painting, paths, links to maps, size, properties, new maps from it", () => {
		const locked: ModeAction[] = ["paint-terrain", "paint-icon", "paint-region-area", "edit-path", "link-map", "grow-map", "shrink-map", "new-child-map", "map-properties", "place-biome", "reshape", "swap-hexes", "delete-map"];
		for (const a of locked) expect(allows("play", a)).toBe(false);
	});

	it("Build adds and edits; reshaping, swapping, shrinking and deleting need God", () => {
		for (const a of ["paint-terrain", "paint-icon", "paint-region-area", "edit-path", "link-map", "grow-map", "new-child-map", "map-properties", "place-biome"] as ModeAction[]) {
			expect(allows("build", a)).toBe(true);
		}
		for (const a of ["reshape", "swap-hexes", "shrink-map", "delete-map"] as ModeAction[]) {
			expect(allows("build", a)).toBe(false);
			expect(modeFor(a)).toBe("god");
		}
	});

	it("never locks note text, settings or palettes (WM2, WM4)", () => {
		for (const a of ["edit-note", "settings", "tables"] as ModeAction[]) expect(ACTION_POLICY[a].modes).toEqual(["play", "build", "god"]);
	});

	it("tools: Play keeps tokens and note links, loses painting and paths", () => {
		expect(allows("play", TOOL_ACTIONS.placeToken)).toBe(true);
		expect(allows("play", TOOL_ACTIONS.factionLink)).toBe(true);
		expect(allows("play", TOOL_ACTIONS.tableLink)).toBe(true);
		for (const t of ["terrain", "icon", "path", "regionLink", "submapLink"] as const) expect(allows("play", TOOL_ACTIONS[t])).toBe(false);
		expect(allows("build", TOOL_ACTIONS.swap)).toBe(false);
	});

	it("hints are one short line naming the mode that unlocks the action", () => {
		expect(lockedHint("paint-terrain")).toBe("Switch to Build to paint terrain.");
		expect(lockedHint("delete-map")).toBe("Switch to God to delete the map.");
		expect(lockedSummary([])).toBeNull();
		expect(lockedSummary(["swap-hexes"])).toBe("Switch to God to swap hexes.");
		// Several: the lowest mode that unlocks any of them.
		expect(lockedSummary(["swap-hexes", "paint-terrain", "edit-path"])).toBe("Switch to Build to edit the map.");
		expect(lockedSummary(["swap-hexes", "paint-terrain"])).toBe("Switch to Build to paint terrain.");
	});
});
