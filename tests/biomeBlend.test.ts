/**
 * "Blend into <biome>" (owner request 2026-10-12): fold a hand-edited map
 * back into its biome's generator, or into the biome's own settings when it
 * has none. The old note is backed up, a Blend of row records the map, and
 * only tables and keys change (the note's prose stays).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TFile } from "obsidian";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { blendBiomeFields, blendMix, blendTerrainWeights, fitSmoothing, measureMap } from "../src/overworld/biomeBlend";
import { mixShares, parseBiomeNote, buildBiomeNote, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { biomePreset } from "../src/overworld/biomePresets";
import { neighbourRegions, type RegionLayout } from "../src/overworld/layout";
import { interiorAgreement } from "../src/overworld/regionGen";
import { paletteTypeOf, planRegion } from "../src/overworld/regionWorld";
import { profileFromFields } from "../src/overworld/biomes";
import { addBlendOfRow, updateGeneratorNote } from "../src/worldgen/generatorNoteUpdate";
import { foldMapIntoModel, generatorText } from "../src/worldgen/generators";
import { applyBlend, type BlendTarget } from "../src/overworld/regionGenerator";
import { blendWeightText } from "../src/overworld/BlendIntoBiomeModal";
import { learnModel, parseModelMarkdown, weightShares, type HexWfcModel } from "../packages/hex-wfc/src";
import { MODELS } from "./overworldFixtures";
import { EXPORT_FIELDS, formatPlan, planExport, shippedBiomesSource } from "../dev/biomes/exportTuned.mjs";
import { SHIPPED_BIOMES } from "../src/modules/world-maps/biomePresets";

const palette = DEFAULT_TERRAIN_PALETTE;
const typeOf = paletteTypeOf(palette);
const firstOf = (type: string) => palette.find((t) => t.type === type)!.name;
const layout: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };

/** A sample region of a biome (its neighbours the same biome). */
function region(f: BiomeNoteFields, seed = 5): Map<string, string> {
	const biomes = new Map<string, string>([["0_0", f.id]]);
	for (const [x, y] of neighbourRegions(layout, 0, 0)) biomes.set(`${x}_${y}`, f.id);
	return planRegion({ layout, parent: [0, 0], biomes, profiles: new Map([[f.id, profileFromFields(f, palette)]]), typeOf, worldSeed: seed, seed }).cells;
}

/** A hand-painted map: all of one type except a column of another. */
function paintedMap(main: string, other: string, size = 8): Map<string, string> {
	const out = new Map<string, string>();
	for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) out.set(`${x}_${y}`, x === 0 ? firstOf(other) : firstOf(main));
	return out;
}

describe("Blend into a biome without a generator: its settings move toward the map", () => {
	const grass = biomePreset("grassland")!;
	const map = paintedMap("forest", "water");
	const stats = measureMap(map, palette, "flat", "odd");

	it("measures the map: counts, land share, neighbour agreement", () => {
		expect(stats.counts.get(firstOf("forest"))).toBe(56);
		expect(stats.land).toBeCloseTo(56 / 64, 9);
		expect(stats.agreement!).toBeGreaterThan(0.8);
	});

	it("the weight sets how far the mix moves (0: unchanged, 1: the map's)", () => {
		const share = (w: number) => mixShares(blendMix(grass.mix, stats.counts, palette, w));
		expect(share(0).get("forest")).toBeCloseTo(mixShares(grass.mix).get("forest")!, 2);
		expect(share(1).get("forest")).toBeCloseTo(56 / 64, 2);
		const quarter = share(0.25).get("forest")!;
		expect(quarter).toBeGreaterThan(share(0).get("forest")!);
		expect(quarter).toBeLessThan(share(1).get("forest")!);
		// Rows keep their order and their Min patches.
		const rows = blendMix(grass.mix, stats.counts, palette, 0.25);
		expect(rows.map((r) => r.type).slice(0, grass.mix.length)).toEqual(grass.mix.map((r) => r.type));
		expect(rows.find((r) => r.type === "hills")!.minPatches).toBe(1);
	});

	it("terrain weights follow how the map splits a type", () => {
		const forests = palette.filter((t) => t.type === "forest").map((t) => t.name);
		expect(forests.length).toBeGreaterThan(1);
		const rows = blendTerrainWeights(undefined, stats.counts, palette, 1)!;
		expect(rows.find((r) => r.terrain === forests[0])!.weight).toBe(10);
		expect(rows.find((r) => r.terrain === forests[1])!.weight).toBe(0);
	});

	it("smoothing is fitted from sample regions: a speckled map fits fewer passes than a smooth one", () => {
		const smooth = { ...grass, tuning: { smoothing: 6 } };
		const rough = { ...grass, tuning: { smoothing: 0 } };
		const a = (f: BiomeNoteFields) => interiorAgreement(layout, region(f), typeOf);
		expect(fitSmoothing(grass, palette, layout, a(smooth))).toBeGreaterThan(fitSmoothing(grass, palette, layout, a(rough)));
	});

	it("blendBiomeFields: weight 0 changes nothing that matters; a smooth map raises smoothing", () => {
		const none = blendBiomeFields(grass, stats, palette, 0, layout);
		expect(mixShares(none.mix)).toEqual(mixShares(grass.mix));
		expect(none.tuning).toBeUndefined();
		const full = blendBiomeFields(grass, stats, palette, 1, layout);
		expect(full.tuning?.smoothing ?? 2).toBeGreaterThanOrEqual(2);
	});

	it("land share moves only when the biome sets one", () => {
		const arch = biomePreset("archipelago")!;
		expect(blendBiomeFields(arch, stats, palette, 0.5).landShare).toBeCloseTo((0.3 + 56 / 64) / 2, 2);
		expect(blendBiomeFields(grass, stats, palette, 0.5).landShare).toBeUndefined();
	});
});

