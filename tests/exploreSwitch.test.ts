import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import type { HexData } from "../src/maps/mapNote";
import { applyTokenFrontmatter } from "../src/frontmatter";
import { ExploreService } from "../src/hexflower/ExploreService";
import { FlowerStore } from "../src/hexflower/FlowerStore";
import { setExplore, setFlowerStore } from "../src/hexflower/context";
import { disableExploring, enableExploring } from "../src/hexflower/exploreSwitch";
import { EXPLORE_PROPS } from "../src/hexflower/exploreProps";
import { emptyFlower } from "../src/hexflower/flower";
import { buildFlowerNote } from "../src/hexflower/flowerNote";
import { NEW_FLOWER } from "../src/hexflower/flowerGenerator";
import { isExploreMap } from "../src/fog/exploreFields";
import { readRules } from "../src/hexflower/explore";

/** Hex flower as a map setting (owner HF8): turned on and off from Map properties. */

const TERRAINS = ["grassland", "forest", "hills"];

class FakeStore {
	hexes = new Map<string, Map<string, HexData>>();
	get(m: string, k: string) { return this.hexes.get(m)?.get(k); }
	all(m: string) { return this.hexes.get(m) ?? new Map<string, HexData>(); }
	set(m: string, k: string, patch: Record<string, unknown>) {
		const t = this.hexes.get(m) ?? new Map<string, HexData>();
		this.hexes.set(m, t);
		t.set(k, { ...(t.get(k) ?? {}), ...patch } as HexData);
		return true;
	}
	async record<T>(fn: () => T) { return { result: await fn(), cells: [] }; }
}

function setup(files: Record<string, string> = {}) {
	const own = emptyFlower("Wilds", "P");
	own.cells = own.cells.map((_, i) => ({ result: TERRAINS[i % 3] }));
	const vault = new MemVault({ "world/hex flowers/Wilds.md": buildFlowerNote(own), ...files });
	const map: Record<string, unknown> = { name: "m", paletteName: "P", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [] };
	let refreshed = 0;
	const plugin = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [map] },
		mapStore: new FakeStore(),
		tableNotes: { lookup: () => ({ table: () => undefined }) },
		getMap: (n: string) => (n === "m" ? map : undefined),
		getPaletteOrPresetTerrains: () => TERRAINS.map((name) => ({ name, color: "#000" })),
		hexPath: (x: number, y: number) => `world/hexes/m/${x}_${y}.md`,
		mapLabel: () => "Misty Vale",
		saveSettings: async () => {},
		pushUndo: () => {},
		refreshHexMap: () => { refreshed++; },
	};
	const flowers = new FlowerStore(plugin as never, () => {});
	setFlowerStore(plugin as never, flowers);
	setExplore(plugin as never, new ExploreService(plugin as never, () => {}));
	return { vault, plugin, map, flowers, refreshed: () => refreshed };
}

describe("exploring as a map setting (HF8)", () => {
	it("turned on: a new flower from the map's palette, the rule, a seed, a Party token on the middle hex, that hex filled", async () => {
		const s = setup();
		await s.flowers.init();
		const path = await enableExploring(s.plugin as never, "m", { flower: NEW_FLOWER, party: true });
		expect(path).toBe("world/hex flowers/Misty Vale.md");
		expect(isExploreMap(s.map as never)).toBe(true);
		expect(readRules(s.map.exploreWith as string[])).toMatchObject([{ source: "world/hex flowers/Misty Vale", target: { kind: "terrain" } }]);
		expect(typeof s.map.seed).toBe("number");
		expect(s.vault.files.get("world/tokens/Party.md")).toMatch(/token-party: true/);
		expect(s.vault.files.get("world/tokens/Party.md")).toMatch(/token-hex: "?2_2"?/);
		expect(s.map.visited).toEqual(["2_2"]);
		expect(TERRAINS).toContain(s.plugin.mapStore.get("m", "2_2")?.terrain);
	});

	it("with a vault flower and the map's own party: no new note or token; the party's hex is the start", async () => {
		const s = setup({ "world/tokens/Band.md": "" });
		await applyTokenFrontmatter(s.plugin.app as never, "world/tokens/Band.md", { hex: "1_3", map: "m", visible: true, party: true });
		s.plugin.mapStore.set("m", "1_3", { terrain: "hills" });
		await s.flowers.init();
		const path = await enableExploring(s.plugin as never, "m", { flower: "Wilds", party: true });
		expect(path).toBe("world/hex flowers/Wilds.md");
		expect(s.flowers.list().length).toBe(1);
		expect(s.vault.files.has("world/tokens/Party.md")).toBe(false);
		expect(s.map.visited).toEqual(["1_3"]);
		// A filled hex is never overwritten.
		expect(s.plugin.mapStore.get("m", "1_3")?.terrain).toBe("hills");
	});

	it("turned off: the map's exploring keys go; the flower note stays", async () => {
		const s = setup();
		await s.flowers.init();
		await enableExploring(s.plugin as never, "m", { flower: "Wilds", party: false });
		s.map.exploreReveal = "2 rings";
		await disableExploring(s.plugin as never, "m");
		expect(isExploreMap(s.map as never)).toBe(false);
		expect(s.map.exploreWith).toBeUndefined();
		expect(s.map.exploreReveal).toBeUndefined();
		expect(s.vault.files.has("world/hex flowers/Wilds.md")).toBe(true);
	});

	it("Map properties: every map shows Hex flower; Explore this map turns it on, Stop exploring turns it off", async () => {
		const s = setup();
		await s.flowers.init();
		const { root, el } = fakeRoot();
		let rerenders = 0;
		const draw = () => { root.empty(); EXPLORE_PROPS.render(el, s.plugin as never, s.map as never, () => { rerenders++; draw(); }); };
		draw();
		expect(root.all((e) => e.tag === "h4").map((h) => h.text)).toEqual(["Hex flower"]);
		const select = root.all((e) => e.tag === "select")[0];
		expect(select.children.map((o: FakeEl) => o.text)).toEqual(["New from this map's palette", "Wilds"]);
		select.value = "Wilds";
		const on = root.buttons().find((b) => b.text === "Explore this map")!;
		on.fire("click");
		for (let i = 0; i < 20 && !rerenders; i++) await new Promise((r) => setTimeout(r, 0));
		expect(readRules(s.map.exploreWith as string[])).toMatchObject([{ source: "world/hex flowers/Wilds" }]);
		expect(s.refreshed()).toBeGreaterThan(0);
		// Now the explored map's section: Each step fills (the hex, or 1–3 rings).
		const reveal = root.all((e) => e.tag === "select" && e.attrs["aria-label"] === "Each step fills")[0];
		expect(reveal.children.map((o: FakeEl) => o.text)).toEqual(["The hex entered", "1 ring around it", "2 rings around it", "3 rings around it"]);
		reveal.value = "3";
		reveal.fire("change");
		expect(s.map.exploreReveal).toBe("3 rings");
		reveal.value = "0";
		reveal.fire("change");
		expect(s.map.exploreReveal).toBeUndefined();
		const off = root.buttons().find((b) => b.text === "Stop exploring this map")!;
		const before = rerenders;
		off.fire("click");
		for (let i = 0; i < 20 && rerenders === before; i++) await new Promise((r) => setTimeout(r, 0));
		expect(isExploreMap(s.map as never)).toBe(false);
		expect(root.buttons().some((b) => b.text === "Explore this map")).toBe(true);
	});
});
