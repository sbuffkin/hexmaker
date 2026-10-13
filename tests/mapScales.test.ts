import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { registry } from "../src/modules";
import { scaleGenerators, scaleOrFirst, scalePalette, scalesFor } from "../src/mapScales";
import { wizardKinds, wizardScale } from "../src/wizardKinds";
import { wheelSize, wheelStep, type WheelField } from "../src/sizeInput";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { getPreset } from "../src/palettes/presets";
import type { TerrainGeneratorKind } from "../src/worldgen/registry";

/** Owner 2026-10-12: "What are you mapping?" then a generator list, Blank first. */

const kind = (id: string, mapKind?: string, source: TerrainGeneratorKind["source"] = "built-in", extra: Partial<TerrainGeneratorKind> = {}): TerrainGeneratorKind =>
	({ id, label: id, mapKind, source, options: [], fits: () => true, generate: () => ({ ok: false, message: "" }), toPaths: () => ({ paths: [], missing: [] }), ...extra }) as unknown as TerrainGeneratorKind;

const KINDS = [
	kind("blank", undefined, "blank"),
	kind("procedural:star-scatter", "space"),
	kind("procedural:orbits", "space"),
	kind("procedural:region-detail", "world", "built-in", { needsContext: true }),
	kind("procedural:overland", "world"),
	kind("procedural:world-biomes", "world"),
	kind("procedural:planet-surface", "space"),
	kind("learned:coast", "world", "learned"),
	kind("learned:moonscape", "planet", "learned"),
];

const ids = (ks: { id: string }[]) => ks.map((k) => k.id);

describe("map scales come from the modules (registry)", () => {
	it("each module brings its own: World Overland, World maps Biomes, Space a sector or system and a planet", () => {
		expect(ids(registry.mapScales())).toEqual(["overland", "biomes", "space-worlds", "planet"]);
		expect(registry.mapScales().map((s) => s.label)).toEqual(["Overland", "Biomes", "Sector or system", "Planet"]);
		for (const s of registry.mapScales()) {
			expect(s.description).not.toBe("");
			expect(s.size.cols).toBeGreaterThan(1);
			expect(getPreset(s.palette)).toBeDefined();
			for (const p of Object.values(s.generatorPalettes ?? {})) expect(getPreset(p)).toBeDefined();
		}
	});

	it("only the map types that are on show their scales", () => {
		expect(ids(scalesFor(["world"]))).toEqual(["overland", "biomes"]);
		expect(ids(scalesFor(["space"]))).toEqual(["space-worlds", "planet"]);
		expect(ids(scalesFor(["world", "space"]))).toEqual(ids(registry.mapScales()));
		expect(ids(scalesFor(undefined))).toEqual(ids(registry.mapScales()));
		expect(scaleOrFirst(scalesFor(["space"]), "overland")?.id).toBe("space-worlds");
		expect(scaleOrFirst(scalesFor(["world"]), "biomes")?.id).toBe("biomes");
	});

	it("Orbits asks for the System palette; the rest keep the scale's", () => {
		const worlds = registry.mapScales().find((s) => s.id === "space-worlds")!;
		expect(scalePalette(worlds, undefined)).toBe("Space - Sector");
		expect(scalePalette(worlds, "procedural:star-scatter")).toBe("Space - Sector");
		expect(scalePalette(worlds, "procedural:orbits")).toBe("Space - System");
	});
});