describe("Blend into a biome's generator: learned and merged at the weight", () => {
	const existing = MODELS.get("biome-temperate-forest")!;
	const map = paintedMap("water", "forest", 10);
	const learned = learnModel(map, { name: "x", orientation: "flat", stagger: "odd" });
	const waterName = firstOf("water");
	const share = (m: HexWfcModel) => weightShares(m).get(waterName) ?? 0;

	it("more weight, more of the map", () => {
		const w0 = foldMapIntoModel(existing, learned, 0), w25 = foldMapIntoModel(existing, learned, 0.25), w75 = foldMapIntoModel(existing, learned, 0.75);
		expect(share(w0)).toBeCloseTo(share(existing), 6);
		expect(share(w25)).toBeGreaterThan(share(w0));
		expect(share(w75)).toBeGreaterThan(share(w25));
		expect(w25.name).toBe(existing.name);
		expect(w25.settings).toEqual(existing.settings);
	});

	it("the weight reads as this map vs the rest", () => {
		expect(blendWeightText(0.25, "Coast")).toBe("25% this map · 75% Coast");
	});
});

describe("generator notes: only tables and keys change", () => {
	const plugin = { settings: { worldFolder: "world" }, app: { vault: { getAbstractFileByPath: () => null } } } as never;
	const a = MODELS.get("biome-tundra")!;
	const b = { ...MODELS.get("biome-taiga")!, name: a.name, meta: { ...a.meta, palette: "Other" } };

	it("keeps the user's prose and other tables, replaces the generator's", () => {
		const old = generatorText(plugin, a).replace("## Terrains", "Notes I wrote about this generator.\n\n## Terrains") + "\n## My table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
		const next = updateGeneratorNote(old, generatorText(plugin, b));
		expect(next).toContain("Notes I wrote about this generator.");
		expect(next).toContain("| 1 | 2 |");
		expect(next).toContain("palette: Other");
		const parsed = parseModelMarkdown(next).model;
		expect(parsed.terrains.map((t) => t.name).sort()).toEqual(b.terrains.map((t) => t.name).sort());
		expect(parsed.adjacency.length).toBe(b.adjacency.length);
	});

	it("is the same text when nothing changed, and keeps CRLF", () => {
		const text = generatorText(plugin, a).replace(/\n/g, "\r\n");
		expect(updateGeneratorNote(text, generatorText(plugin, a))).toBe(text);
	});

	it("a Blend of row is added under its own table", () => {
		let t = addBlendOfRow("# X\n\nProse.\n", { map: "[[_coast]]", weight: 0.25, date: "2026-10-12" });
		expect(t).toContain("## Blend of\n\n| Map | Weight | Date |\n| --- | ---: | --- |\n| [[_coast]] | 25% | 2026-10-12 |");
		t = addBlendOfRow(t, { map: "North", weight: 0.5, date: "2026-10-13" });
		expect(t.match(/## Blend of/g)).toHaveLength(1);
		expect(t).toContain("| [[_coast]] | 25% | 2026-10-12 |\n| North | 50% | 2026-10-13 |");
		expect(t).toContain("Prose.");
		// The biome note still reads the same (the table isn't Mix, Terrain weights or Transitions).
		const note = addBlendOfRow(buildBiomeNote(biomePreset("tundra")!), { map: "x", weight: 1, date: "d" });
		expect(parseBiomeNote(note, "Tundra").fields).toEqual(parseBiomeNote(buildBiomeNote(biomePreset("tundra")!), "Tundra").fields);
		expect(parseBiomeNote(note, "Tundra").problems).toEqual([]);
	});
});

/** A plugin with just what applyBlend touches. */
function fakePlugin(mode: string, files: Map<string, string>) {
	const backups = new Map<string, string>();
	const updates: { id: string; patch: Partial<BiomeNoteFields>; opts?: { backup?: boolean } }[] = [];
	const file = (path: string) => Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.md$/, "") });
	const plugin = {
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world" },
		getMap: (name: string) => ({ name, workMode: mode }),
		mapLabel: (name: string) => name,
		mapStore: { notePath: (name: string) => `world/maps/${name}.md` },
		app: {
			vault: {
				adapter: {
					exists: async (p: string) => backups.has(p),
					mkdir: async () => {},
					write: async (p: string, t: string) => { backups.set(p, t); },
				},
				read: async (f: TFile) => files.get(f.path)!,
				process: async (f: TFile, fn: (t: string) => string) => { files.set(f.path, fn(files.get(f.path)!)); },
				getAbstractFileByPath: (p: string) => (files.has(p) ? file(p) : null),
			},
		},
		biomeStore: {
			update: async (id: string, patch: Partial<BiomeNoteFields>, opts?: { backup?: boolean }) => { updates.push({ id, patch, opts }); return true; },
			pathOf: (id: string) => `world/biomes/${id}.md`,
		},
	};
	return { plugin: plugin as never, backups, updates, file };
}

