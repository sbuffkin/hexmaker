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
import { splitLinkRow, splitRow } from "../src/md/tableRow";

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
