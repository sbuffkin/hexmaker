import { describe, it } from "node:test";
import expect from "expect";
import { nextSort, sortLabel } from "../src/hex-table/view/tableSort";
import { compareFieldValues, filtersLabel, matchesFieldFilters, rowValues, type FieldFilters } from "../src/fields/fieldColumns";
import { FieldStore } from "../src/fields/FieldStore";
import { recalcSummary } from "../src/fields/RecalculateFieldsModal";
import type { FieldDef } from "../src/fields/fieldTypes";
import { readSurface } from "./helpers/source";
import { MemVault } from "./helpers/memVault";

const POP: FieldDef = { name: "Population", type: "whole number", default: "0" };
const CROP: FieldDef = { name: "Crop", type: "choice", default: "", choices: ["Wheat", "Barley", "Rye"] };
const RULER: FieldDef = { name: "Ruler", type: "text", default: "" };
const FORT: FieldDef = { name: "Fortified", type: "yes/no", default: "no" };

describe("hex table: field columns, sorting and filters", () => {
	it("the sort button cycles xy, yx, type, then each field", () => {
		const fields = [POP, CROP];
		const seen = [sortLabel("x")];
		let m = nextSort("x", fields);
		while (m !== "x") { seen.push(sortLabel(m)); m = nextSort(m, fields); }
		expect(seen).toEqual(["Sort: xy", "Sort: yx", "Sort: type", "Sort: Population", "Sort: Crop"]);
		// A field that was removed: back to the start.
		expect(nextSort("field:Gone", fields)).toBe("x");
	});

	it("compares by size, by choice order, by text; blanks last", () => {
		const sort = (f: FieldDef, xs: string[]) => [...xs].sort((a, b) => compareFieldValues(f, a, b));
		expect(sort(POP, ["100", "", "9", "1,000"])).toEqual(["9", "100", "1,000", ""]);
		expect(sort(CROP, ["Rye", "Wheat", "Barley"])).toEqual(["Wheat", "Barley", "Rye"]);
		expect(sort(RULER, ["b", "A", "c10", "c9"])).toEqual(["A", "b", "c9", "c10"]);
	});

	it("filters: number range, a value, text contains; blank reads as the default", () => {
		const fields = [POP, CROP, RULER, FORT];
		const row = rowValues({ extra: { Population: "500", crop: "Barley", Ruler: "Lady Fen" } }, fields);
		expect(row).toEqual({ population: "500", crop: "Barley", ruler: "Lady Fen", fortified: "no" });
		const f = (over: FieldFilters) => matchesFieldFilters(row, over, fields);
		expect(f(new Map([["population", { min: 100, max: 500 }]]))).toBe(true);
		expect(f(new Map([["population", { min: 501 }]]))).toBe(false);
		expect(f(new Map([["crop", { equals: "barley" }]]))).toBe(true);
		expect(f(new Map([["fortified", { equals: "yes" }]]))).toBe(false);
		expect(f(new Map([["ruler", { contains: "fen" }]]))).toBe(true);
		expect(f(new Map([["ruler", {}]]))).toBe(true);
		expect(filtersLabel(new Map([["ruler", {}], ["crop", { equals: "Rye" }]]))).toBe("Fields: 1 set");
	});

	it("the view asks the modules' parts (columns after Type, filters, sort)", () => {
		const src = readSurface("hex-table");
		expect(src).toMatch(/part\.headers\(headerRow\)/);
		expect(src).toMatch(/part\.cells\(tr,/);
		expect(src).toMatch(/p\.passes\(tr\)/);
		expect(src).toMatch(/nextSort\(this\.sortPrimary/);
	});
});

describe("hex fields: the fields note store", () => {
	const plugin = (v: MemVault) => ({ app: v.app(), settings: { worldFolder: "world" } });

	it("reads the world's note, writes edits keeping the user's text, forgets it when deleted", async () => {
		const v = new MemVault({
			"world/Hex fields.md": "---\nhexmaker-fields: 1\n---\n# Hex fields\nMine.\n## Fields\n| Field | Type |\n| Population | whole number |\n",
		});
		const store = new FieldStore(plugin(v) as never);
		let changes = 0;
		store.onChange(() => changes++);
		await store.init();
		expect(store.notePath()).toBe("world/Hex fields.md");
		expect(store.get().fields.map((f) => f.name)).toEqual(["Population"]);
		await store.save({ fields: [...store.get().fields, { name: "Crop", type: "text", default: "" }], influences: [{ place: "City", field: "Population", here: "+1", nearby: "", radius: 0 }] });
		const text = v.files.get("world/Hex fields.md")!;
		expect(text).toContain("Mine.");
		expect(text).toContain("| Crop | text |");
		expect(text).toContain("| City | Population | +1 |");
		// Its own write read back changes nothing.
		const before = changes;
		store.onModify(v.app().vault.getAbstractFileByPath("world/Hex fields.md") as never);
		await store.init();
		expect(store.get().fields).toHaveLength(2);
		expect(changes).toBe(before);
		store.onDelete({ path: "world/Hex fields.md" } as never);
		expect(store.get().fields).toEqual([]);
	});

	it("no note: no fields; the first save makes it", async () => {
		const v = new MemVault();
		const store = new FieldStore(plugin(v) as never);
		await store.init();
		expect(store.get().fields).toEqual([]);
		await store.save({ fields: [{ name: "Population", type: "number", default: "" }], influences: [] });
		expect(v.files.get("world/Hex fields.md")).toMatch(/^---\nhexmaker-fields: 1\n---/);
	});

	it("the Recalculate notice", () => {
		expect(recalcSummary("Coast", { hexes: 1, places: 3 })).toBe("Fields on Coast: 1 hex changed, 3 places counted.");
		expect(recalcSummary("Coast", { hexes: 0, places: 0, refused: true })).toMatch(/Switch to Build/);
	});
});
