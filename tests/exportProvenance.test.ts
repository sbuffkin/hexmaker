import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { exportedMessage, withExportProvenance } from "../src/export/exportFolder";
import { formatRandomTableMarkdown } from "../src/export/exporters/randomTable";
import { parseRandomTable } from "../src/random-tables/randomTable";
import { serializeMarkdown } from "../src/export/mdSerializer";

const WHEN = new Date(2026, 9, 10, 14, 3, 0);

describe("export provenance (X1)", () => {
	it("records the source, the time and the kind", () => {
		const out = withExportProvenance("# 1_2\n\nBody\n", "world/hexes/coast/1_2.md", "hex", WHEN);
		expect(out).toBe(
			'---\nexported-from: "[[world/hexes/coast/1_2]]"\nexported: 2026-10-10T14:03:00\nhexmaker-export: hex\n---\n# 1_2\n\nBody\n',
		);
	});

	it("says Replaced when an export overwrote an earlier one", () => {
		expect(exportedMessage("world/exports/1_2.md", true)).toBe("Replaced world/exports/1_2.md");
		expect(exportedMessage("world/exports/1_2.md", false)).toBe("Exported to world/exports/1_2.md");
	});

	it("each markdown exporter writes it and reports Replaced", () => {
		for (const [file, kind] of [["singleNote", "note"], ["singleHex", "hex"], ["randomTable", "table"], ["workflow", "workflow"]]) {
			const src = readFileSync(`src/export/exporters/${file}.ts`, "utf8");
			expect(src).toContain(`withExportProvenance(finalMd, `);
			expect(src).toContain(`"${kind}")`);
			expect(src).not.toContain("Exported to ${outPath}");
			expect(src.match(/exportedMessage\(outPath, replaced\)/g)?.length).toBe(2);
		}
	});

	it("an exported table still reads as a table", () => {
		const table = { dice: 6, entries: [{ result: "Wolves", weight: 2 }, { result: "Bandits", weight: 1 }] };
		const md = withExportProvenance(serializeMarkdown(formatRandomTableMarkdown("animals", table), { wikilinks: "preserve" }), "world/tables/animals.md", "table", WHEN);
		const back = parseRandomTable(md);
		expect(back.entries.map((e) => e.result)).toEqual(["Wolves", "Bandits"]);
	});
});