describe("the generator list swaps with the scale, Blank always first", () => {
	const at = (id: string) => registry.mapScales().find((s) => s.id === id)!;

	it("lists the scale's generators, then (where it says so) its map type's unlisted ones", () => {
		expect(ids(scaleGenerators(at("overland"), KINDS))).toEqual(["blank", "procedural:overland", "procedural:region-detail", "learned:coast"]);
		expect(ids(scaleGenerators(at("biomes"), KINDS))).toEqual(["blank", "procedural:world-biomes"]);
		expect(ids(scaleGenerators(at("space-worlds"), KINDS))).toEqual(["blank", "procedural:star-scatter", "procedural:orbits"]);
		// A learned generator tagged `map-kind: planet` is a space one.
		expect(ids(scaleGenerators(at("planet"), KINDS))).toEqual(["blank", "procedural:planet-surface", "learned:moonscape"]);
	});

	it("the wizard offers the scale's list that fits (no Region detail without a parent hex) and starts on its first generator", () => {
		const terrains = DEFAULT_TERRAIN_PALETTE.map((t) => ({ ...t }));
		const ctx = { mapKinds: ["world", "space"], scaleId: "overland", generatorId: undefined as string | undefined };
		let r = wizardKinds(KINDS, ctx, terrains);
		expect(ids(r.fitting)).toEqual(["blank", "procedural:overland", "learned:coast"]);
		expect(r.selected).toBe("procedural:overland");
		ctx.scaleId = "biomes";
		r = wizardKinds(KINDS, ctx, terrains);
		expect(ids(r.fitting)).toEqual(["blank", "procedural:world-biomes"]);
		expect(r.selected).toBe("procedural:world-biomes");
		// Blank picked on purpose stays picked.
		r = wizardKinds(KINDS, { ...ctx, generatorId: "blank" }, terrains);
		expect(r.selected).toBe("blank");
	});

	it("the wizard's scale is the first of the map types on until one is picked", () => {
		expect(wizardScale({ mapKinds: ["world"] })?.id).toBe("overland");
		expect(wizardScale({ mapKinds: ["space"] })?.id).toBe("space-worlds");
		expect(wizardScale({ mapKinds: ["space"], scaleId: "planet" })?.id).toBe("planet");
		// A scale whose map type was turned off falls back.
		expect(wizardScale({ mapKinds: ["space"], scaleId: "biomes" })?.id).toBe("space-worlds");
	});
});

describe("grid size: mouse wheel and reset", () => {
	it("a wheel step adds or takes one, clamped, from a number or the minimum", () => {
		expect(wheelSize("20", -100, 2, 200)).toBe(21);
		expect(wheelSize("20", 100, 2, 200)).toBe(19);
		expect(wheelSize("2", 100, 2, 200)).toBe(2);
		expect(wheelSize("200", -1, 2, 200)).toBe(200);
		expect(wheelSize("", -1, 2, 200)).toBe(3);
		expect(wheelSize("abc", 1, 2, 200)).toBe(2);
	});

	function field(value: string, hovered: boolean) {
		let handler: ((e: { deltaY: number; preventDefault(): void }) => void) | undefined;
		let passive: boolean | undefined;
		const events: string[] = [];
		const f: WheelField = {
			value,
			matches: (sel) => sel === ":hover" && hovered,
			addEventListener: (_t, fn, opts) => { handler = fn; passive = opts.passive; },
			dispatchEvent: (e) => { events.push(e.type); return true; },
		};
		const wheel = (deltaY: number) => {
			let prevented = false;
			handler!({ deltaY, preventDefault: () => { prevented = true; } });
			return prevented;
		};
		return { f, wheel, events, passive: () => passive };
	}

	it("steps the field and commits it (change) while hovered or focused", () => {
		const h = field("20", true);
		wheelStep(h.f, 2, 200, () => false);
		expect(h.passive()).toBe(false);
		expect(h.wheel(-1)).toBe(true);
		expect(h.f.value).toBe("21");
		expect(h.events).toEqual(["change"]);
		const foc = field("16", false);
		wheelStep(foc.f, 2, 200, () => true);
		foc.wheel(1);
		expect(foc.f.value).toBe("15");
	});

	it("leaves the page scroll alone when the field is neither hovered nor focused", () => {
		const h = field("20", false);
		wheelStep(h.f, 2, 200, () => false);
		expect(h.wheel(-1)).toBe(false);
		expect(h.f.value).toBe("20");
		expect(h.events).toEqual([]);
	});

	it("the wizard wires the wheel to both size fields, resets to the scale's size, and a scale sets it", () => {
		const src = readFileSync(path.join(process.cwd(), "src", "SetupWizardView.ts"), "utf8").replace(/\r\n/g, "\n");
		expect(src).toMatch(/for \(const input of \[colsInput, rowsInput\]\) \{[\s\S]*?wheelStep\(input, 2, 200,/);
		expect(src).toMatch(/resetBtn\.addEventListener\("click", \(\) => \{\n\s+const s = wizardScale\(ctx\);[\s\S]*?setSize\(s\?\.size\.cols/);
		// A scale sets the size, unless the user typed one (critic C9: kept).
		expect(src).toMatch(/const pickScale = [\s\S]*?sizeForScalePick\([^;]*, s\.size\);\s*setSize\(size\.cols, size\.rows, false\);/);
		expect(src).toContain(`placeMap.place("Wizard.mapScale", scaleRow)`);
		expect(src).toContain(`placeMap.place("Wizard.gridSizeReset", resetBtn)`);
	});
});
