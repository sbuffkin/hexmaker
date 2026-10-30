/**
 * Phase 0 (plan-tables-everywhere §2.2): row attributes, the shared
 * columns (Roll, Shown as, Once, When), decimal weights (T10), and that
 * all of it survives an editor save.
 */
import { describe, it } from "node:test";
import expect from "expect";
import {
	parseRandomTable,
	parseRandomTableWithReport,
	readTableWeight,
	rollTable,
	rowInfoOf,
	writeRollTable,
} from "../src/random-tables/randomTable";
import { conditionsFit, formatWhen, parseWhen } from "../src/random-tables/tableConditions";

const HEXES = `---
dice: 20
rows: any
shown-as: uncharted system
---
# Drift sector hexes

| d20 | Result | Weight | Roll | Shown as | Notes |
| --- | --- | ---: | --- | --- | --- |
| 1 | deep-space station | 1 | now |  | known to every chart |
| 2–11 | [[Mainworlds]] | 10 | now |  | charted |
| 12–15 | [[Mainworlds]] | 4 | on arrival | star system | somewhat known |
| 16–20 | [[Uncharted]] | 5 | on arrival |  | uncharted |
`;

describe("row attributes", () => {
	it("every other column comes back per row, by its header; entries read as before", () => {
		const t = parseRandomTable(HEXES);
		expect(t.entries.map((e) => [e.result, e.weight, e.range])).toEqual([
			["deep-space station", 1, "1"], ["Mainworlds", 10, "2–11"], ["Mainworlds", 4, "12–15"], ["Uncharted", 5, "16–20"],
		]);
		// Entries carry only what they always did.
		expect(Object.keys(t.entries[1]).sort()).toEqual(["isLink", "range", "result", "weight"]);
		expect(rowInfoOf(t, 0).attrs).toEqual({ Roll: "now", Notes: "known to every chart" });
		expect(rowInfoOf(t, 2).attrs).toEqual({ Roll: "on arrival", "Shown as": "star system", Notes: "somewhat known" });
	});

	it("a table with no extra columns has no rowInfo at all", () => {
		const t = parseRandomTable("| d6 | Result | Weight |\n|---|---|---|\n| 1–6 | a | 1 |\n");
		expect(t.rowInfo).toBeUndefined();
		expect(rowInfoOf(t, 0)).toEqual({});
	});

	it("Roll is the die column when it is the only one, the shared Roll column beside a die column", () => {
		const old = parseRandomTable("| Roll | Result |\n|---|---|\n| 1–3 | a |\n| 4–6 | b |\n");
		expect(old.entries.map((e) => e.range)).toEqual(["1–3", "4–6"]);
		expect(old.rowInfo).toBeUndefined();
		const t = parseRandomTable(HEXES);
		expect(t.entries[3].range).toBe("16–20");
		expect(rowInfoOf(t, 3).roll).toBe("on arrival");
		// No die column, but every cell says now / on arrival: the shared column.
		const shared = parseRandomTable("| Result | Weight | Roll |\n|---|---|---|\n| a | 1 | on arrival |\n| b | 2 |  |\n| c | 1 | now |\n");
		expect(shared.entries.map((e) => e.range)).toEqual([undefined, undefined, undefined]);
		expect(rowInfoOf(shared, 0).roll).toBe("on arrival");
	});
});

