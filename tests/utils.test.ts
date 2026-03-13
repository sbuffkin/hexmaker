import { describe, it, expect } from "vitest";
import { normalizeFolder, makeTableTemplate } from "../src/utils";

// ── normalizeFolder ───────────────────────────────────────────────────────────

describe("normalizeFolder", () => {
	it("returns empty string for empty input", () => {
		expect(normalizeFolder("")).toBe("");
	});

	it("strips a leading slash", () => {
		expect(normalizeFolder("/tables")).toBe("tables");
	});

	it("strips a trailing slash", () => {
		expect(normalizeFolder("tables/")).toBe("tables");
	});

	it("strips both leading and trailing slashes", () => {
		expect(normalizeFolder("/tables/")).toBe("tables");
	});

	it("strips multiple leading and trailing slashes", () => {
		expect(normalizeFolder("///tables///")).toBe("tables");
	});

	it("leaves interior slashes intact", () => {
		expect(normalizeFolder("world/tables")).toBe("world/tables");
	});

	it("returns empty string for a string that is only slashes", () => {
		expect(normalizeFolder("///")).toBe("");
	});

	it("does not modify a clean path", () => {
		expect(normalizeFolder("tables/terrain")).toBe("tables/terrain");
	});
});

// ── makeTableTemplate ─────────────────────────────────────────────────────────

describe("makeTableTemplate", () => {
	it("includes the dice value in frontmatter", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("dice: 6");
	});

	it("produces valid YAML frontmatter block", () => {
		const t = makeTableTemplate(4);
		expect(t).toMatch(/^---\n/);
		expect(t).toContain("\n---\n");
	});

	it("generates the default 3 example rows (A, B, C)", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("Example result A");
		expect(t).toContain("Example result B");
		expect(t).toContain("Example result C");
	});

	it("generates 1 example row when exampleRows=1", () => {
		const t = makeTableTemplate(6, 1);
		// Single-row form: "|  | 1 |"
		expect(t).toContain("|  | 1 |");
		expect(t).not.toContain("Example result A");
	});

	it("generates the correct number of example rows", () => {
		const t = makeTableTemplate(6, 5);
		expect(t).toContain("Example result E");
		expect(t).not.toContain("Example result F");
	});

	it("includes extra frontmatter fields when provided", () => {
		const t = makeTableTemplate(6, 3, { terrain: "forest", category: "monsters" });
		expect(t).toContain("terrain: forest");
		expect(t).toContain("category: monsters");
	});

	it("includes preamble between frontmatter and table", () => {
		const t = makeTableTemplate(6, 3, undefined, "[🎲 Open](obsidian://roll)");
		expect(t).toContain("[🎲 Open](obsidian://roll)");
		// preamble should appear before the markdown table header
		const preambleIdx = t.indexOf("[🎲 Open]");
		const tableIdx = t.indexOf("| Result |");
		expect(preambleIdx).toBeLessThan(tableIdx);
	});

	it("includes the Result/Weight table header", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("| Result | Weight |");
		expect(t).toContain("|--------|--------|");
	});

	it("dice: 0 still produces valid frontmatter", () => {
		const t = makeTableTemplate(0);
		expect(t).toContain("dice: 0");
	});
});
