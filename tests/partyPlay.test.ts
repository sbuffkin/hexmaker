import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { MemVault } from "./helpers/memVault";
import { fakeRoot } from "./helpers/fakeDom";
import { applyTokenFrontmatter } from "../src/frontmatter";
import { moveLogText, onPartyMoved } from "../src/play/partyLog";
import { logDayName } from "../src/play/playLog";
import { clearRevealed, markRevealed, REVEAL_BOUNCE_MS, revealedNow } from "../src/hex-map/revealBounce";
import { drawPartyControls, PARTY_CONTROLS_CLS } from "../src/hex-map/view/partyControls";
import { WorkModeButton } from "../src/hex-map/view/workModeButton";
import { setExplore } from "../src/hexflower/context";
import { REVEAL_CONTROL_ID } from "../src/hexflower/exploreHooks";
import { ringOrder } from "../src/hexflower/exploreOrder";
import { neighbourKeys } from "../src/hexKey";
import type { UndoItem } from "../src/hex-map/undoItems";

/** Play: the party's moves in the log (P1), its controls and Reveal (HF3), the bounce. */

const NOW = new Date(2026, 9, 16, 14, 32);

/** A plugin with a vault, a log folder and a "Party" token on map m. */
async function logSetup(files: Record<string, string> = {}) {
	const vault = new MemVault({ "world/tokens/Party.md": "", ...files });
	const app = vault.app() as unknown as Record<string, unknown> & { metadataCache: Record<string, unknown> };
	app.metadataCache.fileToLinktext = (f: { path: string }) => f.path.replace(/\.md$/, "");
	await applyTokenFrontmatter(app as never, "world/tokens/Party.md", { hex: "5_4", map: "m", visible: true, party: true });
	const made: string[] = [];
	const plugin = {
		app,
		settings: { worldFolder: "world", logFolder: "Sessions" },
		hexPath: (x: number, y: number) => `world/hexes/m/${x}_${y}.md`,
		createHexNote: async (x: number, y: number) => { made.push(`${x}_${y}`); return null; },
		mapLabel: () => "Vale",
		hexLinkAlias: () => "Vale 5, 4",
	};
	return { vault, plugin, made };
}

describe("a party move writes a log line (P1)", () => {
	it("the line says where from and where to", () => {
		expect(moveLogText({ from: "4_4", to: "5_4" })).toBe("Moved from 4, 4 to 5, 4.");
	});

	it("goes to the day's note in the play log folder, naming the party; the token's note and the hexes are left alone", async () => {
		const s = await logSetup();
		const tokenBefore = s.vault.files.get("world/tokens/Party.md");
		await onPartyMoved(s.plugin as never, { map: "m", from: "4_4", to: "5_4", token: "world/tokens/Party.md" }, NOW);
		const log = s.vault.files.get(`Sessions/${logDayName(NOW)}.md`);
		expect(log).toBe(`# ${logDayName(NOW)}\n\n- 14:32 · Vale 5, 4 · [[world/tokens/Party]] · Moved from 4, 4 to 5, 4.\n`);
		expect(s.vault.files.get("world/tokens/Party.md")).toBe(tokenBefore);
		// No hex note made per step.
		expect(s.made).toEqual([]);
		expect([...s.vault.files.keys()].some((p) => p.startsWith("world/hexes/"))).toBe(false);
	});

	it("links the hex when its note exists, without touching it", async () => {
		const hex = "---\nterrain: forest\n---\n# 5, 4\n";
		const s = await logSetup({ "world/hexes/m/5_4.md": hex });
		await onPartyMoved(s.plugin as never, { map: "m", from: "4_4", to: "5_4", token: "world/tokens/Party.md" }, NOW);
		expect(s.vault.files.get(`Sessions/${logDayName(NOW)}.md`)).toMatch(/· \[\[world\/hexes\/m\/5_4\|Vale 5, 4\]\] · /);
		expect(s.vault.files.get("world/hexes/m/5_4.md")).toBe(hex);
	});

	it("a failed write never throws (the step keeps its undo)", async () => {
		const s = await logSetup();
		(s.plugin.app as unknown as { vault: Record<string, unknown> }).vault.create = async () => { throw new Error("disk full"); };
		await expect(onPartyMoved(s.plugin as never, { map: "m", from: "4_4", to: "5_4" }, NOW)).resolves.toBeUndefined();
	});

	it("the map view logs every step and records the visited marks in the step's undo (P2)", () => {
		const layer = readFileSync("src/hex-map/view/tokenLayer.ts", "utf8");
		// Only in Play: dragging the party around in Build or God isn't logged.
		expect(layer).toMatch(/if \(this\.host\.undos\.currentWorkMode\(\) === "play"\) void onPartyMoved\(this\.plugin, step\);/);
		const undo = readFileSync("src/hex-map/view/undoController.ts", "utf8");
		expect(undo).toMatch(/if \(item\.field === "visited"\) this\.host\.renderGrid\(\);/);
	});
});

