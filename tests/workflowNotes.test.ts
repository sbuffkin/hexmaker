import { describe, it } from "node:test";
import expect from "expect";
import {
	parseWorkflow,
	buildWorkflowContent,
	reconcileTemplate,
	unfilledTokens,
	fillWorkflowTemplate,
	buildResultsNote,
	rollsSection,
	templateFileCandidates,
	type FilledValue,
	type WorkflowStep,
	type Workflow,
} from "../src/random-tables/workflow";
import { localIsoDateTime, withFrontmatterEntries, yamlLink } from "../src/provenance";

const aspects: WorkflowStep = { kind: "table", tablePath: "world/tables/aspects", rolls: 3, label: "aspects" };
const town: WorkflowStep = { kind: "table", tablePath: "world/tables/towns", rolls: 1, label: "town" };
const dice: WorkflowStep = { kind: "dice", tablePath: "", diceFormula: "2d6", rolls: 1, label: "(2d6)" };

// ── W2: the steps table ─────────────────────────────────────────────────────

describe("workflow steps table (W2)", () => {
	it("writes derived Die and Fills columns after Label", () => {
		const wf: Workflow = { name: "npc", steps: [aspects, dice] };
		const out = buildWorkflowContent(wf, { dieFor: () => "d12" });
		expect(out).toContain("| Table | Rolls | Label | Die | Fills |");
		expect(out).toContain("| [[world/tables/aspects]] | 3 | aspects | d12 | $aspects_1 $aspects_2 $aspects_3 |");
		expect(out).toContain("| 2d6 | 1 | (2d6) | 2d6 | $(2d6) |");
	});

	it("reads the steps and ignores the derived columns", () => {
		const out = buildWorkflowContent({ name: "npc", steps: [aspects, dice] }, { dieFor: () => "d12" });
		const back = parseWorkflow(out, "npc");
		expect(back.steps).toEqual([aspects, dice]);
	});

	it("still has the three columns an older build looks for, first", () => {
		const out = buildWorkflowContent({ name: "npc", steps: [aspects] });
		// The pre-#46 parser's header test and column positions.
		expect(/\|\s*Table\s*\|\s*Rolls\s*\|\s*Label\s*\|/i.test(out)).toBe(true);
		const row = out.split("\n").find((l) => l.includes("[[world/tables/aspects]]"))!;
		const cells = row.split("|").slice(1, -1).map((c) => c.trim());
		expect(cells.slice(0, 3)).toEqual(["[[world/tables/aspects]]", "3", "aspects"]);
	});

	it("keeps other frontmatter, extra columns and text after the table", () => {
		const existing = [
			"---",
			"results-folder: world/results",
			"tags: [npc]",
			"template-file: \"[[npc template]]\"",
			"---",
			"Makes an NPC.",
			"",
			"| Table | Rolls | Label | Notes |",
			"|---|---|---|---|",
			"| [[world/tables/aspects]] | 3 | aspects | roll in order |",
			"| [[world/tables/towns]] | 1 | town | home |",
			"",
			"## Ideas",
			"Add a quirk table.",
			"",
		].join("\n");
		const wf = parseWorkflow(existing, "npc");
		wf.steps = [wf.steps[1], wf.steps[0]]; // reordered in the editor
		const out = buildWorkflowContent(wf, { existing, dieFor: (s) => (s.tablePath.endsWith("aspects") ? "d12" : "d6") });
		expect(out).toContain("tags: [npc]");
		expect(out).toContain('template-file: "[[npc template]]"'); // as typed
		expect(out).toContain("results-folder: world/results");
		expect(out).toContain("Makes an NPC.");
		expect(out).toContain("| Table | Rolls | Label | Die | Fills | Notes |");
		expect(out).toContain("| [[world/tables/towns]] | 1 | town | d6 | $town | home |");
		expect(out).toContain("| [[world/tables/aspects]] | 3 | aspects | d12 | $aspects_1 $aspects_2 $aspects_3 | roll in order |");
		expect(out.indexOf("towns")).toBeLessThan(out.indexOf("aspects]]"));
		expect(out).toContain("\n## Ideas\nAdd a quirk table.\n");
	});

	it("keeps a row's Die when the table can't be read", () => {
		const existing = "---\n---\n\n| Table | Rolls | Label | Die | Fills |\n|---|---|---|---|---|\n| [[t]] | 1 | t | d8 | $t |\n";
		const wf = parseWorkflow(existing, "w");
		expect(buildWorkflowContent(wf, { existing })).toContain("| [[t]] | 1 | t | d8 | $t |");
	});

	it("is unchanged when rebuilt with nothing changed", () => {
		const first = buildWorkflowContent({ name: "w", resultsFolder: "r", steps: [aspects, town] }, { dieFor: () => "d6" });
		const again = buildWorkflowContent(parseWorkflow(first, "w"), { existing: first });
		expect(again).toBe(first);
	});

	it("keeps CRLF line endings", () => {
		const existing = "---\r\nresults-folder: r\r\n---\r\n\r\n| Table | Rolls | Label |\r\n|---|---|---|\r\n| [[t]] | 1 | t |\r\n\r\nNotes\r\n";
		const out = buildWorkflowContent(parseWorkflow(existing, "w"), { existing });
		expect(out.replace(/\r\n/g, "")).not.toContain("\n");
		expect(out).toContain("Notes\r\n");
	});

	it("updates or removes the results folder without touching other keys", () => {
		const existing = "---\ntags: [a]\nresults-folder: old\n---\n\n| Table | Rolls | Label |\n|---|---|---|\n";
		const wf = parseWorkflow(existing, "w");
		expect(buildWorkflowContent({ ...wf, resultsFolder: "new" }, { existing })).toContain("---\ntags: [a]\nresults-folder: new\n---");
		expect(buildWorkflowContent({ ...wf, resultsFolder: undefined }, { existing })).toContain("---\ntags: [a]\n---");
	});

	it("reads columns in any order and case", () => {
		const content = "| label | rolls | TABLE |\n|---|---|---|\n| town | 2 | [[world/tables/towns]] |\n";
		expect(parseWorkflow(content, "w").steps).toEqual([{ kind: "table", tablePath: "world/tables/towns", rolls: 2, label: "town" }]);
	});

	it("keeps a note's prose when it has no steps table yet", () => {
		const existing = "---\n---\nJust some notes.\n";
		const out = buildWorkflowContent({ name: "w", steps: [town] }, { existing });
		expect(out).toContain("| [[world/tables/towns]] | 1 | town |");
		expect(out).toContain("Just some notes.");
	});
});

