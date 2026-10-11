/**
 * PR1 (owner, round 5): "Make generator from this region" — the new
 * generator's biome inherits the region's biome basics; "Overwrite
 * existing" lists the most fitting generators first (the region's biome's,
 * its parents'); an overwrite keeps a backup. Plus the biome note's
 * optional Terrain weights ("different forests go together in different
 * ratios").
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { biomeAncestors, inheritedBiome, makeRegionGenerator, mixFromTerrain, rankOverwriteTargets, relatedBiomes, terrainWeightsFromTerrain, type RankedGenerator } from "../src/worldgen/regionGenerator";
import { buildBiomeNote, parseBiomeNote, updateBiomeNote, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { profileFromFields, profileFromMix, setBiomeSource, withinTypeWeights } from "../src/overworld/biomes";
import { setHexDataSource } from "../src/frontmatter";
import { biomeSlug } from "../src/overworld/biomeNote";
import { MemVault } from "./helpers/memVault";
import type { HexData } from "../src/maps/mapNote";
import type { MapData, TerrainColor } from "../src/types";

const biome = (id: string, extra: Partial<BiomeNoteFields> = {}): BiomeNoteFields => ({ id, label: id[0].toUpperCase() + id.slice(1).replace(/-/g, " "), mix: [{ type: "forest", weight: 1 }], transitions: [], ...extra });

describe("Overwrite existing: the most fitting generators first", () => {
	const biomes = [
		biome("coast", { generator: "gen/coast", parent: "Shoreline" }),
		biome("shoreline", { generator: "gen/shore", parent: "Sea edge" }),
		biome("sea-edge", { generator: "gen/sea" }),
		biome("coastal-fjord", { generator: "gen/fjord" }),
		biome("cove", { generator: "gen/cove", parent: "Coast" }),
	];
	const gens: RankedGenerator[] = [
		{ path: "gen/aaa.md", name: "aaa", sourceMaps: [] },
		{ path: "gen/coast.md", name: "coast", sourceMaps: ["bay"] },
		{ path: "gen/cove.md", name: "cove", sourceMaps: [] },
		{ path: "gen/fjord.md", name: "fjord", sourceMaps: [] },
		{ path: "gen/mixed.md", name: "mixed", sourceMaps: ["bay", "north"] },
		{ path: "gen/sea.md", name: "sea", sourceMaps: [] },
		{ path: "gen/shore.md", name: "shore", sourceMaps: [] },
		{ path: "gen/solo.md", name: "solo", sourceMaps: ["bay"] },
		{ path: "gen/zzz.md", name: "zzz", sourceMaps: [] },
	];
	const resolveGenerator = (l: string) => `${l}.md`;

	it("own biome, parents (nearest first), learned from the region, related, then the rest by name", () => {
		const out = rankOverwriteTargets(gens, { region: "bay", biome: biomes[0], biomes, resolveGenerator });
		expect(out.map((c) => [c.name, c.reason])).toEqual([
			["coast", "own"],
			["shore", "parent"],
			["sea", "parent"],
			["solo", "learned"],
			["mixed", "learned"],
			["cove", "related"],
			["aaa", "other"],
			["fjord", "other"],
			["zzz", "other"],
		]);
		expect(out[0].why).toBe("this region's biome: Coast");
	});

	it("every generator is listed once", () => {
		const out = rankOverwriteTargets(gens, { region: "bay", biome: biomes[0], biomes, resolveGenerator });
		expect(new Set(out.map((c) => c.path)).size).toBe(gens.length);
	});

	it("a region with no biome: learned ones first, then by name", () => {
		const out = rankOverwriteTargets(gens, { region: "bay", biomes, resolveGenerator });
		expect(out.slice(0, 3).map((c) => c.name)).toEqual(["coast", "solo", "mixed"]);
		expect(out[3].reason).toBe("other");
	});

	it("parents are cycle-safe", () => {
		const loop = [biome("a", { parent: "b" }), biome("b", { parent: "a" })];
		expect(biomeAncestors(loop[0], loop).map((b) => b.id)).toEqual(["b"]);
	});

	it("related: blended neighbours, similar biomes, children and siblings, never itself or duplicates", () => {
		const all = [biome("taiga"), biome("tundra"), biome("temperate-forest"), biome("pine", { parent: "taiga" }), biome("larch", { parent: "pine" }), biome("fir", { parent: "taiga" })];
		const rel = relatedBiomes(all[3], all, ["tundra"]).map((b) => b.id);
		expect(rel).toEqual(["tundra", "larch", "fir"]);
	});
});

const PALETTE: TerrainColor[] = [
	{ name: "Pine", color: "#204020", type: "forest" },
	{ name: "Oak", color: "#306030", type: "forest" },
	{ name: "Birch", color: "#507050", type: "forest" },
	{ name: "Sea", color: "#2050a0", type: "water" },
	{ name: "Hamlet", color: "#aa8844", type: "settlement" },
];

describe("the new generator's biome inherits the region's biome basics", () => {
	const source: BiomeNoteFields = {
		id: "coast", label: "Coast", color: "#88aacc", blend: "wide",
		mix: [{ type: "water", weight: 3 }, { type: "forest", weight: 1, minPatches: 2 }],
		transitions: [{ next: "Alpine", between: "Valley" }],
		landShare: 0.4, minIslands: 2, shore: true,
		climate: { temperature: { lo: 0.4, hi: 0.6 }, moisture: { lo: 0.6, hi: 0.8 }, coastal: true, chance: 0.5 },
		generator: "gen/coast",
	};
	const counts = new Map([["Pine", 12], ["Oak", 4], ["Sea", 30], ["Hamlet", 1]]);

	it("copies climate, islands, transitions, shore, blend, colour and the mix; parent is the source", () => {
		const f = inheritedBiome(source, { label: "Rocky coast", generator: "gen/rocky", counts, palette: PALETTE });
		expect(f).toMatchObject({
			label: "Rocky coast", generator: "gen/rocky", parent: "Coast", color: "#88aacc", blend: "wide",
			landShare: 0.4, minIslands: 2, shore: true,
			mix: source.mix, transitions: source.transitions, climate: source.climate,
		});
		// Copies, not the source's own objects.
		expect(f.mix).not.toBe(source.mix);
		expect(f.climate).not.toBe(source.climate);
		expect(f.climate!.temperature).not.toBe(source.climate!.temperature);
	});

	it("takes the split within a type from the region (only types it uses more than one terrain of)", () => {
		const f = inheritedBiome(source, { label: "x", generator: "g", counts, palette: PALETTE });
		expect(f.terrainWeights).toEqual([{ terrain: "Pine", weight: 12 }, { terrain: "Oak", weight: 4 }]);
	});

	it("without a source biome: the mix is what the region shows (no settlements), no parent", () => {
		const f = inheritedBiome(undefined, { label: "x", generator: "g", counts, palette: PALETTE });
		expect(f.mix).toEqual([{ type: "water", weight: 30 }, { type: "forest", weight: 16 }]);
		expect(f.parent).toBeUndefined();
		expect(f.climate).toBeUndefined();
		expect(mixFromTerrain(new Map([["Hamlet", 3]]), PALETTE)).toEqual([]);
		expect(terrainWeightsFromTerrain(counts, PALETTE, ["water"])).toEqual([]);
	});
});

describe("biome Terrain weights: different forests in different ratios", () => {
	it("splits a type's share by the weights; unlisted terrains count 1; 0 leaves one out", () => {
		const p = profileFromMix("f", [{ type: "forest", weight: 1 }], PALETTE, [{ terrain: "pine", weight: 3 }, { terrain: "Birch", weight: 0 }]);
		const forest = p.names.get("forest")!;
		expect(forest.get("Pine")).toBeCloseTo(0.75);
		expect(forest.get("Oak")).toBeCloseTo(0.25);
		expect(forest.has("Birch")).toBe(false);
		expect(p.types.get("forest")).toBe(1);
	});

	it("no weights: an even split, as before; all zero: even too (the type isn't lost)", () => {
		expect([...withinTypeWeights(["A", "B"], undefined).values()]).toEqual([0.5, 0.5]);
		expect([...withinTypeWeights(["A", "B"], [{ terrain: "a", weight: 0 }, { terrain: "b", weight: 0 }]).values()]).toEqual([0.5, 0.5]);
	});

	it("profileFromFields uses the note's weights", () => {
		const p = profileFromFields({ ...biome("woods"), terrainWeights: [{ terrain: "Oak", weight: 2 }] }, PALETTE);
		expect(p.names.get("forest")!.get("Oak")).toBeCloseTo(0.5);
	});

	it("reads and writes the table and `parent`, forgivingly", () => {
		const text = [
			"---", "hexmaker-biome: 1", "id: woods", "label: Woods", "parent: \"[[Taiga]]\"", "---", "",
			"## Mix", "", "| Type | Weight |", "| --- | ---: |", "| forest | 10 |", "",
			"## Terrain weights", "", "| Terrain | Weight |", "| --- | --- |", "| [[Pine]] | 60% |", "| Oak | 40 |", "| oak | 5 |", "| Birch | lots |", "",
		].join("\n");
		const { fields, problems } = parseBiomeNote(text, "Woods");
		expect(fields.parent).toBe("Taiga");
		expect(fields.terrainWeights).toEqual([{ terrain: "Pine", weight: 60 }, { terrain: "Oak", weight: 45 }]);
		expect(problems).toEqual([{ where: "Terrain weights", text: "row 21: weight \"lots\" isn't a number" }]);
		// Rewriting with the same fields leaves the note alone; a change rewrites the table.
		expect(updateBiomeNote(buildBiomeNote(fields), fields)).toBe(buildBiomeNote(fields));
		const next = updateBiomeNote(text, { ...fields, terrainWeights: [{ terrain: "Pine", weight: 1 }] });
		expect(parseBiomeNote(next, "Woods").fields.terrainWeights).toEqual([{ terrain: "Pine", weight: 1 }]);
		expect(next).toContain("parent: \"[[Taiga]]\"");
	});

	it("a note without weights gets no table", () => {
		const f = biome("plain");
		expect(buildBiomeNote(f)).not.toContain("## Terrain weights");
		const note = buildBiomeNote(f);
		expect(updateBiomeNote(note, { ...f, blend: "wide" })).not.toContain("## Terrain weights");
	});
});

// ── glue: new / overwrite through makeRegionGenerator ─────────────────────

function world() {
	const vault = new MemVault({
		"world/generators/old-coast.md": "---\npalette: Woods\n---\n# old-coast\n\nHand notes that the backup must keep.\n",
	});
	const region: MapData = { name: "bay", paletteName: "Woods", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, submapKind: "region", parent: { map: "ow", hex: "2_2" }, biome: { generator: "coast" } } as MapData;
	const maps = [region];
	const hexes = new Map<string, HexData>();
	for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) hexes.set(`${x}_${y}`, { terrain: (x + y) % 3 === 0 ? "Sea" : x < 2 ? "Pine" : "Oak" });
	const biomes: BiomeNoteFields[] = [
		{ id: "coast", label: "Coast", mix: [{ type: "water", weight: 2 }, { type: "forest", weight: 1 }], transitions: [], climate: { temperature: { lo: 0.2, hi: 0.4 } }, landShare: 0.5 },
	];
	setBiomeSource(biomes);
	setHexDataSource({
		isReady: () => true,
		resolve: (p: string) => {
			const m = /^world\/hexes\/([^/]+)\/(-?\d+_-?\d+)\.md$/.exec(p);
			return m ? { map: m[1], key: m[2] } : null;
		},
		get: (m: string, k: string) => (m === "bay" ? hexes.get(k) : undefined),
		set: () => true,
	} as never);
	const plugin = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker", version: "9.9.9" },
		settings: { worldFolder: "world", hexFolder: "world/hexes", hexOrientation: "flat", maps },
		getMap: (n: string) => maps.find((m) => m.name === n),
		hexPath: (x: number, y: number, m: string) => `world/hexes/${m}/${x}_${y}.md`,
		paths: { resolvedPathChains: () => [] },
		mapStore: { all: (m: string) => (m === "bay" ? hexes : new Map()), get: () => undefined },
		getMapPalette: () => PALETTE,
		biomeStore: {
			isReady: () => true,
			list: () => biomes,
			get: (n: string) => biomes.find((b) => b.id === biomeSlug(n) || biomeSlug(b.label) === biomeSlug(n)),
			create: async (f: Omit<BiomeNoteFields, "id">) => {
				const id = biomeSlug(f.label);
				biomes.push({ ...f, id });
				return { id };
			},
		},
	};
	return { vault, plugin, biomes };
}

describe("makeRegionGenerator", () => {
	afterEach(() => {
		setHexDataSource(null);
		setBiomeSource(undefined);
	});

	it("new: writes the generator and a biome that inherits the region's biome and uses it", async () => {
		const { vault, plugin, biomes } = world();
		const r = await makeRegionGenerator(plugin as never, "bay", { kind: "new", name: "Rocky bay" });
		if ("error" in r) throw new Error(r.error);
		expect(r.file.path).toBe("world/generators/rocky-bay.md");
		expect(vault.files.get(r.file.path)).toContain("source-map: bay");
		const made = biomes.find((b) => b.label === "Rocky bay")!;
		expect(made).toMatchObject({ parent: "Coast", generator: "world/generators/rocky-bay", landShare: 0.5, climate: { temperature: { lo: 0.2, hi: 0.4 } } });
		expect(made.terrainWeights?.map((w) => w.terrain).sort()).toEqual(["Oak", "Pine"]);
		expect(r.biome).toBe("Rocky bay");
	});

	it("overwrite: backs the old note up word for word, then writes the learned generator over it", async () => {
		const { vault, plugin } = world();
		const old = vault.files.get("world/generators/old-coast.md")!;
		const r = await makeRegionGenerator(plugin as never, "bay", { kind: "overwrite", path: "world/generators/old-coast.md" });
		if ("error" in r) throw new Error(r.error);
		expect(r.backup).toMatch(/^\.obsidian\/plugins\/hexmaker\/backups\/generators-\d{4}-\d{2}-\d{2}\/old-coast\.md$/);
		expect(vault.files.get(r.backup!)).toBe(old);
		expect(vault.files.get("world/generators/old-coast.md")).toContain("source-map: bay");
		// A second overwrite never writes over the first backup.
		const r2 = await makeRegionGenerator(plugin as never, "bay", { kind: "overwrite", path: "world/generators/old-coast.md" });
		if ("error" in r2) throw new Error(r2.error);
		expect(r2.backup).toMatch(/old-coast-2\.md$/);
	});

	it("overwrite of a generator a biome already uses keeps that biome (no new one)", async () => {
		const { plugin, biomes } = world();
		biomes.push({ id: "old", label: "Old coast", mix: [{ type: "water", weight: 1 }], transitions: [], generator: "world/generators/old-coast" });
		const before = biomes.length;
		const r = await makeRegionGenerator(plugin as never, "bay", { kind: "overwrite", path: "world/generators/old-coast.md" });
		if ("error" in r) throw new Error(r.error);
		expect(r.biome).toBeUndefined();
		expect(biomes.length).toBe(before);
	});
});
