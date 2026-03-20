export interface RandomTableEntry {
	result: string;
	weight: number;
	isLink?: boolean; // true when the result is a vault-relative note path (written as [[...]])
}

export interface RandomTable {
	dice: number; // 0 = no die mapping, show % only
	entries: RandomTableEntry[];
	linkedFolder?: string;
	description?: string; // user-authored blurb shown above the table
}

/** Parse a random-table markdown file into a RandomTable. */
export function parseRandomTable(content: string): RandomTable {
	// Extract dice from YAML frontmatter
	let dice = 0;
	const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
	let linkedFolder: string | undefined;
	if (fmMatch) {
		const diceMatch = /^dice:\s*(\d+)\s*$/m.exec(fmMatch[1]);
		if (diceMatch) dice = parseInt(diceMatch[1], 10);
		const lfMatch = /^linked-folder:\s*(.+)$/m.exec(fmMatch[1]);
		if (lfMatch) linkedFolder = lfMatch[1].trim();
	}

	// Extract user description from preamble (text between frontmatter and table, excluding roller link)
	const afterFm = fmMatch ? content.slice(fmMatch[0].length) : content;
	const firstTableLine = /^[ \t]*\|/m.exec(afterFm);
	const preambleText = firstTableLine ? afterFm.slice(0, firstTableLine.index) : "";
	const descriptionRaw = preambleText
		.replace(/\[.*?\]\(obsidian:\/\/duckmage-roll[^)]*\)/g, "")
		.trim();
	const description = descriptionRaw || undefined;

	// Find first markdown table — lines that start with |
	const lines = content.split("\n");
	const entries: RandomTableEntry[] = [];
	let inTable = false;
	let headerParsed = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) {
			if (inTable) break; // table ended
			continue;
		}
		inTable = true;

		// Skip separator rows (|---|---| style)
		if (/^\|[\s|:-]+\|$/.test(trimmed)) continue;

		const cells = trimmed.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
		if (cells.length < 1) continue;

		// First real row is the header — skip it
		if (!headerParsed) {
			headerParsed = true;
			continue;
		}

		// Strip wiki-link syntax so [[Note Name]] → "Note Name"
		const rawResult = cells[0] ?? "";
		const linkMatch = /^\[\[(.+?)(?:\|[^\]]+)?\]\]$/.exec(rawResult);
		const result = linkMatch ? linkMatch[1] : rawResult;
		const isLink = linkMatch !== null && !linkedFolder; // linked-folder entries already tracked separately
		const rawWeight = cells[1] ?? "1";
		const weight = Math.max(1, parseInt(rawWeight, 10) || 1);
		if (result) entries.push({ result, weight, ...(isLink ? { isLink: true } : {}) });
	}

	return { dice, entries, linkedFolder, description };
}

/**
 * Return any content that appears after the markdown table in a random table file.
 * Finds the last line starting with `|`, then returns everything after it (leading
 * blank lines stripped). Returns "" if nothing follows the table.
 */
export function extractPostTableContent(content: string): string {
	const tableHeaderMatch = /\| Result \| Weight \|/m.exec(content);
	if (!tableHeaderMatch) return "";
	const afterHeader = content.slice(tableHeaderMatch.index);
	const lines = afterHeader.split("\n");
	let lastPipeIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trimStart().startsWith("|")) lastPipeIdx = i;
	}
	if (lastPipeIdx === -1) return "";
	return lines.slice(lastPipeIdx + 1).join("\n").replace(/^\n+/, "");
}

/** Weighted random selection. Returns a random entry. */
export function rollOnTable(table: RandomTable): RandomTableEntry | null {
	if (table.entries.length === 0) return null;
	const total = table.entries.reduce((s, e) => s + e.weight, 0);
	let rand = Math.random() * total;
	for (const entry of table.entries) {
		rand -= entry.weight;
		if (rand <= 0) return entry;
	}
	return table.entries[table.entries.length - 1];
}

/** Return "25%" or "1–4" die range label for a single entry. */
export function getOddsLabel(entry: RandomTableEntry, table: RandomTable): string {
	const total = table.entries.reduce((s, e) => s + e.weight, 0);
	if (total === 0) return "–";
	if (table.dice <= 0) {
		return `${Math.round((entry.weight / total) * 100)}%`;
	}
	return ""; // caller uses getDieRanges for full table
}

/**
 * Compute die ranges for every entry and return them as a parallel array.
 * Each entry gets at least 1 die face; extras go to the heaviest entries first.
 */
export function getDieRanges(table: RandomTable): string[] {
	const n = table.entries.length;
	if (n === 0) return [];
	const total = table.entries.reduce((s, e) => s + e.weight, 0);
	const faces = table.dice;

	// Allocate proportionally, floor each
	const floored = table.entries.map(e => Math.max(1, Math.floor((e.weight / total) * faces)));
	let used = floored.reduce((s, v) => s + v, 0);

	// Distribute remaining faces by fractional remainder, largest first
	if (used < faces) {
		const remainders = table.entries.map((e, i) => ({
			i,
			r: (e.weight / total) * faces - floored[i],
		})).sort((a, b) => b.r - a.r);
		for (const { i } of remainders) {
			if (used >= faces) break;
			floored[i]++;
			used++;
		}
	}

	// Build range strings
	const ranges: string[] = [];
	let cursor = 1;
	for (const count of floored) {
		const from = cursor;
		const to = cursor + count - 1;
		ranges.push(from === to ? String(from) : `${from}–${to}`);
		cursor = to + 1;
	}
	return ranges;
}

/** Update the `dice` value in a table file's YAML frontmatter. */
export function setDiceInFrontmatter(content: string, dice: number): string {
	const fmRegex = /^(---\s*\n)([\s\S]*?)(\n---)/;
	const diceLine = dice > 0 ? `dice: ${dice}` : "";

	const match = fmRegex.exec(content);
	if (match) {
		const existingFm = match[2];
		const hasDiceLine = /^dice:\s*\d*/m.test(existingFm);
		let newFm: string;
		if (hasDiceLine) {
			newFm = diceLine
				? existingFm.replace(/^dice:\s*\d*/m, diceLine)
				: existingFm.replace(/^dice:\s*\d*\n?/m, "");
		} else {
			newFm = diceLine ? (existingFm.trimEnd() + "\n" + diceLine) : existingFm;
		}
		return content.slice(0, match.index) + match[1] + newFm + match[3] + content.slice(match.index + match[0].length);
	}
	// No frontmatter — prepend it
	if (diceLine) {
		return `---\n${diceLine}\n---\n\n` + content;
	}
	return content;
}
