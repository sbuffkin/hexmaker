import { describe, it } from "node:test";
import expect from "expect";
import { normalizeValue, parseFieldType, readNumber, isValidValue, type FieldDecls, type FieldDef } from "../src/fields/fieldTypes";
import { compileFormula, rollNumberText } from "../src/fields/formula";
import { effectsAt, fade, parseChange, applyNumber } from "../src/fields/influence";
import { buildFieldsNote, isFieldsNote, linkTarget, parseFieldsNote, updateFieldsNote } from "../src/fields/fieldsNote";
import { computeHexFields, FIELD_ROLLS_COLUMN, formulaOrder, getField, readRolls, formatRolls, setByHand, withCells } from "../src/fields/hexFields";
import { linksUnderHeading, notePlaceType, placeTypes, terrainPlaces } from "../src/fields/places";
import { hexContext, workOutMap, typedOnHex, type MapFieldsInput } from "../src/fields/mapFields";
import { conditionsFit, formatWhen, parseWhen } from "../src/random-tables/tableConditions";
import { hexDistance } from "../src/paths/router";
import { hexPair } from "../src/hexKey";
import type { HexData } from "../src/maps/mapNote";

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

const POP: FieldDef = { name: "Population", type: "whole number", default: "0", table: "tables/Population" };
const LAND: FieldDef = { name: "Land value", type: "number", default: "1" };
const MILITIA: FieldDef = { name: "Militia", type: "whole number", default: "", formula: "Population / 20" };
const FORT: FieldDef = { name: "Fortified", type: "yes/no", default: "no" };
const decls = (over: Partial<FieldDecls> = {}): FieldDecls => ({ fields: [POP, LAND, MILITIA, FORT], influences: [], ...over });

describe("hex fields: value types", () => {
	it("reads type names as people write them", () => {
		expect(parseFieldType("Whole number")).toBe("whole number");
		expect(parseFieldType("int")).toBe("whole number");
		expect(parseFieldType("Yes / No")).toBe("yes/no");
		expect(parseFieldType("list")).toBe("choice");
		expect(parseFieldType("")).toBe("text");
		expect(parseFieldType("colour")).toBeUndefined();
	});

	it("normalises values by type", () => {
		expect(normalizeValue(POP, "1,200.6")).toBe("1201");
		expect(normalizeValue(LAND, "about 3.456 gold")).toBe("3.46");
		expect(normalizeValue(FORT, "TRUE")).toBe("yes");
		expect(normalizeValue(FORT, "maybe")).toBe("");
		const crop: FieldDef = { name: "Crop", type: "choice", default: "", choices: ["Wheat", "Barley"] };
		expect(normalizeValue(crop, "barley")).toBe("Barley");
		expect(normalizeValue(crop, "rice")).toBe("");
		expect(readNumber("1 200")).toBe(1200);
		expect(isValidValue(POP, "abc")).toBe(false);
		expect(isValidValue(POP, "")).toBe(true);
	});
});

