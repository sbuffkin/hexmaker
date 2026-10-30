/**
 * Phase 6 (plan-tables-everywhere §2.3): rolls made for a hex (the hex
 * editor's 🎲 / 📖 and "Add to this hex"; the planned hex generator's
 * fields) go through the shared resolver: nested tables roll through, the
 * hex's terrain is the When context, pick-each tables give a line per row.
 * A plain table rolls exactly as before.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { rollForHex } from "../src/random-tables/hexRoll";
import { layeredLookup, notesLookup } from "../src/random-tables/resolve";
import { parseRandomTable, rollTable } from "../src/random-tables/randomTable";
import { mulberry32 } from "../packages/hex-wfc/src/rng";

const WEATHER = "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–3 | Clear | 3 |\n| 4–5 | [[Storms]] | 2 |\n| 6 | Fog | 1 |\n";
const TABLES = {
	"t/Weather.md": WEATHER,
	"t/Storms.md": "| Result | Weight |\n|---|---|\n| Hail | 1 |\n| Thunder | 1 |\n",
	"t/Sights.md": "| Result | Weight | When |\n|---|---|---|\n| A heron | 1 | terrain: swamp |\n| A cairn | 1 | type: hills |\n| (nothing) | 1 |  |\n",
	"t/Signs.md": "---\npick: each\n---\n| Result | Chance |\n|---|---|\n| Tracks | always |\n| Smoke | never |\n| Bones | always |\n",
};
const lookup = notesLookup(TABLES);

describe("rolling a table for a hex", () => {
	it("a plain table: the same row as rolling it directly with the same stream", () => {
		const plain = "| d6 | Result | Weight |\n|---|---|---|\n| 1–3 | Clear | 3 |\n| 4–6 | Rain | 3 |\n";
		const table = parseRandomTable(plain);
		for (let seed = 1; seed <= 20; seed++) {
			const direct = rollTable(table, mulberry32(seed))!;
			const r = rollForHex("p.md", notesLookup({ "p.md": plain }), { rand: mulberry32(seed) });
			expect(r.text).toBe(direct.entry.result);
			expect(r.rows).toEqual([direct.index]);
			expect(r.face).toBe(direct.face);
			expect(r.chains).toEqual([]);
		}
	});

	it("a row linking another table is rolled through, and the chain is said", () => {
		const r = rollForHex("t/Weather.md", lookup, { rand: () => 0.7 }); // d6 → 5: Storms
		expect(["Hail", "Thunder"]).toContain(r.text);
		expect(r.rows).toEqual([1]);
		expect(r.face).toBe(5);
		expect(r.chains[0]).toMatch(/^Weather → Storms → (Hail|Thunder)$/);
	});

	it("the hex's terrain and type are the When context; (nothing) adds no text", () => {
		const swamp = new Set<string>();
		const hills = new Set<string>();
		for (let seed = 1; seed <= 40; seed++) {
			swamp.add(rollForHex("t/Sights.md", lookup, { seed, terrain: "swamp", type: "wetland" }).text);
			hills.add(rollForHex("t/Sights.md", lookup, { seed, terrain: "downs", type: "hills" }).text);
		}
		expect([...swamp].sort()).toEqual(["", "A heron"]);
		expect([...hills].sort()).toEqual(["", "A cairn"]);
	});

	it("a pick-each table gives one line per row that came up", () => {
		const r = rollForHex("t/Signs.md", lookup, { rand: () => 0.5 });
		expect(r.text).toBe("Tracks\nBones");
		expect(r.rows).toEqual([0, 2]);
	});

	it("the note's own text wins over the tables folder's copy (the editor may hold newer text)", () => {
		const own = notesLookup({ "t/Weather.md": "| Result | Weight |\n|---|---|\n| Snow | 1 |\n" });
		expect(rollForHex("t/Weather.md", layeredLookup(own, lookup), { seed: 1 }).text).toBe("Snow");
	});
});
