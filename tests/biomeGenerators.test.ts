/**
 * Custom biomes, the generator side (#50): generateBiomeRegion (a region
 * made by a learned, blend or preset generator, joined to pinned cells),
 * the biome page's edits through the store, min patches per type, and the
 * shore setting (land toward the land-heavy neighbours).
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hexDistance, hexNeighbors } from "../packages/hex-wfc/src/grid";
import { learnModel, mergeModels, modelToMarkdown, type HexWfcModel } from "../packages/hex-wfc/src";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { parseBuiltin } from "../src/worldgen/builtinGenerators";
import { BiomeRegionError, generateBiomeRegion, type BiomeRegionRequest, type GeneratorRef } from "../src/worldgen/biomeRegion";
import { biomePagePatch, biomeSamplePlan, setMixRow } from "../src/overworld/biomePage/fields";
import { buildBiomeNote, parseBiomeNote, updateBiomeNote, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { BIOME_PRESETS, biomePreset } from "../src/overworld/biomePresets";
import { BiomeStore } from "../src/overworld/BiomeStore";
import { WATER_TYPES, noteBiomeProfiles, profileFromFields, setBiomeSource, type BiomeProfile } from "../src/overworld/biomes";
import { fieldsFromForm, formFromFields, formTypes, regionGenerator } from "../src/overworld/biomeForm";
import { BlendField, REGION_WARP } from "../src/overworld/blendField";
import { regionCells, type RegionLayout } from "../src/overworld/layout";
import { generateRegion } from "../src/overworld/regionGen";
import type { TerrainPalette } from "../src/types";
import { MemVault } from "./helpers/memVault";

(globalThis as Record<string, unknown>).window ??= globalThis;

const PALETTE: TerrainPalette = { name: "Expanded", terrains: DEFAULT_TERRAIN_PALETTE, pathTypes: DEFAULT_PATH_TYPES };
const typeOfMap = new Map(DEFAULT_TERRAIN_PALETTE.map((t) => [t.name, t.type]));
const typeOf = (n: string) => typeOfMap.get(n);
const water = new Set(WATER_TYPES);
const isLand = (t: string) => { const ty = typeOf(t); return ty !== undefined && !water.has(ty); };

// ── generateBiomeRegion ──────────────────────────────────────────────────

function fakePlugin(vault?: MemVault) {
	return {
		app: { ...(vault?.app() ?? {}), metadataCache: { getFirstLinkpathDest: () => null } },
		settings: { hexOrientation: "flat", staggerOffset: "odd", terrainPalettes: [PALETTE] },
		getPathTypes: () => DEFAULT_PATH_TYPES,
	};
}

/** A painted 12×10 map: forest with a lake and a band of hills. */
function painted(): Map<string, string> {
	const m = new Map<string, string>();
	for (let x = 0; x < 12; x++) for (let y = 0; y < 10; y++) {
		const d = Math.hypot(x - 4, y - 4);
		m.set(`${x}_${y}`, d < 2.2 ? "water" : x > 8 ? "hills" : (x + y) % 5 === 0 ? "grass" : "forest");
	}
	return m;
}

const learned = (): HexWfcModel => learnModel(painted(), { name: "my-woods", orientation: "flat", meta: { palette: "Expanded" } });
const otherLearned = (): HexWfcModel => {
	const m = new Map<string, string>();
	for (let x = 0; x < 10; x++) for (let y = 0; y < 8; y++) m.set(`${x}_${y}`, y < 3 ? "hills" : (x * y) % 7 === 0 ? "forest" : "grass");
	return learnModel(m, { name: "my-hills", orientation: "flat", meta: { palette: "Expanded" } });
};
const preset = (slug: string) => parseBuiltin(readFileSync(join(__dirname, "../src/worldgen/builtin", `${slug}.md`), "utf8"), slug)!;

const BOUNDS = { cols: 8, rows: 8, offset: { x: 16, y: 8 }, stagger: "odd" as const };
const inBounds = (k: string) => {
	const [x, y] = k.split("_").map(Number);
	return x >= 16 && x < 24 && y >= 8 && y < 16;
};

/** A neighbour's column of forest just west, and two locked cells inside. */
function pins(): Map<string, string> {
	const p = new Map<string, string>();
	for (let y = 8; y < 16; y++) p.set(`15_${y}`, "forest");
	p.set("18_10", "hills");
	p.set("20_13", "water");
	return p;
}

