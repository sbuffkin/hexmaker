import { describe, it } from "node:test";
import expect from "expect";
import {
	classifyResult,
	describeWrites,
	EXPLORE_DEFAULTS,
	formatFlowerAt,
	formatRule,
	parseFlowerAt,
	parseReveal,
	parseRule,
	planStep,
	readRules,
	ruleSeed,
	startCell,
	type ExploreSource,
	type PlanInput,
} from "../src/hexflower/explore";
import { CENTRE, emptyFlower, type Flower } from "../src/hexflower/flower";

/** plan-hex-flower phase 2: explore-with rules and the step planner. */

const TERRAINS = ["grassland", "forest", "hills"];

function wilds(): Flower {
	const f = emptyFlower("Wilds");
	f.cells = f.cells.map((_, i) => ({ result: TERRAINS[i % 3] }));
	return f;
}

function input(over: Partial<PlanInput> = {}, sources: Record<string, ExploreSource> = {}): PlanInput {
	return {
		rules: readRules(["[[Wilds]] -> terrain"]),
		hex: "3_4",
		from: "2_4",
		fromTerrain: "forest",
		now: {},
		seed: 77,
		at: new Map(),
		terrains: TERRAINS,
		source: (l) => sources[l.toLowerCase()] ?? (l.toLowerCase() === "wilds" ? { kind: "flower", flower: wilds() } : undefined),
		isTable: (l) => sources[l.toLowerCase()]?.kind === "table",
		...over,
	};
}

describe("explore-with grammar", () => {
	it("reads link, arrow (->, →, into), target and every step", () => {
		expect(parseRule("[[Wilds]] -> terrain")).toMatchObject({ source: "Wilds", target: { kind: "terrain" }, every: false });
		expect(parseRule("[[tables/Weather|Weather]] → play log, every step")).toMatchObject({ source: "tables/Weather", target: { kind: "log" }, every: true });
		expect(parseRule("[[Ruins]] into Features", ["Features"])).toMatchObject({ target: { kind: "section", section: "Features" } });
		expect(parseRule("[[Odd]]")).toMatchObject({ source: "Odd", every: false });
		expect("target" in (parseRule("[[Odd]]") as object)).toBe(false);
		expect(parseRule("Wilds -> name")).toMatchObject({ source: "Wilds", target: { kind: "name" } });
		expect(parseRule("[[X]] -> on arrival")).toMatchObject({ target: { kind: "arrival" } });
		expect(parseRule("  ")).toMatchObject({ error: "empty" });
	});

	it("formats back to what it reads", () => {
		for (const r of ["[[Wilds]] -> terrain", "[[Weather]] -> play log, every step", "[[Ruins]] -> Features"]) {
			const rule = parseRule(r, ["Features"]);
			expect("error" in rule).toBe(false);
			if (!("error" in rule)) expect(formatRule(rule)).toBe(r);
		}
	});

	it("positions and reveal read forgivingly", () => {
		const at = parseFlowerAt(["Wilds: 7", "[[Weather]] = 12", "junk", "Bad: 40"]);
		expect([...at]).toEqual([["wilds", 7], ["weather", 12]]);
		expect(formatFlowerAt(at, new Map([["wilds", "Wilds"]]))).toEqual(["Wilds: 7", "weather: 12"]);
		expect(parseReveal(undefined)).toBe("entered");
		expect(parseReveal("neighbours")).toBe("neighbours");
		expect(parseReveal("neighbors")).toBe("neighbours");
	});
});

describe("where a flower's walk starts", () => {
	const f = wilds(); // cells 1, 4, 7… grassland; 2, 5, 8… forest; 3, 6, 9… hills
	it("stored cell when it shows the left hex's terrain", () => {
		expect(startCell(f, 5, "forest", true)).toBe(5);
	});
	it("else the nearest cell showing it", () => {
		const s = startCell(f, 10, "hills", true);
		expect(f.cells[s - 1].result).toBe("hills");
	});
	it("else the stored cell, else the start; outcome flowers use the stored cell only", () => {
		expect(startCell(f, 4, "lava", true)).toBe(4);
		expect(startCell(f, undefined, undefined, true)).toBe(CENTRE);
		expect(startCell(f, 5, "hills", false)).toBe(5);
	});
});

