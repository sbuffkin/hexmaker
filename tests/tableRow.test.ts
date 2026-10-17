/**
 * src/md/tableRow.ts replaced six copies of `splitRow` (mapNote,
 * biomeNote, biomePool, paletteNote, pathTypeTable, worldTypes). This
 * golden test holds the shared split to the two originals, kept here
 * verbatim, over every table line in the fixtures and the shipped notes
 * plus hand-made edge cases.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEPARATOR_ROW, splitLinkRow, splitPipedRow, splitRow } from "../src/md/tableRow";
import { splitTableRow } from "../src/textUtils";
import { parseWorkflow } from "../src/random-tables/workflow";
import { readSource } from "./helpers/source";

/** The original in mapNote, biomeNote, paletteNote and pathTypeTable. */
function plainOriginal(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const cells: string[] = [];
	let cur = "";
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
		else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; }
		else cur += s[i];
	}
	cells.push(cur.trim());
	return cells;
}

/** The original in biomePool and worldTypes (a `|` inside [[link|alias]] belongs to the link). */
function linkOriginal(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const cells: string[] = [];
	let cur = "";
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "[" && s[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
		if (s[i] === "]" && s[i + 1] === "]" && depth) { depth--; cur += "]]"; i++; continue; }
		if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
		else if (s[i] === "|" && !depth) { cells.push(cur.trim()); cur = ""; }
		else cur += s[i];
	}
	cells.push(cur.trim());
	return cells;
}

function mdFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) mdFiles(p, out);
		else if (name.endsWith(".md")) out.push(p);
	}
	return out;
}

const EDGE = [
	"",
	"|",
	"||",
	"| a |",
	"a | b",
	"| a | b |",
	"|a|b|c|",
	"  | a | b |  ",
	"| a \\| b | c |",
	"| a | b \\|",
	"| a | b \\|\\|",
	"| [[Note|Alias]] | 2 |",
	"| [[Note\\|Alias]] | 2 |",
	"| [[a]] | [[b|c]] | [[d|e|f]] |",
	"| [[unclosed|x | y |",
	"| ]] | [[x]]] | y |",
	"| [[[x|y]]] | z |",
	"| :--- | :---: | ---: |",
	"|===|===|",
	"| a |\t b\t|",
	"| a | | | b |",
	"| \\ | \\\\| x |",
	"| café | — | ✓ |",
];

const corpus = (() => {
	const lines = new Set(EDGE);
	for (const root of ["tests/fixtures", "src"]) {
		for (const f of mdFiles(root)) {
			for (const line of readFileSync(f, "utf8").split(/\r?\n/)) if (line.includes("|")) lines.add(line);
		}
	}
	return [...lines];
})();