describe("revealed hexes bounce in (HF3)", () => {
	it("marked hexes are drawn bouncing for a moment, with their ring", () => {
		clearRevealed();
		markRevealed("m", new Map([["2_2", 0], ["2_3", 1]]), 1000);
		markRevealed("m", ["4_4"], 1000);
		expect([...revealedNow("m", 1200)]).toEqual([["2_2", 0], ["2_3", 1], ["4_4", 0]]);
		expect(revealedNow("other", 1200).size).toBe(0);
		// Drawn once: a redraw (an undo) a moment later doesn't bounce them again.
		expect(revealedNow("m", 1300).size).toBe(0);
		markRevealed("m", ["1_1"], 1000);
		expect(revealedNow("m", 1000 + REVEAL_BOUNCE_MS + 1).size).toBe(0);
		expect(revealedNow("m", 1200).size).toBe(0);
	});

	it("the grid tags them; the CSS bounce stops under reduced motion", () => {
		const grid = readFileSync("src/hex-map/view/gridRenderer.ts", "utf8");
		expect(grid).toMatch(/const revealed = revealedNow\(region\.name\);/);
		expect(grid).toMatch(/hexEl\.addClass\("duckmage-hex-reveal"\);/);
		// Only hexes with terrain bounce.
		expect(grid).toMatch(/if \(ring !== undefined && ownTerrain\) \{/);
		const css = readFileSync("styles.css", "utf8");
		expect(css).toMatch(/\.duckmage-hex\.duckmage-hex-reveal \{\s*animation: duckmage-hex-reveal-bounce/);
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.duckmage-hex\.duckmage-hex-reveal \{ animation: none; \}/);
	});

	it("rings: around the centre, one ring at a time, each reached from the ring before", () => {
		const near = (k: string) => neighbourKeys(k, "flat", "odd");
		const order = ringOrder("5_5", 3, near);
		expect(order.filter((o) => o.ring === 1).length).toBe(6);
		expect(order.filter((o) => o.ring === 2).length).toBe(12);
		expect(order.filter((o) => o.ring === 3).length).toBe(18);
		const ringOf = new Map([["5_5", 0], ...order.map((o): [string, number] => [o.hex, o.ring])]);
		for (const o of order) expect(ringOf.get(o.from)).toBe(o.ring - 1);
		expect(ringOrder("5_5", 0, near)).toEqual([]);
	});
});

describe("the party controls (HF3)", () => {
	function setup(explored: boolean) {
		const { root, el } = fakeRoot();
		const calls: [string, string, number][] = [];
		const item: UndoItem = { kind: "map-field", mapName: "m", field: "hexFlowerAt", before: undefined, after: ["W: 3"] };
		const map: Record<string, unknown> = { gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, workMode: "play" };
		const plugin = { getMap: (n: string) => (n === "m" ? map : undefined) };
		setExplore(plugin as never, {
			exploreMap: (m: string) => (explored && m === "m" ? {} : undefined),
			reveal: async (m: string, hex: string, rings: number) => {
				calls.push([m, hex, rings]);
				// Revealing 3 rings from the middle grows the map (HF4).
				if (rings === 3) { map.gridOffset = { x: -4, y: -4 }; map.gridSize = { cols: 13, rows: 13 }; }
				return [item];
			},
		} as never);
		const pushed: [UndoItem, string][] = [];
		const still: unknown[] = [];
		let renders = 0;
		const host = {
			controlsEl: () => el, pushUndo: (it: UndoItem, m: string) => pushed.push([it, m]), renderGrid: () => { renders++; },
			keepViewStill: (before: unknown, after: unknown) => still.push([before, after]),
		};
		const party = { map: "m", hex: "2_2", token: "world/tokens/Party.md", title: "Party" };
		return { root, plugin, host, party, calls, pushed, item, still, renders: () => renders };
	}

	it("on an explored map: the party's name and Reveal 1 · 2 · 3; a click reveals that far as one undo", async () => {
		const s = setup(true);
		drawPartyControls(s.plugin as never, s.host, s.party);
		const bar = s.root.find(PARTY_CONTROLS_CLS)!;
		expect(bar.find("duckmage-party-controls-name")?.text).toBe("Party");
		const reveal = bar.all((e) => e.attrs["data-control"] === REVEAL_CONTROL_ID)[0];
		expect(reveal.find("duckmage-party-control-label")?.text).toBe("Reveal");
		expect(reveal.buttons().map((b) => b.text)).toEqual(["1", "2", "3"]);
		reveal.buttons()[1].fire("click");
		await new Promise((r) => setTimeout(r, 0));
		expect(s.calls).toEqual([["m", "2_2", 2]]);
		expect(s.pushed).toEqual([[s.item, "m"]]);
		expect(s.renders()).toBe(1);
		// The map didn't grow: the view isn't moved.
		expect(s.still).toEqual([]);
	});

	it("a Reveal that grew the map redraws and keeps the view still (HF4)", async () => {
		const s = setup(true);
		drawPartyControls(s.plugin as never, s.host, s.party);
		const reveal = s.root.find(PARTY_CONTROLS_CLS)!.all((e) => e.attrs["data-control"] === REVEAL_CONTROL_ID)[0];
		reveal.buttons()[2].fire("click");
		await new Promise((r) => setTimeout(r, 0));
		expect(s.renders()).toBe(1);
		expect(s.still).toEqual([[{ x: 0, y: 0, cols: 5, rows: 5 }, { x: -4, y: -4, cols: 13, rows: 13 }]]);
	});

	it("a party step that grew the map keeps the view still too", () => {
		const layer = readFileSync("src/hex-map/view/tokenLayer.ts", "utf8");
		expect(layer).toMatch(/const gridBefore = gridBoxOf\(this\.host\.getActiveMap\(\)\);\s*const filled = await runPartyEntered/);
		expect(layer).toMatch(/if \(!sameGrid\(gridBefore, gridAfter\)\) this\.host\.keepViewStill\(gridBefore, gridAfter\);/);
	});

	it("a bar left over after leaving Play does nothing (no fill, no undo on another mode's queue)", async () => {
		const s = setup(true);
		drawPartyControls(s.plugin as never, s.host, s.party);
		(s.plugin.getMap("m") as Record<string, unknown>).workMode = "build";
		const reveal = s.root.find(PARTY_CONTROLS_CLS)!.all((e) => e.attrs["data-control"] === REVEAL_CONTROL_ID)[0];
		reveal.buttons()[0].fire("click");
		await new Promise((r) => setTimeout(r, 0));
		expect(s.calls).toEqual([]);
		expect(s.pushed).toEqual([]);
	});

	it("switching the mode puts the party down, which redraws the tokens and takes the bar away", () => {
		const picked: (string | null)[] = [];
		const map: Record<string, unknown> = { name: "m", workMode: "play" };
		const el = { removeClass() {}, addClass() {}, querySelectorAll: () => [] };
		const button = new WorkModeButton({
			plugin: { getMap: () => map, saveSettings: async () => {} } as never,
			contentEl: el as never,
			activeMapName: () => "m",
			getActiveMap: () => map as never,
			owView: () => null,
			drawingMode: () => null,
			undos: { commitTerrainStroke() {}, commitIconStroke() {}, updateUndoButton() {}, currentWorkMode: () => map.workMode as never },
			nav: { refreshArrivalBar() {}, refreshSideCrumbs() {} },
			toolbar: { applyMode() {} },
			tokens: { selectParty: (p) => picked.push(p) },
			exitCurrentMode() {},
		});
		button.setWorkMode("build");
		expect(map.workMode).toBe("build");
		expect(picked).toEqual([null]);
	});

	it("drawn again, it replaces itself; no party or no explored map: nothing", () => {
		const s = setup(true);
		drawPartyControls(s.plugin as never, s.host, s.party);
		drawPartyControls(s.plugin as never, s.host, s.party);
		expect(s.root.all((e) => e.classes.has(PARTY_CONTROLS_CLS)).length).toBe(1);
		drawPartyControls(s.plugin as never, s.host, undefined);
		expect(s.root.find(PARTY_CONTROLS_CLS)).toBeUndefined();
		const plain = setup(false);
		drawPartyControls(plain.plugin as never, plain.host, plain.party);
		expect(plain.root.find(PARTY_CONTROLS_CLS)).toBeUndefined();
	});
});
