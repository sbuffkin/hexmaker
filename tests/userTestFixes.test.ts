/**
 * User test 2026-10-12 (runs/20261012-131538-demo-world): the toolbar
 * flower, "same as here" in New land, the stale region tooltip, reroll and
 * painter feedback, and how a region made past the overworld's old edge
 * meshes with its neighbour.
 */
import { after, before, describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { flowerLayout, flowerPetals, PETAL_SIZE } from "../src/maps/mapNav";
import { regionsViewTip } from "../src/hex-map/hexHover";
import { strokeNotice } from "../src/overworld/biomePainter";
import { rerolledNotice } from "../src/overworld/BiomeModals";
import { walkFromBiome, walkIntoHex } from "../src/overworld/regionsVault";
import { representativeTerrain, setBiomeSource } from "../src/overworld/biomes";
import { seamContinuity } from "../src/overworld/regionGen";
import { paletteTypeOf, regionOrder } from "../src/overworld/regionWorld";
import { regionLayoutOf } from "../src/overworld/regionWorld";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { SCENARIOS, runScenario } from "./biomeParityFixtures";
import { presetFields } from "./biomeParityFixtures";
import type { MapData } from "../src/types";
import type { NewMapOptions } from "../src/services/MapsService";

describe("the toolbar's region flower", () => {
	it("every petal is a whole 22px target and none touch, in both orientations", () => {
		expect(PETAL_SIZE).toBeGreaterThanOrEqual(22);
		for (const o of ["flat", "pointy"] as const) {
			const petals = flowerPetals(o, "odd", 2, 3);
			const fl = flowerLayout(petals);
			const centres = [{ x: 0, y: 0 }, ...fl.at];
			for (let i = 0; i < centres.length; i++) {
				for (let j = i + 1; j < centres.length; j++) {
					expect(Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y)).toBeGreaterThanOrEqual(PETAL_SIZE);
				}
			}
			// The card holds every petal whole.
			for (const c of centres) {
				expect(Math.abs(c.x) + PETAL_SIZE / 2).toBeLessThanOrEqual(fl.width / 2 + 0.01);
				expect(Math.abs(c.y) + PETAL_SIZE / 2).toBeLessThanOrEqual(fl.height / 2 + 0.01);
			}
		}
	});

	it("styles: 22px petals with a hover ring; the neighbour box never clips or shrinks; the row wraps", () => {
		const css = readFileSync("styles.css", "utf8").replace(/\r\n/g, "\n");
		const rule = (sel: string) => {
			const i = css.indexOf(`${sel} {`);
			expect(i).toBeGreaterThanOrEqual(0);
			return css.slice(i, css.indexOf("}", i));
		};
		expect(rule(".duckmage-region-flower-petal")).toMatch(/width: 22px;[\s\S]*height: 22px;/);
		expect(css).toMatch(/\.duckmage-region-flower-petal:hover:not\(:disabled\),[\s\S]*?box-shadow: 0 0 0 2px var\(--interactive-accent\)/);
		const side = css.slice(css.lastIndexOf(".duckmage-map-nav-group > .duckmage-map-side-crumbs {"));
		expect(side.slice(0, side.indexOf("}"))).toMatch(/flex: none;[\s\S]*overflow: visible;/);
		expect(rule(".duckmage-map-nav-group.is-wrapped")).toContain("flex-wrap: wrap;");
		// The hex editor's flower uses the same petal size.
		expect(rule(".duckmage-neighbor-tile")).toMatch(/width: 22px;[\s\S]*height: 22px;/);
	});
});

describe("hover on an overworld's Regions view", () => {
	const opts = { label: (r: string) => `Label ${r}`, emptySlot: (h: string) => h === "3_3", canAdd: true };
	it("names the region under the pointer", () => {
		expect(regionsViewTip({ region: "ow-2-4", parentHex: "2_4" }, opts)).toBe("Label ow-2-4: click to go there");
	});
	it("says what an empty brick is", () => {
		expect(regionsViewTip({ parentHex: "3_3" }, opts)).toBe("No region yet (hex 3, 3): click to set its biome");
		expect(regionsViewTip({ parentHex: "3_3" }, { ...opts, canAdd: false })).toBe("No region yet (hex 3, 3)");
	});
	it("is empty over no region or brick (blank map below a region)", () => {
		expect(regionsViewTip({ parentHex: "2_5" }, opts)).toBe("");
		expect(regionsViewTip(null, opts)).toBe("");
	});
});

