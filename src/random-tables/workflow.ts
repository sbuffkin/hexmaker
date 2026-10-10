import { splitTableRow, escapeTableCell, escapeRegex, placeholderPattern } from "../textUtils";
import { withFrontmatterEntries, yamlLink } from "../provenance";

export interface WorkflowStep {
	kind: "table" | "dice";
	tablePath: string;  // vault-relative path, no .md extension (kind=table), or "" (kind=dice)
	diceFormula?: string;  // only for kind=dice, e.g. "2d6+6"
	rolls: number;      // >= 1
	label?: string;     // optional display name
}

export interface Workflow {
	name: string;
	description?: string;
	resultsFolder?: string;
	templateFile?: string;
	steps: WorkflowStep[];
}

/** Returns true if the string is a valid TRPG dice formula (xdy+z). */
export function isDiceFormula(s: string): boolean {
	return /^\d*d\d+([+-]\d+)?$/i.test(s.trim());
}

/** Roll a dice formula string and return the numeric result. */
export function rollDiceFormula(formula: string): number {
	const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(formula.trim());
	if (!m) return 0;
	const numDice = m[1] ? parseInt(m[1], 10) : 1;
	const dieSize = parseInt(m[2], 10);
	const modifier = m[3] ? parseInt(m[3], 10) : 0;
	let total = modifier;
	for (let i = 0; i < numDice; i++) {
		total += Math.floor(Math.random() * dieSize) + 1;
	}
	return total;
}

/** Roll a dice formula and return a breakdown string: "(d1+d2+...+mod)=total".
 *  For a single die with no modifier, returns just the number. */
export function rollDiceFormulaWithBreakdown(formula: string): string {
	const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(formula.trim());
	if (!m) return "0";
	const numDice = m[1] ? parseInt(m[1], 10) : 1;
	const dieSize = parseInt(m[2], 10);
	const modifier = m[3] ? parseInt(m[3], 10) : 0;
	const dice: number[] = [];
	for (let i = 0; i < numDice; i++) {
		dice.push(Math.floor(Math.random() * dieSize) + 1);
	}
	const total = dice.reduce((a, b) => a + b, 0) + modifier;
	if (numDice === 1 && modifier === 0) return String(total);
	let expr = dice.join("+");
	if (modifier > 0) expr += `+${modifier}`;
	else if (modifier < 0) expr += String(modifier);
	return `(${expr})=${total}`;
}

// ── The workflow note ───────────────────────────────────────────────────────
//
//   ---
//   results-folder: world/results
//   template-file: world/workflows/templates/npc.md
//   ---
//   Optional description.
//
//   | Table | Rolls | Label | Die | Fills |
//   |-------|-------|-------|-----|-------|
//   | [[world/tables/aspects]] | 3 | aspects | d12 | $aspects_1 $aspects_2 $aspects_3 |
//
//   Anything after the table is the user's and is kept.
//
// Table, Rolls and Label are the steps; Die and Fills are derived (the
// table's die, the placeholders the step fills) and are ignored on read.
// They come after Label so older builds, which read the first three
// columns, still read the note. Other columns a person adds are kept.

/** Columns the plugin writes, in order. The first three are the steps. */
const STEP_COLUMNS = ["Table", "Rolls", "Label"] as const;
const DERIVED_COLUMNS = ["Die", "Fills"] as const;
/** Header names (lower case) the parser accepts for each column. */
const COLUMN_ALIASES: Record<string, string> = {
	table: "table", source: "table",
	rolls: "rolls", roll: "rolls", count: "rolls", times: "rolls",
	label: "label", name: "label",
	die: "die", dice: "die",
	fills: "fills", placeholders: "fills", fill: "fills",
};

interface FrontmatterSpan {
	/** The YAML between the fences (may be ""). */
	body: string;
	/** Where the note after the closing fence starts. */
	end: number;
}

function findFrontmatter(content: string): FrontmatterSpan | null {
	const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(content);
	return m ? { body: m[1], end: m[0].length } : null;
}

interface StepsTable {
	/** Offsets of the header line's start and of the line after the last row. */
	start: number;
	end: number;
	/** Header cell names as typed. */
	headers: string[];
	/** Column index per known column ("table", "rolls", …). */
	col: Map<string, number>;
	/** Data rows' cells (the separator is skipped). */
	rows: string[][];
}

