import { describe, it, expect, vi, afterEach } from "vitest";
import {
	isDiceFormula,
	rollDiceFormula,
	rollDiceFormulaWithBreakdown,
	parseWorkflow,
	buildWorkflowContent,
	stepVarName,
	stepPlaceholder,
	generateDefaultTemplate,
	requiredPlaceholders,
	type WorkflowStep,
	type Workflow,
} from "../src/random-tables/workflow";

// ── isDiceFormula ─────────────────────────────────────────────────────────────

describe("isDiceFormula", () => {
	it("accepts basic XdY format", () => {
		expect(isDiceFormula("2d6")).toBe(true);
		expect(isDiceFormula("1d20")).toBe(true);
		expect(isDiceFormula("4d8")).toBe(true);
	});

	it("accepts dY format (omitted die count)", () => {
		expect(isDiceFormula("d6")).toBe(true);
		expect(isDiceFormula("d20")).toBe(true);
	});

	it("accepts positive modifier", () => {
		expect(isDiceFormula("2d6+6")).toBe(true);
		expect(isDiceFormula("1d4+1")).toBe(true);
	});

	it("accepts negative modifier", () => {
		expect(isDiceFormula("2d6-3")).toBe(true);
		expect(isDiceFormula("d20-5")).toBe(true);
	});

	it("is case-insensitive (D vs d)", () => {
		expect(isDiceFormula("2D6")).toBe(true);
		expect(isDiceFormula("1D20+3")).toBe(true);
	});

	it("trims whitespace before checking", () => {
		expect(isDiceFormula("  2d6  ")).toBe(true);
	});

	it("rejects plain numbers", () => {
		expect(isDiceFormula("6")).toBe(false);
		expect(isDiceFormula("20")).toBe(false);
	});

	it("rejects table paths", () => {
		expect(isDiceFormula("world/tables/encounters")).toBe(false);
		expect(isDiceFormula("[[some/table]]")).toBe(false);
	});

	it("rejects malformed formulas", () => {
		expect(isDiceFormula("2d")).toBe(false);      // no die size
		expect(isDiceFormula("d")).toBe(false);       // no die size
		expect(isDiceFormula("2d6d8")).toBe(false);   // double d
		expect(isDiceFormula("abc")).toBe(false);
		expect(isDiceFormula("")).toBe(false);
	});

	it("rejects formulas with non-numeric modifiers", () => {
		expect(isDiceFormula("2d6+x")).toBe(false);
	});
});

// ── rollDiceFormula ───────────────────────────────────────────────────────────

describe("rollDiceFormula", () => {
	afterEach(() => vi.restoreAllMocks());

	it("returns 0 for invalid formula", () => {
		expect(rollDiceFormula("invalid")).toBe(0);
		expect(rollDiceFormula("")).toBe(0);
	});

	it("rolls a single die with mocked random", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // floor(0 * 6) + 1 = 1
		expect(rollDiceFormula("1d6")).toBe(1);
	});

	it("applies positive modifier", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 6 = 7
		expect(rollDiceFormula("1d6+6")).toBe(7);
	});

	it("applies negative modifier", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.999); // floor(0.999 * 6) + 1 = 6, 6-3 = 3
		expect(rollDiceFormula("1d6-3")).toBe(3);
	});

	it("sums multiple dice", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // each die = 1, 3 dice = 3
		expect(rollDiceFormula("3d6")).toBe(3);
	});

	it("omitted die count defaults to 1", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5); // floor(0.5 * 20) + 1 = 11
		expect(rollDiceFormula("d20")).toBe(11);
	});

	it("is case-insensitive", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		expect(rollDiceFormula("1D6")).toBe(1);
	});

	it("result is always within valid range for 1d6", () => {
		vi.restoreAllMocks();
		for (let i = 0; i < 100; i++) {
			const r = rollDiceFormula("1d6");
			expect(r).toBeGreaterThanOrEqual(1);
			expect(r).toBeLessThanOrEqual(6);
		}
	});
});

// ── rollDiceFormulaWithBreakdown ──────────────────────────────────────────────