describe("feedback", () => {
	it("Reroll says which region it rerolled", () => {
		expect(rerolledNotice("Demo Bricks 0, 4")).toBe("Rerolled Demo Bricks 0, 4.");
	});
	it("the Biome painter says once per stroke what it made", () => {
		const label = (n: string) => n.toUpperCase();
		expect(strokeNotice({ made: ["a"], remade: 0 }, label)).toBe("Made A.");
		expect(strokeNotice({ made: ["a", "b", "c"], remade: 1 }, label)).toBe("Made 3 regions, remade 1 region.");
		expect(strokeNotice({ made: [], remade: 2 }, label)).toBe("Remade 2 regions.");
		expect(strokeNotice({ made: [], remade: 0 }, label)).toBeNull();
	});
});

// ── a small vault: an overworld, its regions, the map store ─────────────────
type Hex = { terrain?: string; biome?: string; locked?: boolean };
function world(rows: number) {
	const overworld = {
		name: "ow", paletteName: "Default", workMode: "build",
		gridSize: { cols: 3, rows }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
		regions: { footprint: "rect", size: 8, blend: "normal", worldId: "w1", stagger: "odd" },
		pathChains: [],
	} as unknown as MapData;
	const maps: MapData[] = [overworld];
	const store = new Map<string, Map<string, Hex>>();
	const hexes = (m: string): Map<string, Hex> => {
		let h = store.get(m);
		if (!h) store.set(m, (h = new Map()));
		return h;
	};
	const plugin = {
		settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
		getMap: (n: string) => maps.find((m) => m.name === n),
		rolledMapName: () => undefined,
		getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
		getPaletteOrPresetTerrains: () => DEFAULT_TERRAIN_PALETTE,
		getPaletteByName: () => undefined,
		mapLabel: (n: string) => n,
		mapStore: {
			get: (m: string, k: string) => store.get(m)?.get(k),
			all: (m: string) => hexes(m),
			set: (m: string, k: string, patch: Hex) => hexes(m).set(k, { ...hexes(m).get(k), ...patch }),
			setMany: (m: string, cells: [string, Hex][]) => { for (const [k, p] of cells) hexes(m).set(k, { ...hexes(m).get(k), ...p }); },
			flush: async () => {},
		},
		saveSettings: async () => {},
		createNewMap: async (opts: NewMapOptions) => {
			const { name, cols, rows, stagger, terrain: cells } = opts;
			const x = opts.offset?.x ?? 0, y = opts.offset?.y ?? 0, extra = opts;
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			maps.push({ name: slug, paletteName: "Default", gridSize: { cols, rows }, gridOffset: { x, y }, staggerOffset: stagger, parent: extra?.parent, submapKind: "region", pathChains: [] } as unknown as MapData);
			for (const [k, t] of cells ?? []) hexes(slug).set(k, { terrain: t });
			return { name: slug };
		},
		ensureOverworldBiomes: async () => {},
		linkRegion: async () => true,
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { plugin: plugin as any, store, overworld, maps };
}

describe("with the shipped biome notes", () => {
	before(() => setBiomeSource(presetFields()));
	after(() => setBiomeSource(undefined));

	describe('"same as here" in New land is the region\'s own biome', () => {
		it("a Coast region on a beach hex is Coast, not the Coastal fjord its terrain reads as", async () => {
			const w = world(3);
			const r = await walkIntoHex(w.plugin, "ow", 1, 1, "coast", { seed: 3, name: "Here" });
			expect(r).toMatchObject({ name: "here" });
			// Its terrain alone would say another biome; the Biome column says Coast.
			expect(w.store.get("ow")!.get("1_1")!.biome).toBe("Coast");
			expect(walkFromBiome(w.plugin, "here")).toBe("coast");
		});
		it("without a Biome cell, the region's recorded biome, then its terrain", async () => {
			const w = world(3);
			await walkIntoHex(w.plugin, "ow", 1, 1, "taiga", { seed: 3, name: "Here" });
			w.store.get("ow")!.get("1_1")!.biome = undefined;
			w.maps.find((m) => m.name === "here")!.biome = { generator: "Taiga" };
			expect(walkFromBiome(w.plugin, "here")).toBe("taiga");
			w.maps.find((m) => m.name === "here")!.biome = undefined;
			w.store.get("ow")!.get("1_1")!.terrain = representativeTerrain("grassland", DEFAULT_TERRAIN_PALETTE);
			expect(walkFromBiome(w.plugin, "here")).toBe("grassland");
			expect(walkFromBiome(w.plugin, "ow")).toBeUndefined();
		});
	});

	describe("a region made past the overworld's old edge meshes like any other", () => {
		const typeOf = paletteTypeOf(DEFAULT_TERRAIN_PALETTE);
		/** Make 1,1 then 1,2 (in the grid), then walk to 1,3: past the edge of a 3-row overworld, inside a 4-row one. */
		async function build(rows: number, seed: number) {
			const w = world(rows);
			await walkIntoHex(w.plugin, "ow", 1, 1, "coastal-fjord", { seed: seed + 1, name: "A" });
			await walkIntoHex(w.plugin, "ow", 1, 2, "coastal-fjord", { seed: seed + 2, name: "B" });
			const r = await walkIntoHex(w.plugin, "ow", 1, 3, "coastal-fjord", { seed: seed + 3, name: "C" });
			return { w, r };
		}

		it("grow-then-create makes exactly the region the in-grid path makes (the neighbour is in its context)", async () => {
			for (const seed of [10, 20, 30]) {
				const past = await build(3, seed);
				const inGrid = await build(4, seed);
				expect(past.r).toEqual({ name: "c", grew: true });
				expect(inGrid.r).toEqual({ name: "c", grew: false });
				expect(past.w.overworld.gridSize).toEqual({ cols: 3, rows: 4 });
				expect([...past.w.store.get("c")!].map(([k, h]) => [k, h.terrain])).toEqual([...inGrid.w.store.get("c")!].map(([k, h]) => [k, h.terrain]));
			}
		});

		it("and continues its neighbour's land and water across the seam", async () => {
			let edge = 0, matched = 0;
			for (const seed of [10, 20, 30, 40, 50, 60]) {
				const { w } = await build(3, seed);
				const layout = regionLayoutOf(w.overworld, { orientation: "flat", stagger: "odd" })!;
				const own = new Map([...w.store.get("c")!].map(([k, h]) => [k, h.terrain!] as [string, string]));
				const nb = new Map([...w.store.get("b")!].map(([k, h]) => [k, h.terrain!] as [string, string]));
				const c = seamContinuity(layout, [1, 3], own, nb, typeOf);
				edge += c.edge; matched += c.matched;
			}
			expect(edge).toBeGreaterThan(0);
			expect(matched / edge).toBeGreaterThanOrEqual(0.85);
		});
	});
});

describe("the seam pass: made neighbours' land and water carry on", () => {
	it("every parity world continues at least 90% of its seams at the defaults", () => {
		for (const s of SCENARIOS) {
			const regions = runScenario(s);
			const typeOf = paletteTypeOf(s.palette);
			const pinned = new Map<string, string>();
			let edge = 0, matched = 0;
			const hexes = [...regions.keys()].map((k) => k.split("_").map(Number) as [number, number]);
			for (const [px, py] of regionOrder(hexes, s.layout.orientation, s.layout.parentStagger)) {
				const cells = regions.get(`${px}_${py}`)!;
				const c = seamContinuity(s.layout, [px, py], cells, pinned, typeOf);
				edge += c.edge; matched += c.matched;
				for (const [k, t] of cells) pinned.set(k, t);
			}
			expect({ name: s.name, ok: matched / edge >= 0.9 }).toEqual({ name: s.name, ok: true });
		}
	});
});
