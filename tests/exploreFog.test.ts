import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import type { UndoDirection } from "../src/undoBook";
import type { UndoItem } from "../src/hex-map/undoItems";
import { applyGroup, applyMapField } from "../src/hex-map/view/undoGroup";
import { fogEdge, formatSeen, parseSeen, sightKeys, withSeen } from "../src/hexflower/fog";
import { FogService } from "../src/hexflower/FogService";
import { setFog } from "../src/hexflower/context";
import { isExploreMap, isFogMap } from "../src/hexflower/exploreFields";
import { EXPLORE_MENU, exploreFog, exploreFrontier, exploreHexMenu, exploreLook, explorePartyClick, explorePartyControls, exploreStep, FOG_CONTROL_ID, PEEK_CONTROL_ID, PICK_CONTROL_ID, revealBrush, SEES_CONTROL_ID, setSight } from "../src/hexflower/exploreHooks";
import { readHexInput, startDefaults } from "../src/hexflower/StartExploringModal";
import { visibleBranches } from "../src/paths/pathGeometry";
import type { ResolvedBranch } from "../src/paths/resolve";
import { neighbourKeys } from "../src/hexKey";
import { setModeMapLookup } from "../src/modeGate";
import { allows, MENU_ACTIONS } from "../src/workMode";
import { clearRevealed, revealedNow } from "../src/hex-map/revealBounce";

/** HF11: a finished map explored by revealing it (fog of war); plan-explore-reveal-existing. */

const near = (k: string) => neighbourKeys(k, "flat", "odd");

describe("fog: the revealed hexes in the map note", () => {
	it("runs per row round trip, and read forgivingly", () => {
		const seen = new Set(["4_3", "5_3", "6_3", "9_3", "2_4", "0_0"]);
		const text = formatSeen(seen);
		expect(text).toEqual(["0: 0", "3: 4-6, 9", "4: 2"]);
		expect(parseSeen(text)).toEqual(seen);
		// Bare keys, en dashes, a string, junk.
		expect(parseSeen(["7_1", "2: 1–3", "nope", 5])).toEqual(new Set(["7_1", "1_2", "2_2", "3_2"]));
		expect(parseSeen("1: 2-3; 2: 5")).toEqual(new Set(["2_1", "3_1", "5_2"]));
		expect(parseSeen(undefined).size).toBe(0);
		// A typo can't make millions of hexes.
		expect(parseSeen(["1: 0-99999999"]).size).toBe(0);
		expect(formatSeen([])).toEqual([]);
	});

	it("what the party sees: the centre then the rings; adding and taking out; the fog's edge", () => {
		expect(sightKeys("5_5", 0, near)).toEqual(["5_5"]);
		expect(sightKeys("5_5", 1, near).length).toBe(7);
		expect(sightKeys("5_5", 2, near).length).toBe(19);
		const seen = new Set(["1_1"]);
		expect(withSeen(seen, ["1_1"], true)).toBe(seen);
		expect([...withSeen(seen, ["2_1"], true)].sort()).toEqual(["1_1", "2_1"]);
		expect([...withSeen(seen, ["1_1"], false)]).toEqual([]);
		expect(fogEdge(new Set(["5_5"]), near).sort()).toEqual(near("5_5").sort());
	});

	it("a fog map is never a map filled as it goes", () => {
		expect(isFogMap({ exploreFog: "on" } as never)).toBe(true);
		expect(isFogMap({ exploreFog: "On " } as never)).toBe(true);
		expect(isFogMap({ exploreFog: "on", exploreWith: ["[[W]] -> terrain"] } as never)).toBe(false);
		expect(isExploreMap({ exploreFog: "on" } as never)).toBe(false);
		expect(isFogMap(undefined)).toBe(false);
	});
});

describe("fog: paths stop at the fog", () => {
	const rb = (hexes: string[], extra: Partial<ResolvedBranch> = {}): ResolvedBranch => ({ path: "Road", typeName: "Road", branch: 0, hexes, anchorIdx: [0, hexes.length - 1], fallbackSegments: [], ...extra });
	it("only the steps between two shown hexes are kept; a cut branch loses its fork ties", () => {
		const shown = new Set(["1_1", "2_1", "3_1", "5_1", "6_1", "9_9"]);
		const out = visibleBranches([rb(["1_1", "2_1", "3_1", "4_1", "5_1", "6_1", "7_1"]), rb(["9_9", "8_9"], { branch: 1, forkFrom: { branch: 0, hexIdx: 2 } })], (h) => shown.has(h));
		expect(out.map((b) => b.hexes)).toEqual([["1_1", "2_1", "3_1"], ["5_1", "6_1"]]);
		// A whole shown branch is kept as it is (forks too, when the parent wasn't cut).
		const whole = rb(["1_1", "2_1"]);
		const fork = rb(["2_1", "3_1"], { branch: 1, forkFrom: { branch: 0, hexIdx: 1 } });
		expect(visibleBranches([whole, fork], (h) => shown.has(h))).toEqual([whole, fork]);
		// Its parent cut: the fork is drawn on its own.
		const cutParent = rb(["1_1", "4_1", "2_1"]);
		expect(visibleBranches([cutParent, fork], (h) => shown.has(h)).find((b) => b.branch === 1)?.forkFrom).toBeUndefined();
	});
});

