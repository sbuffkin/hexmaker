/**
 * Biome tuning (owner request 2026-10-12): every generator constant of a
 * biome is a per-biome value in its note's Tuning table, exposed in Debug
 * on the biome page. Unset gives exactly today's regions.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARITY_FILE, SCENARIOS, digest, runScenario, scenarioProfiles, snapshot } from "./biomeParityFixtures";
import {
  TUNING_PARAMS,
  TUNING_SECTIONS,
  blendTuning,
  cleanTuning,
  engineOverrides,
  readTuningRows,
  shownDefault,
  tuned,
  tuningControlId,
  tuningCount,
  tuningParam,
  tuningTable,
} from "../src/overworld/biomeTuning";
import { buildBiomeNote, parseBiomeNote, updateBiomeNote, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { biomePreset } from "../src/overworld/biomePresets";
import { CUTOFF, REGION_WARP, WARP_SCALE } from "../src/overworld/blendField";
import { layerOf, isShown, parsePlacement, subSectionOf } from "../src/ui/placement";
import { Disclosure } from "../src/ui/disclosure";
import { setDebugMode, type LocalStore } from "../src/ui/debugMode";
import { DEFAULT_SETTINGS, solve } from "../packages/hex-wfc/src";
import { withSettings } from "../src/worldgen/biomeRegion";
import { MODELS } from "./overworldFixtures";
import { neighbourRegions, type RegionLayout } from "../src/overworld/layout";
import { paletteTypeOf, planRegion } from "../src/overworld/regionWorld";
import type { BiomeProfile } from "../src/overworld/biomes";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { biomePagePatch, setTuningValue } from "../src/overworld/biomePage/fields";

const parity = JSON.parse(readFileSync(PARITY_FILE, "utf8")) as Record<string, Record<string, string>>;

describe("biome tuning: same seed and defaults give today's regions", () => {
	it("every scenario matches the snapshots taken before tuning was wired in (neighbour influence off)", () => {
		// The super-region (neighbour context, tests/regionMesh.test.ts) is the one
		// deliberate change since: with its influence at 0 every region is as before.
		const s0 = SCENARIOS.map((s) => {
			const profiles = new Map([...scenarioProfiles(s)].map(([k, p]) => [k, { ...p, tuning: { "neighbour-influence": 0 } }]));
			return [s.name, Object.fromEntries([...runScenario(s, profiles)].map(([k, c]) => [k, digest(c)]))];
		});
		expect(Object.fromEntries(s0)).toEqual(parity);
	});

	it("tuning set to every default (written or not) changes nothing", () => {
		const s = SCENARIOS[0];
		const all: Record<string, number> = {};
		for (const p of TUNING_PARAMS) if (!p.inherits) all[p.key] = p.default;
		const regions = runScenario(s, scenarioProfiles(s, (f) => ({ ...f, tuning: all })));
		expect(Object.fromEntries([...regions].map(([k, c]) => [k, digest(c)]))).toEqual(snapshot()[s.name]);
	});

	it("the defaults are the constants generation used", () => {
		expect(tuned(undefined, "reach")).toBe(CUTOFF);
		expect(tuned(undefined, "wiggle")).toBe(REGION_WARP);
		expect(tuned(undefined, "wiggle-scale")).toBe(WARP_SCALE);
		expect(tuned(undefined, "smoothing")).toBe(2);
		expect(tuned(undefined, "field-hold")).toBe(1.5);
		expect(tuned(undefined, "beach")).toBe(0.6);
		expect(tuned(undefined, "shore-lean")).toBe(1.6);
		expect(tuned(undefined, "shore-ragged")).toBe(0.12);
		for (const p of TUNING_PARAMS.filter((x) => x.engine)) expect(p.default).toBe(DEFAULT_SETTINGS[p.engine!]);
	});
});

describe("biome tuning: each parameter changes generation", () => {
	// The mixed overworld, plus one region of each biome ringed by another
	// (the island, shore and patch params only act on their own biome's region).
	// An archipelago amid archipelagos too: in the worlds, the made neighbours' land now reaches every
	// edge cell of the one region where islands might start at the edge, so it no longer shows Islands at the edge.
	const rings: [string, string][] = [["archipelago", "open-sea"], ["archipelago", "archipelago"], ["coast", "grassland"], ["alpine", "valley"], ["volcanic", "badlands"], ["tundra", "taiga"]];
	const ringLayout: RegionLayout = { footprint: "rect", size: 10, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
	const ringed = (centre: string, around: string, profiles: Map<string, BiomeProfile>) => {
		const biomes = new Map<string, string>([["0_0", centre]]);
		for (const [x, y] of neighbourRegions(ringLayout, 0, 0)) biomes.set(`${x}_${y}`, around);
		return digest(planRegion({ layout: ringLayout, parent: [0, 0], biomes, profiles, typeOf: paletteTypeOf(DEFAULT_TERRAIN_PALETTE), worldSeed: 99, seed: 99 }).cells);
	};
	/** Every digest a tuning gives, across the scenarios. */
	const all = (tuning: Record<string, number> | undefined): string[] => {
		const out: string[] = [];
		for (const s of SCENARIOS) {
			const profiles = scenarioProfiles(s, (f) => ({ ...f, ...(tuning ? { tuning } : {}) }));
			// The shipped-generator profiles carry no note: tune them directly.
			if (tuning) for (const p of profiles.values()) p.tuning = tuning;
			out.push(...[...runScenario(s, profiles).values()].map(digest));
		}
		const notes = scenarioProfiles(SCENARIOS[0], (f) => ({ ...f, ...(tuning ? { tuning } : {}) }));
		for (const [c, a] of rings) out.push(ringed(c, a, notes));
		return out;
	};
	const base = all(undefined);
	for (const p of TUNING_PARAMS.filter((x) => !x.engine)) {
		it(`${p.label} (${p.key})`, () => {
			// Either end of its range changes some region.
			const changed = [p.min, p.max].some((v) => all({ [p.key]: v }).some((d, i) => d !== base[i]));
			expect(changed).toBe(true);
		});
	}

	const model = MODELS.get("biome-coastal-fjord")!;
	const grid = { cols: 14, rows: 14, orientation: "flat" as const, stagger: "odd" as const, seed: 7 };
	const plain = solve(model, grid);
	for (const p of TUNING_PARAMS.filter((x) => x.engine)) {
		it(`Engine: ${p.label} reaches the generator's settings and changes its region`, () => {
			const v = Math.abs(p.max - p.default) >= Math.abs(p.min - p.default) ? p.max : p.min;
			const over = engineOverrides({ [p.key]: v });
			expect(over).toEqual({ [p.engine!]: v });
			const tuned = solve(withSettings(model, over), grid);
			expect(plain.ok && tuned.ok).toBe(true);
			if (plain.ok && tuned.ok) expect(JSON.stringify([...tuned.cells])).not.toBe(JSON.stringify([...plain.cells]));
		});
	}
});

