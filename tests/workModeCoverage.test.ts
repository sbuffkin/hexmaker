import { describe, it } from "node:test";
import expect from "expect";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSource } from "./helpers/source";
import { everyModule, moduleOn } from "./helpers/slices";
import {
	ACTION_POLICY,
	allows,
	COMMAND_ACTIONS,
	CORE_ACTION_POLICY,
	CORE_COMMAND_ACTIONS,
	CORE_MENU_ACTIONS,
	lockedHint,
	lockedSummary,
	MENU_ACTIONS,
	MODE_ACTIONS,
	modeFor,
	TOOL_ACTIONS,
	type ModeAction,
} from "../src/workMode";

/**
 * The tables with every module's rows, whichever slices this run builds
 * (npm run test:slices): the scan below reads every module's source.
 */
const MODULES_ALL = everyModule();
const ALL_COMMANDS: Record<string, ModeAction> = Object.assign({}, CORE_COMMAND_ACTIONS, ...MODULES_ALL.map((m) => m.modeActions?.commands ?? {}));
const ALL_MENUS: Record<string, ModeAction> = Object.assign({}, CORE_MENU_ACTIONS, ...MODULES_ALL.map((m) => m.modeActions?.menus ?? {}));
const ALL_ACTIONS = Object.keys(Object.assign({}, CORE_ACTION_POLICY, ...MODULES_ALL.map((m) => m.modeActions?.policy ?? {})));

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
			...src.flatMap((f) => [...read(f).matchAll(/(?:addCommand\(|addPlaced\("[^"]+",\s*)\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1])),
			// Modules' command contributions (src/modules/<id>/runtime.ts).
			...src.filter((f) => /^src\/modules\/[^/]+\/runtime\.ts$/.test(f))
				// (Not their settings, which have ids and names too: "Settings.<key>".)
				.flatMap((f) => [...read(f).matchAll(/\{\s*id:\s*"(?!Settings\.)([^"]+)",\s*name:\s*"/g)].map((m) => m[1])),
		];
		expect(ids.length).toBeGreaterThan(10);
		const missing = ids.filter((id) => !(id in ALL_COMMANDS));
		expect(missing).toEqual([]);
		const stale = Object.keys(ALL_COMMANDS).filter((id) => !ids.includes(id));
		expect(stale).toEqual([]);
	});

	it("every drawing tool is classified (and none is stale)", () => {
		const union = /export type DrawingMode =([^;]+);/.exec(readSource("src/hex-map/toolMode.ts"))![1];
		const tools = [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
		expect(tools.length).toBeGreaterThan(5);
		expect(Object.keys(TOOL_ACTIONS).sort()).toEqual(tools);
	});

	it("the map view builds its menus only through ModeMenu, with classified ids", () => {
		const files = ["src/hex-map/HexMapView.ts", "src/hex-map/HexEditorModal.ts"];
		const used = new Set<string>();
		for (const f of files) {
			const text = readSource(f);
			// A raw Obsidian Menu would bypass the mode table.
			expect({ file: f, rawMenus: (text.match(/new Menu\(|\.addItem\(/g) ?? []).length }).toEqual({ file: f, rawMenus: 0 });
			for (const m of text.matchAll(/\bmenu\.add\(\s*"([^"]+)"/g)) used.add(m[1]);
		}
		// Modules' hex and token menu items (ModuleRuntime.hexMenu, play.tokenMenu): `menuId: "hex.<id>"`
		// or `id: "token.<id>"` in their code.
		for (const f of src.filter((p) => /^src\/(modules|hexflower)\//.test(p))) {
			for (const m of read(f).matchAll(/menuId:\s*"([^"]+)"/g)) used.add(m[1]);
			for (const m of read(f).matchAll(/\bid:\s*"((?:hex|token)\.[^"]+)"/g)) used.add(m[1]);
		}
		// The overworld menu's ids come from overworldMenu() as `ow.<id>`.
		const owIds = /id:\s*("[^;]+?");/.exec(readSource("src/overworld/overworldInput.ts"))![1];
		for (const m of owIds.matchAll(/"([^"]+)"/g)) used.add(`ow.${m[1]}`);
		const unclassified = [...used].filter((id) => !(id in ALL_MENUS));
		expect(unclassified).toEqual([]);
		const stale = Object.keys(ALL_MENUS).filter((id) => !used.has(id));
		expect(stale).toEqual([]);
	});

	it("every mapping points at a real action", () => {
		for (const a of [...Object.values(ALL_COMMANDS), ...Object.values(TOOL_ACTIONS), ...Object.values(ALL_MENUS)]) {
			expect(ALL_ACTIONS).toContain(a);
		}
		// In this build: every mapping of the modules built points at an action this build knows.
		for (const a of [...Object.values(COMMAND_ACTIONS), ...Object.values(MENU_ACTIONS)]) expect(MODE_ACTIONS).toContain(a);
	});

	it("a module's rows are its own: none shadows a core id, and a build has exactly the rows of the modules built", () => {
		for (const m of MODULES_ALL) {
			const rows = m.modeActions ?? {};
			for (const id of Object.keys(rows.commands ?? {})) expect({ m: m.id, id, core: id in CORE_COMMAND_ACTIONS }).toEqual({ m: m.id, id, core: false });
			for (const id of Object.keys(rows.menus ?? {})) expect({ m: m.id, id, core: id in CORE_MENU_ACTIONS }).toEqual({ m: m.id, id, core: false });
			for (const id of Object.keys(rows.policy ?? {})) expect({ m: m.id, id, core: id in CORE_ACTION_POLICY }).toEqual({ m: m.id, id, core: false });
			const on = moduleOn(m.id);
			for (const id of Object.keys(rows.commands ?? {})) expect({ id, built: id in COMMAND_ACTIONS }).toEqual({ id, built: on });
			for (const id of Object.keys(rows.menus ?? {})) expect({ id, built: id in MENU_ACTIONS }).toEqual({ id, built: on });
			for (const id of Object.keys(rows.policy ?? {})) expect({ id, built: id in ACTION_POLICY }).toEqual({ id, built: on });
		}
	});

	it("an action no module of this build classifies is God's only (never throws)", () => {
		const unknown = "no-such-action" as ModeAction;
		expect(allows("play", unknown)).toBe(false);
		expect(allows("god", unknown)).toBe(true);
		expect(lockedHint(unknown)).toBe("Switch to God to do that.");
	});
});

describe("work mode policy", () => {
	it("God may do everything; every action is allowed somewhere", () => {
		for (const a of MODE_ACTIONS) {
			expect(allows("god", a)).toBe(true);
			expect(ACTION_POLICY[a]!.modes.length).toBeGreaterThan(0);
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

	it("an explored map grows (blank hexes only) as the party nears its edge, in every mode like discovering (HF4)", () => {
		// Hex flower's own action (its module classifies it).
		const grow = MODULES_ALL.find((m) => m.id === "hex-flower")!.modeActions!.policy!["grow-while-exploring"]!;
		expect(grow.modes).toEqual(["play", "build", "god"]);
		expect(grow.modes).toEqual(ACTION_POLICY.discover!.modes);
		expect(allows("play", "grow-while-exploring")).toBe(moduleOn("hex-flower"));
		// Growing by hand stays Build's.
		expect(allows("play", "grow-map")).toBe(false);
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
		for (const a of ["edit-note", "settings", "tables"] as ModeAction[]) expect(ACTION_POLICY[a]!.modes).toEqual(["play", "build", "god"]);
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
