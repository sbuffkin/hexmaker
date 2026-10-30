/**
 * The legacy table corpus as read by the parser before the phase 0 format
 * extensions (plan-tables-everywhere): `npx tsx … tests/fixtures/tables/golden.ts`
 * regenerates golden.json. tests/tableGolden.test.ts checks every table
 * still reads, rolls and rewrites exactly the same. Only regenerate on purpose.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRandomTableWithReport, rollTable, writeRollTable, resolveTable } from "../../../src/random-tables/randomTable";

export const CORPUS_DIRS = ["tests/fixtures/tables", "tests/fixtures/sim-vault/tables", "tests/fixtures"];
export const EXTRA_FILES = ["tests/fixtures/compat/legacy-table-1.5.6.md"];

export function corpus(root: string): { name: string; content: string }[] {
	const out: { name: string; content: string }[] = [];
	for (const dir of CORPUS_DIRS) {
		for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith(".md")).sort()) {
			const content = readFileSync(join(root, dir, f), "utf8").replace(/\r\n/g, "\n");
			if (dir === "tests/fixtures" && !/table/.test(f)) continue;
			out.push({ name: `${dir}/${f}`, content });
		}
	}
	for (const f of EXTRA_FILES) out.push({ name: f, content: readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n") });
	// Every table again with CRLF line ends.
	return [...out, ...out.map((c) => ({ name: `${c.name} (crlf)`, content: c.content.replace(/\n/g, "\r\n") }))];
}

/** What the old parser said about one note: the legacy fields only. */
export function snapshot(content: string): unknown {
	const { table, issues } = parseRandomTableWithReport(content);
	const seq = [0.01, 0.2, 0.37, 0.5, 0.66, 0.81, 0.99];
	return {
		table: {
			dice: table.dice,
			linkedFolder: table.linkedFolder ?? null,
			description: table.description ?? null,
			entries: table.entries.map((e) => ({ result: e.result, weight: e.weight, isLink: e.isLink ?? false, range: e.range ?? null })),
		},
		issues: issues.map((i) => ({ code: i.code, row: i.row ?? null })),
		mode: resolveTable(table).mode,
		rolls: seq.map((u) => rollTable(table, () => u)?.index ?? null),
		rewrite: writeRollTable(content, { dice: table.dice, rows: table.entries.map((entry, source) => ({ entry, source })), ranges: "keep" }),
	};
}

if (process.argv[1]?.endsWith("golden.ts")) {
	const root = process.cwd();
	const out: Record<string, unknown> = {};
	for (const c of corpus(root)) out[c.name] = snapshot(c.content);
	writeFileSync(join(root, "tests/fixtures/tables/golden.json"), JSON.stringify(out, null, 1) + "\n");
	console.log(`wrote ${Object.keys(out).length} tables`);
}