describe("rollDiceFormulaWithBreakdown", () => {
	afterEach(() => vi.restoreAllMocks());

	it("returns '0' for invalid formula", () => {
		expect(rollDiceFormulaWithBreakdown("invalid")).toBe("0");
	});

	it("returns plain number for single die with no modifier", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // 1
		expect(rollDiceFormulaWithBreakdown("1d6")).toBe("1");
	});

	it("returns plain number for omitted-count single die with no modifier", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5); // floor(0.5*20)+1 = 11
		expect(rollDiceFormulaWithBreakdown("d20")).toBe("11");
	});

	it("returns breakdown for multiple dice", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // each die = 1
		expect(rollDiceFormulaWithBreakdown("2d6")).toBe("(1+1)=2");
	});

	it("includes positive modifier in expression", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // die = 1, total = 1+6 = 7
		expect(rollDiceFormulaWithBreakdown("1d6+6")).toBe("(1+6)=7");
	});

	it("includes negative modifier in expression without double sign", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.999); // floor(0.999*6)+1 = 6, 6-3=3
		expect(rollDiceFormulaWithBreakdown("1d6-3")).toBe("(6-3)=3");
	});

	it("handles multiple dice with modifier", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // each die = 1, total = 1+1+6=8
		expect(rollDiceFormulaWithBreakdown("2d6+6")).toBe("(1+1+6)=8");
	});

	it("breakdown total matches numeric rollDiceFormula result", () => {
		// Use a fixed random to compare both functions
		const randomVal = 0.4;
		vi.spyOn(Math, "random").mockReturnValue(randomVal);
		const numeric = rollDiceFormula("2d6+3");
		vi.spyOn(Math, "random").mockReturnValue(randomVal);
		const breakdown = rollDiceFormulaWithBreakdown("2d6+3");
		const extracted = parseInt(breakdown.replace(/.*=(-?\d+)$/, "$1"), 10);
		expect(extracted).toBe(numeric);
	});
});

// ── parseWorkflow ─────────────────────────────────────────────────────────────

const tableStep = (path: string, rolls = 1, label?: string): WorkflowStep => ({
	kind: "table",
	tablePath: path,
	rolls,
	label,
});

const diceStep = (formula: string, rolls = 1, label?: string): WorkflowStep => ({
	kind: "dice",
	tablePath: "",
	diceFormula: formula,
	rolls,
	label,
});

describe("parseWorkflow", () => {
	it("returns empty workflow for empty content", () => {
		const wf = parseWorkflow("", "test");
		expect(wf.name).toBe("test");
		expect(wf.steps).toEqual([]);
		expect(wf.resultsFolder).toBeUndefined();
		expect(wf.templateFile).toBeUndefined();
	});

	it("parses results-folder from frontmatter", () => {
		const content = `---\nresults-folder: world/results\n---\n\n| Table | Rolls | Label |\n|---|---|---|\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.resultsFolder).toBe("world/results");
	});

	it("parses template-file from frontmatter", () => {
		const content = `---\ntemplate-file: world/workflows/templates/test.md\n---\n\n| Table | Rolls | Label |\n|---|---|---|\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.templateFile).toBe("world/workflows/templates/test.md");
	});

	it("parses both frontmatter fields", () => {
		const content = `---\nresults-folder: world/results\ntemplate-file: world/workflows/templates/t.md\n---\n\n| Table | Rolls | Label |\n|---|---|---|\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.resultsFolder).toBe("world/results");
		expect(wf.templateFile).toBe("world/workflows/templates/t.md");
	});

	it("returns no steps when no table header found", () => {
		const content = `---\nresults-folder: x\n---\n\nSome text with no table.`;
		expect(parseWorkflow(content, "test").steps).toEqual([]);
	});

	it("parses a single table step", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| [[world/tables/encounters]] | 1 | Encounters |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps).toHaveLength(1);
		expect(wf.steps[0]).toEqual(tableStep("world/tables/encounters", 1, "Encounters"));
	});

	it("strips [[wikilink]] syntax from table cell", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| [[world/tables/my table]] | 1 |  |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps[0].tablePath).toBe("world/tables/my table");
		expect(wf.steps[0].kind).toBe("table");
	});

	it("parses a dice step", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| 2d6+6 | 1 | (2d6+6) |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps).toHaveLength(1);
		expect(wf.steps[0]).toEqual(diceStep("2d6+6", 1, "(2d6+6)"));
	});

	it("parses dice step with no label", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| d20 | 1 |  |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps[0].kind).toBe("dice");
		expect(wf.steps[0].diceFormula).toBe("d20");
		expect(wf.steps[0].label).toBeUndefined();
	});

	it("parses multiple rolls", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| [[world/tables/enc]] | 3 | enc |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps[0].rolls).toBe(3);
	});

	it("parses multiple steps", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| [[world/tables/a]] | 1 | A |\n| 2d6 | 2 | (2d6) |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps).toHaveLength(2);
		expect(wf.steps[0].kind).toBe("table");
		expect(wf.steps[1].kind).toBe("dice");
	});

	it("skips rows with missing or invalid roll count", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| [[world/tables/a]] | abc | A |\n| [[world/tables/b]] | 0 | B |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps).toHaveLength(0);
	});

	it("empty label becomes undefined", () => {
		const content = `| Table | Rolls | Label |\n|---|---|---|\n| [[world/tables/enc]] | 1 |  |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps[0].label).toBeUndefined();
	});

	it("is case-insensitive for table header", () => {
		const content = `| TABLE | ROLLS | LABEL |\n|---|---|---|\n| [[world/tables/enc]] | 1 | enc |\n`;
		const wf = parseWorkflow(content, "test");
		expect(wf.steps).toHaveLength(1);
	});
});