/**
 * Find the steps table: the first table whose header has a Table and a
 * Rolls column (any case, any order, aliases allowed).
 */
function findStepsTable(content: string, from: number): StepsTable | null {
	const lineRe = /[^\n]*(?:\n|$)/g;
	lineRe.lastIndex = from;
	const lines: { text: string; start: number; end: number }[] = [];
	let m: RegExpExecArray | null;
	while ((m = lineRe.exec(content)) !== null && m[0] !== "") {
		lines.push({ text: m[0].replace(/\r?\n$/, ""), start: m.index, end: m.index + m[0].length });
	}
	for (let i = 0; i < lines.length; i++) {
		const headers = splitTableRow(lines[i].text);
		if (!headers) continue;
		const col = new Map<string, number>();
		headers.forEach((h, idx) => {
			const key = COLUMN_ALIASES[h.trim().toLowerCase()];
			if (key && !col.has(key)) col.set(key, idx);
		});
		if (!col.has("table") || !col.has("rolls")) continue;
		const rows: string[][] = [];
		let j = i + 1;
		if (j < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[j].text) && lines[j].text.includes("-")) j++;
		for (; j < lines.length; j++) {
			const cells = splitTableRow(lines[j].text);
			if (!cells) break;
			rows.push(cells);
		}
		const end = j < lines.length ? lines[j].start : content.length;
		return { start: lines[i].start, end, headers, col, rows };
	}
	return null;
}

/** A step from one row's cells, or null when the row isn't a usable step. */
function stepFromCells(cells: string[], col: Map<string, number>): WorkflowStep | null {
	const rawTable = cells[col.get("table")!] ?? "";
	const rolls = parseInt(cells[col.get("rolls")!] ?? "", 10);
	const label = col.has("label") ? (cells[col.get("label")!] ?? "") : "";
	if (!rawTable.trim() || isNaN(rolls) || rolls < 1) return null;
	if (isDiceFormula(rawTable)) {
		// Dice step — formula stored directly in the table cell
		return { kind: "dice", tablePath: "", diceFormula: rawTable.trim(), rolls, label: label || undefined };
	}
	// Table step — extract path from [[link]] syntax or plain text
	const linkMatch = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(rawTable);
	const tablePath = linkMatch ? linkMatch[1].trim() : rawTable.trim();
	return { kind: "table", tablePath, rolls, label: label || undefined };
}

/** What identifies a row's step when the note is rewritten (its table or formula). */
function stepKey(step: WorkflowStep): string {
	return step.kind === "dice" ? `dice:${(step.diceFormula ?? "").toLowerCase()}` : `table:${step.tablePath.replace(/\.md$/i, "").toLowerCase()}`;
}

/** Parse a workflow markdown file into a Workflow. */
export function parseWorkflow(content: string, name: string): Workflow {
	const workflow: Workflow = { name, steps: [] };

	// Extract YAML frontmatter
	const fm = findFrontmatter(content);
	if (fm) {
		const rfMatch = /^results-folder:\s*(.+)$/m.exec(fm.body);
		if (rfMatch) workflow.resultsFolder = rfMatch[1].trim();
		const tfMatch = /^template-file:\s*(.+)$/m.exec(fm.body);
		if (tfMatch) workflow.templateFile = tfMatch[1].trim();
	}

	const table = findStepsTable(content, fm?.end ?? 0);
	if (!table) return workflow;

	// Description: text between frontmatter and the steps table
	const desc = content.slice(fm?.end ?? 0, table.start).trim();
	if (desc) workflow.description = desc;

	for (const cells of table.rows) {
		const step = stepFromCells(cells, table.col);
		if (step) workflow.steps.push(step);
	}
	return workflow;
}

/** The placeholders a step fills, space separated (the Fills column). */
export function stepFills(step: WorkflowStep): string {
	return Array.from({ length: step.rolls }, (_, r) => stepPlaceholder(step, r)).join(" ");
}

export interface BuildWorkflowOptions {
	/**
	 * The note as it is now. Its other frontmatter, any text after the
	 * steps table and any extra columns are kept; only the steps,
	 * description and the two settings are rewritten.
	 */
	existing?: string;
	/**
	 * The Die cell for a step ("d12"), when known. A dice step shows its
	 * formula. Without it, the cell the row had is kept.
	 */
	dieFor?: (step: WorkflowStep) => string | undefined;
}

