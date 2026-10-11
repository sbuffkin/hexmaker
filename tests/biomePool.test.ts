import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { hexDistance } from "../packages/hex-wfc/src/grid";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import {
	ALL_BIOMES_POOL,
	allBiomesPool,
	buildBiomePool,
	parseBiomePool,
	poolBiomes,
	updateBiomePool,
} from "../src/overworld/biomePool";
import { biomeFileName, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { BIOME_PRESETS } from "../src/overworld/biomePresets";
import { biomeForTerrain, setBiomeSource } from "../src/overworld/biomes";
import { worldBiomes } from "../src/overworld/worldBiomes";
import { firstPassWrites } from "../src/overworld/overworldPass";
import { buildMapNote, parseMapNote, type HexData, type MapNoteData } from "../src/maps/mapNote";

const hexWorld = (R: number): [number, number][] => {
	const out: [number, number][] = [];
	for (let x = 0; x <= 2 * R; x++) for (let y = 0; y <= 2 * R; y++) if (hexDistance([x, y], [R, R], "flat", "odd") <= R) out.push([x, y]);
	return out;
};
const sorted = (m: Map<string, string>) => JSON.stringify([...m].sort());
const byId = new Map(BIOME_PRESETS.map((p) => [p.id, p]));
const preset = (id: string) => byId.get(id)!;
/** Lookup like the plugin's (biome store): id, label or note name. */
const finder = (list: BiomeNoteFields[]) => (ref: string) => {
	const k = ref.trim().toLowerCase().replace(/\s+/g, "-");
	return list.find((b) => b.id === k || b.label.toLowerCase().replace(/\s+/g, "-") === k);
};

afterEach(() => setBiomeSource(undefined));

describe("biome pool notes", () => {
	it("round-trips and keeps prose", () => {
		const rows = [{ biome: "Tundra" }, { biome: "Taiga", weight: 2, notes: "more | pines" }, { biome: "Glass wastes", weight: 0.5 }];
		const note = buildBiomePool("Cold north", rows);
		expect(note).toContain("hexmaker-biome-pool: 1");
		expect(note).toContain("| [[Taiga]] | 2 | more \\| pines |");
		expect(parseBiomePool(note)).toEqual({ rows, problems: [] });
		const withProse = note.replace("# Cold north", "# Cold north\n\nMy notes on the north.");
		expect(updateBiomePool(withProse, rows)).toBe(withProse);
		const next = updateBiomePool(withProse, rows.slice(1));
		expect(next).toContain("My notes on the north.");
		expect(parseBiomePool(next).rows).toEqual(rows.slice(1));
	});

	it("reads forgivingly and reports what it can't", () => {
		const note = [
			"| Notes | Biome | Chance |",
			"| --- | --- | --- |",
			"| a | [[world/biomes/Tundra|cold one]] | 50% |",
			"|  | Taiga | lots |",
			"| orphan |  | 1 |",
			"",
		].join("\n");
		const { rows, problems } = parseBiomePool(note);
		expect(rows).toEqual([{ biome: "world/biomes/Tundra", weight: 0.5, notes: "a" }, { biome: "Taiga" }]);
		expect(problems.map((p) => p.text)).toEqual([expect.stringMatching(/weight "lots"/), expect.stringMatching(/no biome/)]);
		expect(parseBiomePool("no table here").problems.length).toBe(1);
	});

	it("ships one pool with every built-in biome", () => {
		const rows = allBiomesPool(BIOME_PRESETS);
		expect(ALL_BIOMES_POOL).toBe("All biomes");
		expect(rows.map((r) => r.biome)).toEqual(BIOME_PRESETS.map((p) => biomeFileName(p.label)));
		const { biomes, unknown } = poolBiomes(parseBiomePool(buildBiomePool(ALL_BIOMES_POOL, rows)).rows, finder([...BIOME_PRESETS]));
		expect(unknown).toEqual([]);
		expect(biomes.map((b) => b.id)).toEqual(BIOME_PRESETS.map((p) => p.id));
	});

	it("weights scale a biome's chance; 0 leaves it out; unknown biomes are reported", () => {
		const { biomes, unknown } = poolBiomes(
			[{ biome: "Karst", weight: 0.5 }, { biome: "Valley", weight: 3 }, { biome: "Tundra", weight: 0 }, { biome: "Nowhere" }, { biome: "karst" }],
			finder([...BIOME_PRESETS]),
		);
		expect(unknown).toEqual(["Nowhere"]);
		expect(biomes.map((b) => b.id)).toEqual(["karst", "valley"]);
		expect(biomes[0].climate!.chance).toBeCloseTo(0.275, 6);
		expect(biomes[1].climate!.chance).toBeUndefined(); // 0.55 × 3 → always
		expect(preset("karst").climate!.chance).toBe(0.55); // the note's own data untouched
	});
});

describe("placement from a pool", () => {
	const SEEDS = [1, 5, 42, 99, 2024];
	const cells = hexWorld(4);

	it("places only the pool's biomes", () => {
		const pool = ["tundra", "taiga", "temperate-forest", "grassland", "alpine", "open-sea"].map(preset);
		const ids = new Set(pool.map((b) => b.id));
		for (const seed of SEEDS) {
			const r = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, climate: "varied", biomes: pool });
			expect(r.biomes.size).toBe(cells.length);
			for (const b of r.biomes.values()) expect(ids.has(b)).toBe(true);
		}
	});

	it("the full shipped pool places exactly what World biomes does", () => {
		for (const seed of SEEDS) {
			const a = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed });
			const b = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, biomes: BIOME_PRESETS });
			expect(sorted(b.biomes)).toBe(sorted(a.biomes));
		}
	});

	const ASH: BiomeNoteFields = { id: "ash", label: "Ash", mix: [{ type: "badlands", weight: 1 }], transitions: [] };

	it("a pool biome without a climate fills only the hexes no climate biome fits", () => {
		setBiomeSource([...BIOME_PRESETS, ASH]);
		// With lowland biomes covering every climate, it never gets a hex.
		for (const seed of SEEDS) {
			const r = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, biomes: [...BIOME_PRESETS, ASH] });
			expect([...r.biomes.values()]).not.toContain("ash");
		}
		// With no lowland biome in the pool, the lowlands are it.
		const pool = [preset("alpine"), preset("open-sea"), ASH];
		const r = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 42, biomes: pool, river: false });
		const land = [...r.biomes].filter(([k]) => !r.sea.has(k));
		expect(land.filter(([, b]) => b === "ash").length).toBeGreaterThan(land.length / 2);
		for (const b of r.biomes.values()) expect(["alpine", "open-sea", "ash"]).toContain(b);
	});

	it("is deterministic for a seed and a pool", () => {
		setBiomeSource([...BIOME_PRESETS, ASH]);
		const pool = [preset("alpine"), preset("open-sea"), preset("taiga"), ASH];
		const a = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 7, biomes: pool });
		const b = worldBiomes([...cells].reverse(), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 7, biomes: [...pool] });
		expect(sorted(a.biomes)).toBe(sorted(b.biomes));
		expect(sorted(a.terrain)).toBe(sorted(b.terrain));
	});

	it("a pool with nothing placeable places nothing", () => {
		const r = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 1, biomes: [] });
		expect(r.biomes.size).toBe(0);
		expect(r.terrain.size).toBe(0);
	});
});