/** A plugin with one map, a vault for tokens and no map store writes allowed. */
function setup(map: Record<string, unknown> = {}, files: Record<string, string> = {}) {
	const vault = new MemVault(files);
	const mapData: Record<string, unknown> = { name: "m", paletteName: "P", gridSize: { cols: 9, rows: 9 }, gridOffset: { x: 0, y: 0 }, pathChains: [], workMode: "play", ...map };
	let mapWrites = 0;
	const pushed: UndoItem[] = [];
	const plugin = {
		app: vault.app(),
		settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [mapData] },
		mapStore: { set: () => { mapWrites++; return true; }, get: () => undefined, all: () => new Map() },
		getMap: (n: string) => (n === "m" ? mapData : undefined),
		saveSettings: async () => {},
		pushUndo: (_m: string, it: UndoItem) => pushed.push(it),
		refreshHexMap: () => {},
	};
	const notices: string[] = [];
	const fog = new FogService(plugin as never, (t) => notices.push(t));
	setFog(plugin as never, fog);
	return { plugin, vault, mapData, fog, notices, pushed, mapWrites: () => mapWrites };
}

async function applyAll(plugin: ReturnType<typeof setup>["plugin"], items: UndoItem[], dir: UndoDirection) {
	const apply = async (it: UndoItem, d: UndoDirection): Promise<void> => {
		if (it.kind === "map-field") applyMapField(plugin as never, it, d);
		else if (it.kind === "group") await applyGroup(it, d, apply);
	};
	await applyGroup({ kind: "group", items }, dir, apply);
}

const PARTY = "world/tokens/Party.md";
const partyFile = (hex: string) => ({ [PARTY]: `---\ntoken: true\ntoken-hex: "${hex}"\ntoken-map: m\ntoken-party: true\n---\n` });