/** Set or remove one `key: value` line in frontmatter YAML (other lines untouched). */
function setYamlLine(body: string, key: string, value: string | undefined, current: string | undefined): string {
	if ((value ?? "") === (current ?? "")) return body;
	const lines = body === "" ? [] : body.split(/\r?\n/);
	const at = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
	if (!value) {
		if (at >= 0) lines.splice(at, 1);
	} else if (at >= 0) {
		lines[at] = `${key}: ${value}`;
	} else {
		lines.push(`${key}: ${value}`);
	}
	return lines.join("\n");
}

/** Serialize a Workflow back to markdown (see the note format above). */
export function buildWorkflowContent(workflow: Workflow, opts: BuildWorkflowOptions = {}): string {
	const existing = opts.existing?.replace(/\r\n/g, "\n");
	const eol = opts.existing?.includes("\r\n") ? "\r\n" : "\n";
	const fm = existing !== undefined ? findFrontmatter(existing) : null;
	const old = existing !== undefined ? findStepsTable(existing, fm?.end ?? 0) : null;
	const before = existing !== undefined ? parseWorkflow(existing, workflow.name) : null;

	// Frontmatter: the two settings; any other keys stay as they were.
	let fmBody = fm?.body.replace(/\r\n/g, "\n") ?? "";
	if (fm) {
		fmBody = setYamlLine(fmBody, "results-folder", workflow.resultsFolder, before?.resultsFolder);
		fmBody = setYamlLine(fmBody, "template-file", workflow.templateFile, before?.templateFile);
	} else {
		fmBody = [
			workflow.resultsFolder ? `results-folder: ${workflow.resultsFolder}` : "",
			workflow.templateFile ? `template-file: ${workflow.templateFile}` : "",
		].filter(Boolean).join("\n");
	}

	// Columns: the steps, the derived ones, then any the user added.
	const known = new Set(Object.keys(COLUMN_ALIASES));
	const extraCols = old ? old.headers.map((h, i) => ({ name: h, i })).filter(({ name }) => !known.has(name.trim().toLowerCase()) && name.trim() !== "") : [];
	const headers = [...STEP_COLUMNS, ...DERIVED_COLUMNS, ...extraCols.map((c) => c.name)];

	// Each step keeps the extra cells (and last Die) of the row it came from.
	const oldRows = (old?.rows ?? []).map((cells) => {
		const step = old ? stepFromCells(cells, old.col) : null;
		return { key: step ? stepKey(step) : null, cells, used: false };
	});
	const lines: string[] = [];
	lines.push(`| ${headers.map(escapeTableCell).join(" | ")} |`);
	lines.push(`|${headers.map((h) => "-".repeat(Math.max(3, h.length + 2))).join("|")}|`);
	for (const step of workflow.steps) {
		const key = stepKey(step);
		const row = oldRows.find((r) => !r.used && r.key === key);
		if (row) row.used = true;
		const tableCell = step.kind === "dice"
			? (step.diceFormula ?? "")
			: `[[${step.tablePath}]]`;
		const oldDie = row && old?.col.has("die") ? row.cells[old.col.get("die")!] : undefined;
		const die = step.kind === "dice" ? (step.diceFormula ?? "") : (opts.dieFor?.(step) ?? oldDie ?? "");
		const cells = [
			tableCell,
			String(step.rolls),
			step.label ?? "",
			die,
			stepFills(step),
			...extraCols.map((c) => row?.cells[c.i] ?? ""),
		];
		lines.push(`| ${cells.map(escapeTableCell).join(" | ")} |`);
	}
	const table = lines.join("\n") + "\n";

	const withFm = existing === undefined || fm !== null || fmBody !== "";
	let out = withFm ? `---\n${fmBody ? fmBody + "\n" : ""}---\n\n` : "";
	out += (workflow.description ? `${workflow.description}\n\n` : "") + table;
	if (existing !== undefined) {
		// Whatever followed the table is the user's, kept as typed. A note
		// with no steps table keeps its whole body, after the new table.
		if (old) out += existing.slice(old.end);
		else {
			const body = existing.slice(fm?.end ?? 0).replace(/^\s*\n/, "");
			if (body.trim()) out += "\n" + body;
		}
	}
	return eol === "\n" ? out : out.replace(/\n/g, "\r\n");
}

/**
 * The note a workflow's `template-file` names, as paths to try: the value
 * as typed (quotes and `[[ ]]` removed), then with ".md". Hand-set values
 * like `"[[npc template]]"` work too (the caller can resolve the link).
 */
