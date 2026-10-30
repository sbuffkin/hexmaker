/**
 * The pure part of dev/biomes/export-tuned-biomes.mjs (dev-only, never
 * bundled): compare tuned biome notes with the shipped biome data and write
 * the shipped data file. Takes the biome-note parser as an argument so it
 * stays plain JavaScript (the script loads the TypeScript with tsx).
 */

/** The shipped data file, relative to the repo root. */
export const SHIPPED_FILE = "src/modules/world-maps/biomePresets.ts";

/**
 * Fields carried from a tuned note into the shipped data: everything that
 * shapes generation and placement. Label, colour, the generator link (a
 * vault path), parent and blank stay as shipped.
 */
export const EXPORT_FIELDS = ["mix", "terrainWeights", "transitions", "blend", "landShare", "minIslands", "shore", "climate", "tuning"];

/** A field as compared: missing, undefined and empty lists/objects alike. */
function norm(v, field) {
	if (v === undefined || v === null || v === false) return undefined;
	// Transitions and Mix are always written (empty lists stay lists); other empties are "none".
	if (Array.isArray(v) && !v.length) return field === "mix" || field === "transitions" ? [] : undefined;
	if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) return undefined;
	return v;
}

const show = (v) => (v === undefined ? "(none)" : JSON.stringify(v));

/**
 * What exporting `notes` would change.
 * @param notes   [{ name, content }] read from the vault folder
 * @param shipped the shipped biomes (BIOME_PRESETS)
 * @param parse   parseBiomeNote(content, basename) → { fields, problems }
 * @param only    ids to export (empty: all)
 * @returns { changes: [{ id, label, fields: [{ field, from, to }] }], skipped: [string], next: shipped list with the changes }
 */
export function planExport(notes, shipped, parse, only = []) {
	const next = shipped.map((b) => ({ ...b }));
	const changes = [];
	const skipped = [];
	for (const n of notes) {
		const { fields, problems } = parse(n.content, n.name);
		const i = next.findIndex((b) => b.id === fields.id);
		if (i < 0) { skipped.push(`${n.name}: not a shipped biome (id ${fields.id})`); continue; }
		if (only.length && !only.includes(fields.id)) continue;
		if (problems.length) skipped.push(`${n.name}: ${problems.length} unreadable bit(s), e.g. ${problems[0].where}: ${problems[0].text}`);
		const cur = next[i];
		const diff = [];
		for (const f of EXPORT_FIELDS) {
			const from = norm(cur[f], f), to = norm(fields[f], f);
			if (JSON.stringify(from) === JSON.stringify(to)) continue;
			diff.push({ field: f, from, to });
			if (to === undefined) delete cur[f];
			else cur[f] = to;
		}
		if (diff.length) changes.push({ id: cur.id, label: cur.label, fields: diff });
	}
	return { changes, skipped, next };
}

/** The diff as text, for the terminal. */
export function formatPlan(plan) {
	const out = [];
	for (const c of plan.changes) {
		out.push(`${c.label} (${c.id})`);
		for (const d of c.fields) {
			out.push(`  ${d.field}:`);
			out.push(`    - ${show(d.from)}`);
			out.push(`    + ${show(d.to)}`);
		}
	}
	if (!plan.changes.length) out.push("No changes: the shipped biomes already match.");
	for (const s of plan.skipped) out.push(`Skipped ${s}`);
	return out.join("\n");
}

/** The shipped data file's text: one biome per line, so a diff shows which biome changed. */
export function shippedBiomesSource(list) {
	return [
		"/**",
		" * The shipped biomes as data (#50): written into biome notes once by",
		" * BiomeStore (seedBiomeNotes), then the notes are what counts. See",
		" * src/overworld/biomePresets.ts for what each field means.",
		" *",
		" * Hand edits are fine; tuned values from a vault's biome notes are copied",
		" * in with dev/biomes/export-tuned-biomes.mjs (see dev/biomes/README.md),",
		" * which rewrites this file one biome per line.",
		" *",
		" * Pure data.",
		" */",
		"",
		'import type { BiomePreset } from "../../overworld/biomePresets";',
		"",
		"export const SHIPPED_BIOMES: readonly BiomePreset[] = [",
		...list.map((b) => `  ${JSON.stringify(b)},`),
		"];",
		"",
	].join("\n");
}
