/**
 * Security review #7: resolveOdds walked a linked table once for every row
 * linking to it (rows^depth), so a pack's tables with a couple of hundred
 * rows chained six deep hung world generation. A table's outcome odds are
 * now worked out once per (link, tables above it) and scaled.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { parseRandomTable, resolveTable, rowInfoOf, type RandomTable } from "../src/random-tables/randomTable";
import { DEFAULT_MAX_DEPTH, LOOP_MARK, cellKind, memoryLookup, resolveOdds, type ResolvedOdds, type TableLookup } from "../src/random-tables/resolve";
import { mulberry32 } from "../packages/hex-wfc/src/rng";

/** The old walk (before memoizing), for tables without When/Once/terrain filters. */
function naiveOdds(link: string, lookup: TableLookup): Map<string, ResolvedOdds> {
	const out = new Map<string, ResolvedOdds>();
	const add = (kind: ResolvedOdds["kind"], value: string, q: number) => {
		const k = `${kind}:${value.trim().toLowerCase()}`;
		const o = out.get(k);
		if (o) o.odds += q;
		else out.set(k, { kind, value, odds: q });
	};
	const walk = (l: string, visited: string[], p: number): void => {
		const t = lookup.table(l);
		if (!t) return add("empty", l, p);
		if (visited.includes(t.key) || visited.length >= DEFAULT_MAX_DEPTH) return add("loop", `${LOOP_MARK} ${l}`, p);
		const r = resolveTable(t.table);
		const weights = t.table.entries.map((e, i) => (r.mode === "ranges" ? r.faces[i].length : Math.max(0, e.weight)));
		const total = weights.reduce((a, b) => a + b, 0);
		if (total <= 0) return add("empty", l, p);
		t.table.entries.forEach((e, i) => {
			if (weights[i] <= 0) return;
			const q = (p * weights[i]) / total;
			void rowInfoOf(t.table, i);
			const { kind, value } = cellKind(t.table, e, lookup);
			if (kind === "table") walk(value, [...visited, t.key], q);
			else add(kind, value, q);
		});
	};
	walk(link, [], 1);
	return out;
}

const table = (rows: [string, number][]): RandomTable =>
	parseRandomTable(`| Result | Weight |\n|---|---|\n${rows.map(([r, w]) => `| ${r} | ${w} |`).join("\n")}\n`);

function expectSameOdds(link: string, lookup: TableLookup): void {
	const now = resolveOdds(link, lookup);
	const before = naiveOdds(link, lookup);
	expect(now.map((o) => `${o.kind}:${o.value}`).sort()).toEqual([...before.values()].map((o) => `${o.kind}:${o.value}`).sort());
	for (const o of now) expect(Math.abs(o.odds - before.get(`${o.kind}:${o.value.trim().toLowerCase()}`)!.odds)).toBeLessThan(1e-12);
}

describe("odds on linked tables (security review #7)", () => {
	it("match the old walk on ordinary nested tables: shared tables, loops, missing links, mixed case", () => {
		const lk = memoryLookup({
			Encounters: table([["[[Beasts]]", 3], ["[[People]]", 2], ["quiet", 5], ["[[Missing]]", 1]]),
			Beasts: table([["wolf", 2], ["Bear", 1], ["[[People]]", 1], ["[[Encounters]]", 1]]),
			People: table([["bandit", 1], ["merchant", 3], ["bear", 1], ["[[Beasts]]", 2]]),
		});
		for (const l of ["Encounters", "Beasts", "People"]) expectSameOdds(l, lk);
		const total = resolveOdds("Encounters", lk).reduce((a, o) => a + o.odds, 0);
		expect(Math.abs(total - 1)).toBeLessThan(1e-12);
	});

	it("match the old walk on random small table webs", () => {
		const rand = mulberry32(7);
		for (let web = 0; web < 30; web++) {
			const names = ["A", "B", "C", "D", "E"];
			const tables: Record<string, RandomTable> = {};
			for (const n of names) {
				const rows: [string, number][] = [];
				const count = 1 + Math.floor(rand() * 5);
				for (let i = 0; i < count; i++) {
					const linked = rand() < 0.5;
					rows.push([linked ? `[[${names[Math.floor(rand() * names.length)]}]]` : `out ${Math.floor(rand() * 4)}`, 1 + Math.floor(rand() * 4)]);
				}
				tables[n] = table(rows);
			}
			expectSameOdds("A", memoryLookup(tables));
		}
	});

	it("a crafted fan-out (200 rows each linking the next table, six deep) is fast and exact", () => {
		const tables: Record<string, RandomTable> = {};
		for (let t = 0; t < 6; t++) {
			const rows: [string, number][] = [];
			for (let i = 0; i < 200; i++) rows.push([t < 5 ? `[[T${t + 1}]]` : `end ${i % 4}`, 1]);
			tables[`T${t}`] = table(rows);
		}
		const started = performance.now();
		const odds = resolveOdds("T0", memoryLookup(tables));
		expect(performance.now() - started).toBeLessThan(1000);
		// T0..T4 are five tables deep: T5 is reached at the depth cap, so every roll stops there as a loop.
		expect(odds.map((o) => o.value)).toEqual([`${LOOP_MARK} T5`]);
		expect(odds[0].odds).toBeCloseTo(1, 12);

		// One table shallower: the end table's four outcomes, a quarter each.
		const shallow = resolveOdds("T1", memoryLookup(tables));
		expect(shallow.map((o) => o.value)).toEqual(["end 0", "end 1", "end 2", "end 3"]);
		for (const o of shallow) expect(o.odds).toBeCloseTo(0.25, 12);
	});
});