describe("biome tuning: stored per biome, readable", () => {
	const tundra = biomePreset("tundra")!;

	it("round trips through the note, writing only the non-default values", () => {
		const f: BiomeNoteFields = { ...tundra, tuning: { smoothing: 4, wiggle: 0.35, beach: 0.6, clumping: 3 } };
		const note = buildBiomeNote(f);
		expect(note).toContain("## Tuning");
		expect(note).toContain("| Smoothing passes | 4 | 2 |");
		expect(note).toContain("| Border wiggle | 0.35 | 0.2 |");
		expect(note).not.toContain("Beach cover"); // the default: not written
		expect(note).toContain("| Clumping | 3 | — |"); // an Engine override: written even at the engine default
		expect(parseBiomeNote(note, "Tundra").fields.tuning).toEqual({ smoothing: 4, wiggle: 0.35, clumping: 3 });
	});

	it("a note with nothing tuned gets no table", () => {
		expect(buildBiomeNote(tundra)).not.toContain("## Tuning");
		expect(updateBiomeNote(buildBiomeNote(tundra), tundra)).toBe(buildBiomeNote(tundra));
	});

	it("reads forgivingly: labels or keys, percentages, clamped values, unknown rows reported and kept", () => {
		const note = buildBiomeNote(tundra) + "\n## Tuning\n\n| Setting | Value |\n| --- | --- |\n| SMOOTHING | 3 |\n| border-wiggle | 30% |\n| Field hold | 99 |\n| Sparkle | 5 |\n";
		const { fields, problems } = parseBiomeNote(note, "Tundra");
		expect(fields.tuning).toEqual({ smoothing: 3, wiggle: 0.3, "field-hold": 6 });
		expect(problems.map((p) => p.where)).toEqual(["Tuning", "Tuning"]);
		// Rewriting keeps the row it couldn't read, as written.
		const next = updateBiomeNote(note, { ...fields, tuning: { ...fields.tuning, smoothing: 5 } });
		expect(next).toContain("| Sparkle | 5 |");
		expect(next).toContain("| Smoothing passes | 5 | 2 |");
	});

	it("updating tuning keeps the note's prose", () => {
		const note = buildBiomeNote(tundra).replace("## Mix", "My own words about tundra.\n\n## Mix");
		const next = updateBiomeNote(note, { ...tundra, tuning: { halo: 3 } });
		expect(next).toContain("My own words about tundra.");
		expect(next).toContain("| Edge look-ahead | 3 | 2 |");
	});

	it("the page writes the tuning with the rest of its fields; a default clears the value", () => {
		const f: BiomeNoteFields = { ...tundra };
		const smoothing = tuningParam("smoothing")!;
		setTuningValue(f, smoothing, 5);
		expect(biomePagePatch(f).tuning).toEqual({ smoothing: 5 });
		setTuningValue(f, smoothing, 2);
		expect(f.tuning).toBeUndefined();
		setTuningValue(f, smoothing, 100);
		expect(f.tuning).toEqual({ smoothing: 8 });
		expect(tuningCount(f.tuning)).toBe(1);
	});

	it("the blend falloff shows the Blend width's k until it's set", () => {
		const p = tuningParam("blend-k")!;
		expect(shownDefault(p, "narrow")).toBe(6);
		expect(shownDefault(p, undefined)).toBe(3.5);
		expect(cleanTuning({ "blend-k": 3.5 })).toEqual({ "blend-k": 3.5 });
	});

	it("table helpers: header, rows in param order", () => {
		expect(tuningTable({ wiggle: 0.3, smoothing: 1 }).slice(2)).toEqual(["| Border wiggle | 0.3 | 0.2 |", "| Smoothing passes | 1 | 2 |"]);
		expect(readTuningRows([{ cells: ["Halo", ""], line: "", n: 3 }], ["setting", "value"]).tuning).toBeUndefined();
	});
});

