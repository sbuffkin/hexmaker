/**
 * Where a note the plugin writes came from, recorded in its frontmatter so
 * the raw note says it (workflow results, exports). Pure: no Obsidian
 * imports.
 */

/** Local date and time as Obsidian's date & time property writes it: 2026-10-10T14:03:00. */
export function localIsoDateTime(d: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** A wiki-link to a vault path (".md" dropped), quoted for YAML: "[[world/tables/aspects]]". */
export function yamlLink(path: string): string {
	return JSON.stringify(`[[${path.replace(/\.md$/i, "")}]]`);
}

/**
 * Set top-level frontmatter keys to raw YAML values, adding a frontmatter
 * block when there isn't one. Keys already there are replaced in place;
 * every other line is kept as typed.
 */
export function withFrontmatterEntries(content: string, entries: [key: string, yaml: string][]): string {
	// The block uses the note's first line ending; the rest is kept byte for byte.
	const eol = /^[^\n]*\r\n/.test(content) ? "\r\n" : "\n";
	const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(content);
	const lines = m ? (m[1] === "" ? [] : m[1].split(/\r?\n/)) : [];
	for (const [key, yaml] of entries) {
		const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
		const at = lines.findIndex((l) => keyRe.test(l));
		const line = `${key}: ${yaml}`;
		if (at >= 0) lines[at] = line;
		else lines.push(line);
	}
	const rest = m ? content.slice(m[0].length) : content;
	return ["---", ...lines, "---", ""].join(eol) + rest;
}
