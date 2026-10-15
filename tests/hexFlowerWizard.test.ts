import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import { registry } from "../src/modules";
import { moduleMapProperties, moduleNewMapOptionIds } from "../src/modules/runtime";
import { scaleGenerators } from "../src/mapScales";
import { scaleStarter } from "../src/wizardKinds";
import { wizardOptionId } from "../src/wizardText";
import { layerOf } from "../src/ui/placement";
import { FlowerStore } from "../src/hexflower/FlowerStore";
import { setFlowerStore } from "../src/hexflower/context";
import { HEX_FLOWER_GENERATOR_ID, hexFlowerGenerator, middleHex, PARTY_TOKEN_NAME, startFill } from "../src/hexflower/flowerGenerator";
import { emptyFlower } from "../src/hexflower/flower";
import { parseFlowerAt, readRules } from "../src/hexflower/explore";
import { EXPLORE_PROPS } from "../src/hexflower/exploreProps";
import { readSurface } from "./helpers/source";
import type { ScaleMapMade } from "../src/modules/types";

/** plan-hex-flower phase 6: the Hex flower card on every scale, and the map it makes. */

const TERRAINS = ["grassland", "forest", "hills", "lake"];
const grid = { cols: 7, rows: 5, offset: { x: 0, y: 0 }, stagger: "odd" as const };
const helpers = { toPaths: () => ({ paths: [], missing: [] }), procGrid: (g: typeof grid) => ({ ...g, orientation: "flat" as const }) };

function setup() {
	const vault = new MemVault({});
	const maps: Record<string, Record<string, unknown>> = { m: { name: "m", paletteName: "P", gridSize: { cols: 7, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [] } };
	const plugin = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", hexOrientation: "flat" },
		getMap: (n: string) => maps[n],
		getPaletteOrPresetTerrains: () => TERRAINS.map((name) => ({ name, color: "#123" })),
		mapLabel: (n: string) => (n === "m" ? "Misty Vale" : n),
		saveSettings: async () => {},
	};
	const store = new FlowerStore(plugin as never, () => {});
	setFlowerStore(plugin as never, store);
	return { vault, maps, plugin, store, kind: hexFlowerGenerator(plugin as never, helpers as never) };
}