describe("hex fields: formulas", () => {
	const names = ["Population", "Land value", "Land"];
	it("reads names with spaces (longest first), × ÷, functions, brackets", () => {
		const get = (n: string) => ({ Population: 400, "Land value": 3, Land: 99 } as Record<string, number>)[n];
		expect(compileFormula("Population × Land value / 10", names).run(get)).toBe(120);
		expect(compileFormula("round(population ÷ 3)", names).run(get)).toBe(133);
		expect(compileFormula("[Land value] * 2 - -1", names).run(get)).toBe(7);
		expect(compileFormula("max(Land, Population) + 50%", names).run(get)).toBe(400.5);
		expect(compileFormula("Population * Land value", names).refs.sort()).toEqual(["Land value", "Population"]);
	});

	it("reports what it can't read and never evaluates text", () => {
		expect(compileFormula("Population +", names).error).toBeTruthy();
		expect(compileFormula("alert(1)", names).error).toMatch(/isn't a field/);
		expect(compileFormula("(1 + 2", names).error).toBeTruthy();
		expect(compileFormula("[Nope] + 1", names).error).toMatch(/no field/);
		expect(compileFormula("Population / 0", names).run(() => 5)).toBeUndefined();
	});

	it("rolls dice in number cells", () => {
		expect(rollNumberText("2d6 * 100", seq(0, 0.99))).toBe(700);
		expect(rollNumberText("400")).toBe(400);
		expect(rollNumberText("a village")).toBeUndefined();
	});
});

describe("hex fields: place influences", () => {
	it("reads changes", () => {
		expect(parseChange("+400")).toEqual({ kind: "add", amount: 400 });
		expect(parseChange("-20%")).toEqual({ kind: "mul", factor: 0.8 });
		expect(parseChange("×1.5")).toEqual({ kind: "mul", factor: 1.5 });
		expect(parseChange("=yes")).toEqual({ kind: "set", value: "yes" });
		expect(parseChange("")).toBeNull();
		expect(parseChange("lots")).toBeUndefined();
	});

	it("fades linearly to the radius", () => {
		expect([0, 1, 2, 3, 4].map((d) => fade(d, 3))).toEqual([0, 1, 2 / 3, 1 / 3, 0]);
	});

	it("adds up places: adds summed, multiplies multiplied, the nearest set wins", () => {
		const places = [{ key: "0_0", type: "city", source: "" }, { key: "5_0", type: "camp", source: "" }];
		const infs = [
			{ place: "City", field: "Population", here: "+400", nearby: "+40%", radius: 3 },
			{ place: "City", field: "Fortified", here: "=yes", nearby: "", radius: 0 },
			{ place: "Camp", field: "Population", here: "+10", nearby: "+5", radius: 4 },
		];
		const dist = (to: string) => (to === "0_0" ? 1 : 4);
		const e = effectsAt(places, infs, dist).get("population")!;
		expect(e.add).toBeCloseTo(5 * (1 / 4));
		expect(e.mul).toBeCloseTo(1.4);
		expect(applyNumber(100, e)).toBeCloseTo((100 + 1.25) * 1.4);
		expect(effectsAt(places, infs, dist).has("fortified")).toBe(false);
		expect(effectsAt(places, infs, () => 0).get("fortified")?.set?.value).toBe("yes");
	});
});

describe("hex fields: the fields note", () => {
	it("reads fields and influences forgivingly, reporting rows it can't read", () => {
		const note = [
			"---", "hexmaker-fields: 1", "---", "# Hex fields", "My notes.",
			"## Fields",
			"| Name | Kind | Default | Roll on | Formula | Options |",
			"| --- | --- | --- | --- | --- | --- |",
			"| Population | int | 0 | [[tables/Population\\|Pop]] |  |  |",
			"| Crop | list |  |  |  | Wheat, Barley |",
			"| Militia | whole number |  |  | Population / 20 |  |",
			"| Bad | colour |  |  |  |  |",
			"| population | text |  |  |  |  |",
			"| Broken | number |  |  | Population + |  |",
			"## Place influences",
			"| Place type | Field | Here | Nearby | Radius |",
			"| City | Population | +400 | +40% | 3 |",
			"| Town | Population | lots |  | 1 |",
			"| Camp | Population | +5 |  | x |",
		].join("\n");
		const r = parseFieldsNote(note);
		expect(isFieldsNote(note)).toBe(true);
		expect(r.fields.map((f) => [f.name, f.type])).toEqual([["Population", "whole number"], ["Crop", "choice"], ["Militia", "whole number"], ["Broken", "number"]]);
		expect(r.fields[0].table).toBe("tables/Population");
		expect(r.fields[1].choices).toEqual(["Wheat", "Barley"]);
		expect(r.influences).toEqual([{ place: "City", field: "Population", here: "+400", nearby: "+40%", radius: 3 }]);
		expect(r.problems.map((p) => p.reason)).toEqual([
			expect.stringMatching(/isn't a type/), expect.stringMatching(/already a field/), expect.stringMatching(/formula can't be read/),
			expect.stringMatching(/Here "lots"/), expect.stringMatching(/Radius "x"/),
		]);
	});

	it("builds a note that reads back, and an update keeps the user's text", () => {
		const d = decls({ influences: [{ place: "City", field: "Population", here: "+400", nearby: "+40%", radius: 3 }] });
		const note = buildFieldsNote(d);
		const back = parseFieldsNote(note);
		expect(back.fields).toEqual(d.fields);
		expect(back.influences).toEqual(d.influences);
		const edited = note.replace("# Hex fields", "# Hex fields\nKeep this line.") + "\n## Ideas\nMore of mine.\n";
		const updated = updateFieldsNote(edited, { ...d, fields: [POP] });
		expect(updated).toContain("Keep this line.");
		expect(updated).toContain("## Ideas\nMore of mine.");
		expect(parseFieldsNote(updated).fields).toEqual([POP]);
		expect(parseFieldsNote(updated).influences).toEqual(d.influences);
	});

	it("reads wikilink cells", () => {
		expect(linkTarget("[[a/b.md|B]]")).toBe("a/b");
		expect(linkTarget("plain/path")).toBe("plain/path");
	});
});

describe("hex fields: one hex worked out", () => {
	const ctx = (roll: string | undefined, effects = new Map()) => ({ decls: decls(), roll: () => roll, effects });

	it("fill: rolls blank fields, keeps the roll, works out formulas; defaults stay blank", () => {
		const extra = computeHexFields(undefined, ctx("400"), "fill")!;
		expect(extra).toEqual({ Population: "400", Militia: "20", [FIELD_ROLLS_COLUMN]: "Population: 400" });
		// Values already there (typed, scripted) are kept on fill.
		expect(computeHexFields({ extra: { population: "7" } }, ctx("400"), "fill")).toEqual({ population: "7", Militia: "0" });
	});

	it("nothing rolled: the default is used only when a place changes it", () => {
		expect(computeHexFields(undefined, ctx(undefined), "fill")).toEqual({ Militia: "0" });
		const city = new Map([["population", { add: 100, mul: 2, touched: true }], ["fortified", { add: 0, mul: 1, set: { value: "yes", distance: 0 }, touched: true }]]);
		const e = computeHexFields(undefined, { decls: decls(), roll: () => undefined, effects: city }, "fill")!;
		expect(e).toEqual({ Population: "200", Militia: "10", Fortified: "yes", [FIELD_ROLLS_COLUMN]: "Population: 0; Fortified: no" });
	});

	it("modifiers: rolls kept and places redone; typed values kept", () => {
		const h: Pick<HexData, "extra"> = { extra: { Population: "400", "Land value": "9", [FIELD_ROLLS_COLUMN]: "Population: 400" } };
		const city = new Map([["population", { add: 0, mul: 1.5, touched: true }], ["land value", { add: 5, mul: 1, touched: true }]]);
		const e = computeHexFields(h, { decls: decls(), roll: () => "999", effects: city }, "modifiers")!;
		expect(e.Population).toBe("600");
		expect(e["Land value"]).toBe("9"); // typed by hand: kept
		expect(readRolls(e[FIELD_ROLLS_COLUMN]).get("population")?.value).toBe("400");
	});

	it("reroll: every field rolled again, typed ones too", () => {
		const h = { extra: { Population: "7" } };
		expect(computeHexFields(h, ctx("50"), "reroll")!.Population).toBe("50");
	});

	it("unchanged: undefined (no write)", () => {
		const once = computeHexFields(undefined, ctx("400"), "fill")!;
		expect(computeHexFields({ extra: once }, ctx("400"), "fill")).toBeUndefined();
		expect(computeHexFields(undefined, { decls: { fields: [], influences: [] }, roll: () => "1", effects: new Map() }, "fill")).toBeUndefined();
	});

	it("typed by hand: roll forgotten, formulas follow", () => {
		const once = computeHexFields(undefined, ctx("400"), "fill")!;
		const e = setByHand({ extra: once }, decls(), POP, "1000")!;
		expect(e.Population).toBe("1000");
		expect(e.Militia).toBe("50");
		expect(getField({ extra: e }, FIELD_ROLLS_COLUMN)).toBeUndefined();
	});

	it("formulas in dependency order; loops left out", () => {
		const a: FieldDef = { name: "A", type: "number", default: "", formula: "B + 1" };
		const b: FieldDef = { name: "B", type: "number", default: "", formula: "2" };
		const c: FieldDef = { name: "C", type: "number", default: "", formula: "D" };
		const d: FieldDef = { name: "D", type: "number", default: "", formula: "C" };
		expect(formulaOrder([a, b, c, d]).map((f) => f.name)).toEqual(["B", "A"]);
	});

	it("cells: any header case, other spellings dropped; rolls escape semicolons", () => {
		expect(withCells({ population: "1", Other: "x" }, { Population: "2" })).toEqual({ population: "2", Other: "x" });
		expect(withCells({ A: "1" }, { a: null })).toBeUndefined();
		const rolls = readRolls(formatRolls(new Map([["note", { name: "Note", value: "a;b" }]]), []));
		expect(rolls.get("note")?.value).toBe("a;b");
	});
});

describe("hex fields: places and the near: key", () => {
	const hexes = new Map<string, HexData>([["0_0", { terrain: "City" }], ["1_0", { terrain: "urban" }], ["2_0", { terrain: "forest" }]]);
	const types = placeTypes([{ place: "Mine", field: "x", here: "", nearby: "", radius: 0 }]);

	it("terrain places: named like a type, or of a type", () => {
		const ps = terrainPlaces(hexes, types, (t) => (t === "urban" ? "settlement" : undefined));
		expect(ps.map((p) => [p.key, p.type])).toEqual([["0_0", "city"], ["1_0", "settlement"]]);
		expect(types.has("mine")).toBe(true);
	});

	it("note places: place-type, a type: that is a place type, else town", () => {
		expect(notePlaceType({ "place-type": "City" }, types)).toBe("city");
		expect(notePlaceType({ type: "camp" }, types)).toBe("camp");
		expect(notePlaceType({ type: "npc" }, types)).toBe("town");
		expect(notePlaceType(undefined, types)).toBe("town");
	});

	it("links under a heading, up to the next one at its level", () => {
		const at = (offset: number) => ({ start: { offset } });
		const cache = {
			headings: [{ heading: "Towns", level: 3, position: at(10) }, { heading: "Sub", level: 4, position: at(30) }, { heading: "Dungeons", level: 3, position: at(50) }],
			links: [{ link: "Saltmere", position: at(20) }, { link: "Inner", position: at(40) }, { link: "Crypt", position: at(60) }],
		};
		expect(linksUnderHeading(cache, (h) => h === "Towns")).toEqual(["Saltmere", "Inner"]);
	});

	it("near: reads, fits by distance, formats; no context lets the row through", () => {
		const when = parseWhen("near: town, city 2; terrain: forest");
		expect(formatWhen(when)).toBe("near: town, city 2; terrain: forest");
		expect(conditionsFit(when, { terrain: "forest", near: [{ type: "City", distance: 2 }] })).toBe(true);
		expect(conditionsFit(when, { terrain: "forest", near: [{ type: "city", distance: 3 }] })).toBe(false);
		expect(conditionsFit(when, { terrain: "forest", near: [] })).toBe(false);
		expect(conditionsFit(when, { terrain: "forest" })).toBe(true);
		expect(conditionsFit(parseWhen("near: camp"), { near: [{ type: "camp", distance: 1 }] })).toBe(true);
		expect(parseWhen("near:")[0].key).toBe("unknown");
	});
});

describe("hex fields: a whole map", () => {
	const input = (hexes: Map<string, HexData>, rolls: (ctx: { near?: readonly { type: string; distance: number }[] }) => string | undefined, d = decls()): MapFieldsInput => {
		const places = terrainPlaces(hexes, placeTypes(d.influences), () => undefined);
		return {
			decls: d,
			hexes,
			places,
			distance: (a, b) => hexDistance(hexPair(a), hexPair(b), "flat", "odd"),
			typeOf: (t) => (t === "forest" ? "forest" : undefined),
			roll: (_f, ctx) => rolls(ctx),
		};
	};

	it("the roll's When context knows the terrain, its type and the places around", () => {
		const hexes = new Map<string, HexData>([["0_0", { terrain: "Town" }], ["2_0", { terrain: "forest" }]]);
		const ctx = hexContext(input(hexes, () => undefined), "2_0", hexes.get("2_0"));
		expect(ctx).toEqual({ terrain: "forest", type: "forest", near: [{ type: "town", distance: 2 }] });
	});

	it("Recalculate (modifiers) gives a town's neighbours its influence; rolls see near:", () => {
		const d = decls({ influences: [{ place: "Town", field: "Population", here: "+100", nearby: "+50%", radius: 2 }] });
		const hexes = new Map<string, HexData>([["0_0", { terrain: "Town" }], ["1_0", { terrain: "forest" }], ["4_0", { terrain: "forest" }]]);
		const rolled = (ctx: { near?: readonly { type: string; distance: number }[] }) => (conditionsFit(parseWhen("near: town 1"), ctx) ? "20" : "10");
		const out = new Map(workOutMap(input(hexes, rolled, d), "modifiers"));
		expect(out.get("0_0")?.Population).toBe("120"); // own hex: roll 20 (the town is 0 away) + 100
		expect(out.get("1_0")?.Population).toBe("30"); // next door: roll 20 (near town 1), × 1.5
		expect(out.get("4_0")?.Population).toBe("10"); // out of reach
		// Typed by hand on a hex: kept by modifiers.
		const typed = typedOnHex(input(hexes, rolled, d), "4_0", "population", "77")!;
		hexes.set("4_0", { terrain: "forest", extra: typed });
		expect(new Map(workOutMap(input(hexes, rolled, d), "modifiers")).get("4_0")?.Population).toBeUndefined();
	});

	it("hexes without terrain are left alone", () => {
		const hexes = new Map<string, HexData>([["0_0", { name: "Nowhere" }]]);
		expect(workOutMap(input(hexes, () => "5"), "reroll")).toEqual([]);
	});
});