// ── Debug-only visibility ──────────────────────────────────────────────────

class FakeStore implements LocalStore {
	data = new Map<string, unknown>();
	loadLocalStorage(key: string): unknown {
		return this.data.has(key) ? this.data.get(key) : null;
	}
	saveLocalStorage(key: string, value: unknown): void {
		if (value === null || value === undefined) this.data.delete(key);
		else this.data.set(key, value);
	}
}

class FakeEl {
	children: FakeEl[] = [];
	parent: FakeEl | null = null;
	open = false;
	root = false;
	constructor(public tag: string, public cls = "", public text = "") {}
	get isConnected(): boolean {
		for (let e: FakeEl | null = this; e; e = e.parent) if (e.root) return true;
		return false;
	}
	createEl(tag: string, o: { cls?: string; text?: string } = {}): FakeEl {
		const c = new FakeEl(tag, o.cls ?? "", o.text ?? "");
		c.parent = this;
		this.children.push(c);
		return c;
	}
	createDiv(o: { cls?: string; text?: string } = {}): FakeEl {
		return this.createEl("div", o);
	}
	setText(t: string): void {
		this.text = t;
	}
	appendChild(c: FakeEl): FakeEl {
		c.remove();
		c.parent = this;
		this.children.push(c);
		return c;
	}
	remove(): void {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter((x) => x !== this);
		this.parent = null;
	}
	addEventListener(): void {}
	find(cls: string): FakeEl[] {
		return this.children.flatMap((c) => [...(c.cls.split(" ").includes(cls) ? [c] : []), ...c.find(cls)]);
	}
	get childElementCount(): number {
		return this.children.length;
	}
	get firstElementChild(): FakeEl | null {
		return this.children[0] ?? null;
	}
	get parentElement(): FakeEl | null {
		return this.parent;
	}
	insertBefore(c: FakeEl, ref: FakeEl): FakeEl {
		c.remove();
		c.parent = this;
		const i = this.children.indexOf(ref);
		this.children.splice(i < 0 ? this.children.length : i, 0, c);
		return c;
	}
}