describe("the Hex flower card", () => {
	it("is offered on every scale right after Blank, and never the one a scale starts on", () => {
		const { kind } = setup();
		expect(kind.id).toBe(HEX_FLOWER_GENERATOR_ID);
		for (const scale of registry.mapScales()) {
			const all = [{ id: "blank", source: "blank" as const }, ...scale.generators.map((id) => ({ id, source: "built-in" as const })), kind];
			const list = scaleGenerators(scale, all);
			expect(list[1].id).toBe(HEX_FLOWER_GENERATOR_ID);
			expect(scaleStarter(list)).not.toBe(HEX_FLOWER_GENERATOR_ID);
		}
	});

	it("options: Flower (new from this palette first), Start (blank first); Party token and Reveal are Advanced on New map and in the wizard", () => {
		const { kind, store } = setup();
		expect(kind.options.map((o) => [o.key, o.default])).toEqual([["flower", "new"], ["start", "blank"], ["party", "on"], ["reveal", "entered"]]);
		void store;
		const ids = moduleNewMapOptionIds()[HEX_FLOWER_GENERATOR_ID];
		expect(ids).toEqual({ party: "NewMap.flowerParty", reveal: "NewMap.flowerReveal" });
		for (const key of ["party", "reveal"]) {
			expect(layerOf(ids[key])).toBe("advanced");
			expect(layerOf(wizardOptionId(key, ids[key]))).toBe("advanced");
		}
		expect(wizardOptionId("start", undefined)).toBe("Wizard.genOptOther");
		expect(wizardOptionId("water")).toBe("Wizard.genOptWater");
	});

	it("generates only the middle hex (blank start) or the whole map (fill now), the same for the same seed", () => {
		const { kind } = setup();
		const req = { terrains: TERRAINS.map((name) => ({ name, color: "#000" })), grid, seed: 5, options: { flower: "new", start: "blank" } };
		const a = kind.generate(req as never);
		expect(a.ok && [...a.cells.keys()]).toEqual([middleHex(grid)]);
		const b = kind.generate({ ...req, options: { flower: "new", start: "fill" } } as never);
		expect(b.ok && b.cells.size).toBe(35);
		expect(b.ok && [...b.cells.values()].every((t) => TERRAINS.includes(t))).toBe(true);
		const c = kind.generate({ ...req, options: { flower: "new", start: "fill" } } as never);
		expect(c.ok && b.ok && [...c.cells]).toEqual(b.ok && [...b.cells]);
	});

	it("starts on the nearest terrain cell when the start cell isn't one", () => {
		const f = emptyFlower("F");
		f.cells[0] = { result: "forest" };
		const { cells, at } = startFill(f, TERRAINS, grid, "flat", 1, false);
		expect([...cells]).toEqual([[middleHex(grid), "forest"]]);
		expect([...at]).toEqual([["f", 1]]);
	});

	it("after making the map: a flower note from the palette, explore-with + hex-flower-at + seed, a Party token there", async () => {
		const s = setup();
		await s.store.init();
		const made: ScaleMapMade = { mapName: "m", generatorId: HEX_FLOWER_GENERATOR_ID, options: { flower: "new", start: "blank", party: "on", reveal: "neighbours" }, seed: 9, grid, paletteName: "P", choices: {}, onProgress: () => {} };
		await s.kind.afterCreate!(s.plugin as never, made);
		const map = s.maps.m;
		expect(s.store.list().map((e) => e.path)).toEqual(["world/hex flowers/Misty Vale.md"]);
		expect(readRules(map.exploreWith as string[])).toMatchObject([{ source: "world/hex flowers/Misty Vale", target: { kind: "terrain" } }]);
		expect([...parseFlowerAt(map.hexFlowerAt as string[]).keys()]).toEqual(["misty vale"]);
		expect(map.seed).toBe(9);
		expect(map.exploreReveal).toBe("neighbours");
		expect(map.visited).toEqual([middleHex(grid)]);
		const token = s.vault.files.get(`world/tokens/${PARTY_TOKEN_NAME}.md`)!;
		expect(token).toMatch(/token-party: true/);
		expect(token).toMatch(new RegExp(`token-hex: "?${middleHex(grid)}"?`));
		// The flower note is the same flower the map's first hex came from.
		const g = s.kind.generate({ terrains: TERRAINS.map((name) => ({ name, color: "#000" })), grid, seed: 9, options: { flower: "new", start: "blank" } } as never);
		const first = g.ok ? g.cells.get(middleHex(grid)) : undefined;
		const cell = [...parseFlowerAt(map.hexFlowerAt as string[]).values()][0];
		expect(s.store.list()[0].flower.cells[cell - 1].result).toBe(first);
	});
});

describe("wiring", () => {
	it("the wizard and New map run the generator's afterCreate and give such a map no fresh-map Reroll bar", () => {
		const wizard = readSurface("setup-wizard");
		expect(wizard).toMatch(/await kind\?\.afterCreate\?\.\(plugin, made\);/);
		expect(wizard).toMatch(/!kind\.afterCreate && !plugin\.arrival\.isOverworld\(result\.name\)\) markFreshMap/);
		const newMap = readSurface("new-map-setup");
		expect(newMap).toMatch(/await effective\?\.afterCreate\?\.\(this\.plugin, madeWith\);/);
		expect(newMap).toMatch(/!kind\.afterCreate && outcome\?\.ok/);
	});

	it("Map properties → Exploring shows on explored maps only", () => {
		expect(moduleMapProperties()).toContain(EXPLORE_PROPS);
	});
});