describe("the shared columns", () => {
	it("Roll: now (default) or on arrival; Shown as; the table's shown-as is the default", () => {
		const t = parseRandomTable(HEXES);
		expect(t.entries.map((_, i) => rowInfoOf(t, i).roll)).toEqual([undefined, undefined, "on arrival", "on arrival"]);
		expect(rowInfoOf(t, 2).shownAs).toBe("star system");
		expect(rowInfoOf(t, 3).shownAs).toBeUndefined();
		expect(t.shownAs).toBe("uncharted system");
	});

	it("Once: per world / per map / blank", () => {
		const t = parseRandomTable("| d100 | Result | Weight | Once |\n|---|---|---|---|\n| 01 | [[The Silent Fleet]] | 1 | per world |\n| 02 | a | 1 | per map |\n| 03–100 | (nothing) | 98 |  |\n");
		expect(t.entries.map((_, i) => rowInfoOf(t, i).once)).toEqual(["world", "map", undefined]);
	});

	it("unreadable Roll / Once / When are reported; Roll rolls now, Once repeats, a bad When never fires", () => {
		const r = parseRandomTableWithReport("| d6 | Result | Weight | Roll | Once | When |\n|---|---|---|---|---|---|\n| 1–3 | a | 1 | sometimes | twice | phase: full moon |\n| 4–6 | b | 1 |  |  | zone: outer |\n");
		expect(r.issues.filter((i) => i.row).map((i) => [i.code, i.row])).toEqual([["roll-unknown", 1], ["once-unknown", 1], ["when-unknown", 1]]);
		const info = rowInfoOf(r.table, 0);
		expect(info.roll).toBeUndefined();
		expect(info.once).toBeUndefined();
		expect(conditionsFit(info.when, {})).toBe(false);
		// Kept as typed.
		expect(info.attrs).toEqual({ Roll: "sometimes", Once: "twice", When: "phase: full moon" });
	});

	it("When: conditions by key, choices by comma, all must fit; keys the context doesn't know pass", () => {
		const w = parseWhen("star: red dwarf, white dwarf; zone: outer; ring: 3–5; temperature: cold");
		expect(w.map((c) => c.key)).toEqual(["star", "zone", "ring", "temperature"]);
		expect(conditionsFit(w, {})).toBe(true);
		expect(conditionsFit(w, { star: "Red Dwarf", zone: "outer", ring: 4, temperature: 0.1 })).toBe(true);
		expect(conditionsFit(w, { star: "yellow star" })).toBe(false);
		expect(conditionsFit(w, { zone: "inner" })).toBe(false);
		expect(conditionsFit(w, { ring: 6 })).toBe(false);
		expect(conditionsFit(w, { temperature: 0.9 })).toBe(false);
		expect(conditionsFit(parseWhen("type: gas-giant"), { type: "gas-giant" })).toBe(true);
		expect(parseWhen("")).toEqual([]);
		expect(parseWhen("any")).toEqual([]);
		expect(formatWhen(parseWhen("zone: habitable, outer; star: red dwarf"))).toBe("zone: habitable, outer; star: red dwarf");
	});
});

describe("decimal weights (T10)", () => {
	it("3.5, 0.5, .25 and 50% read; anything else is reported and counts as 1", () => {
		expect([readTableWeight("3.5"), readTableWeight("0.5"), readTableWeight(".25"), readTableWeight("50%"), readTableWeight("2")]).toEqual([3.5, 0.5, 0.25, 0.5, 2]);
		expect(readTableWeight("abc")).toBeNaN();
		expect(readTableWeight("-1")).toBeNaN();
		const r = parseRandomTableWithReport("| Result | Weight |\n|---|---|\n| a | 3.5 |\n| b | 0.5 |\n| c | lots |\n");
		expect(r.table.entries.map((e) => e.weight)).toEqual([3.5, 0.5, 1]);
		expect(r.issues.map((i) => i.code)).toEqual(["weight-unreadable"]);
	});

	it("decimal weights roll in proportion and give whole ranges on a die", () => {
		const t = parseRandomTable("---\ndice: 8\n---\n| Result | Weight |\n|---|---|\n| a | 3.5 |\n| b | 0.5 |\n");
		let a = 0;
		for (let i = 0; i < 8000; i++) if (rollTable(t, () => (i + 0.5) / 8000)?.entry.result === "a") a++;
		expect(a / 8000).toBeCloseTo(3.5 / 4, 2);
		const written = writeRollTable("---\ndice: 8\n---\n| Result | Weight |\n|---|---|\n| a | 3.5 |\n| b | 0.5 |\n", { dice: 8, rows: t.entries.map((entry, source) => ({ entry, source })), ranges: "regenerate" });
		expect(written).toContain("| 1–7 | a | 3.5 |");
		expect(written).toContain("| 8 | b | 0.5 |");
	});
});

describe("an editor save keeps every column", () => {
	it("reweighting, reordering and adding rows keep the attribute and shared cells as typed", () => {
		const t = parseRandomTable(HEXES);
		const rows = t.entries.map((entry, source) => ({ entry: { ...entry }, source }));
		rows[1].entry.weight = 9;
		[rows[2], rows[3]] = [rows[3], rows[2]];
		const next = writeRollTable(HEXES, {
			dice: 20,
			rows: [...rows, { entry: { result: "black hole", weight: 1 } }],
			ranges: "regenerate",
		});
		const back = parseRandomTable(next);
		expect(back.entries.map((e) => e.result)).toEqual(["deep-space station", "Mainworlds", "Uncharted", "Mainworlds", "black hole"]);
		expect(rowInfoOf(back, 1).attrs).toEqual({ Roll: "now", Notes: "charted" });
		expect(rowInfoOf(back, 2).roll).toBe("on arrival");
		expect(rowInfoOf(back, 3).attrs).toEqual({ Roll: "on arrival", "Shown as": "star system", Notes: "somewhat known" });
		expect(rowInfoOf(back, 4)).toEqual({});
		expect(back.rows).toBeUndefined();
		expect(back.shownAs).toBe("uncharted system");
		expect(next).toContain("# Drift sector hexes");
		expect(next.split("\n").find((l) => l.includes("black hole"))).toMatch(/^\| \S+ \| black hole \| 1 \|  \|  \|  \|$/);
	});
});
