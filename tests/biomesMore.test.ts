/**
 * More biomes and mixed biomes (owner 2026-10-12: "we definitely want more
 * biomes and it'd be nice if the 'edit region' let you multi-select to
 * combine different biomes … more mountainous terrain, or one implying
 * underground caves").
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { buildBiomeNote, mixShares, parseBiomeNote, updateBiomeNote, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { BIOME_PRESETS, biomePreset } from "../src/overworld/biomePresets";
import {
	biomeByRef,
	biomeInfo,
	biomeNoteOf,
	biomeRef,
	biomeShortLabel,
	combinedBiome,
	isComboId,
	noteBiomeProfiles,
	profileFromFields,
	representativeTerrain,
	setBiomeSource,
	withComboProfiles,
} from "../src/overworld/biomes";
import { combineBiomeFields, comboId, comboParts, formatComboRef, normalizeParts, parseComboRef } from "../src/overworld/biomeCombo";
import { BIOME_GROUPS, biomeGroupOf, groupBiomes } from "../src/overworld/biomeGroups";
import { placementPool, worldBiomes } from "../src/overworld/worldBiomes";
import { ALL_BIOMES_POOL, allBiomesPool, appendPoolRows, buildBiomePool, parseBiomePool } from "../src/overworld/biomePool";
import { BiomeStore } from "../src/overworld/BiomeStore";
import { isPlaceable } from "../src/overworld/biomeClimate";
import { MemVault } from "./helpers/memVault";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { paletteTypeOf, planRegion, worldSeed } from "../src/overworld/regionWorld";
import { buildMapNote, parseMapNote, type MapNoteData } from "../src/maps/mapNote";
import type { RegionLayout } from "../src/overworld/layout";
import { isTerrainType } from "../src/terrainTypes";
import { BlendField } from "../src/overworld/blendField";
import { TYPE_FALLBACKS } from "../src/worldgen/builtinGenerators";

const SURFACE_NEW = ["highlands", "volcanic-peaks", "glacier", "canyon", "mesa", "steppe", "desert", "wasteland", "blighted-lands", "reef"];
const UNDERGROUND_NEW = ["caverns", "underdark", "fungal-forest", "underground-lake", "mines", "magma-caves"];
const preset = (id: string): BiomeNoteFields => biomePreset(id)!;

afterEach(() => setBiomeSource(undefined));

describe("new shipped biomes", () => {
	it("are shipped, and their notes read back as written", () => {
		for (const id of [...SURFACE_NEW, ...UNDERGROUND_NEW]) {
			const p = preset(id);
			expect(p).toBeTruthy();
			const back = parseBiomeNote(buildBiomeNote(p), p.label);
			expect({ id, problems: back.problems }).toEqual({ id, problems: [] });
			const f = back.fields;
			expect(f.id).toBe(p.id);
			expect(f.label).toBe(p.label);
			expect(f.color).toBe(p.color);
			expect(f.mix).toEqual(p.mix);
			expect(f.transitions).toEqual(p.transitions);
			expect(f.layer).toBe(p.layer);
			expect(f.landShare).toBe(p.landShare);
			expect(f.minIslands).toBe(p.minIslands);
			expect(f.terrainWeights).toEqual(p.terrainWeights);
			expect(f.tuning).toEqual(p.tuning);
			expect(f.climate?.elevation).toBe(p.climate?.elevation);
			expect(f.climate?.chance).toBe(p.climate?.chance);
			for (const k of ["temperature", "moisture"] as const) {
				if (!p.climate?.[k]) { expect(f.climate?.[k]).toBeUndefined(); continue; }
				expect(f.climate![k]!.lo).toBeCloseTo(p.climate[k]!.lo, 6);
				expect(f.climate![k]!.hi).toBeCloseTo(p.climate[k]!.hi, 6);
			}
		}
	});

	it("mix only known terrain types, name known biomes in their transitions, and have a colour", () => {
		setBiomeSource(BIOME_PRESETS);
		for (const id of [...SURFACE_NEW, ...UNDERGROUND_NEW]) {
			const p = preset(id);
			expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
			for (const r of p.mix) expect({ id, type: r.type, ok: isTerrainType(r.type) }).toEqual({ id, type: r.type, ok: true });
			for (const t of p.transitions) {
				expect({ id, next: biomeByRef(t.next) !== undefined }).toEqual({ id, next: true });
				expect({ id, between: biomeByRef(t.between) !== undefined }).toEqual({ id, between: true });
			}
		}
	});

	it("surface ones carry a climate (World biomes places them); underground ones are marked and carry none", () => {
		for (const id of SURFACE_NEW) expect({ id, placeable: isPlaceable(preset(id).climate), layer: preset(id).layer }).toEqual({ id, placeable: true, layer: undefined });
		for (const id of UNDERGROUND_NEW) expect({ id, climate: preset(id).climate, layer: preset(id).layer }).toEqual({ id, climate: undefined, layer: "underground" });
		// Caverns: little smoothing, and its patches may grow big.
		expect(preset("caverns").tuning).toMatchObject({ smoothing: 1, "patch-max": 0.35 });
	});

	it("can be painted on Expanded with their own terrains, and on Limited by type fallback", () => {
		setBiomeSource(BIOME_PRESETS);
		expect(representativeTerrain("caverns", DEFAULT_TERRAIN_PALETTE)).toBe("cave floor");
		expect(representativeTerrain("fungal-forest", DEFAULT_TERRAIN_PALETTE)).toBe("fungal forest");
		expect(representativeTerrain("underdark", DEFAULT_TERRAIN_PALETTE)).toBe("solid rock");
		expect(representativeTerrain("mines", DEFAULT_TERRAIN_PALETTE)).toBe("mine shaft");
		expect(representativeTerrain("blighted-lands", DEFAULT_TERRAIN_PALETTE)).toBe("dead forest");
		expect(representativeTerrain("desert", DEFAULT_TERRAIN_PALETTE)).toBe("dunes");
		for (const id of [...SURFACE_NEW, ...UNDERGROUND_NEW]) {
			expect({ id, expanded: !!representativeTerrain(id, DEFAULT_TERRAIN_PALETTE) }).toEqual({ id, expanded: true });
			expect({ id, limited: !!representativeTerrain(id, LIMITED_TERRAIN_PALETTE) }).toEqual({ id, limited: true });
			// On Limited every type of the mix still lands somewhere.
			expect({ id, types: (noteBiomeProfiles(LIMITED_TERRAIN_PALETTE).get(id)?.types.size ?? 0) > 0 }).toEqual({ id, types: true });
		}
		// The cave types fall back to the land types a small palette has.
		expect(TYPE_FALLBACKS["cave"]).toEqual(["hills", "mountains"]);
		expect(TYPE_FALLBACKS["underground-water"][0]).toBe("water");
	});
});

describe("layer: underground", () => {
	it("reads forgivingly, reports nonsense, and keeps the user's spelling", () => {
		const note = (v: string) => `---\nlabel: Deep halls\nlayer: ${v}\n---\n\n| Type | Weight |\n| --- | --- |\n| cave | 1 |\n`;
		expect(parseBiomeNote(note("Underground"), "x").fields.layer).toBe("underground");
		expect(parseBiomeNote(note("below"), "x").fields.layer).toBe("underground");
		expect(parseBiomeNote(note("surface"), "x").fields.layer).toBe("surface");
		const bad = parseBiomeNote(note("sideways"), "x");
		expect(bad.fields.layer).toBeUndefined();
		expect(bad.problems.map((p) => p.text)).toEqual([expect.stringMatching(/layer should be surface or underground/)]);
		// A rewrite keeps the user's own word for it.
		const mine = note("below");
		expect(updateBiomeNote(mine, parseBiomeNote(mine, "x").fields)).toContain("\nlayer: below\n");
		expect(buildBiomeNote({ ...preset("caverns") })).toContain("\nlayer: underground\n");
	});

	it("World biomes never places an underground biome, even from a pool that fills gaps", () => {
		const deep: BiomeNoteFields = { id: "deep", label: "Deep", mix: [{ type: "cave", weight: 1 }], transitions: [], layer: "underground", climate: { elevation: "low" } };
		const unclimated: BiomeNoteFields = { ...deep, id: "deeper", label: "Deeper", climate: undefined };
		const pool = placementPool([...BIOME_PRESETS, deep, unclimated], "fill");
		expect(pool.cands.map((c) => c.id)).not.toContain("deep");
		expect(pool.fallback.map((c) => c.id)).not.toContain("deeper");
		for (const id of UNDERGROUND_NEW) expect(pool.cands.some((c) => c.id === id) || pool.fallback.some((c) => c.id === id)).toBe(false);
		setBiomeSource(BIOME_PRESETS);
		const cells: [number, number][] = [];
		for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) cells.push([x, y]);
		const placed = new Set<string>();
		for (const seed of [1, 2, 3, 4, 5, 6]) for (const b of worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, climate: "varied" }).biomes.values()) placed.add(b);
		for (const id of UNDERGROUND_NEW) expect(placed.has(id)).toBe(false);
		// ...while the new surface ones turn up.
		expect(SURFACE_NEW.some((id) => placed.has(id))).toBe(true);
		// The shipped pool lists the surface ones only.
		const rows = allBiomesPool(BIOME_PRESETS).map((r) => r.biome);
		expect(rows).toContain("Highlands");
		expect(rows).not.toContain("Caverns");
	});
});

describe("biome picker groups", () => {
	it("group the shipped biomes by their data", () => {
		const g = (id: string) => biomeGroupOf(preset(id));
		for (const id of UNDERGROUND_NEW) expect(g(id)).toBe("underground");
		for (const id of ["highlands", "glacier", "canyon", "mesa", "volcanic-peaks", "alpine", "valley"]) expect({ id, g: g(id) }).toEqual({ id, g: "mountains" });
		for (const id of ["reef", "archipelago", "open-sea"]) expect({ id, g: g(id) }).toEqual({ id, g: "water" });
		for (const id of ["grassland", "desert", "steppe", "swamp", "coast", "blighted-lands"]) expect({ id, g: g(id) }).toEqual({ id, g: "surface" });
		expect(g("custom")).toBe("blank");
	});

	it("group a user's biome without a climate by its mix", () => {
		const mk = (mix: { type: string; weight: number }[]): BiomeNoteFields => ({ id: "u", label: "U", mix, transitions: [] });
		expect(biomeGroupOf(mk([{ type: "mountains", weight: 3 }, { type: "grassland", weight: 1 }]))).toBe("mountains");
		expect(biomeGroupOf(mk([{ type: "water", weight: 3 }, { type: "coast", weight: 1 }]))).toBe("water");
		expect(biomeGroupOf(mk([{ type: "cave", weight: 3 }, { type: "fungus", weight: 1 }]))).toBe("underground");
		expect(biomeGroupOf(mk([{ type: "grassland", weight: 3 }]))).toBe("surface");
	});

	it("keep the order within a group and leave empty groups out", () => {
		const items = ["caverns", "grassland", "alpine", "desert"].map((id) => ({ id, group: biomeGroupOf(preset(id)) }));
		const out = groupBiomes(items, (i) => i.group);
		expect(out.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([["surface", ["grassland", "desert"]], ["mountains", ["alpine"]], ["underground", ["caverns"]]]);
		expect(BIOME_GROUPS.map((g) => g.label)).toEqual(["Surface", "Mountains", "Water", "Underground", "Blank"]);
	});
});

describe("mixed biomes: ids and how they're written", () => {
	const resolve = (n: string) => ({ alpine: "alpine", taiga: "taiga", "zone 51": "zone-51" } as Record<string, string>)[n.trim().toLowerCase()];

	it("normalize: merged, heaviest first, equal weights as 1, one part is just that biome", () => {
		expect(comboId([{ id: "taiga", weight: 1 }, { id: "alpine", weight: 2 }])).toBe("alpine*2+taiga");
		expect(comboId([{ id: "taiga", weight: 3 }, { id: "alpine", weight: 3 }])).toBe("taiga+alpine");
		expect(comboId([{ id: "alpine", weight: 1 }, { id: "alpine", weight: 1 }])).toBe("alpine");
		expect(comboId([{ id: "alpine", weight: 5 }, { id: "taiga", weight: 0 }])).toBe("alpine");
		expect(comboParts("alpine*2+taiga")).toEqual([{ id: "alpine", weight: 2 }, { id: "taiga", weight: 1 }]);
		expect(comboParts("alpine")).toEqual([{ id: "alpine", weight: 1 }]);
		expect(isComboId("alpine")).toBe(false);
		expect(normalizeParts(comboParts("taiga*1+alpine*2")).map((p) => p.id)).toEqual(["alpine", "taiga"]);
	});

	it("read forgivingly: labels, links, ×2, (2), commas; unknown parts read as nothing", () => {
		expect(parseComboRef("Alpine 2 + Taiga", resolve)).toEqual([{ id: "alpine", weight: 2 }, { id: "taiga", weight: 1 }]);
		expect(parseComboRef("[[Alpine]] ×2, [[world/biomes/Taiga|the taiga]]", resolve)).toEqual([{ id: "alpine", weight: 2 }, { id: "taiga", weight: 1 }]);
		expect(parseComboRef("Alpine (3) + Taiga x1", resolve)).toEqual([{ id: "alpine", weight: 3 }, { id: "taiga", weight: 1 }]);
		expect(parseComboRef("Zone 51 + Taiga", resolve)).toEqual([{ id: "zone-51", weight: 1 }, { id: "taiga", weight: 1 }]);
		expect(parseComboRef("Alpine + Nowhere", resolve)).toBeUndefined();
		expect(parseComboRef("Alpine", resolve)).toBeUndefined();
	});

	it("written readably, with weights only when they differ", () => {
		const label = (id: string) => ({ alpine: "Alpine", taiga: "Taiga" } as Record<string, string>)[id];
		expect(formatComboRef([{ id: "taiga", weight: 1 }, { id: "alpine", weight: 2 }], label)).toBe("Alpine 2 + Taiga 1");
		expect(formatComboRef([{ id: "alpine", weight: 2 }, { id: "taiga", weight: 2 }], label)).toBe("Alpine + Taiga");
	});

	it("round-trip through the biome lookups (the Biome column and the region note use biomeRef)", () => {
		setBiomeSource(BIOME_PRESETS);
		const id = biomeByRef("Taiga + Alpine 2")!;
		expect(id).toBe("alpine*2+taiga");
		expect(biomeRef(id)).toBe("Alpine 2 + Taiga 1");
		expect(biomeByRef(biomeRef(id))).toBe(id);
		const even = combinedBiome([{ id: "alpine", weight: 1 }, { id: "taiga", weight: 1 }]);
		expect(biomeRef(even)).toBe("Alpine + Taiga");
		expect(biomeInfo(even)?.label).toBe("Alpine + Taiga");
		expect(biomeShortLabel(even)).toBe("Alpine+");
		expect(biomeByRef("[[Alpine]] + [[Taiga]]")).toBe(even);
		// A part whose note is gone: no combined biome.
		expect(biomeByRef("Alpine + Glass wastes")).toBeUndefined();
		// The overworld paints its dominant part's terrain.
		expect(representativeTerrain(id, DEFAULT_TERRAIN_PALETTE)).toBe(representativeTerrain("alpine", DEFAULT_TERRAIN_PALETTE));
		// Blank biomes can't be mixed (they paint nothing).
		expect(biomeNoteOf(combinedBiome([{ id: "custom", weight: 1 }, { id: "taiga", weight: 1 }]))).toBeUndefined();
	});

	it("are stored readably in the region's map note and the overworld's Biome column", () => {
		setBiomeSource(BIOME_PRESETS);
		const id = combinedBiome([{ id: "alpine", weight: 2 }, { id: "taiga", weight: 1 }]);
		const data: MapNoteData = { settings: { paletteName: "Expanded", biome: { generator: biomeRef(id), from: ["Grassland"] } } as never, hexes: new Map([["3_4", { terrain: "peak", biome: biomeRef(id) }]]), paths: [] };
		const note = buildMapNote("ow", data);
		expect(note).toMatch(/\nbiome: "?Alpine 2 \+ Taiga 1"?\n/);
		expect(note).toContain("Alpine 2 + Taiga 1 |");
		const back = parseMapNote(note)!;
		const gen = (back.settings as { biome?: { generator: string } }).biome!.generator;
		expect(biomeByRef(gen)).toBe(id);
		expect(biomeByRef(back.hexes.get("3_4")!.biome)).toBe(id);
		// A hand-written cell with links reads too.
		const hand = note.replace("| Alpine 2 + Taiga 1 |", "| [[Alpine]] 2 + [[Taiga]] |");
		expect(biomeByRef(parseMapNote(hand)!.hexes.get("3_4")!.biome)).toBe(id);
	});
});

describe("mixed biomes: what a region is made from", () => {
	const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-3);

	it("the mix is the parts' shares times their weights", () => {
		const a = preset("alpine"), t = preset("taiga");
		const f = combineBiomeFields("alpine*3+taiga", "Alpine + Taiga", [{ fields: a, weight: 3 }, { fields: t, weight: 1 }]);
		const got = mixShares(f.mix), sa = mixShares(a.mix), st = mixShares(t.mix);
		for (const type of new Set([...sa.keys(), ...st.keys()])) near(got.get(type) ?? 0, 0.75 * (sa.get(type) ?? 0) + 0.25 * (st.get(type) ?? 0));
		// Colour, blend and the like are the dominant part's.
		expect(f.color).toBe(a.color);
		// Min patches are weighted too (alpine's 2 peak patches at 3:1 → 2).
		expect(f.mix.find((r) => r.type === "peaks")?.minPatches).toBe(2);
		// The profile on a palette follows the same weights.
		const p = profileFromFields(f, DEFAULT_TERRAIN_PALETTE);
		const pa = profileFromFields(a, DEFAULT_TERRAIN_PALETTE), pt = profileFromFields(t, DEFAULT_TERRAIN_PALETTE);
		for (const [type, v] of p.types) near(v, 0.75 * (pa.types.get(type) ?? 0) + 0.25 * (pt.types.get(type) ?? 0));
	});

	it("terrain weights are merged and numbers weighted", () => {
		const one: BiomeNoteFields = { id: "one", label: "One", mix: [{ type: "forest", weight: 1 }], transitions: [], terrainWeights: [{ terrain: "Pine", weight: 3 }], tuning: { "patch-size": 2, smoothing: 4 }, landShare: 0.2, minIslands: 2 };
		const two: BiomeNoteFields = { id: "two", label: "Two", mix: [{ type: "grassland", weight: 1 }], transitions: [], terrainWeights: [{ terrain: "Oak", weight: 0 }] };
		const f = combineBiomeFields("one+two", "One + Two", [{ fields: one, weight: 1 }, { fields: two, weight: 1 }]);
		expect(f.terrainWeights).toEqual([{ terrain: "Pine", weight: 2 }, { terrain: "Oak", weight: 0.5 }]);
		// patch-size: (2 + default 1) / 2; smoothing (whole numbers): (4 + 2) / 2.
		expect(f.tuning).toEqual({ "patch-size": 1.5, smoothing: 3 });
		// Land share: one's 0.2 and two's mix (all land: 1).
		expect(f.landShare).toBeCloseTo(0.6, 6);
		expect(f.minIslands).toBe(1);
	});

	it("one biome is exactly that biome (same fields, same profiles, same regions)", () => {
		const a = preset("alpine");
		expect(combineBiomeFields("alpine", "Alpine", [{ fields: a, weight: 1 }])).toBe(a);
		setBiomeSource(BIOME_PRESETS);
		const profiles = noteBiomeProfiles(DEFAULT_TERRAIN_PALETTE);
		expect(withComboProfiles(profiles, ["alpine", "taiga"], DEFAULT_TERRAIN_PALETTE)).toBe(profiles);
		const layout: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		const run = (own: string) => {
			const biomes = new Map([["0_0", own], ["1_0", "grassland"], ["0_1", "taiga"]]);
			return planRegion({ layout, parent: [0, 0], biomes, profiles: withComboProfiles(profiles, biomes.values(), DEFAULT_TERRAIN_PALETTE), typeOf: paletteTypeOf(DEFAULT_TERRAIN_PALETTE), worldSeed: worldSeed("w"), seed: 42 });
		};
		const plain = run("alpine");
		const viaRef = run(biomeByRef("Alpine + Alpine")!);
		expect(viaRef.cells).toEqual(plain.cells);
		expect(viaRef.biome).toEqual(plain.biome);
		// The zoned field is the plain field where no mix is near (the very same map).
		const expand = (b: string) => (isComboId(b) ? comboParts(b) : undefined);
		const plainField = new BlendField(layout, new Map([["0_0", "alpine"], ["1_0", "taiga"]]), "normal", { expand });
		for (const [x, y] of [[0, 0], [3, 4], [9, 2]] as [number, number][]) expect(plainField.zoned(x, y)).toBe(plainField.at(x, y));
		// With a mix: its share splits into its parts, the rest is kept, and a seam cell reads the same from either side's field.
		const mixed = new BlendField(layout, new Map([["0_0", "alpine*2+taiga"], ["1_0", "grassland"]]), "normal", { expand, seed: 5, warp: 0.2 });
		const z = mixed.zoned(9, 3), phi = mixed.at(9, 3);
		expect(z.has("alpine*2+taiga")).toBe(false);
		near((z.get("alpine") ?? 0) + (z.get("taiga") ?? 0), phi.get("alpine*2+taiga")!);
		near(z.get("grassland") ?? 0, phi.get("grassland") ?? 0);
		const again = new BlendField(layout, new Map([["0_0", "alpine*2+taiga"], ["1_0", "grassland"]]), "normal", { expand, seed: 5, warp: 0.2 });
		expect(again.zoned(9, 3)).toEqual(z);
	});

	it("generates in proportion to the weights, meshed with its neighbours, and records itself readably", () => {
		setBiomeSource(BIOME_PRESETS);
		const palette = DEFAULT_TERRAIN_PALETTE;
		const typeOf = paletteTypeOf(palette);
		const caveTypes = new Set(preset("caverns").mix.map((r) => r.type));
		const layout: RegionLayout = { footprint: "rect", size: 10, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		const base = noteBiomeProfiles(palette);
		const share = (weights: [number, number]) => {
			const id = combinedBiome([{ id: "caverns", weight: weights[0] }, { id: "desert", weight: weights[1] }]);
			let cave = 0, all = 0;
			for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
				const biomes = new Map([["0_0", id]]);
				const plan = planRegion({ layout, parent: [0, 0], biomes, profiles: withComboProfiles(base, biomes.values(), palette), typeOf, worldSeed: worldSeed("mix"), seed });
				for (const t of plan.cells.values()) { all++; if (caveTypes.has(typeOf(t) ?? "")) cave++; }
				expect(plan.biome?.generator).toBe(biomeRef(id));
			}
			return cave / all;
		};
		// Each part holds zones of the region about as big as its weight (BlendField.zoned;
		// exact shares are checked on the profile above).
		const threeToOne = share([3, 1]), oneToThree = share([1, 3]), even = share([1, 1]);
		expect(threeToOne).toBeGreaterThan(0.55);
		expect(threeToOne).toBeLessThan(0.9);
		expect(even).toBeGreaterThan(0.35);
		expect(even).toBeLessThan(0.65);
		expect(oneToThree).toBeGreaterThan(0.1);
		expect(oneToThree).toBeLessThan(0.4);
		expect(even).toBeGreaterThan(oneToThree);
		expect(even).toBeLessThan(threeToOne);
		// Next to a forest region, a mixed region still blends toward it at the seam.
		const id = combinedBiome([{ id: "caverns", weight: 1 }, { id: "desert", weight: 1 }]);
		const biomes = new Map([["0_0", id], ["1_0", "temperate-forest"]]);
		const plan = planRegion({ layout, parent: [0, 0], biomes, profiles: withComboProfiles(base, biomes.values(), palette), typeOf, worldSeed: worldSeed("mix"), seed: 9 });
		expect(plan.biome?.from).toEqual(["temperate-forest"]);
		expect([...plan.cells.values()].some((t) => typeOf(t) === "forest")).toBe(true);
	});
});

// ── the store: new shipped biomes in an existing vault ───────────────────

function plugin(vault: MemVault, settings: Record<string, unknown> = {}) {
	return {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", biomesFolder: "", kindContent: ["world"], mapKinds: ["world"], ...settings } as Record<string, unknown>,
		saveSettings: async () => {},
	};
}

describe("new shipped biomes in an existing vault", () => {
	it("are written once each (never a deleted one), and the surface ones join the shipped pool once", async () => {
		const old = BIOME_PRESETS.filter((p) => ![...SURFACE_NEW, ...UNDERGROUND_NEW].includes(p.id));
		const files: Record<string, string> = {};
		for (const p of old) files[`world/biomes/${p.label}.md`] = buildBiomeNote(p);
		const pool = buildBiomePool(ALL_BIOMES_POOL, allBiomesPool(old)) + "\nMy own line.\n";
		files[`world/biome-pools/${ALL_BIOMES_POOL}.md`] = pool;
		const v = new MemVault(files);
		// Caverns was seeded once before and deleted by the user.
		const seeded = [...old.map((p) => p.id), "caverns"];
		const p = plugin(v, { biomesSeeded: seeded, biomePoolSeeded: true });
		const store = new BiomeStore(p as never);
		await store.init();
		await store.seedShipped(true);
		expect(v.files.has("world/biomes/Highlands.md")).toBe(true);
		expect(v.files.has("world/biomes/Underdark.md")).toBe(true);
		expect(v.files.has("world/biomes/Caverns.md")).toBe(false);
		expect(store.get("underdark")?.layer).toBe("underground");
		const after = v.files.get(`world/biome-pools/${ALL_BIOMES_POOL}.md`)!;
		const rows = parseBiomePool(after).rows.map((r) => r.biome);
		expect(rows).toEqual([...allBiomesPool(old).map((r) => r.biome), "Highlands", "Volcanic peaks", "Glacier", "Canyon", "Mesa", "Steppe", "Desert", "Wasteland", "Blighted lands", "Reef"]);
		expect(after).toContain("My own line.");
		// A restart (or the user taking Highlands out of the pool) adds nothing again.
		const trimmed = after.replace(/^\| \[\[Highlands\]\].*\n/m, "");
		v.files.set(`world/biome-pools/${ALL_BIOMES_POOL}.md`, trimmed);
		const again = new BiomeStore(plugin(v, { biomesSeeded: p.settings.biomesSeeded, biomePoolSeeded: true }) as never);
		await again.init();
		await again.seedShipped(true);
		expect(v.files.get(`world/biome-pools/${ALL_BIOMES_POOL}.md`)).toBe(trimmed);
	});

	it("appendPoolRows adds only what's missing and keeps every other line", () => {
		const note = buildBiomePool("P", [{ biome: "Tundra" }, { biome: "world/biomes/Taiga", weight: 2 }]) + "Notes after.\n";
		const out = appendPoolRows(note, ["Taiga", "Steppe", "Steppe"]);
		expect(parseBiomePool(out).rows.map((r) => r.biome)).toEqual(["Tundra", "world/biomes/Taiga", "Steppe"]);
		expect(out.endsWith("Notes after.\n")).toBe(true);
		expect(appendPoolRows(out, ["steppe"])).toBe(out);
		expect(appendPoolRows("no table", ["X"])).toBe("no table");
	});
});