describe("the first pass writes", () => {
	const readsAs = (t: string) => biomeForTerrain(t, DEFAULT_TERRAIN_PALETTE);

	it("never touches locked hexes; records a biome its terrain can't say", () => {
		setBiomeSource([...BIOME_PRESETS, { id: "ash", label: "Ash", mix: [{ type: "badlands", weight: 1 }], transitions: [], climate: { elevation: "low" } }]);
		const r = worldBiomes(hexWorld(3), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 3 });
		const keys = [...r.biomes.keys()];
		const current = new Map<string, { terrain?: string; biome?: string; locked?: boolean }>([
			[keys[0], { terrain: "my painted", locked: true }],
			[keys[1], { terrain: "old", biome: "old-one" }],
		]);
		const w = firstPassWrites(current, r, readsAs);
		expect(w.kept).toEqual([keys[0]]);
		expect(w.cells.some(([k]) => k === keys[0])).toBe(false);
		for (const [k, patch] of w.cells) {
			expect(patch.terrain).toBe(r.terrain.get(k));
			expect(patch.biome).toBe(readsAs(patch.terrain) === r.biomes.get(k) ? null : r.biomes.get(k));
		}
		// Nothing to do the second time round (beyond the locked hex).
		const after = new Map(current);
		for (const [k, p] of w.cells) after.set(k, { terrain: p.terrain, biome: p.biome ?? undefined });
		expect(firstPassWrites(after, r, readsAs).cells).toEqual([]);
	});

	it("regenerating keeps locked hexes across seeds", () => {
		const cells = hexWorld(3);
		const first = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 1 });
		const state = new Map<string, { terrain?: string; biome?: string; locked?: boolean }>();
		for (const [k, p] of firstPassWrites(state, first, readsAs).cells) state.set(k, { terrain: p.terrain });
		const lockedKey = [...state.keys()][4];
		state.set(lockedKey, { terrain: "hand painted", locked: true });
		const second = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 2 });
		for (const [k, p] of firstPassWrites(state, second, readsAs).cells) state.set(k, { ...state.get(k), terrain: p.terrain });
		expect(state.get(lockedKey)).toEqual({ terrain: "hand painted", locked: true });
	});
});

describe("map note: Biome column", () => {
	it("is written only when a hex has a biome, and reads back", () => {
		const hexes = new Map<string, HexData>([["0_0", { terrain: "forest" }], ["1_0", { terrain: "hills", biome: "ash" }]]);
		const data: MapNoteData = { settings: { paletteName: "Default", biomePool: "world/biome-pools/All biomes.md" }, hexes, paths: [] };
		const note = buildMapNote("ow", data);
		expect(note).toContain("| Hex | Name | Terrain | Biome |");
		expect(note).toContain('biome-pool: "[[world/biome-pools/All biomes]]"');
		const back = parseMapNote(note)!;
		expect(back.hexes.get("1_0")).toEqual({ terrain: "hills", biome: "ash" });
		expect(back.settings.biomePool).toBe("world/biome-pools/All biomes.md");
		const plain = buildMapNote("ow", { ...data, hexes: new Map([["0_0", { terrain: "forest" }]]) });
		expect(plain).not.toContain("Biome |");
	});
});