// ── buildWorkflowContent ──────────────────────────────────────────────────────

describe("buildWorkflowContent", () => {
	it("produces minimal valid output with no steps", () => {
		const wf: Workflow = { name: "test", steps: [] };
		const out = buildWorkflowContent(wf);
		expect(out).toContain("---\n---");
		expect(out).toContain("| Table | Rolls | Label |");
	});

	it("includes results-folder in frontmatter when set", () => {
		const wf: Workflow = { name: "t", resultsFolder: "world/results", steps: [] };
		expect(buildWorkflowContent(wf)).toContain("results-folder: world/results");
	});

	it("includes template-file in frontmatter when set", () => {
		const wf: Workflow = { name: "t", templateFile: "world/workflows/templates/t.md", steps: [] };
		expect(buildWorkflowContent(wf)).toContain("template-file: world/workflows/templates/t.md");
	});

	it("omits optional frontmatter fields when absent", () => {
		const wf: Workflow = { name: "t", steps: [] };
		const out = buildWorkflowContent(wf);
		expect(out).not.toContain("results-folder");
		expect(out).not.toContain("template-file");
	});

	it("serializes table step with wikilink", () => {
		const wf: Workflow = { name: "t", steps: [tableStep("world/tables/enc", 1, "Encounters")] };
		expect(buildWorkflowContent(wf)).toContain("| [[world/tables/enc]] | 1 | Encounters |");
	});

	it("serializes dice step without wikilink brackets", () => {
		const wf: Workflow = { name: "t", steps: [diceStep("2d6+6", 1, "(2d6+6)")] };
		expect(buildWorkflowContent(wf)).toContain("| 2d6+6 | 1 | (2d6+6) |");
	});

	it("serializes step with empty label as empty cell", () => {
		const wf: Workflow = { name: "t", steps: [tableStep("world/tables/enc", 1, undefined)] };
		expect(buildWorkflowContent(wf)).toContain("| [[world/tables/enc]] | 1 |  |");
	});

	it("round-trips through parse → build → parse", () => {
		const original: Workflow = {
			name: "roundtrip",
			resultsFolder: "world/results",
			templateFile: "world/workflows/templates/roundtrip.md",
			steps: [
				tableStep("world/tables/enc", 2, "Encounters"),
				diceStep("2d6", 1, "(2d6)"),
			],
		};
		const serialized = buildWorkflowContent(original);
		const parsed = parseWorkflow(serialized, "roundtrip");
		expect(parsed.resultsFolder).toBe(original.resultsFolder);
		expect(parsed.templateFile).toBe(original.templateFile);
		expect(parsed.steps).toHaveLength(2);
		expect(parsed.steps[0]).toEqual(original.steps[0]);
		expect(parsed.steps[1]).toEqual(original.steps[1]);
	});
});

// ── stepVarName ───────────────────────────────────────────────────────────────

describe("stepVarName", () => {
	it("uses label when set, replacing spaces with underscores", () => {
		const step: WorkflowStep = { kind: "table", tablePath: "world/tables/enc", rolls: 1, label: "My Table" };
		expect(stepVarName(step)).toBe("My_Table");
	});

	it("uses table basename when no label", () => {
		const step: WorkflowStep = { kind: "table", tablePath: "world/tables/encounters", rolls: 1 };
		expect(stepVarName(step)).toBe("encounters");
	});

	it("replaces spaces in basename with underscores", () => {
		const step: WorkflowStep = { kind: "table", tablePath: "world/tables/random encounters", rolls: 1 };
		expect(stepVarName(step)).toBe("random_encounters");
	});

	it("uses formula in parens for dice step with no label", () => {
		const step: WorkflowStep = { kind: "dice", tablePath: "", diceFormula: "2d6+6", rolls: 1 };
		expect(stepVarName(step)).toBe("(2d6+6)");
	});

	it("falls back to 'dice' when dice step has no formula", () => {
		const step: WorkflowStep = { kind: "dice", tablePath: "", rolls: 1 };
		expect(stepVarName(step)).toBe("dice");
	});

	it("label takes priority over dice formula", () => {
		const step: WorkflowStep = { kind: "dice", tablePath: "", diceFormula: "2d6", rolls: 1, label: "damage" };
		expect(stepVarName(step)).toBe("damage");
	});

	it("uses full path basename (after last slash)", () => {
		const step: WorkflowStep = { kind: "table", tablePath: "a/b/c/my table", rolls: 1 };
		expect(stepVarName(step)).toBe("my_table");
	});
});