describe("fog: start, step, look, stop (FogService)", () => {
	afterEach(() => setModeMapLookup(null));

	it("Start exploring: a new party token, the fog on, what the party sees revealed; one undo; no map data written", async () => {
		const s = setup();
		setModeMapLookup((n) => s.plugin.getMap(n));
		const undo = await s.fog.start("m", { start: "4_4", sees: 1 });
		expect(s.mapData.exploreFog).toBe("on");
		expect(s.mapData.exploreReveal).toBe("1 ring");
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(sightKeys("4_4", 1, near)));
		expect(s.vault.frontmatter(PARTY)).toMatchObject({ "token-hex": "4_4", "token-party": true });
		expect(undo.map((u) => u.kind)).toEqual(["token", "map-field", "map-field", "map-field"]);
		expect(s.mapWrites()).toBe(0);
		// The fog view: hidden outside the sight, the GM's peek off.
		const view = exploreFog(s.plugin as never, s.mapData as never)!;
		expect(view.hidden("4_4")).toBe(false);
		expect(view.hidden("0_0")).toBe(true);
		expect(view.peek).toBe(false);
		// Undone: no fog, nothing seen.
		await applyAll(s.plugin, undo.filter((u) => u.kind === "map-field"), "undo");
		expect(s.mapData.exploreFog).toBeUndefined();
		expect(s.mapData.exploreSeen).toBeUndefined();
		expect(exploreFog(s.plugin as never, s.mapData as never)).toBeUndefined();
	});

	it("an existing token becomes the party and moves to the start", async () => {
		const s = setup({}, { "world/tokens/Scout.md": "---\ntoken: true\ntoken-hex: \"1_1\"\ntoken-map: m\n---\n" });
		const undo = await s.fog.start("m", { start: "2_2", sees: 0, token: "world/tokens/Scout.md" });
		expect(s.vault.frontmatter("world/tokens/Scout.md")).toMatchObject({ "token-hex": "2_2", "token-party": true });
		expect(undo[0]).toMatchObject({ kind: "token", path: "world/tokens/Scout.md", before: { hex: "1_1", map: "m" }, after: { hex: "2_2", map: "m" } });
		expect(s.mapData.exploreReveal).toBeUndefined();
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(["2_2"]));
	});

	it("a step reveals the sight around the hex entered (one undo with the move); undone, hidden again", async () => {
		clearRevealed();
		const s = setup({ exploreFog: "on", exploreReveal: "1 ring", exploreSeen: ["4: 4"] });
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "4_4", to: "5_4", token: PARTY });
		expect(undo.map((u) => u.kind)).toEqual(["map-field"]);
		const seen = parseSeen(s.mapData.exploreSeen);
		for (const k of sightKeys("5_4", 1, near)) expect(seen.has(k)).toBe(true);
		expect([...revealedNow("m")].length).toBe(6);
		await applyAll(s.plugin, undo, "undo");
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(["4_4"]));
		expect(s.mapWrites()).toBe(0);
	});

	it("Sees 2 then a click on the party's own hex: the ring-2 hexes are revealed, the token stays, one undo, one notice", async () => {
		const s = setup({ exploreFog: "on", exploreReveal: "1 ring", exploreSeen: formatSeen(sightKeys("4_4", 1, near)) }, partyFile("4_4"));
		expect(explorePartyClick(s.plugin as never, { map: "m", token: PARTY, from: "4_4", to: "4_4", orientation: "flat", stagger: "odd" })).toBe("look");
		setSight(s.plugin as never, "m", 2);
		expect(s.mapData.exploreReveal).toBe("2 rings");
		const undo = await exploreLook(s.plugin as never, { map: "m", hex: "4_4", token: PARTY });
		expect(undo.length).toBe(1);
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(sightKeys("4_4", 2, near)));
		expect(s.notices).toEqual(["Revealed 12 hexes (2 rings around 4, 4)."]);
		expect(s.vault.frontmatter(PARTY)).toMatchObject({ "token-hex": "4_4" });
		expect(s.mapData.visited).toBeUndefined();
		// Again: nothing new, no undo.
		expect(await exploreLook(s.plugin as never, { map: "m", hex: "4_4", token: PARTY })).toEqual([]);
		expect(s.notices.at(-1)).toBe("Nothing new to see 2 rings around 4, 4.");
	});

	it("Stop keeps what was seen (and is undoable); Start again carries on or starts over", async () => {
		const s = setup({ exploreFog: "on", explorePeek: "on", exploreSeen: ["1: 1-3"] }, partyFile("2_1"));
		const stop = s.fog.stop("m");
		expect(s.mapData.exploreFog).toBeUndefined();
		expect(s.mapData.explorePeek).toBeUndefined();
		expect(s.mapData.exploreSeen).toEqual(["1: 1-3"]);
		expect(stop.map((u) => u.kind)).toEqual(["map-field", "map-field"]);
		await applyAll(s.plugin, stop, "undo");
		expect(s.mapData.exploreFog).toBe("on");
		s.fog.stop("m");
		expect(s.fog.seenBefore("m")).toBe(3);
		await s.fog.start("m", { start: "6_6", sees: 0, token: PARTY });
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(["1_1", "2_1", "3_1", "6_6"]));
		s.fog.stop("m");
		await s.fog.start("m", { start: "6_6", sees: 0, token: PARTY, reset: true });
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(["6_6"]));
	});

	it("the GM reveals exactly one hex (nothing around it) and hides it again; the party's sight can't be hidden", async () => {
		const s = setup({ exploreFog: "on", exploreReveal: "1 ring", exploreSeen: formatSeen(sightKeys("1_1", 1, near)) }, partyFile("1_1"));
		const menu = (hex: string) => exploreHexMenu(s.plugin as never, "m", hex).map((m) => m.id);
		expect(menu("7_7")).toEqual([EXPLORE_MENU.reveal.menuId, EXPLORE_MENU.stop.menuId]);
		exploreHexMenu(s.plugin as never, "m", "7_7")[0].run();
		expect(parseSeen(s.mapData.exploreSeen).size).toBe(8);
		expect(parseSeen(s.mapData.exploreSeen).has("7_7")).toBe(true);
		expect(s.pushed.length).toBe(1);
		expect(s.notices).toEqual([]);
		expect(menu("7_7")).toEqual([EXPLORE_MENU.hide.menuId, EXPLORE_MENU.stop.menuId]);
		exploreHexMenu(s.plugin as never, "m", "7_7")[0].run();
		expect(parseSeen(s.mapData.exploreSeen).has("7_7")).toBe(false);
		// In the party's sight: no Hide again, and a pick to hide it does nothing.
		expect(menu("1_1")).toEqual([EXPLORE_MENU.stop.menuId]);
		expect(s.fog.pick("m", ["1_1"], false)).toEqual([]);
		expect(s.notices.at(-1)).toBe("The party can see that hex: it stays revealed.");
		expect(s.mapWrites()).toBe(0);
	});

	it("the Reveal hexes brush: a drag reveals each hex crossed as one undo entry and one notice; a tap on a revealed hex hides it; right-click hides", async () => {
		const s = setup({ exploreFog: "on", exploreSeen: ["0: 0"] }, partyFile("0_0"));
		const brush = revealBrush(s.plugin as never, "m");
		expect(brush.id).toBe(PICK_CONTROL_ID);
		const undo = await brush.stroke(["5_5", "5_6", "6_6", "5_5"], false);
		expect(undo.length).toBe(1);
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(["0_0", "5_5", "5_6", "6_6"]));
		expect(s.notices).toEqual(["Revealed 3 hexes."]);
		// Tap a revealed hex: hidden again (no notice for one hex).
		await brush.stroke(["5_6"], false);
		expect(parseSeen(s.mapData.exploreSeen).has("5_6")).toBe(false);
		await brush.stroke(["6_6"], true);
		expect(parseSeen(s.mapData.exploreSeen)).toEqual(new Set(["0_0", "5_5"]));
		expect(s.notices.length).toBe(1);
		// Undo the drag: as before it.
		await applyAll(s.plugin, undo, "undo");
		expect(s.mapData.exploreSeen).toEqual(["0: 0"]);
	});

	it("party controls under fog: Sees · Look, Peek, Reveal hexes, Stop; the frontier is the fog's edge; peek draws faded", () => {
		const s = setup({ exploreFog: "on", exploreSeen: ["4: 4"] }, partyFile("4_4"));
		const controls = explorePartyControls(s.plugin as never, { map: "m", hex: "4_4", token: PARTY });
		expect(controls.map((c) => [c.id, c.buttons.map((b) => b.label)])).toEqual([
			[SEES_CONTROL_ID, ["0", "1", "2", "3", "Look"]],
			[PEEK_CONTROL_ID, ["Show"]],
			[PICK_CONTROL_ID, ["Pick"]],
			[FOG_CONTROL_ID, ["Stop"]],
		]);
		void controls[1].buttons[0].run!();
		expect(s.mapData.explorePeek).toBe("on");
		expect(exploreFog(s.plugin as never, s.mapData as never)?.peek).toBe(true);
		expect(exploreFrontier(s.plugin as never, "m").sort()).toEqual(near("4_4").sort());
	});

	it("Start exploring from here: only in Play, only on a map not explored yet; every fog action is Play's", () => {
		const s = setup();
		expect(exploreHexMenu(s.plugin as never, "m", "3_3").map((m) => m.id)).toEqual([EXPLORE_MENU.start.menuId]);
		s.mapData.workMode = "build";
		expect(exploreHexMenu(s.plugin as never, "m", "3_3")).toEqual([]);
		for (const id of [EXPLORE_MENU.start, EXPLORE_MENU.reveal, EXPLORE_MENU.hide, EXPLORE_MENU.stop].map((m) => m.menuId)) {
			expect(MENU_ACTIONS[id]).toBe("explore-play");
		}
		expect(allows("play", "explore-play")).toBe(true);
		expect(MENU_ACTIONS[EXPLORE_MENU.roll.menuId]).toBe("discover");
	});

	it("the Start dialog's defaults: the clicked hex, else where the party last stood, else the middle; party tokens first", () => {
		const s = setup({ visited: ["1_1", "2_2"], exploreReveal: "2 rings" });
		const tokens = [
			{ path: "a.md", name: "Cart", map: "m" },
			{ path: "b.md", name: "Heroes", map: "m", party: true },
			{ path: "c.md", name: "Others", map: "x", party: true },
			{ path: "d.md", name: "Elsewhere", map: "x" },
		];
		const d = startDefaults(s.mapData as never, undefined, s.fog, tokens);
		expect(d.start).toBe("2_2");
		expect(d.sees).toBe(2);
		expect(d.tokens.map((t) => t.name)).toEqual(["Heroes", "Cart", "Others (on another map)"]);
		expect(startDefaults(s.mapData as never, "7_1", s.fog, []).start).toBe("7_1");
		const fresh = setup();
		expect(startDefaults(fresh.mapData as never, undefined, fresh.fog, []).start).toBe("4_4");
		expect(startDefaults(fresh.mapData as never, undefined, fresh.fog, []).sees).toBe(1);
		expect(readHexInput("4, 3")).toBe("4_3");
		expect(readHexInput(" 4_3 ")).toBe("4_3");
		expect(readHexInput("four")).toBeUndefined();
	});
});
