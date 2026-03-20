import { describe, it, expect } from "vitest";
import {
	parseRandomTable,
	rollOnTable,
	getOddsLabel,
	getDieRanges,
	setDiceInFrontmatter,
	extractPostTableContent,
} from "../src/random-tables/randomTable";

// ── parseRandomTable ──────────────────────────────────────────────────────────

describe("parseRandomTable", () => {
	it("returns empty entries for empty content", () => {
		const result = parseRandomTable("");
		expect(result.dice).toBe(0);
		expect(result.entries).toEqual([]);
	});

	it("parses a basic table with equal weights", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| Alpha | 1 |\n| Beta | 1 |\n| Gamma | 1 |`;
		const result = parseRandomTable(content);
		expect(result.entries).toHaveLength(3);
		expect(result.entries[0]).toEqual({ result: "Alpha", weight: 1 });
		expect(result.entries[2]).toEqual({ result: "Gamma", weight: 1 });
	});

	it("reads dice value from YAML frontmatter", () => {
		const content = `---\ndice: 20\n---\n\n| Result | Weight |\n|--------|--------|\n| A | 1 |`;
		const result = parseRandomTable(content);
		expect(result.dice).toBe(20);
		expect(result.entries).toHaveLength(1);
	});

	it("defaults dice to 0 when not in frontmatter", () => {
		const content = `---\nsome: value\n---\n\n| Result | Weight |\n|--------|--------|\n| A | 1 |`;
		expect(parseRandomTable(content).dice).toBe(0);
	});

	it("parses varying weights correctly", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| Common | 4 |\n| Rare | 1 |`;
		const result = parseRandomTable(content);
		expect(result.entries[0].weight).toBe(4);
		expect(result.entries[1].weight).toBe(1);
	});

	it("defaults missing weight to 1", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| NoWeight |  |`;
		const result = parseRandomTable(content);
		expect(result.entries[0].weight).toBe(1);
	});

	it("clamps invalid weight (0 or NaN) to 1", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| Bad | 0 |\n| NaN | abc |`;
		const result = parseRandomTable(content);
		expect(result.entries[0].weight).toBe(1);
		expect(result.entries[1].weight).toBe(1);
	});

	it("skips separator rows", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| Only | 1 |`;
		const result = parseRandomTable(content);
		expect(result.entries).toHaveLength(1);
	});

	it("skips empty result cells", () => {
		const content = `| Result | Weight |\n|--------|--------|\n|  | 1 |\n| Valid | 2 |`;
		const result = parseRandomTable(content);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].result).toBe("Valid");
	});

	it("stops parsing after table ends", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| A | 1 |\n\nSome text\n\n| Other | Weight |\n|-------|--------|\n| B | 1 |`;
		const result = parseRandomTable(content);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].result).toBe("A");
	});

	it("handles content with only frontmatter and no table", () => {
		const content = `---\ndice: 6\n---\n\nJust some prose.`;
		const result = parseRandomTable(content);
		expect(result.dice).toBe(6);
		expect(result.entries).toHaveLength(0);
	});

	it("parses linked-folder from frontmatter", () => {
		const content = `---\ndice: 6\nlinked-folder: world/towns\n---\n\n| Result | Weight |\n|--------|--------|\n| A | 1 |`;
		expect(parseRandomTable(content).linkedFolder).toBe("world/towns");
	});

	it("leaves linkedFolder undefined when not in frontmatter", () => {
		const content = `---\ndice: 6\n---\n\n| Result | Weight |\n|--------|--------|\n| A | 1 |`;
		expect(parseRandomTable(content).linkedFolder).toBeUndefined();
	});

	it("trims whitespace from linked-folder value", () => {
		const content = `---\ndice: 6\nlinked-folder:   world/towns  \n---`;
		expect(parseRandomTable(content).linkedFolder).toBe("world/towns");
	});

	it("leaves linkedFolder undefined when there is no frontmatter block", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| A | 1 |`;
		expect(parseRandomTable(content).linkedFolder).toBeUndefined();
	});

	it("strips wiki-link syntax from result cells", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| [[Riverdale]] | 1 |\n| [[path/to/Town]] | 2 |`;
		const result = parseRandomTable(content);
		expect(result.entries[0].result).toBe("Riverdale");
		expect(result.entries[1].result).toBe("path/to/Town");
	});

	it("sets isLink=true for wiki-link cells in a non-linked-folder table", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| [[world/towns/Millhaven]] | 1 |\n| Plain | 1 |`;
		const result = parseRandomTable(content);
		expect(result.entries[0].isLink).toBe(true);
		expect(result.entries[1].isLink).toBeUndefined();
	});

	it("does not set isLink for wiki-link cells when linkedFolder is present", () => {
		const content = `---\ndice: 6\nlinked-folder: world/towns\n---\n\n| Result | Weight |\n|--------|--------|\n| [[Millhaven]] | 1 |`;
		const result = parseRandomTable(content);
		expect(result.entries[0].isLink).toBeUndefined();
	});

	it("leaves plain result cells unchanged", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| Plain text | 1 |`;
		expect(parseRandomTable(content).entries[0].result).toBe("Plain text");
	});
});

