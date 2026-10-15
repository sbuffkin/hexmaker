/**
 * Phase 0/1 (plan-tables-everywhere §2.2, §2.5): `rows:` per table, each
 * cell's kind detected from what it links to (T3), and the picker seam.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { parseRandomTable, parseRandomTableWithReport } from "../src/random-tables/randomTable";
import { cellKind, memoryLookup, noteKind, notesLookup, rowTypeProblems, tableFitsWant } from "../src/random-tables/resolve";

const table = (fm: string, rows: string) => `---\n${fm}\n---\n| d6 | Result | Weight |\n| --- | --- | ---: |\n${rows}`;

describe("rows: and friends in the frontmatter", () => {
	it("reads rows, terrain-type, shown-as and linked-folder", () => {
		const t = parseRandomTable(table("dice: 6\nrows: terrain\nterrain-type: world, gas-giant\nshown-as: uncharted system", "| 1–6 | garden world | 1 |"));
		expect(t.rows).toBe("terrain");
		expect(t.terrainTypes).toEqual(["world", "gas-giant"]);
		expect(t.shownAs).toBe("uncharted system");
		const lf = parseRandomTable(table("dice: 6\nrows: note\nlinked-folder: \"[[Space/Stations]]\"", "| 1–6 | [[Highport]] | 1 |"));
		expect(lf.linkedFolder).toBe("Space/Stations");
		expect(lf.rows).toBe("note");
	});

	it("rows: any (or none) is the default; plurals read; an unknown word is reported and read as any", () => {
		expect(parseRandomTable(table("dice: 6\nrows: any", "| 1 | a | 1 |")).rows).toBeUndefined();
		expect(parseRandomTable(table("dice: 6", "| 1 | a | 1 |")).rows).toBeUndefined();
		expect(parseRandomTable(table("dice: 6\nrows: notes", "| 1 | a | 1 |")).rows).toBe("note");
		const r = parseRandomTableWithReport(table("dice: 6\nrows: spaceships", "| 1–6 | a | 1 |"));
		expect(r.table.rows).toBeUndefined();
		expect(r.issues.map((i) => i.code)).toContain("rows-unknown");
		// It still rolls: rows: is a constraint, never a parser switch.
		expect(r.table.entries.map((e) => e.result)).toEqual(["a"]);
	});
});

describe("cell kinds (T3: from what the cell links to)", () => {
	const notes = {
		"tables/Mainworlds.md": "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–6 | garden world | 1 |\n",
		"tables/Plain list.md": "| Result | Weight |\n|---|---|\n| a | 1 |\n",
		"gen/Desert.md": "---\nhex-wfc: 1\n---\n# Desert\n",
		"gen/Drift.md": "---\nhexmaker-recipe: 1\n---\n",
		"wf/NPC.md": "---\nresults-folder: npcs\ntemplate-file: t.md\n---\n| Table | Rolls | Label |\n|---|---|---|\n",
		"places/Highport.md": "# Highport\nA station.\n",
	};
	const lookup = notesLookup(notes);
	const t = parseRandomTable("| Result | Weight |\n|---|---|\n| [[Mainworlds]] | 1 |\n| [[Plain list]] | 1 |\n| [[Desert]] | 1 |\n| [[Drift]] | 1 |\n| [[NPC]] | 1 |\n| [[Highport]] | 1 |\n| [[Nowhere]] | 1 |\n| procedural:orbits | 1 |\n| (nothing) | 1 |\n| garden world | 1 |\n| a ghost | 1 |\n");

	it("tables, generators (generator notes, recipes, workflows, ids), notes, nothing, terrain, text", () => {
		const kinds = t.entries.map((e) => cellKind(t, e, lookup, { terrains: ["Garden World"] }));
		expect(kinds.map((k) => k.kind)).toEqual(["table", "table", "generator", "generator", "generator", "note", "note", "generator", "nothing", "terrain", "text"]);
		// A terrain comes back in the palette's spelling.
		expect(kinds[9].value).toBe("Garden World");
	});

	it("noteKind reads a note's own text", () => {
		expect(noteKind(notes["tables/Mainworlds.md"])).toBe("table");
		expect(noteKind(notes["gen/Desert.md"])).toBe("generator");
		expect(noteKind(notes["places/Highport.md"])).toBe("note");
	});

	it("a linked-folder table's rows are notes in that folder", () => {
		const lf = parseRandomTable("---\nlinkedFolder: places\n---\n| Result | Weight |\n|---|---|\n| [[Highport]] | 1 |\n");
		expect(cellKind(lf, lf.entries[0], lookup)).toEqual({ kind: "note", value: "places/Highport" });
	});

	it("rowTypeProblems: cells that don't fit rows: are reported, never dropped", () => {
		const mixed = parseRandomTable("---\nrows: note\n---\n| Result | Weight |\n|---|---|\n| [[Highport]] | 1 |\n| loose text | 1 |\n| [[Mainworlds]] | 1 |\n");
		const p = rowTypeProblems(mixed, lookup);
		expect(p.map((x) => x.index)).toEqual([1]);
		expect(p[0].message).toMatch(/plain text.*rows are note/);
		expect(mixed.entries).toHaveLength(3);
		const terr = parseRandomTable("---\nrows: terrain\n---\n| Result | Weight |\n|---|---|\n| garden world | 1 |\n| crystal world | 1 |\n");
		expect(rowTypeProblems(terr, memoryLookup({}), { terrains: ["garden world"] }).map((x) => x.message)).toEqual([
			"Row 2 (\"crystal world\") isn't a terrain of the palette, but the table's rows are terrain.",
		]);
		expect(rowTypeProblems(parseRandomTable("| Result | Weight |\n|---|---|\n| a | 1 |\n"), lookup)).toEqual([]);
	});
});

describe("tableFitsWant (the seam for pickers)", () => {
	it("exact for a wanted rows:, any for rows: any (sorts after), no with a reason otherwise", () => {
		expect(tableFitsWant({ rows: "note" }, { rows: ["note"] })).toEqual({ fit: "exact" });
		expect(tableFitsWant({}, { rows: ["note"] })).toEqual({ fit: "any" });
		expect(tableFitsWant({ rows: "biome" }, { rows: ["note"] })).toEqual({ fit: "no", why: "its rows are biome, not note" });
		expect(tableFitsWant({ rows: "terrain", terrainTypes: ["star"] }, { rows: ["terrain"], terrainType: "star" }).fit).toBe("exact");
		expect(tableFitsWant({ rows: "terrain", terrainTypes: ["world"] }, { rows: ["terrain"], terrainType: "star" }).fit).toBe("no");
		expect(tableFitsWant({ rows: "terrain" }, { rows: ["terrain"], terrainType: "star" }).fit).toBe("exact");
	});
});