describe("biome tuning: Debug only, in collapsible sub-sections", () => {
	it("every param has a placement in Debug, under its own section", () => {
		for (const p of TUNING_PARAMS) {
			const id = tuningControlId(p.key);
			expect({ id, layer: layerOf(id) }).toEqual({ id, layer: "debug" });
			expect(subSectionOf(id)).toBe(p.section);
			expect(isShown(id, false)).toBe(false);
			expect(isShown(id, true)).toBe(true);
		}
		expect(parsePlacement("debug/Layout")).toEqual({ layer: "debug", sub: "Layout" });
		expect([...new Set(TUNING_PARAMS.map((p) => p.section))]).toEqual([...TUNING_SECTIONS]);
		// More than one control each, so none folds away (round 10).
		for (const s of TUNING_SECTIONS) expect(TUNING_PARAMS.filter((p) => p.section === s).length).toBeGreaterThan(1);
	});

	const build = (store: FakeStore) => {
		const host = new FakeEl("div");
		host.root = true;
		const d = new Disclosure(store, "BiomePage", () => host as unknown as HTMLElement);
		const tuning: Record<string, number> = { smoothing: 4, halo: 1 };
		let built = 0;
		for (const p of TUNING_PARAMS) {
			const parent = d.target(tuningControlId(p.key), host as unknown as HTMLElement, () => tuning[p.key] !== undefined) as unknown as FakeEl | null;
			if (parent) { parent.createDiv({ text: p.label }); built++; }
		}
		return { host, built };
	};

	it("nothing is built while debug mode is off", () => {
		const { host, built } = build(new FakeStore());
		expect(built).toBe(0);
		expect(host.find("duckmage-disclosure-debug")).toHaveLength(0);
	});

	it("with debug mode on: one sub-section per section, counted toward · N set", async () => {
		const store = new FakeStore();
		setDebugMode(store, true);
		const { host, built } = build(store);
		await Promise.resolve();
		expect(built).toBe(TUNING_PARAMS.length);
		const subs = host.find("duckmage-disclosure-debug-sub");
		expect(subs).toHaveLength(TUNING_SECTIONS.length);
		const titles = host.find("duckmage-disclosure-sub-summary").map((s) => s.text);
		expect(titles).toContain("Patches & detail · 1 set");
		expect(titles).toContain("Layout · 1 set");
		expect(host.find("duckmage-disclosure-debug-title")[0].text).toBe("Debug · 2 set");
		expect(host.find("duckmage-disclosure-summary")[0].text).toBe("Advanced · 2 set");
		setDebugMode(store, false);
	});
});

describe("biome tuning: blending tunings", () => {
	it("mixes per param at the weight, rounding whole-number params", () => {
		expect(blendTuning({ smoothing: 2 }, { smoothing: 6 }, 0.25)).toEqual({ smoothing: 3 });
		expect(blendTuning(undefined, { wiggle: 0.4 }, 0.5)).toEqual({ wiggle: 0.3 });
		expect(blendTuning({ smoothing: 4 }, { smoothing: 4 }, 0.5)).toEqual({ smoothing: 4 });
		expect(blendTuning(undefined, undefined, 0.5)).toBeUndefined();
	});
});

describe("biome tuning: shipped biomes as module data", () => {
	it("the presets read from src/modules/world-maps", () => {
		const src = readFileSync(join(__dirname, "../src/overworld/biomePresets.ts"), "utf8");
		expect(src).toContain('from "../modules/world-maps/biomePresets"');
		expect(biomePreset("open-sea")!.mix).toEqual([{ type: "water", weight: 80 }, { type: "deep-water", weight: 20, minPatches: 1 }]);
	});
});
