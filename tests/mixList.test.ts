import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitMix } from "../src/ui/mixList";
import { addedMixWeight, setMixRow } from "../src/overworld/BiomePanel";
import type { BiomeNoteFields } from "../src/overworld/biomeNote";
import { readSurface } from "./helpers/source";

/**
 * O6 (owner 2026-10-14, A + note): the biome page AND the generator page
 * list only what is in the mix, with a × per row and "+ Add …" (the shared
 * picker with a filter). Both pages use one component (src/ui/mixList.ts).
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("O6: splitMix", () => {
	it("keeps list order, splits shown from addable, drops repeats", () => {
		const all = ["forest", "grassland", "hills", "forest", "water"].map((id) => ({ id }));
		const inMix = new Set(["hills", "forest"]);
		const { shown, addable } = splitMix(all, (id) => inMix.has(id));
		expect(shown.map((i) => i.id)).toEqual(["forest", "hills"]);
		expect(addable.map((i) => i.id)).toEqual(["grassland", "water"]);
	});
});

describe("O6: adding and removing a type on the biome page", () => {
	const fields = (mix: { type: string; weight: number }[]) => ({ mix: mix.map((r) => ({ ...r })) }) as unknown as BiomeNoteFields;

	it("an added type gets an equal share with the ones already in", () => {
		expect(addedMixWeight([{ weight: 50 }, { weight: 30 }, { weight: 20 }])).toBe(33);
		expect(addedMixWeight([])).toBe(1);
		expect(addedMixWeight([{ weight: 0 }])).toBe(1);
	});

	it("× takes a type out of the mix; + Add puts it back", () => {
		const f = fields([{ type: "forest", weight: 60 }, { type: "hills", weight: 40 }]);
		setMixRow(f, "hills", { weight: 0 });
		expect(f.mix.map((r) => r.type)).toEqual(["forest"]);
		setMixRow(f, "water", { weight: addedMixWeight(f.mix) });
		expect(f.mix).toEqual([{ type: "forest", weight: 60 }, { type: "water", weight: 60 }]);
	});
});

describe("O6: one component on both pages", () => {
	const biome = readSurface("biome-page");
	const gen = readSurface("generator-page");
	const kit = read("src", "ui", "mixList.ts");

	it("both pages list only what's in the mix, with × and + Add", () => {
		for (const page of [biome, gen]) {
			expect(page).toMatch(/import \{ mixRemoveButton, renderMixAdd, splitMix \} from "\.\.\/ui\/mixList";/);
			expect(page).toMatch(/splitMix\(/);
			expect(page).toMatch(/mixRemoveButton\(row, /);
			expect(page).toMatch(/renderMixAdd\(this\.plugin\.app, /);
		}
		expect(biome).toMatch(/thing: "type",\s*things: "types"/);
		expect(gen).toMatch(/thing: "terrain",\s*things: "terrains"/);
		// The biome page's rows stay the shared zero-sum sliders.
		expect(biome).toMatch(/renderShareSliders\(box, \{\s*empty: "hold",\s*cls: "duckmage-biome-page-mix"/);
	});

	it("the picker is the shared modal base with the picker standard's filter", () => {
		expect(kit).toMatch(/class AddToMixModal extends HexmakerModal/);
		expect(kit).toMatch(/addPickerFilter\(list, \{ things: this\.o\.things, count: this\.o\.addable\.length, always: true \}\)/);
		expect(kit).toMatch(/filterText\(tile, /);
	});
});