describe("splitRow (src/md/tableRow.ts)", () => {
	it("has a real corpus", () => {
		expect(corpus.length).toBeGreaterThan(500);
		expect(corpus.some((l) => /\[\[[^\]]*\|/.test(l))).toBe(true);
	});

	it("splits every line as the plain original did", () => {
		const diff = corpus.filter((l) => JSON.stringify(splitRow(l)) !== JSON.stringify(plainOriginal(l)));
		expect(diff).toEqual([]);
	});

	it("with wikiLinks, splits every line as the link-aware original did", () => {
		const diff = corpus.filter((l) => JSON.stringify(splitLinkRow(l)) !== JSON.stringify(linkOriginal(l)));
		expect(diff).toEqual([]);
		expect(corpus.filter((l) => JSON.stringify(splitRow(l, { wikiLinks: true })) !== JSON.stringify(linkOriginal(l)))).toEqual([]);
	});

	it("examples", () => {
		expect(splitRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
		expect(splitRow("| [[Note|Alias]] | 2 |")).toEqual(["[[Note", "Alias]]", "2"]);
		expect(splitLinkRow("| [[Note|Alias]] | 2 |")).toEqual(["[[Note|Alias]]", "2"]);
		expect(splitRow("| a | b \\|")).toEqual(["a", "b |"]);
	});
});

/** The original textUtils.splitTableRow (workflow steps tables), verbatim. */
function pipedOriginal(line: string): string[] | null {
	const s = line.trim();
	if (!s.startsWith("|")) return null;
	const cells: string[] = [];
	let cur = "";
	let linkDepth = 0;
	for (let i = 1; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
		else if (ch === "[" && s[i + 1] === "[") { linkDepth++; cur += "[["; i++; }
		else if (ch === "]" && s[i + 1] === "]" && linkDepth > 0) { linkDepth--; cur += "]]"; i++; }
		else if (ch === "|" && linkDepth === 0) { cells.push(cur.trim()); cur = ""; }
		else cur += ch;
	}
	if (cur.trim()) cells.push(cur.trim());
	return cells;
}

describe("one table-row splitter: splitPipedRow (was textUtils.splitTableRow)", () => {
	const REAL_SHAPED = [
		"| Table | Rolls | Label | Die | Fills |",
		"| --- | --- | --- | --- | --- |",
		"| [[world/tables/Weather]] | 1 | Weather | d6 | $Weather |",
		"| [[world/tables/Loot|Loot]] | 2 | Loot | d20 | $Loot_1, $Loot_2 |",
		"| [[Weather]] | 1 | Weather |\r",
		"  | [[Weather]] | 1 | Weather |  \r",
		"| [[Weather]] | 1 | Weather",
		"| [[Weather]] | 1 | |",
		"| [[Weather]] | | | |",
		"| [[Weather]] | 1 | Fish \\| chips |",
		"[[Weather]] | 1 | Weather",
		"Weather",
		"",
	];

	it("splits every corpus line as the original did, but for an unclosed [[link before the closing pipe and a lone pipe", () => {
		const diff = [...corpus, ...REAL_SHAPED].filter((l) => JSON.stringify(splitPipedRow(l)) !== JSON.stringify(pipedOriginal(l)));
		expect(diff.filter((l) => !(l.trim() === "|" || /\[\[(?:(?!\]\]).)*\|\s*$/.test(l.trim())))).toEqual([]);
	});

	it("pins the real-shaped rows (CRLF, missing outer pipes, empty trailing cells)", () => {
		const got = REAL_SHAPED.map((l) => splitPipedRow(l));
		expect(got).toEqual([
			["Table", "Rolls", "Label", "Die", "Fills"],
			["---", "---", "---", "---", "---"],
			["[[world/tables/Weather]]", "1", "Weather", "d6", "$Weather"],
			["[[world/tables/Loot|Loot]]", "2", "Loot", "d20", "$Loot_1, $Loot_2"],
			["[[Weather]]", "1", "Weather"],
			["[[Weather]]", "1", "Weather"],
			["[[Weather]]", "1", "Weather"],
			["[[Weather]]", "1", ""],
			["[[Weather]]", "", "", ""],
			["[[Weather]]", "1", "Fish | chips"],
			null,
			null,
			null,
		]);
		expect(REAL_SHAPED.map((l) => pipedOriginal(l))).toEqual(got);
	});

	it("the two changed edge cases, on purpose", () => {
		expect(pipedOriginal("|")).toEqual([]);
		expect(splitPipedRow("|")).toEqual([]);
		// An unfinished link before the row's closing pipe: the pipe ends the row now.
		expect(pipedOriginal("| [[unclosed|x |")).toEqual(["[[unclosed|x |"]);
		expect(splitPipedRow("| [[unclosed|x |")).toEqual(["[[unclosed|x"]);
	});

	it("textUtils.splitTableRow is the same function", () => {
		expect(splitTableRow).toBe(splitPipedRow);
	});

	it("a workflow note reads the same", () => {
		const note = "---\r\nresults-folder: world/results\r\n---\r\n| Table | Rolls | Label |\r\n| --- | --- | --- |\r\n| [[world/tables/Weather|Weather]] | 2 | Sky |\r\n| [[Loot]] | 1 | |\r\n";
		const wf = parseWorkflow(note, "w");
		expect(wf.steps.map((st) => [st.tablePath, st.rolls, st.label])).toEqual([["world/tables/Weather", 2, "Sky"], ["Loot", 1, undefined]]);
	});
});

describe("one separator row and one regex escaper", () => {
	it("SEPARATOR_ROW reads the usual separators and nothing else", () => {
		for (const ok of ["| --- | --- |", "|---|:-:|", "--- | ---", "| - |", "  | :--- | ---: |  "]) expect({ ok, m: SEPARATOR_ROW.test(ok) }).toEqual({ ok, m: true });
		for (const no of ["| a | b |", "|===|===|", "| -- x |", "", "|  |"]) expect({ no, m: SEPARATOR_ROW.test(no) }).toEqual({ no, m: false });
	});

	it("the note parsers share it instead of keeping copies", () => {
		for (const f of ["src/space/worldTypes.ts", "src/overworld/biomePool.ts", "src/palettes/paletteNote.ts", "src/overworld/biomeNote.ts", "src/palettes/pathTypeTable.ts"]) {
			const text = readSource(f);
			expect({ f, own: /const SEPARATOR_ROW\s*=/.test(text) }).toEqual({ f, own: false });
			expect({ f, imports: /import \{[^}]*\bSEPARATOR_ROW\b[^}]*\} from "\.\.\/md\/tableRow"/.test(text) }).toEqual({ f, imports: true });
		}
	});

	it("the regex escape is written once (textUtils.escapeRegex)", () => {
		const inline = ".replace(/[.*+?^${}()|[\\]\\\\]/g";
		for (const f of ["src/provenance.ts", "src/sections.ts", "src/notes/frontmatterText.ts", "src/packs/packKinds.ts", "src/packs/packPalettes.ts", "src/textUtils.ts"]) {
			const n = readSource(f).split(inline).length - 1;
			expect({ f, n }).toEqual({ f, n: f === "src/textUtils.ts" ? 1 : 0 });
		}
	});
});
