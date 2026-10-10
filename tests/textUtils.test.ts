import { describe, it } from "node:test";
import expect from "expect";
import { escapeRegex, splitTableRow, escapeTableCell, fillPlaceholders, placeholderPattern } from "../src/textUtils";
import { fillTemplate } from "../src/export/exporters/workflow";
import { parseRandomTable, writeRollTable } from "../src/random-tables/randomTable";
import { parseWorkflow, buildWorkflowContent, type Workflow } from "../src/random-tables/workflow";

describe("escapeRegex", () => {
	it("matches special characters literally", () => {
		const name = "Hooks & Rumors (old?) [x] + $5";
		expect(new RegExp(`^${escapeRegex(name)}$`).test(name)).toBe(true);
		expect(new RegExp(`^${escapeRegex("a.b")}$`).test("axb")).toBe(false);
	});
});

describe("splitTableRow / escapeTableCell", () => {
	it("splits plain rows", () => {
		expect(splitTableRow("| a | 2 |")).toEqual(["a", "2"]);
		expect(splitTableRow("not a row")).toBeNull();
	});

	it("keeps escaped pipes and wiki-link aliases inside a cell", () => {
		expect(splitTableRow("| fish \\| chips | 3 |")).toEqual(["fish | chips", "3"]);
		expect(splitTableRow("| [[Goblin Camp|the camp]] | 1 |")).toEqual(["[[Goblin Camp|the camp]]", "1"]);
		expect(splitTableRow("| [[Goblin Camp\\|the camp]] | 1 |")).toEqual(["[[Goblin Camp|the camp]]", "1"]);
	});

	it("escaping round-trips and is idempotent", () => {
		const text = "a | b | c";
		const cell = escapeTableCell(text);
		expect(cell).toBe("a \\| b \\| c");
		expect(escapeTableCell(cell)).toBe(cell);
		expect(splitTableRow(`| ${cell} | 1 |`)).toEqual([text, "1"]);
	});
});

describe("fillPlaceholders", () => {
	it("doesn't match a placeholder inside a longer one", () => {
		const values = new Map<string, string>();
		for (let i = 1; i <= 12; i++) values.set(`$x_${i}`, `v${i}`);
		expect(fillPlaceholders("$x_1 $x_10 $x_12", values)).toBe("v1 v10 v12");
		expect(fillPlaceholders("$Loot / $Loot_extra", new Map([["$Loot", "gold"], ["$Loot_extra", "gem"]]))).toBe("gold / gem");
		expect(fillPlaceholders("$Loot_extra", new Map([["$Loot", "gold"]]))).toBe("$Loot_extra");
	});

	it("inserts values literally and never re-fills them", () => {
		const values = new Map([["$a", "$& and $1 cost $5"], ["$b", "$a"]]);
		expect(fillPlaceholders("$a | $b", values)).toBe("$& and $1 cost $5 | $a");
	});

	it("placeholderPattern stops at the token boundary", () => {
		const re = new RegExp(placeholderPattern("$x_1"), "g");
		expect("$x_1 $x_10 $x_1.".replace(re, "Y")).toBe("Y $x_10 Y.");
	});
});

describe("workflow templates (regressions)", () => {
	const wf = (steps: Workflow["steps"]): Workflow => ({ name: "t", steps });

	it("fills $x_1 … $x_12 without $x_1 eating into $x_10", () => {
		const w = wf([{ kind: "table", tablePath: "t", rolls: 12, label: "x" }]);
		const rolls = [Array.from({ length: 12 }, (_, i) => `r${i + 1}`)];
		const template = Array.from({ length: 12 }, (_, i) => `$x_${i + 1}`).join(",");
		expect(fillTemplate(template, w, rolls)).toBe(rolls[0].join(","));
	});

	it("keeps $Loot and $Loot_extra apart", () => {
		const w = wf([
			{ kind: "table", tablePath: "a", rolls: 1, label: "Loot" },
			{ kind: "table", tablePath: "b", rolls: 1, label: "Loot_extra" },
		]);
		expect(fillTemplate("$Loot then $Loot_extra", w, [["coins"], ["a ring"]])).toBe("coins then a ring");
	});

	it("keeps dollar signs in rolled results", () => {
		const w = wf([{ kind: "table", tablePath: "a", rolls: 1, label: "price" }]);
		expect(fillTemplate("Costs $price.", w, [["$5 ($& off)"]])).toBe("Costs $5 ($& off).");
	});
});

describe("tables with pipes (regressions)", () => {
	it("random table results may contain escaped pipes and aliased links", () => {
		const t = parseRandomTable(
			["---", "dice: 6", "---", "", "| Result | Weight |", "|---|---|", "| fish \\| chips | 2 |", "| [[Goblin Camp\\|the camp]] | 1 |", ""].join("\n"),
		);
		expect(t.entries).toEqual([
			{ result: "fish | chips", weight: 2 },
			{ result: "Goblin Camp", weight: 1, isLink: true },
		]);
	});

	it("adding roll ranges keeps escaped pipes and aliases byte for byte", () => {
		const content = ["---", "dice: 6", "---", "", "| Result | Weight |", "|---|---|", "| fish \\| chips | 2 |", "| [[Goblin Camp\\|the camp]] | 1 |", ""].join("\n");
		const t = parseRandomTable(content);
		const out = writeRollTable(content, { dice: 6, rows: t.entries.map((entry, source) => ({ entry, source })), ranges: "keep" });
		expect(out).toContain("| 1–4 | fish \\| chips | 2 |\n| 5–6 | [[Goblin Camp\\|the camp]] | 1 |");
		expect(parseRandomTable(out).entries.map((e) => e.result)).toEqual(["fish | chips", "Goblin Camp"]);
	});

	it("workflow labels with pipes survive save and load", () => {
		const w: Workflow = { name: "w", steps: [{ kind: "table", tablePath: "loot", rolls: 2, label: "gold | gems" }] };
		const back = parseWorkflow(buildWorkflowContent(w), "w");
		expect(back.steps).toEqual([{ kind: "table", tablePath: "loot", rolls: 2, label: "gold | gems" }]);
	});
});