export function templateFileCandidates(raw: string | undefined): string[] {
	if (!raw) return [];
	let v = raw.trim().replace(/^["']|["']$/g, "").trim();
	const link = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(v);
	if (link) v = link[1].trim();
	v = v.replace(/^\/+/, "");
	if (!v) return [];
	return /\.md$/i.test(v) ? [v] : [v, `${v}.md`];
}

/** Derive the variable base name for a step: label if set, else table basename or sanitized formula. */
export function stepVarName(step: WorkflowStep): string {
	if (step.label) return step.label.replace(/ /g, "_");
	if (step.kind === "dice") {
		return step.diceFormula ? `(${step.diceFormula})` : "dice";
	}
	const base = step.tablePath.split("/").pop() ?? step.tablePath;
	return base.replace(/ /g, "_");
}

/** Return the placeholder string for a specific roll of a step.
 *  Single-roll step: `$label`   Multi-roll step: `$label_1`, `$label_2`, … */
export function stepPlaceholder(step: WorkflowStep, rollIndex: number): string {
	const varName = stepVarName(step);
	return step.rolls === 1 ? `$${varName}` : `$${varName}_${rollIndex + 1}`;
}

/** Return an auto-generated template body with label-based placeholders per step. */
export function generateDefaultTemplate(steps: WorkflowStep[]): string {
	const lines: string[] = [];

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const heading = step.label || (step.kind === "dice" ? (step.diceFormula ?? `Step ${i + 1}`) : `Table ${i + 1}`);
		lines.push(`## ${heading}`);
		lines.push("");
		for (let r = 0; r < step.rolls; r++) {
			lines.push(stepPlaceholder(step, r));
		}
		lines.push("");
	}

	return lines.join("\n");
}

/** Return the list of all required placeholder strings for the given steps. */
export function requiredPlaceholders(steps: WorkflowStep[]): string[] {
	const placeholders: string[] = [];
	for (const step of steps) {
		for (let r = 0; r < step.rolls; r++) {
			placeholders.push(stepPlaceholder(step, r));
		}
	}
	return placeholders;
}

/**
 * A filled-in workflow made safe to add under one "### section" of a hex
 * note (PA2): its headings become bold lines and its "---" rules go, since
 * either would end the section early (sections.ts sectionText).
 */
export function workflowResultAsSectionText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((line) => !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line))
		.map((line) => {
			const h = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
			return h ? (h[1] ? `**${h[1]}**` : "") : line;
		})
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ── Templates ───────────────────────────────────────────────────────────────

/** Heading for a step's block in a template: its label, else table name or formula. */
function stepHeading(step: WorkflowStep, index: number): string {
	if (step.label) return step.label;
	if (step.kind === "dice") return step.diceFormula ?? `Step ${index + 1}`;
	return step.tablePath.split("/").pop() || `Table ${index + 1}`;
}

/** Is this placeholder written in the template (as a whole token)? */
function hasPlaceholder(template: string, placeholder: string): boolean {
	return new RegExp(placeholderPattern(placeholder)).test(template);
}

/**
 * `$tokens` in a template that no step fills, in order, once each (the
 * wizard would leave them as typed). Money like "$5" isn't a token.
 */
export function unfilledTokens(template: string, steps: WorkflowStep[]): string[] {
	const known = requiredPlaceholders(steps).sort((a, b) => b.length - a.length);
	const out: string[] = [];
	const re = /\$(?:\([^)\s]*\)(?:_\d+)?|[A-Za-z_]\w*(?:-\w+)*)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(template)) !== null) {
		const at = m.index;
		const hit = known.find((p) => template.startsWith(p, at) && !/\w/.test(template[at + p.length] ?? ""));
		if (hit) {
			re.lastIndex = at + hit.length;
			continue;
		}
		if (!out.includes(m[0])) out.push(m[0]);
	}
	return out;
}

/**
 * Bring a template in line with the steps: a step none of whose
 * placeholders are in it gets a "## label" block at the end; a step with
 * some missing gets them after its last one. Nothing is removed or
 * rewritten. Returns the placeholders added.
 */
