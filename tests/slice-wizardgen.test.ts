import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { wizardKinds } from "../src/wizardKinds";
import type { TerrainGeneratorKind } from "../src/worldgen/registry";
import { readSource } from "./helpers/source";
import { describeWith, describeWithout } from "./helpers/slices";

/**
 * The setup wizard's generator list ("wizardgen"; owner 2026-11-16, R22):
 * the 'Hex map setup' terrain step's generator cards, live preview and
 * Reroll. Held back from 2.0, whose first map is Blank; generated maps come
 * from the generator page and Maps → New map…, which keep their lists.
 */

const kind = (id: string, mapKind?: string, source: TerrainGeneratorKind["source"] = "built-in"): TerrainGeneratorKind =>
	({ id, label: id, mapKind, source, options: [], fits: () => true, generate: () => ({ ok: false, message: "" }), toPaths: () => ({ paths: [], missing: [] }) }) as unknown as TerrainGeneratorKind;

const KINDS = [kind("blank", undefined, "blank"), kind("procedural:overland", "world"), kind("learned:coast", "world", "learned")];
const terrains = DEFAULT_TERRAIN_PALETTE.map((t) => ({ ...t }));
const ctx = { mapKinds: ["world"] as ("world" | "space")[], scaleId: "overland", generatorId: undefined as string | undefined };

describeWith("wizardgen", "wizardgen on: the wizard lists generators and starts on Overland", () => {
	it("offers the scale's list and preselects its first generator", () => {
		const r = wizardKinds(KINDS, ctx, terrains);
		expect(r.fitting.map((k) => k.id)).toEqual(["blank", "procedural:overland", "learned:coast"]);
		expect(r.selected).toBe("procedural:overland");
	});

	it("the step builds the list, the preview and Reroll after the flag's early return", () => {
		const src = readSource("src", "SetupWizardView.ts");
		expect(src).toContain("if (!__SLICE_WIZARDGEN__) return;");
		expect(src.indexOf("Reroll", src.indexOf("if (!__SLICE_WIZARDGEN__) return;"))).toBeGreaterThan(0);
	});

});

describeWithout("wizardgen", "wizardgen off: the wizard's first map is Blank only", () => {
	it("offers Blank alone and selects it, whatever the scale or an earlier pick", () => {
		for (const generatorId of [undefined, "procedural:overland", "learned:coast"]) {
			const r = wizardKinds(KINDS, { ...ctx, generatorId }, terrains);
			expect(r.fitting.map((k) => k.id)).toEqual(["blank"]);
			expect(r.selected).toBe("blank");
		}
	});

	it("the same for the other scales", () => {
		for (const scaleId of ["biomes", "space-worlds", "planet"]) expect(wizardKinds(KINDS, { ...ctx, scaleId, mapKinds: ["world", "space"] }, terrains).selected).toBe("blank");
	});
});

describe("wizardgen, whichever way the build is made", () => {
	it("everything that builds the list sits after the flag's return; the progress line Next writes to sits before it", () => {
		const src = readSource("src", "SetupWizardView.ts");
		const gate = src.indexOf("if (!__SLICE_WIZARDGEN__) return;");
		expect(gate).toBeGreaterThan(0);
		expect(src.indexOf("duckmage-wizard-gen-progress")).toBeLessThan(gate);
		for (const part of ["listGeneratorKinds(plugin).then", "🎲 Reroll", "duckmage-setup-generators", "drawPreview(canvas"]) {
			expect({ part, after: src.indexOf(part) > gate }).toEqual({ part, after: true });
		}
	});

	it("Next makes a Blank map without the list: no run, no preview key", () => {
		const src = readSource("src", "wizardKinds.ts");
		expect(src).toContain("if (!__SLICE_WIZARDGEN__) return { fitting: kinds.filter((k) => k.id === BLANK_ID), selected: BLANK_ID };");
	});
});