// ── stepPlaceholder ───────────────────────────────────────────────────────────

describe("stepPlaceholder", () => {
	const tableStepFixed: WorkflowStep = { kind: "table", tablePath: "world/tables/enc", rolls: 1, label: "Encounters" };

	it("returns $label for single-roll step", () => {
		expect(stepPlaceholder(tableStepFixed, 0)).toBe("$Encounters");
	});

	it("returns $label_N for multi-roll step", () => {
		const multi: WorkflowStep = { ...tableStepFixed, rolls: 3 };
		expect(stepPlaceholder(multi, 0)).toBe("$Encounters_1");
		expect(stepPlaceholder(multi, 1)).toBe("$Encounters_2");
		expect(stepPlaceholder(multi, 2)).toBe("$Encounters_3");
	});

	it("uses formula-in-parens for dice step placeholder", () => {
		const step: WorkflowStep = { kind: "dice", tablePath: "", diceFormula: "2d6", rolls: 1 };
		expect(stepPlaceholder(step, 0)).toBe("$(2d6)");
	});

	it("uses label for dice step when label is set", () => {
		const step: WorkflowStep = { kind: "dice", tablePath: "", diceFormula: "2d6", rolls: 1, label: "damage" };
		expect(stepPlaceholder(step, 0)).toBe("$damage");
	});
});

// ── generateDefaultTemplate ───────────────────────────────────────────────────

describe("generateDefaultTemplate", () => {
	it("returns empty string for no steps", () => {
		expect(generateDefaultTemplate([])).toBe("");
	});

	it("generates heading and placeholder for a single-roll table step", () => {
		const steps: WorkflowStep[] = [tableStep("world/tables/enc", 1, "Encounters")];
		const tmpl = generateDefaultTemplate(steps);
		expect(tmpl).toContain("## Encounters");
		expect(tmpl).toContain("$Encounters");
	});

	it("generates multiple placeholders for multi-roll step", () => {
		const steps: WorkflowStep[] = [tableStep("world/tables/enc", 3, "Encounters")];
		const tmpl = generateDefaultTemplate(steps);
		expect(tmpl).toContain("$Encounters_1");
		expect(tmpl).toContain("$Encounters_2");
		expect(tmpl).toContain("$Encounters_3");
		expect(tmpl).not.toContain("$Encounters\n");
	});

	it("uses formula as heading when dice step has no label", () => {
		const steps: WorkflowStep[] = [diceStep("2d6", 1)];
		const tmpl = generateDefaultTemplate(steps);
		expect(tmpl).toContain("## 2d6");
		expect(tmpl).toContain("$(2d6)");
	});

	it("uses label as heading when set", () => {
		const steps: WorkflowStep[] = [diceStep("2d6", 1, "damage")];
		const tmpl = generateDefaultTemplate(steps);
		expect(tmpl).toContain("## damage");
		expect(tmpl).toContain("$damage");
	});

	it("generates a section per step", () => {
		const steps: WorkflowStep[] = [
			tableStep("world/tables/enc", 1, "Encounters"),
			diceStep("2d6+6", 1, "(2d6+6)"),
		];
		const tmpl = generateDefaultTemplate(steps);
		expect(tmpl).toContain("## Encounters");
		expect(tmpl).toContain("## (2d6+6)");
	});

	it("uses 'Table N' heading for unlabelled table step", () => {
		const steps: WorkflowStep[] = [tableStep("world/tables/enc", 1)];
		const tmpl = generateDefaultTemplate(steps);
		expect(tmpl).toContain("## Table 1");
	});
});

// ── requiredPlaceholders ──────────────────────────────────────────────────────

describe("requiredPlaceholders", () => {
	it("returns empty array for no steps", () => {
		expect(requiredPlaceholders([])).toEqual([]);
	});

	it("returns one placeholder per single-roll step", () => {
		const steps: WorkflowStep[] = [
			tableStep("world/tables/enc", 1, "enc"),
			diceStep("2d6", 1, "roll"),
		];
		expect(requiredPlaceholders(steps)).toEqual(["$enc", "$roll"]);
	});

	it("returns N placeholders for a multi-roll step", () => {
		const steps: WorkflowStep[] = [tableStep("world/tables/enc", 3, "enc")];
		expect(requiredPlaceholders(steps)).toEqual(["$enc_1", "$enc_2", "$enc_3"]);
	});

	it("accumulates placeholders across multiple steps", () => {
		const steps: WorkflowStep[] = [
			tableStep("world/tables/a", 2, "A"),
			tableStep("world/tables/b", 1, "B"),
		];
		expect(requiredPlaceholders(steps)).toEqual(["$A_1", "$A_2", "$B"]);
	});
});