// ── rollOnTable ───────────────────────────────────────────────────────────────

describe("rollOnTable", () => {
	it("returns null for empty table", () => {
		expect(rollOnTable({ dice: 6, entries: [] })).toBeNull();
	});

	it("always returns the only entry in a single-entry table", () => {
		const entry = { result: "Solo", weight: 1 };
		for (let i = 0; i < 20; i++) {
			expect(rollOnTable({ dice: 0, entries: [entry] })).toBe(entry);
		}
	});

	it("always returns an entry from the table", () => {
		const table = {
			dice: 6,
			entries: [
				{ result: "A", weight: 1 },
				{ result: "B", weight: 2 },
				{ result: "C", weight: 3 },
			],
		};
		for (let i = 0; i < 100; i++) {
			const result = rollOnTable(table);
			expect(result).not.toBeNull();
			expect(table.entries).toContain(result);
		}
	});

	it("respects weighting in distribution (heavy entry rolled more)", () => {
		const light = { result: "Light", weight: 1 };
		const heavy = { result: "Heavy", weight: 99 };
		const table = { dice: 0, entries: [light, heavy] };
		const counts = { Light: 0, Heavy: 0 };
		for (let i = 0; i < 1000; i++) {
			const r = rollOnTable(table);
			if (r) counts[r.result as "Light" | "Heavy"]++;
		}
		expect(counts.Heavy).toBeGreaterThan(counts.Light);
	});
});

// ── getOddsLabel ──────────────────────────────────────────────────────────────

describe("getOddsLabel", () => {
	it("returns percentage when dice is 0", () => {
		const table = { dice: 0, entries: [{ result: "A", weight: 1 }, { result: "B", weight: 3 }] };
		expect(getOddsLabel(table.entries[0], table)).toBe("25%");
		expect(getOddsLabel(table.entries[1], table)).toBe("75%");
	});

	it("returns '–' when total weight is 0", () => {
		const entry = { result: "A", weight: 0 };
		const table = { dice: 0, entries: [entry] };
		// weight is clamped to 1 by parseRandomTable but getOddsLabel works on raw entries
		// Force total = 0 by manipulating directly
		const zeroTable = { dice: 0, entries: [{ result: "A", weight: 0 }] };
		// total will be 0
		expect(getOddsLabel(zeroTable.entries[0], zeroTable)).toBe("–");
	});

	it("returns empty string when dice > 0 (caller uses getDieRanges)", () => {
		const table = { dice: 6, entries: [{ result: "A", weight: 1 }] };
		expect(getOddsLabel(table.entries[0], table)).toBe("");
	});
});

// ── getDieRanges ──────────────────────────────────────────────────────────────

