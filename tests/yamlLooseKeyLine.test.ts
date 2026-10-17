import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { keyLine, parseYamlLoose, toJs, withoutComment, yamlBlocks } from "../src/maps/yamlLoose";
import * as ref from "./fixtures/compat/yaml-loose/yamlLoose-regex";
import { parseMapNote } from "../src/maps/mapNote";

/** The regexes the linear code replaced (security review #5), as the reference. */
const OLD_KEY_LINE = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:"'][^:]*?)\s*:(?:\s+(.*?))?\s*$/;
const oldKeyLine = (l: string) => {
	const m = OLD_KEY_LINE.exec(l);
	return m ? { key: m[1], rest: m[2] } : null;
};
const oldWithoutComment = (t: string) => t.replace(/\s+#\s.*$/, "");

/** A tiny seeded random (mulberry32) so a failure reproduces. */
function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const ALPHABET = ["a", "b", "k", " ", " ", "\t", ":", ":", "#", '"', "'", "\\", "\r", " ", "-", "[", "1", "."];
function randomLine(r: () => number, max: number): string {
	let s = "";
	const n = Math.floor(r() * max);
	for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
	return s;
}

const frontmatterOf = (text: string) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
function mdFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = path.join(dir, f);
		return statSync(p).isDirectory() ? mdFiles(p) : p.endsWith(".md") ? [p] : [];
	});
}
const toPlain = (r: { blocks: unknown; values: Map<string, unknown> }) => ({ blocks: r.blocks, values: [...r.values].map(([k, v]) => [k, toJs(v as never), v]) });

describe("loose YAML: linear-time key lines (security #5)", () => {
	it("keyLine matches exactly what the old regex matched (seeded fuzz)", () => {
		const r = rng(5);
		for (let i = 0; i < 60000; i++) {
			const line = randomLine(r, 14);
			expect({ line, got: keyLine(line) }).toEqual({ line, got: oldKeyLine(line) });
		}
	});

	it("withoutComment matches the old comment regex (seeded fuzz)", () => {
		const r = rng(9);
		for (let i = 0; i < 60000; i++) {
			const t = randomLine(r, 14);
			expect({ t, got: withoutComment(t) }).toEqual({ t, got: oldWithoutComment(t) });
		}
	});

	it("normal keys still parse identically", () => {
		const cases: [string, { key: string; rest: string | undefined } | null][] = [
			["cols: 38", { key: "cols", rest: "38" }],
			["palette:", { key: "palette", rest: undefined }],
			["palette:   ", { key: "palette", rest: "" }],
			["  nested key  :  value  ", { key: "nested key", rest: "value" }],
			['"quoted: key": "v"', { key: '"quoted: key"', rest: '"v"' }],
			["'it''s': x", { key: "'it''s'", rest: "x" }],
			["url: https://example.com/a:b", { key: "url", rest: "https://example.com/a:b" }],
			["name: Thornwood #2", { key: "name", rest: "Thornwood #2" }],
			["map: \"[[_coast]]\"\r", { key: "map", rest: "\"[[_coast]]\"" }],
			["a:b", null],
			["# comment: no", null],
			["- item: x", { key: "- item", rest: "x" }],
			["just text", null],
		];
		for (const [line, want] of cases) {
			expect({ line, got: keyLine(line) }).toEqual({ line, got: want });
			expect({ line, got: keyLine(line) }).toEqual({ line, got: oldKeyLine(line) });
		}
	});

	it("a 400k-character line parses fast (it took over a minute)", () => {
		const N = 400_000;
		const lines = [
			"a".repeat(N),
			"a" + " ".repeat(N),
			"k" + " ".repeat(N) + "x",
			"k: x" + " ".repeat(N) + "y",
			"k: x" + " ".repeat(N) + "#y",
			"k: " + "1".repeat(N) + "x",
			"k: " + "1".repeat(N) + "." + "1".repeat(N) + "e",
			"'" + "''".repeat(N / 2),
			'"' + "\\a".repeat(N / 2),
		];
		for (const line of lines) {
			const t0 = Date.now();
			const out = parseYamlLoose(`cols: 4\n${line}\nrows: 3`);
			for (const v of out.values.values()) toJs(v);
			expect(out.values.get("cols")).toEqual({ t: "s", v: "4", q: false });
			expect(Date.now() - t0).toBeLessThan(500);
		}
		const t0 = Date.now();
		const d = parseMapNote(`---\nhexmaker-map: 6\ncols: 4\nrows: 3\nnote: x${" ".repeat(N)}y\n---\n# m\n`);
		expect(d!.settings.gridSize).toEqual({ cols: 4, rows: 3 });
		expect(Date.now() - t0).toBeLessThan(1500);
	});

	it("every frontmatter in the test fixtures reads exactly as before", () => {
		let n = 0;
		for (const file of mdFiles(path.join(__dirname, "fixtures"))) {
			const fm = frontmatterOf(readFileSync(file, "utf8"));
			if (fm === undefined) continue;
			n++;
			expect({ file, got: toPlain(parseYamlLoose(fm)) }).toEqual({ file, got: toPlain(ref.parseYamlLoose(fm)) });
		}
		expect(n).toBeGreaterThan(5);
	});

	it("random multi-line frontmatter reads exactly as before (seeded fuzz)", () => {
		const r = rng(13);
		const shapes = ["cols: 38", "  - a", "  - b: c", "key:", "  sub: 1", "  sub2: [x, \"y, z\"]", "list: [1, 2]", "m: {a: 1, b: 'q'}", "txt: |", "  line one", "# note", "", "name: Thornwood #2 # c"];
		for (let i = 0; i < 3000; i++) {
			const lines: string[] = [];
			const count = 1 + Math.floor(r() * 7);
			for (let j = 0; j < count; j++) lines.push(r() < 0.6 ? shapes[Math.floor(r() * shapes.length)] : randomLine(r, 12));
			const src = lines.join("\n");
			expect({ src, got: toPlain(parseYamlLoose(src)) }).toEqual({ src, got: toPlain(ref.parseYamlLoose(src)) });
			expect(yamlBlocks(src)).toEqual(ref.yamlBlocks(src));
		}
	});
});