export function reconcileTemplate(template: string, steps: WorkflowStep[]): { template: string; added: string[] } {
	let t = template;
	const added: string[] = [];
	steps.forEach((step, i) => {
		const all = Array.from({ length: step.rolls }, (_, r) => stepPlaceholder(step, r));
		const present = all.filter((p) => hasPlaceholder(t, p));
		const missing = all.filter((p) => !present.includes(p));
		if (!missing.length) return;
		added.push(...missing);
		if (!present.length) {
			const block = [`## ${stepHeading(step, i)}`, "", ...missing, ""].join("\n");
			t = t.trim() ? `${t.trimEnd()}\n\n${block}` : block;
			return;
		}
		const last = present[present.length - 1];
		const re = new RegExp(placeholderPattern(last), "g");
		let end = -1;
		let m: RegExpExecArray | null;
		while ((m = re.exec(t)) !== null) end = m.index + m[0].length;
		t = `${t.slice(0, end)}\n${missing.join("\n")}${t.slice(end)}`;
	});
	return { template: t, added };
}

/** A value filled into a template: its text, and the note it links to, if any. */
export interface FilledValue {
	text: string;
	/** Link text of the note the result is (a linked table row). */
	link?: string;
}

/** A wiki-link to `link` that reads as `text` (escaped inside a table row). */
function linkMarkup(link: string, text: string, inTableRow: boolean): string {
	const shown = text.replace(/[[\]|]/g, "").trim();
	const base = link.split("/").pop() ?? link;
	if (!shown || shown === link || (shown === base && base === link)) return `[[${link}]]`;
	return `[[${link}${inTableRow ? "\\|" : "|"}${shown}]]`;
}

/**
 * Fill a workflow template. Like fillPlaceholders, plus links: a linked
 * result goes in as a link, and where the template already wraps the
 * placeholder in `[[ ]]` (older templates did, to link the bare name),
 * only the link target goes in.
 */
export function fillWorkflowTemplate(template: string, values: Map<string, FilledValue>): string {
	if (!values.size) return template;
	const keys = [...values.keys()].sort((a, b) => b.length - a.length);
	const re = new RegExp(`(\\[\\[)?(?:${keys.map(escapeRegex).join("|")})(?![\\w])`, "g");
	return template.replace(re, (m: string, open: string | undefined, offset: number) => {
		const ph = open ? m.slice(2) : m;
		const v = values.get(ph);
		if (!v) return m;
		if (open) {
			const rest = template.slice(offset + m.length);
			return "[[" + (/^(?:\]\]|\||#)/.test(rest) ? (v.link ?? v.text) : v.text);
		}
		if (!v.link) return v.text;
		const lineStart = template.lastIndexOf("\n", offset - 1) + 1;
		const inTableRow = template.slice(lineStart, offset).trimStart().startsWith("|");
		return linkMarkup(v.link, v.text, inTableRow);
	});
}

// ── Results notes ───────────────────────────────────────────────────────────

/** One rolled slot, for the results note's Rolls table. */
export interface RollRecord {
	placeholder: string;
	/** Markdown: a link to the table, or the dice formula. */
	source: string;
	/** "d12", a dice formula, or "" (no die). */
	die: string;
	/** The face rolled, a dice breakdown, "picked"/"typed", or "" (a weighted pick). */
	roll: string;
	/** The result as it went into the note (markdown). */
	result: string;
}

/** The `## Rolls` table: what each placeholder got and how. */
export function rollsSection(records: RollRecord[]): string {
	const cell = (s: string) => escapeTableCell(s.replace(/\s*\r?\n\s*/g, " ").trim()) || "—";
	const lines = [
		"## Rolls",
		"",
		"| Placeholder | Source | Die | Roll | Result |",
		"|-------------|--------|-----|------|--------|",
		...records.map((r) => `| \`${r.placeholder}\` | ${cell(r.source)} | ${cell(r.die)} | ${cell(r.roll)} | ${cell(r.result)} |`),
	];
	return lines.join("\n") + "\n";
}

/**
 * A workflow results note: the filled template with `workflow` and
 * `rolled` in its frontmatter (merged into the template's own, if it has
 * one) and the Rolls table at the end.
 */
export function buildResultsNote(filled: string, meta: { workflowPath: string; rolled: string }, records: RollRecord[]): string {
	const withMeta = withFrontmatterEntries(filled, [
		["workflow", yamlLink(meta.workflowPath)],
		["rolled", meta.rolled],
	]);
	const body = withMeta.replace(/\s*$/, "");
	return records.length ? `${body}\n\n${rollsSection(records)}` : `${body}\n`;
}