describe("applying a blend", () => {
	const existing = MODELS.get("biome-temperate-forest")!;
	const learned = learnModel(paintedMap("water", "forest"), { name: "x", orientation: "flat", stagger: "odd" });

	it("generator: backs up the old note, writes tables and keys, adds a Blend of row, keeps prose", async () => {
		const files = new Map<string, string>();
		const gen = "world/generators/temperate.md";
		const { plugin, backups, file } = fakePlugin("build", files);
		const old = generatorText(plugin, existing).replace("## Terrains", "My notes stay.\n\n## Terrains");
		files.set(gen, old);
		files.set("world/maps/_coast.md", "map note");
		const biome = biomePreset("temperate-forest")!;
		const target: BlendTarget = { biome, generator: { file: file(gen), model: existing, warnings: [] } };
		const res = await applyBlend(plugin, "_coast", target, { weight: 0.25, model: foldMapIntoModel(existing, learned, 0.25) });
		expect("wrote" in res && res.wrote).toBe(gen);
		expect([...backups.values()]).toEqual([old]);
		const now = files.get(gen)!;
		expect(now).toContain("My notes stay.");
		expect(now).toMatch(/\| \[\[[^\]]*_coast[^\]]*\]\] \| 25% \| \d{4}-\d\d-\d\d \|/);
		expect(weightShares(parseModelMarkdown(now).model).get(firstOf("water")) ?? 0).toBeGreaterThan(weightShares(existing).get(firstOf("water")) ?? 0);
	});

	it("no generator: the biome's tables are updated with a backup, and a Blend of row is added", async () => {
		const files = new Map<string, string>();
		const biome = biomePreset("grassland")!;
		const path = "world/biomes/grassland.md";
		files.set(path, buildBiomeNote(biome).replace("## Mix", "Hand prose.\n\n## Mix"));
		const { plugin, updates } = fakePlugin("god", files);
		const fields = { ...biome, mix: [{ type: "forest", weight: 100 }], tuning: { smoothing: 3 } };
		const res = await applyBlend(plugin, "North", { biome }, { weight: 0.5, fields });
		expect("wrote" in res).toBe(true);
		expect(updates).toEqual([{ id: "grassland", patch: { mix: fields.mix, terrainWeights: undefined, landShare: undefined, tuning: { smoothing: 3 } }, opts: { backup: true } }]);
		expect(files.get(path)).toContain("| North | 50% |");
		expect(files.get(path)).toContain("Hand prose.");
	});

	it("needs Build or God: Play writes nothing", async () => {
		const files = new Map<string, string>([["world/biomes/grassland.md", "x"]]);
		const { plugin, updates } = fakePlugin("play", files);
		const res = await applyBlend(plugin, "North", { biome: biomePreset("grassland")! }, { weight: 0.5, fields: biomePreset("grassland")! });
		expect("error" in res && res.error).toMatch(/Switch to Build/);
		expect(updates).toEqual([]);
		expect(files.get("world/biomes/grassland.md")).toBe("x");
	});
});