// ── W3: templates ───────────────────────────────────────────────────────────

describe("template reconciling (W3)", () => {
	it("finds $tokens no step fills, but not money or the steps' own", () => {
		const t = "## Aspects\n$aspects_1 $aspects_2 $aspects_3\nFrom $town, costs $5. Mood: $mood; $aspects_4";
		expect(unfilledTokens(t, [aspects, town])).toEqual(["$mood", "$aspects_4"]);
	});

	it("knows dice placeholders", () => {
		expect(unfilledTokens("Gold: $(2d6)", [dice])).toEqual([]);
		expect(unfilledTokens("Gold: $(3d6)", [dice])).toEqual(["$(3d6)"]);
	});

	it("adds a block for a step the template doesn't show", () => {
		const { template, added } = reconcileTemplate("## Aspects\n$aspects_1\n$aspects_2\n$aspects_3\n", [aspects, town]);
		expect(added).toEqual(["$town"]);
		expect(template).toBe("## Aspects\n$aspects_1\n$aspects_2\n$aspects_3\n\n## town\n\n$town\n");
	});

	it("adds missing rolls after the step's last one", () => {
		const { template, added } = reconcileTemplate("A: $aspects_1, $aspects_2.\nEnd", [aspects]);
		expect(added).toEqual(["$aspects_3"]);
		expect(template).toBe("A: $aspects_1, $aspects_2\n$aspects_3.\nEnd");
	});

	it("leaves a complete template alone", () => {
		const t = "$town and $aspects_1 $aspects_2 $aspects_3 and $nothing";
		expect(reconcileTemplate(t, [town, aspects])).toEqual({ template: t, added: [] });
	});
});

describe("template-file as typed (W3)", () => {
	it("accepts a path, a path without .md, and a quoted link", () => {
		expect(templateFileCandidates("world/workflows/templates/npc.md")).toEqual(["world/workflows/templates/npc.md"]);
		expect(templateFileCandidates("world/t/npc")).toEqual(["world/t/npc", "world/t/npc.md"]);
		expect(templateFileCandidates('"[[npc template|NPC]]"')).toEqual(["npc template", "npc template.md"]);
		expect(templateFileCandidates(undefined)).toEqual([]);
	});
});