describe("getDieRanges", () => {
	it("returns empty array for empty table", () => {
		expect(getDieRanges({ dice: 6, entries: [] })).toEqual([]);
	});

	it("d6 with 3 equal-weight entries gives 2 faces each", () => {
		const table = {
			dice: 6,
			entries: [
				{ result: "A", weight: 1 },
				{ result: "B", weight: 1 },
				{ result: "C", weight: 1 },
			],
		};
		expect(getDieRanges(table)).toEqual(["1–2", "3–4", "5–6"]);
	});

	it("d6 with single entry spans the full die", () => {
		const table = { dice: 6, entries: [{ result: "Only", weight: 1 }] };
		expect(getDieRanges(table)).toEqual(["1–6"]);
	});

	it("allocates single faces to light entries and larger ranges to heavy ones", () => {
		const table = {
			dice: 6,
			entries: [
				{ result: "Common", weight: 5 },
				{ result: "Rare", weight: 1 },
			],
		};
		const ranges = getDieRanges(table);
		expect(ranges).toHaveLength(2);
		// Common gets 5 faces (1–5), Rare gets 1 face (6)
		expect(ranges[0]).toBe("1–5");
		expect(ranges[1]).toBe("6");
	});

	it("total faces used always equals dice value", () => {
		const table = {
			dice: 20,
			entries: [
				{ result: "A", weight: 3 },
				{ result: "B", weight: 7 },
				{ result: "C", weight: 10 },
			],
		};
		const ranges = getDieRanges(table);
		// Parse end of last range to verify all 20 faces accounted for
		const lastRange = ranges[ranges.length - 1];
		const lastFace = parseInt(lastRange.includes("–") ? lastRange.split("–")[1] : lastRange);
		expect(lastFace).toBe(20);
	});

	it("returns single numbers (not ranges) for 1-face allocations", () => {
		const table = {
			dice: 2,
			entries: [
				{ result: "A", weight: 1 },
				{ result: "B", weight: 1 },
			],
		};
		const ranges = getDieRanges(table);
		expect(ranges).toEqual(["1", "2"]);
	});
});

// ── setDiceInFrontmatter ──────────────────────────────────────────────────────

describe("setDiceInFrontmatter", () => {
	it("adds dice to existing frontmatter that lacks it", () => {
		const content = `---\nsome: value\n---\n\nContent`;
		const result = setDiceInFrontmatter(content, 6);
		expect(result).toContain("dice: 6");
		expect(result).toContain("some: value");
	});

	it("updates existing dice value", () => {
		const content = `---\ndice: 6\n---\n\nContent`;
		const result = setDiceInFrontmatter(content, 20);
		expect(result).toContain("dice: 20");
		expect(result).not.toContain("dice: 6");
	});

	it("removes dice line when dice is 0 and field existed", () => {
		const content = `---\ndice: 6\n---\n\nContent`;
		const result = setDiceInFrontmatter(content, 0);
		expect(result).not.toContain("dice:");
		expect(result).toContain("---");
	});

	it("creates frontmatter when none exists", () => {
		const content = `No frontmatter here.`;
		const result = setDiceInFrontmatter(content, 12);
		expect(result).toMatch(/^---\ndice: 12\n---/);
		expect(result).toContain("No frontmatter here.");
	});

	it("leaves content unchanged when dice is 0 and no frontmatter exists", () => {
		const content = `No frontmatter.`;
		const result = setDiceInFrontmatter(content, 0);
		expect(result).toBe(content);
	});

	it("preserves content after frontmatter", () => {
		const content = `---\ndice: 4\n---\n\n| Result | Weight |\n|--------|--------|\n| A | 1 |`;
		const result = setDiceInFrontmatter(content, 8);
		expect(result).toContain("| Result | Weight |");
		expect(result).toContain("| A | 1 |");
	});
});


// ── extractPostTableContent ───────────────────────────────────────────────────

describe("extractPostTableContent", () => {
	it("returns empty string when nothing follows the table", () => {
		const content = `---\ndice: 6\n---\n\n| Result | Weight |\n|--------|--------|\n| a | 1 |\n`;
		expect(extractPostTableContent(content)).toBe("");
	});

	it("returns content after the last table row", () => {
		const content = `| Result | Weight |\n|--------|--------|\n| a | 1 |\n\n## Notes\n\nSome extra text.\n`;
		expect(extractPostTableContent(content)).toBe("## Notes\n\nSome extra text.\n");
	});

	it("returns empty string when no table present", () => {
		expect(extractPostTableContent("No table here.")).toBe("");
	});
});