describe("export-tuned-biomes: shipping the owner's tuning", () => {
	const shipped = SHIPPED_BIOMES.map((b) => ({ ...b }));
	const noteOf = (id: string, edit: (f: BiomeNoteFields) => BiomeNoteFields = (f) => f) => {
		const f = biomePreset(id)!;
		return { name: f.label, content: buildBiomeNote(edit(f)) };
	};

	it("untouched notes: no changes", () => {
		const notes = shipped.filter((b) => b.mix.length || b.blank).map((b) => noteOf(b.id));
		const plan = planExport(notes, shipped, parseBiomeNote);
		expect(plan.changes).toEqual([]);
		expect(formatPlan(plan)).toContain("No changes");
	});

	it("a dry run lists what changed, field by field; user biomes are skipped", () => {
		const notes = [
			noteOf("tundra", (f) => ({ ...f, tuning: { smoothing: 4 }, landShare: 0.2 })),
			{ name: "Mine", content: buildBiomeNote({ id: "mine", label: "Mine", mix: [{ type: "forest", weight: 1 }], transitions: [] }) },
		];
		const plan = planExport(notes, shipped, parseBiomeNote);
		expect(plan.changes).toEqual([{ id: "tundra", label: "Tundra", fields: [{ field: "landShare", from: undefined, to: 0.2 }, { field: "tuning", from: undefined, to: { smoothing: 4 } }] }]);
		expect(plan.skipped[0]).toMatch(/^Mine: not a shipped biome/);
		const text = formatPlan(plan);
		expect(text).toContain("Tundra (tundra)\n  landShare:\n    - (none)\n    + 0.2\n  tuning:\n    - (none)\n    + {\"smoothing\":4}");
		// The shipped list given in isn't touched; the plan's copy has the change.
		expect(shipped.find((b) => b.id === "tundra")!.tuning).toBeUndefined();
		expect(plan.next.find((b: { id: string }) => b.id === "tundra").tuning).toEqual({ smoothing: 4 });
		expect(planExport(notes, shipped, parseBiomeNote, ["taiga"]).changes).toEqual([]);
	});

	it("carries generation fields only (not label, colour or the vault's generator link)", () => {
		expect(EXPORT_FIELDS).not.toContain("label");
		expect(EXPORT_FIELDS).not.toContain("color");
		expect(EXPORT_FIELDS).not.toContain("generator");
		const plan = planExport([noteOf("tundra", (f) => ({ ...f, label: "Frost", color: "#000000", generator: "world/generators/x" }))], shipped, parseBiomeNote);
		expect(plan.changes).toEqual([]);
	});

	it("the shipped data file is exactly what the script writes (one biome per line)", () => {
		const file = readFileSync(join(__dirname, "../src/modules/world-maps/biomePresets.ts"), "utf8").replace(/\r\n/g, "\n");
		expect(file).toBe(shippedBiomesSource(SHIPPED_BIOMES));
	});

	it("the script is dev-only: nothing in src imports dev/", () => {
		const main = readFileSync(join(__dirname, "../esbuild.config.mjs"), "utf8");
		expect(main).not.toContain("dev/biomes");
		expect(readFileSync(join(__dirname, "../dev/biomes/export-tuned-biomes.mjs"), "utf8")).toContain("--write");
	});
});