const req = (generator: GeneratorRef, seed: number, extra: Partial<BiomeRegionRequest> = {}): BiomeRegionRequest => ({
	generator, palette: PALETTE, bounds: BOUNDS, pinned: pins(), seed, ...extra,
});

describe("generateBiomeRegion", () => {
	const refs: [string, () => GeneratorRef][] = [
		["a learned generator", () => ({ model: learned(), source: "learned" })],
		["a blend", () => ({ model: mergeModels([learned(), otherLearned()], "woods-to-hills", { "blend-of": "my-woods + my-hills" }, [50, 50], ["W", "E"]), source: "blend" })],
		["a preset", () => ({ model: preset("preset-volcanic"), source: "preset" })],
	];
	for (const [label, ref] of refs) {
		it(`${label}: fills the region, keeps pinned cells, same seed same region`, async () => {
			const plugin = fakePlugin() as never;
			for (const seed of [1, 7, 42]) {
				const a = await generateBiomeRegion(plugin, req(ref(), seed));
				const b = await generateBiomeRegion(plugin, req(ref(), seed));
				expect([...a.cells]).toEqual([...b.cells]);
				expect(a.cells.size).toBe(64);
				for (const k of a.cells.keys()) expect(inBounds(k)).toBe(true);
				// Pinned cells inside come out as they were; neighbours' cells aren't in the result.
				expect(a.cells.get("18_10")).toBe("hills");
				expect(a.cells.get("20_13")).toBe("water");
				expect(a.cells.has("15_9")).toBe(false);
				for (const t of a.cells.values()) expect(DEFAULT_TERRAIN_PALETTE.some((p) => p.name === t)).toBe(true);
			}
		});
	}

	it("a different seed gives a different region", async () => {
		const plugin = fakePlugin() as never;
		const a = await generateBiomeRegion(plugin, req({ model: learned(), source: "learned" }, 1));
		const b = await generateBiomeRegion(plugin, req({ model: learned(), source: "learned" }, 2));
		expect([...a.cells]).not.toEqual([...b.cells]);
	});

	it("only the mask's cells (hex flowers)", async () => {
		const mask = (k: string) => { const [x] = k.split("_").map(Number); return x < 20; };
		const r = await generateBiomeRegion(fakePlugin() as never, req({ model: learned(), source: "learned" }, 3, { mask }));
		expect(r.cells.size).toBe(32);
		for (const k of r.cells.keys()) expect(mask(k)).toBe(true);
	});

	it("carries a neighbour's edge on (a hills column west pulls hills to the region's west edge)", async () => {
		const edge = (terrain: string) => {
			const p = new Map<string, string>();
			for (let y = 8; y < 16; y++) p.set(`15_${y}`, terrain);
			return p;
		};
		const share = async (pinned: Map<string, string>) => {
			let hit = 0, n = 0;
			for (let seed = 1; seed <= 20; seed++) {
				const r = await generateBiomeRegion(fakePlugin() as never, req({ model: learned(), source: "learned" }, seed, { pinned }));
				for (let y = 8; y < 16; y++) { n++; if (r.cells.get(`16_${y}`) === "hills") hit++; }
			}
			return hit / n;
		};
		expect(await share(edge("hills"))).toBeGreaterThan((await share(edge("water"))) + 0.2);
	});

	it("throws a readable error when the generator doesn't fit the palette", async () => {
		const alien = learnModel({ "0_0": "lava", "0_1": "glass", "1_0": "lava", "1_1": "glass" }, { name: "alien", orientation: "flat" });
		const p = generateBiomeRegion(fakePlugin() as never, req({ model: alien, source: "learned" }, 1));
		await expect(p).rejects.toBeInstanceOf(BiomeRegionError);
		await expect(generateBiomeRegion(fakePlugin() as never, req({ model: alien, source: "learned" }, 1))).rejects.toThrow(/alien doesn't fit palette Expanded: it uses (lava, glass|glass, lava)/);
		const tiny: TerrainPalette = { name: "Tiny", terrains: [{ name: "grass", color: "#0f0", type: "grassland" }] };
		await expect(generateBiomeRegion(fakePlugin() as never, { ...req({ model: preset("preset-volcanic"), source: "preset" }, 1), palette: tiny })).rejects.toThrow(/doesn't fit palette Tiny/);
	});

	it("reads a generator note by link target (a biome's generator: [[…]])", async () => {
		const v = new MemVault({ "world/generators/my-woods.md": modelToMarkdown(learned()) });
		const plugin = fakePlugin(v) as never;
		const byLink = await generateBiomeRegion(plugin, req({ path: "world/generators/my-woods" }, 5));
		const byModel = await generateBiomeRegion(plugin, req({ model: learned(), source: "learned" }, 5));
		expect(byLink.cells.size).toBe(64);
		expect([...byLink.cells.values()].every((t) => DEFAULT_TERRAIN_PALETTE.some((p) => p.name === t))).toBe(true);
		expect(byModel.cells.size).toBe(64);
		await expect(generateBiomeRegion(plugin, req({ path: "world/generators/nope" }, 5))).rejects.toThrow(/nope wasn't found/);
	});

	it("routing: a biome with a generator link goes to its generator, the rest blend", () => {
		expect(regionGenerator({ generator: "world/generators/my-woods" })).toEqual({ kind: "generator", generator: "world/generators/my-woods", ready: true });
		expect(regionGenerator({})).toEqual({ kind: "blend" });
	});
});

// ── the biome page through the store ─────────────────────────────────────

function storePlugin(vault: MemVault) {
	return {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", biomesFolder: "", kindContent: ["world"], mapKinds: ["world"] } as Record<string, unknown>,
		saveSettings: async () => {},
	};
}

describe("biome page edits round-trip through the store", () => {
	afterEach(() => setBiomeSource(undefined));

	it("mix, min patches, blend, land, islands, shore and transitions are written to the note and read back", async () => {
		const v = new MemVault();
		const store = new BiomeStore(storePlugin(v) as never);
		await store.init();
		// The shipped notes come with the first overworld or region (DJ-Q4).
		await store.seedShipped(true);
		const path = "world/biomes/Alpine.md";
		v.files.set(path, v.files.get(path)! + "\nMy notes about the peaks.\n");
		store.onModify(v.app().vault.getAbstractFileByPath(path)!);
		const f = structuredClone(store.get("alpine")!);
		setMixRow(f, "peaks", { weight: 30, minPatches: 3 });
		setMixRow(f, "snow", { weight: 0 });
		setMixRow(f, "hills", { minPatches: null });
		f.blend = "wide";
		f.landShare = 0.8;
		f.minIslands = 1;
		f.shore = true;
		f.transitions = [{ next: "Jungle", between: "Karst" }, { next: "Swamp", between: "Valley" }];
		expect(await store.update("alpine", biomePagePatch(f))).toBe(true);
		const text = v.files.get(path)!;
		expect(text).toContain("My notes about the peaks.");
		expect(text).toContain("| Type | Weight | Min patches |");
		expect(text).toMatch(/\| peaks \| 30 \| 3 \|/);
		expect(text).toContain("shore: yes");
		const back = parseBiomeNote(text, "Alpine").fields;
		expect(back.mix).toEqual(f.mix);
		expect(back.transitions).toEqual(f.transitions);
		expect([back.blend, back.landShare, back.minIslands, back.shore]).toEqual(["wide", 0.8, 1, true]);
		expect(store.get("alpine")!.mix.find((r) => r.type === "peaks")).toEqual({ type: "peaks", weight: 30, minPatches: 3 });
		// Turning things off removes them.
		const g = structuredClone(store.get("alpine")!);
		delete g.shore; delete g.blend; delete g.landShare; delete g.minIslands;
		expect(await store.update("alpine", biomePagePatch(g))).toBe(true);
		expect(v.files.get(path)).not.toMatch(/^(shore|blend|land-share|min-islands):/m);
		// Restore default brings the shipped preset back (min patches included).
		expect(store.hasDefault("alpine")).toBe(true);
		expect(await store.restoreDefault("alpine")).toBe(true);
		expect(store.get("alpine")!.mix).toEqual(biomePreset("alpine")!.mix);
		expect(store.get("alpine")!.shore).toBeUndefined();
	});

	it("the Coast preset is seeded, listed, and restorable", async () => {
		const v = new MemVault();
		const store = new BiomeStore(storePlugin(v) as never);
		await store.init();
		// The shipped notes come with the first overworld or region (DJ-Q4).
		await store.seedShipped(true);
		expect(store.get("coast")?.shore).toBe(true);
		expect(v.files.get("world/biomes/Coast.md")).toContain("shore: yes");
		await store.update("coast", { shore: undefined });
		expect(store.get("coast")?.shore).toBeUndefined();
		await store.restoreDefault("coast");
		expect(store.get("coast")?.shore).toBe(true);
	});

	it("the Add / Edit biome form keeps min patches and shore", () => {
		const coast = biomePreset("coast")!;
		const alpine = biomePreset("alpine")!;
		for (const b of [coast, alpine]) {
			const back = fieldsFromForm(formFromFields(b, formTypes(DEFAULT_TERRAIN_PALETTE, b)), b.id);
			const byType = (m: { type: string }[]) => [...m].sort((x, y) => (x.type < y.type ? -1 : 1));
			expect(byType(back.mix)).toEqual(byType(b.mix));
			expect(!!back.shore).toBe(!!b.shore);
		}
	});
});

// ── the note's Min patches column ────────────────────────────────────────

describe("Min patches in the biome note", () => {
	it("reads forgivingly (header spelling, blanks, bad values reported, row kept)", () => {
		const text = "| Type | Weight | Patches |\n| --- | --- | --- |\n| peaks | 20 | 2 |\n| hills | 10 |  |\n| snow | 5 | lots |\n";
		const { fields, problems } = parseBiomeNote(text, "Crags");
		expect(fields.mix).toEqual([{ type: "peaks", weight: 20, minPatches: 2 }, { type: "hills", weight: 10 }, { type: "snow", weight: 5 }]);
		expect(problems).toHaveLength(1);
		expect(problems[0].text).toMatch(/min patches "lots"/);
	});

	it("notes without the column are left exactly as written", () => {
		const old = buildBiomeNote({ ...biomePreset("tundra")!, mix: [{ type: "snow", weight: 2 }, { type: "hills", weight: 1 }] });
		expect(old).not.toContain("| Min patches |");
		const f = parseBiomeNote(old, "Tundra").fields;
		expect(updateBiomeNote(old, f)).toBe(old);
	});

	it("round-trips through build and parse", () => {
		const f: BiomeNoteFields = { id: "crags", label: "Crags", mix: [{ type: "peaks", weight: 20, minPatches: 2 }, { type: "hills", weight: 10 }], transitions: [], shore: true };
		expect(parseBiomeNote(buildBiomeNote(f), "Crags").fields).toEqual(f);
	});
});

// ── min patches in region generation ─────────────────────────────────────

const brick = (size: number): RegionLayout => ({ footprint: "rect", size, orientation: "flat", parentStagger: "odd", childStagger: "odd" });

function ringed(centre: string, around: string): Map<string, string> {
	const m = new Map<string, string>();
	for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) m.set(`${x}_${y}`, hexDistance([x, y], [2, 2], "flat", "odd") === 0 ? centre : around);
	return m;
}

/** Separate patches of `type` among a region's cells. */
function patches(l: RegionLayout, cells: Map<string, string>, type: string): number {
	const of = new Set([...cells].filter(([, t]) => typeOf(t) === type).map(([k]) => k));
	const seen = new Set<string>();
	let n = 0;
	for (const k of of) {
		if (seen.has(k)) continue;
		n++;
		const stack = [k];
		seen.add(k);
		while (stack.length) {
			const [x, y] = stack.pop()!.split("_").map(Number);
			for (const [a, b] of hexNeighbors(x, y, l.orientation, l.childStagger)) {
				const nk = `${a}_${b}`;
				if (of.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
			}
		}
	}
	return n;
}

const strip = (p: BiomeProfile): BiomeProfile => { const q = { ...p }; delete q.minPatches; return q; };

describe("min patches per type (regionGen)", () => {
	setBiomeSource(BIOME_PRESETS);
	const profiles = noteBiomeProfiles(DEFAULT_TERRAIN_PALETTE);
	setBiomeSource(undefined);
	const l = brick(8);
	const gen = (centre: string, around: string, seed: number, ps: Map<string, BiomeProfile> = profiles) =>
		generateRegion({ layout: l, parent: [2, 2], field: new BlendField(l, ringed(centre, around), "normal", { warp: REGION_WARP, seed }), profiles: ps, typeOf, seed });

	for (const [biome, around] of [["alpine", "alpine"], ["alpine", "grassland"], ["volcanic", "volcanic"], ["volcanic", "grassland"], ["taiga", "taiga"], ["jungle", "jungle"]] as const) {
		it(`${biome} ringed by ${around}: every min-patches type is there on 200 seeds`, () => {
			const wants = [...profiles.get(biome)!.minPatches!];
			expect(wants.length).toBeGreaterThan(0);
			for (let seed = 1; seed <= 200; seed++) {
				const out = gen(biome, around, seed);
				for (const [type, min] of wants) expect({ seed, type, ok: patches(l, out, type) >= min }).toEqual({ seed, type, ok: true });
			}
		});
	}

	it("the presets ask for alpine peaks and a volcano", () => {
		expect(profiles.get("alpine")!.minPatches!.get("peaks")).toBeGreaterThanOrEqual(1);
		expect(profiles.get("volcanic")!.minPatches!.get("volcanic")).toBe(1);
	});

	it("a biome without the setting comes out exactly as before (200 seeds)", () => {
		const without = new Map([...profiles].map(([id, p]) => [id, strip(p)]));
		for (const biome of ["archipelago", "coastal-fjord", "grassland"]) {
			const ps = new Map(without);
			if (biome !== "grassland") ps.set(biome, without.get(biome)!);
			for (let seed = 1; seed <= 200; seed++) {
				// The neighbours' min patches never touch this region; an empty setting changes nothing.
				const a = gen(biome, "alpine", seed, ps);
				const b = gen(biome, "alpine", seed, new Map([...ps, [biome, { ...without.get(biome)!, minPatches: new Map() }]]));
				const c = gen(biome, "alpine", seed, new Map([...profiles, [biome, without.get(biome)!]]));
				expect(b).toEqual(a);
				expect(c).toEqual(a);
			}
		}
	});

	it("never changes pinned cells or the neighbours'", () => {
		const pinned = new Map<string, string>();
		for (const [x, y] of regionCells(l, 1, 2)) pinned.set(`${x}_${y}`, "grass");
		const own = regionCells(l, 2, 2).map(([x, y]) => `${x}_${y}`);
		pinned.set(own[20], "grass");
		pinned.set(own[30], "grass");
		for (let seed = 1; seed <= 50; seed++) {
			const out = generateRegion({ layout: l, parent: [2, 2], field: new BlendField(l, ringed("alpine", "alpine"), "normal", { warp: REGION_WARP, seed }), profiles, typeOf, seed, pinned });
			for (const k of pinned.keys()) expect(out.has(k)).toBe(false);
			expect(out.size).toBe(own.length - 2);
		}
	});
});

// ── shore biomes ─────────────────────────────────────────────────────────

describe("shore biomes (Coast)", () => {
	setBiomeSource(BIOME_PRESETS);
	const profiles = noteBiomeProfiles(DEFAULT_TERRAIN_PALETTE);
	setBiomeSource(undefined);
	const l = brick(8);
	/** A 5×5 overworld: coast at 2,2; `west` on columns 0–1, `east` on 3–4, coast above and below. */
	const layout = (west: string, east: string) => {
		const m = new Map<string, string>();
		for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) m.set(`${x}_${y}`, x < 2 ? west : x > 2 ? east : "coast");
		return m;
	};
	const gen = (west: string, east: string, seed: number, pinned?: Map<string, string>) =>
		generateRegion({ layout: l, parent: [2, 2], field: new BlendField(l, layout(west, east), "normal", { warp: REGION_WARP, seed }), profiles, typeOf, seed, pinned });
	const cells = regionCells(l, 2, 2);
	const xs = cells.map(([x]) => x);
	const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
	const landShare = (out: Map<string, string>, side: "west" | "east") => {
		const keys = cells.filter(([x]) => (side === "west" ? x < mid : x > mid)).map(([x, y]) => `${x}_${y}`).filter((k) => out.has(k));
		return keys.filter((k) => isLand(out.get(k)!)).length / keys.length;
	};

	it("Coast is a shore biome, by its setting", () => {
		expect(profiles.get("coast")!.shore).toBe(true);
		expect(profileFromFields({ ...biomePreset("coast")!, shore: undefined }, DEFAULT_TERRAIN_PALETTE).shore).toBeUndefined();
	});

	it("forest to the west, open sea to the east: land-heavy west, water east (100 seeds)", () => {
		let west = 0, east = 0;
		for (let seed = 1; seed <= 100; seed++) {
			const out = gen("temperate-forest", "open-sea", seed);
			const w = landShare(out, "west"), e = landShare(out, "east");
			expect({ seed, ok: w > e + 0.3 }).toEqual({ seed, ok: true });
			west += w; east += e;
		}
		expect(west / 100).toBeGreaterThan(0.7);
		expect(east / 100).toBeLessThan(0.25);
	});

	it("the land side follows the land neighbour (sea west, forest east)", () => {
		for (let seed = 1; seed <= 100; seed++) {
			const out = gen("open-sea", "temperate-forest", seed);
			expect({ seed, ok: landShare(out, "east") > landShare(out, "west") + 0.3 }).toEqual({ seed, ok: true });
		}
	});

	it("a coast band sits between land and water", () => {
		const out = gen("temperate-forest", "open-sea", 11);
		expect([...out.values()].some((t) => typeOf(t) === "coast")).toBe(true);
		expect([...out.values()].some((t) => typeOf(t) === "shallows")).toBe(true);
	});

	it("with no land around: mostly water, with land along one side picked by the seed", () => {
		const sides = new Set<string>();
		for (let seed = 1; seed <= 60; seed++) {
			const out = gen("open-sea", "open-sea", seed);
			const land = [...out.values()].filter(isLand).length / out.size;
			expect({ seed, ok: land > 0.05 && land < 0.5 }).toEqual({ seed, ok: true });
			sides.add(landShare(out, "west") > landShare(out, "east") ? "west" : "east");
		}
		expect(sides.size).toBe(2);
	});

	it("already painted neighbours count: a land region painted to the east pulls the land there", () => {
		const pinned = new Map<string, string>();
		for (const [qx, qy] of hexNeighbors(2, 2, "flat", "odd")) {
			if (qx <= 2) continue;
			for (const [x, y] of regionCells(l, qx, qy)) pinned.set(`${x}_${y}`, "forest");
		}
		// The overworld says sea everywhere, but the painted cells say land to the east.
		for (let seed = 1; seed <= 30; seed++) {
			const out = gen("open-sea", "open-sea", seed, pinned);
			expect({ seed, ok: landShare(out, "east") > landShare(out, "west") }).toEqual({ seed, ok: true });
		}
	});

	it("pinned and neighbour cells unchanged; deterministic", () => {
		const pinned = new Map<string, string>();
		for (const [x, y] of regionCells(l, 1, 2)) pinned.set(`${x}_${y}`, "forest");
		const own = cells.map(([x, y]) => `${x}_${y}`);
		pinned.set(own[5], "ocean");
		for (let seed = 1; seed <= 30; seed++) {
			const a = gen("temperate-forest", "open-sea", seed, pinned);
			const b = gen("temperate-forest", "open-sea", seed, pinned);
			expect([...a]).toEqual([...b]);
			for (const k of pinned.keys()) expect(a.has(k)).toBe(false);
			for (const k of a.keys()) expect(own.includes(k)).toBe(true);
		}
	});

	it("the biome page's sample shows the shore turning toward the land", () => {
		const coast = biomePreset("coast")!;
		setBiomeSource(BIOME_PRESETS);
		try {
			const plan = biomeSamplePlan(brick(10), DEFAULT_TERRAIN_PALETTE, coast, 9, "land-west", "temperate-forest", profiles);
			const own = regionCells(brick(10), 0, 0);
			const m = (Math.min(...own.map(([x]) => x)) + Math.max(...own.map(([x]) => x))) / 2;
			const share = (west: boolean) => {
				const ks = own.filter(([x]) => (west ? x < m : x > m)).map(([x, y]) => `${x}_${y}`);
				return ks.filter((k) => isLand(plan.cells.get(k)!)).length / ks.length;
			};
			expect(share(true)).toBeGreaterThan(share(false));
		} finally {
			setBiomeSource(undefined);
		}
	});
});

