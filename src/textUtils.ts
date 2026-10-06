/**
 * Pure text helpers shared by the parsers and editors (no Obsidian imports).
 */

/** Escape a string so it matches literally inside a RegExp. */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a Markdown table row into trimmed cells.
 * - `\|` is a literal pipe inside a cell (Obsidian's escape), returned as `|`.
 * - A `|` inside `[[...]]` (a wiki-link alias) doesn't split the cell.
 * Returns null if the line isn't a table row.
 */
export function splitTableRow(line: string): string[] | null {
	const s = line.trim();
	if (!s.startsWith("|")) return null;
	const cells: string[] = [];
	let cur = "";
	let linkDepth = 0;
	for (let i = 1; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\\" && s[i + 1] === "|") {
			cur += "|";
			i++;
		} else if (ch === "[" && s[i + 1] === "[") {
			linkDepth++;
			cur += "[[";
			i++;
		} else if (ch === "]" && s[i + 1] === "]" && linkDepth > 0) {
			linkDepth--;
			cur += "]]";
			i++;
		} else if (ch === "|" && linkDepth === 0) {
			cells.push(cur.trim());
			cur = "";
		} else {
			cur += ch;
		}
	}
	if (cur.trim()) cells.push(cur.trim());
	return cells;
}

/** Escape pipes so text can sit in a Markdown table cell. */
export function escapeTableCell(s: string): string {
	return s.replace(/\\?\|/g, "\\|");
}

/**
 * Replace every placeholder in `template` with its value, in one pass.
 * - A placeholder only matches as a whole token: `$x_1` never matches inside
 *   `$x_10`, nor `$Loot` inside `$Loot_extra`.
 * - Values are inserted literally (`$&`, `$1` in a value stay as typed) and
 *   are never themselves searched for placeholders.
 */
export function fillPlaceholders(template: string, values: Map<string, string>): string {
	if (!values.size) return template;
	const keys = [...values.keys()].sort((a, b) => b.length - a.length);
	const re = new RegExp(`(?:${keys.map(escapeRegex).join("|")})(?![\\w])`, "g");
	return template.replace(re, (m) => values.get(m) ?? m);
}

/** RegExp source matching exactly this placeholder (not a longer one that starts with it). */
export function placeholderPattern(placeholder: string): string {
	return `${escapeRegex(placeholder)}(?![\\w])`;
}