// ── W1: results notes ───────────────────────────────────────────────────────

describe("filling a template with links (W1)", () => {
	const values = new Map<string, FilledValue>([
		["$town", { text: "Saltmarsh", link: "Saltmarsh" }],
		["$aspects_1", { text: "brave" }],
		["$lair", { text: "Cave", link: "world/dungeons/Cave" }],
	]);

	it("puts a linked result in as a link", () => {
		expect(fillWorkflowTemplate("From $town, $aspects_1.", values)).toBe("From [[Saltmarsh]], brave.");
	});

	it("shows a path link by the note's name", () => {
		expect(fillWorkflowTemplate("Lair: $lair", values)).toBe("Lair: [[world/dungeons/Cave|Cave]]");
	});

	it("escapes the alias pipe inside a table row", () => {
		expect(fillWorkflowTemplate("| Lair | $lair |", values)).toBe("| Lair | [[world/dungeons/Cave\\|Cave]] |");
	});

	it("inserts only the target where the template already wraps the placeholder", () => {
		expect(fillWorkflowTemplate("Home: [[$town]]; lair [[$lair|the lair]]", values)).toBe("Home: [[Saltmarsh]]; lair [[world/dungeons/Cave|the lair]]");
		// A plain result in [[ ]] still reads as before.
		expect(fillWorkflowTemplate("[[$aspects_1]]", values)).toBe("[[brave]]");
	});
});

describe("results note (W1)", () => {
	const records = [
		{ placeholder: "$aspects_1", source: "[[aspects]]", die: "d12", roll: "7", result: "brave" },
		{ placeholder: "$lair", source: "[[lairs]]", die: "", roll: "", result: "[[world/dungeons/Cave|Cave]]" },
		{ placeholder: "$(2d6)", source: "2d6", die: "2d6", roll: "(3+4)=7", result: "7" },
	];

	it("records the workflow and time in frontmatter and a Rolls table", () => {
		const note = buildResultsNote("## NPC\nbrave\n", { workflowPath: "world/workflows/npc.md", rolled: "2026-10-10T14:03:00" }, records);
		expect(note.startsWith('---\nworkflow: "[[world/workflows/npc]]"\nrolled: 2026-10-10T14:03:00\n---\n## NPC\nbrave\n\n## Rolls\n')).toBe(true);
		expect(note).toContain("| Placeholder | Source | Die | Roll | Result |");
		expect(note).toContain("| `$aspects_1` | [[aspects]] | d12 | 7 | brave |");
		expect(note).toContain("| `$lair` | [[lairs]] | — | — | [[world/dungeons/Cave\\|Cave]] |");
		expect(note).toContain("| `$(2d6)` | 2d6 | 2d6 | (3+4)=7 | 7 |");
	});

	it("merges into the template's own frontmatter", () => {
		const note = buildResultsNote("---\ntags: [npc]\nworkflow: old\n---\nBody", { workflowPath: "w.md", rolled: "2026-01-01T00:00:00" }, []);
		expect(note).toBe('---\ntags: [npc]\nworkflow: "[[w]]"\nrolled: 2026-01-01T00:00:00\n---\nBody\n');
	});

	it("keeps the Rolls table readable as a table", () => {
		const lines = rollsSection(records).trim().split("\n").slice(2);
		for (const l of lines) expect(l.replace(/\\\|/g, "").split("|").length).toBe(7);
	});
});

describe("provenance helpers", () => {
	it("writes local date and time without a zone", () => {
		expect(localIsoDateTime(new Date(2026, 9, 10, 4, 5, 6))).toBe("2026-10-10T04:05:06");
	});

	it("quotes a link for YAML", () => {
		expect(yamlLink("world/hexes/coast/1_2.md")).toBe('"[[world/hexes/coast/1_2]]"');
	});

	it("adds a frontmatter block, or replaces keys in place", () => {
		expect(withFrontmatterEntries("# T\n", [["a", "1"]])).toBe("---\na: 1\n---\n# T\n");
		expect(withFrontmatterEntries("---\na: 0\nb: 2\n---\nx", [["a", "1"]])).toBe("---\na: 1\nb: 2\n---\nx");
		expect(withFrontmatterEntries("---\r\nb: 2\r\n---\r\nx\r\n", [["a", "1"]])).toBe("---\r\nb: 2\r\na: 1\r\n---\r\nx\r\n");
	});
});