describe("planning a step", () => {
	it("fills a blank hex's terrain from the flower and stores where the walk landed", () => {
		const plan = planStep(input());
		expect(plan.writes).toHaveLength(1);
		expect(plan.writes[0]).toMatchObject({ target: { kind: "terrain" }, kind: "terrain" });
		expect(TERRAINS).toContain(plan.writes[0].value);
		expect(plan.moves).toHaveLength(1);
		expect(plan.at.get("wilds")).toBe(plan.moves[0].to);
	});

	it("is deterministic; reroll and another from-hex change the seed", () => {
		expect(planStep(input())).toEqual(planStep(input()));
		const base = { seed: 1, hex: "3_4", from: "2_4" };
		expect(ruleSeed(base, 0, false)).not.toBe(ruleSeed({ ...base, reroll: 1 }, 0, false));
		expect(ruleSeed(base, 0, false)).not.toBe(ruleSeed({ ...base, from: "3_3" }, 0, false));
		expect(ruleSeed(base, 0, true)).not.toBe(ruleSeed({ ...base, stepNo: 2 }, 0, true));
	});

	it("never overwrites: painted terrain, a filled section and a locked hex are left alone", () => {
		expect(planStep(input({ now: { terrain: "hills" } })).writes).toEqual([]);
		expect(planStep(input({ now: { locked: true } })).writes).toEqual([]);
		const note: ExploreSource = { kind: "table", roll: () => ({ kind: "note", value: "Old shrine" }) };
		const rules = readRules(["[[Ruins]] -> Features"]);
		expect(planStep(input({ rules, now: { filledSections: ["features"] } }, { ruins: note })).writes).toEqual([]);
		expect(planStep(input({ rules }, { ruins: note })).writes).toEqual([{ target: { kind: "section", section: "Features" }, value: "Old shrine", kind: "note", rule: 0 }]);
	});

	it("rules see earlier results (terrain) and where the party came from", () => {
		const seen: unknown[] = [];
		const table: ExploreSource = { kind: "table", roll: (_s, known) => { seen.push(known); return { kind: "text", value: "fog" }; } };
		const rules = readRules(["[[Wilds]] -> terrain", "[[Weather]] -> Description"]);
		const plan = planStep(input({ rules }, { weather: table }));
		expect(seen).toEqual([{ terrain: plan.writes[0].value, from: "forest" }]);
		expect(plan.writes[1]).toMatchObject({ target: { kind: "section", section: "Description" }, value: "fog" });
	});

	it("no target: by what came up; a text result never becomes terrain", () => {
		const t: ExploreSource = { kind: "table", roll: () => ({ kind: "text", value: "a cairn" }) };
		const plan = planStep(input({ rules: readRules(["[[Odd]]"]) }, { odd: t }));
		expect(plan.writes[0].target).toEqual(EXPLORE_DEFAULTS.text);
		const bad = planStep(input({ rules: readRules(["[[Odd]] -> terrain"]) }, { odd: t }));
		expect(bad.writes).toEqual([]);
		expect(bad.problems[0]).toMatch(/isn't a terrain/);
	});

	it("every step rules run on a hex that isn't blank; the others don't", () => {
		const log: ExploreSource = { kind: "table", roll: () => ({ kind: "text", value: "rain" }) };
		const rules = readRules(["[[Wilds]] -> terrain", "[[Weather]] -> play log, every step"]);
		const plan = planStep(input({ rules, everyOnly: true, now: { terrain: "hills" } }, { weather: log }));
		expect(plan.writes).toEqual([{ target: { kind: "log" }, value: "rain", kind: "text", rule: 1 }]);
		expect(plan.moves).toEqual([]);
	});

	it("a flower cell naming a table rolls it through; a missing source is reported", () => {
		const f = emptyFlower("Deep");
		f.cells = f.cells.map(() => ({ result: "[[Encounters]]" }));
		const enc: ExploreSource = { kind: "table", roll: () => ({ kind: "note", value: "Ogre" }) };
		const plan = planStep(input({ rules: readRules(["[[Deep]] -> Features"]) }, { deep: { kind: "flower", flower: f }, encounters: enc }));
		expect(plan.writes[0]).toMatchObject({ value: "Ogre", kind: "note" });
		expect(planStep(input({ rules: readRules(["[[Nope]]"]) })).problems[0]).toMatch(/Nope/);
	});

	it("classifies cells and describes writes", () => {
		expect(classifyResult("Forest", TERRAINS, () => false)).toEqual({ kind: "terrain", value: "forest" });
		expect(classifyResult("(nothing)", TERRAINS, () => false)).toBeUndefined();
		expect(classifyResult("[[Ogre]]", TERRAINS, () => false)).toEqual({ kind: "note", value: "Ogre" });
		expect(classifyResult("[[T]]", TERRAINS, () => true)).toEqual({ kind: "table", value: "T" });
		expect(describeWrites([
			{ target: { kind: "terrain" }, value: "hills", kind: "terrain", rule: 0 },
			{ target: { kind: "section", section: "Features" }, value: "Old shrine", kind: "note", rule: 1 },
		])).toBe("hills. Features: [[Old shrine]]");
	});
});
