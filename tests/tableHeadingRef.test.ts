/**
 * Phase 0 (plan-tables-everywhere §2.2): a link like [[Tundra#Mix]] reads
 * the table under that heading, so a table inside another note rolls
 * without moving its data.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { headingSection, locateRollTable, parseRandomTable, parseRandomTableWithReport } from "../src/random-tables/randomTable";
import { notesLookup, resolveOdds, resolveRoll } from "../src/random-tables/resolve";

const TUNDRA = `---
hexmaker-biome: 1
---
# Tundra

Cold and flat.

## Mix

| Type | Weight |
| --- | ---: |
| snow | 6 |
| grassland | 3 |
| hills | 1 |

## Transitions

| Next to | Becomes |
| --- | --- |
| forest | taiga |

\`\`\`
## Not a heading
| Result | Weight |
| x | 1 |
\`\`\`

### Deep

| Result | Weight |
| --- | --- |
| frost giant | 1 |
`;

describe("heading-addressed tables", () => {
	it("finds the section under a heading, any case, up to the next heading of its level", () => {
		const s = headingSection(TUNDRA, "mix")!;
		expect(TUNDRA.slice(s.start, s.end)).toContain("| snow | 6 |");
		expect(TUNDRA.slice(s.start, s.end)).not.toContain("Transitions");
		// A deeper heading stays inside its parent's section.
		const tr = headingSection(TUNDRA, "Transitions")!;
		expect(TUNDRA.slice(tr.start, tr.end)).toContain("frost giant");
		// Headings in code fences don't count.
		expect(headingSection(TUNDRA, "Not a heading")).toBeNull();
	});

	it("reads the table under the heading (Tundra#Mix), weights and all", () => {
		const t = parseRandomTable(TUNDRA, { heading: "Mix" });
		expect(t.entries.map((e) => [e.result, e.weight])).toEqual([["snow", 6], ["grassland", 3], ["hills", 1]]);
		expect(parseRandomTable(TUNDRA, { heading: "Deep" }).entries.map((e) => e.result)).toEqual(["frost giant"]);
		// Without a heading: the note's roll table as before (the first with a Result column).
		expect(locateRollTable(TUNDRA)?.header).toEqual(["Result", "Weight"]);
	});

	it("a missing heading, or no table under it, is reported", () => {
		const r = parseRandomTableWithReport(TUNDRA, { heading: "Weather" });
		expect(r.table.entries).toEqual([]);
		expect(r.issues.map((i) => i.code)).toEqual(["heading-missing", "no-table"]);
		const none = parseRandomTableWithReport("# A\n\n## Empty\n\nNothing.\n\n## B\n| Result |\n|---|\n| x |\n", { heading: "Empty" });
		expect(none.issues.map((i) => i.code)).toEqual(["no-table"]);
	});

	it("rolls through a link to it, like any table", () => {
		const lookup = notesLookup({ "world/biomes/Tundra.md": TUNDRA, "tables/Ground.md": "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–6 | [[Tundra#Mix]] | 1 |\n" });
		const odds = resolveOdds("Ground", lookup);
		expect(odds.map((o) => [o.value, Math.round(o.odds * 100)])).toEqual([["snow", 60], ["grassland", 30], ["hills", 10]]);
		const r = resolveRoll("Ground", lookup, { seed: 4 });
		expect(["snow", "grassland", "hills"]).toContain(r.value);
		expect(r.chain.map((s) => s.table)).toEqual(["tables/Ground.md", "world/biomes/Tundra.md#Mix"]);
	});
});
