/**
 * Phase 1 (plan-tables-everywhere §2.3): one resolver for nested and
 * seeded rolls, with a loop guard; its odds are the odds it rolls.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { parseRandomTable } from "../src/random-tables/randomTable";
import {
	DEFAULT_MAX_DEPTH,
	LOOP_MARK,
	chainLabel,
	findRow,
	memoryLookup,
	notesLookup,
	resolveOdds,
	resolveRoll,
	skippedRows,
} from "../src/random-tables/resolve";
import { mulberry32 } from "../packages/hex-wfc/src/rng";

const T = (body: string, fm = "") => parseRandomTable(`${fm ? `---\n${fm}\n---\n` : ""}| d | Result | Weight | Notes |\n|---|---|---|---|\n${body}`);

const NOTES = {
	"tables/Sector hexes.md": "---\ndice: 20\n---\n| d20 | Result | Weight | Roll | Notes |\n|---|---|---|---|---|\n| 1 | deep-space station | 1 |  | known |\n| 2–15 | [[Mainworlds]] | 14 |  | charted |\n| 16–20 | [[Uncharted]] | 5 | on arrival | uncharted |\n",
	"tables/Mainworlds.md": "---\ndice: 6\nrows: terrain\n---\n| d6 | Result | Weight | Mainworld | Size |\n|---|---|---|---|---|\n| 1–4 | garden world | 4 | terrestrial planet | 13×13 |\n| 5–6 | ocean world | 2 | ocean planet |  |\n",
	"tables/Uncharted.md": "---\ndice: 12\n---\n| d12 | Result | Weight |\n|---|---|---|\n| 1–6 | [[Mainworlds]] | 6 |\n| 7–8 | rogue planet | 2 |\n| 9–10 | black hole | 2 |\n| 11–12 | (nothing) | 2 |\n",
};

describe("resolveRoll: nesting", () => {
	const lookup = notesLookup(NOTES);

	it("a row that links a table is rolled through, with the chain and the attributes along it", () => {
		const seen = new Set<string>();
		for (let seed = 1; seed <= 300; seed++) {
			const r = resolveRoll("Sector hexes", lookup, { seed });
			seen.add(r.value);
			if (r.value === "garden world") {
				// Mainworlds says rows: terrain, so its plain text is a terrain.
				expect(r.kind).toBe("terrain");
				const tables = r.chain.map((s) => s.table);
				expect([["tables/Sector hexes.md", "tables/Mainworlds.md"], ["tables/Sector hexes.md", "tables/Uncharted.md", "tables/Mainworlds.md"]]).toContainEqual(tables);
				expect(r.attrs.Mainworld).toBe("terrestrial planet");
				expect(r.attrs.Size).toBe("13×13");
				expect(chainLabel(r)).toMatch(/^Sector hexes → Mainworlds → garden world$|^Sector hexes → Uncharted → Mainworlds → garden world$/);
			}
		}
		expect([...seen].sort()).toEqual(["", "black hole", "deep-space station", "garden world", "ocean world", "rogue planet"]);
	});

	it("an inner row's cell wins over an outer one's", () => {
		const r = resolveRoll("Sector hexes", lookup, { seed: 1, rand: () => 0.3 });
		expect(r.attrs.Notes).toBe("charted");
		expect(r.attrs.Mainworld).toBeDefined();
	});

	it("(nothing) is its own kind", () => {
		const t = memoryLookup({ N: T("| 1 | (nothing) | 1 | |") });
		expect(resolveRoll("N", t, { seed: 1 })).toMatchObject({ kind: "nothing", value: "" });
	});

	it("with terrains, plain text naming one is a terrain in the palette's spelling", () => {
		const r = resolveRoll("Mainworlds", lookup, { seed: 2, terrains: ["Garden World", "Ocean World"] });
		expect(r.kind).toBe("terrain");
		expect(["Garden World", "Ocean World"]).toContain(r.value);
	});

	it("on arrival rows stop there when asked (deferArrival), with what the hex shows", () => {
		const lk = notesLookup({ ...NOTES, "tables/Sector hexes.md": NOTES["tables/Sector hexes.md"].replace("| on arrival |", "| on arrival |").replace("| Roll | Notes |", "| Roll | Notes |") });
		const r = resolveRoll("Sector hexes", lk, { rand: () => 0.99, deferArrival: true });
		expect(r.kind).toBe("deferred");
		expect(r.value).toBe("Uncharted");
		// Not deferring (the Tables view, today's generators): rolled through.
		expect(resolveRoll("Sector hexes", lk, { rand: () => 0.99 }).kind).not.toBe("deferred");
	});
});

describe("resolveRoll: seeding", () => {
	const lookup = notesLookup(NOTES);
	it("the same seed gives the same chain; another seed may not", () => {
		for (let seed = 1; seed <= 50; seed++) {
			expect(resolveRoll("Sector hexes", lookup, { seed })).toEqual(resolveRoll("Sector hexes", lookup, { seed }));
		}
		const chains = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(resolveRoll("Sector hexes", lookup, { seed: i + 1 }).chain)));
		expect(chains.size).toBeGreaterThan(3);
	});

	it("a given stream is used as is (nested rolls draw from it in turn)", () => {
		const a = resolveRoll("Uncharted", lookup, { rand: mulberry32(9) });
		const b = resolveRoll("Uncharted", lookup, { rand: mulberry32(9) });
		expect(a).toEqual(b);
	});

	it("a table that rolls by its die reports the face", () => {
		const r = resolveRoll("Mainworlds", lookup, { rand: () => 0.0 });
		expect(r.chain[0].face).toBe(1);
	});
});

describe("resolveRoll: the loop guard", () => {
	it("a table that links itself, or a cycle, stops with ⟲ instead of hanging", () => {
		const self = memoryLookup({ A: T("| 1 | [[A]] | 1 | |") });
		const r = resolveRoll("A", self, { seed: 1 });
		expect(r.kind).toBe("loop");
		expect(r.value).toBe(`${LOOP_MARK} A`);
		const cycle = memoryLookup({ A: T("| 1 | [[B]] | 1 | |"), B: T("| 1 | [[A]] | 1 | |") });
		const c = resolveRoll("A", cycle, { seed: 1 });
		expect(c.kind).toBe("loop");
		expect(c.chain.map((s) => s.table)).toEqual(["A", "B"]);
		expect(resolveOdds("A", cycle)).toEqual([{ kind: "loop", value: `${LOOP_MARK} A`, odds: 1 }]);
	});

	it("a chain deeper than the cap stops too (default 5)", () => {
		const tables: Record<string, ReturnType<typeof T>> = {};
		for (let i = 0; i < 9; i++) tables[`L${i}`] = T(`| 1 | [[L${i + 1}]] | 1 | |`);
		tables.L9 = T("| 1 | bottom | 1 | |");
		const lk = memoryLookup(tables);
		const r = resolveRoll("L0", lk, { seed: 1 });
		expect(r.kind).toBe("loop");
		expect(r.chain).toHaveLength(DEFAULT_MAX_DEPTH);
		expect(resolveRoll("L0", lk, { seed: 1, maxDepth: 10 }).value).toBe("bottom");
	});

	it("a loop row in a terrain-only roll is left out, not rolled into", () => {
		const lk = memoryLookup({ A: T("| 1 | [[A]] | 5 | |\n| 2 | rock | 1 | |") });
		for (let seed = 1; seed <= 20; seed++) expect(resolveRoll("A", lk, { seed, terrains: ["rock"], onlyTerrains: true }).value).toBe("rock");
		expect(skippedRows("A", lk, { terrains: ["rock"], onlyTerrains: true })).toEqual([{ table: "A", index: 0, result: "A", why: "dead-end" }]);
	});
});

describe("When, Once and terrain-only: left out and renormalised", () => {
	const lk = memoryLookup({
		Z: parseRandomTable("| Result | Weight | When | Once |\n|---|---|---|---|\n| hot rock | 3 | zone: inner |  |\n| garden | 2 |  |  |\n| ice ball | 5 | zone: outer |  |\n| relic | 1 |  | per world |\n| crystal | 4 |  |  |\n"),
	});

	it("rows whose When doesn't fit never come up; the rest keep their proportions", () => {
		const odds = resolveOdds("Z", lk, { zone: "inner" });
		expect(odds.map((o) => [o.value, o.odds])).toEqual([["crystal", 0.4], ["hot rock", 0.3], ["garden", 0.2], ["relic", 0.1]]);
		for (let seed = 1; seed <= 200; seed++) expect(resolveRoll("Z", lk, { seed, zone: "inner" }).value).not.toBe("ice ball");
	});

	it("used Once rows are left out (isUsed: the ledger)", () => {
		const isUsed = (_t: string, i: number) => i === 3;
		expect(resolveOdds("Z", lk, { zone: "outer", isUsed }).some((o) => o.value === "relic")).toBe(false);
		const r = resolveRoll("Z", lk, { rand: () => 0.99, zone: "inner" });
		expect(r.value).toBe("crystal");
		const relic = resolveRoll("R", memoryLookup({ R: parseRandomTable("| Result | Weight | Once |\n|---|---|---|\n| relic | 1 | per map |\n") }), { seed: 1 });
		expect(relic.once).toEqual({ table: "R", index: 0, scope: "map" });
	});

	it("with onlyTerrains, rows that aren't terrains of the palette are left out and listed", () => {
		const odds = resolveOdds("Z", lk, { terrains: ["garden", "crystal"], onlyTerrains: true });
		expect(odds.map((o) => [o.value, o.odds])).toEqual([["crystal", 4 / 6], ["garden", 2 / 6]]);
		expect(skippedRows("Z", lk, { terrains: ["garden", "crystal"], onlyTerrains: true }).map((s) => [s.result, s.why])).toEqual([
			["hot rock", "not-terrain"], ["ice ball", "not-terrain"], ["relic", "not-terrain"],
		]);
	});
});

describe("resolveOdds is what resolveRoll rolls", () => {
	it("nested odds multiply, sum to 1, and match 20 000 seeded rolls", () => {
		const lookup = notesLookup(NOTES);
		const odds = resolveOdds("Sector hexes", lookup);
		expect(odds.reduce((a, o) => a + o.odds, 0)).toBeCloseTo(1, 12);
		const garden = odds.find((o) => o.value === "garden world")!.odds;
		// 14/20 · 4/6 + 5/20 · 6/12 · 4/6
		expect(garden).toBeCloseTo(14 / 20 * 4 / 6 + 5 / 20 * 6 / 12 * 4 / 6, 12);
		const n = 20000;
		const counts = new Map<string, number>();
		for (let i = 0; i < n; i++) {
			const r = resolveRoll("Sector hexes", lookup, { seed: i + 1 });
			counts.set(r.value, (counts.get(r.value) ?? 0) + 1);
		}
		for (const o of odds) {
			const got = (counts.get(o.value) ?? 0) / n;
			expect(Math.abs(got - o.odds)).toBeLessThan(4 * Math.sqrt((o.odds * (1 - o.odds)) / n) + 1e-3);
		}
	});
});

describe("findRow", () => {
	it("finds the row naming a result in a table or the tables it links, with its attributes", () => {
		const lookup = notesLookup(NOTES);
		expect(findRow("Sector hexes", "Ocean World", lookup)?.attrs).toEqual({ Notes: "charted", Mainworld: "ocean planet" });
		expect(findRow("Sector hexes", "nowhere", lookup)).toBeUndefined();
		// Loops are guarded here too.
		expect(findRow("A", "x", memoryLookup({ A: T("| 1 | [[A]] | 1 | |") }))).toBeUndefined();
	});
});
