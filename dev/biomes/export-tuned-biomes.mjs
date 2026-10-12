#!/usr/bin/env node
/**
 * Ship the owner's biome tuning (dev-only, git-only; never bundled).
 *
 *   node dev/biomes/export-tuned-biomes.mjs <vault biomes folder> [--only id,id] [--write]
 *
 * Reads every biome note in the folder, compares the fields that shape
 * generation (Mix, Terrain weights, Transitions, blend, land-share,
 * min-islands, shore, climate, Tuning) with the shipped biome data
 * (src/modules/world-maps/biomePresets.ts) and prints the differences.
 * Only with --write is the shipped file rewritten. Notes that aren't a
 * shipped biome are skipped. See dev/biomes/README.md.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { require as tsRequire } from "tsx/cjs/api";
import { formatPlan, planExport, SHIPPED_FILE, shippedBiomesSource } from "./exportTuned.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const write = args.includes("--write");
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? (args[onlyAt + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
if (!folder || !statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
	console.error("Usage: node dev/biomes/export-tuned-biomes.mjs <vault biomes folder> [--only id,id] [--write]");
	process.exit(2);
}

// The TypeScript is loaded in CommonJS mode, as the tests load it (extensionless imports).
const { parseBiomeNote } = tsRequire(join(root, "src/overworld/biomeNote.ts"), import.meta.url);
const { SHIPPED_BIOMES } = tsRequire(join(root, SHIPPED_FILE), import.meta.url);

const notes = readdirSync(folder)
	.filter((f) => f.endsWith(".md") && !f.startsWith("_"))
	.sort()
	.map((f) => ({ name: basename(f, ".md"), content: readFileSync(join(folder, f), "utf8") }));

const plan = planExport(notes, SHIPPED_BIOMES, parseBiomeNote, only);
console.log(formatPlan(plan));
if (!plan.changes.length) process.exit(0);
if (!write) {
	console.log(`\nDry run: nothing written. Run again with --write to update ${SHIPPED_FILE}.`);
	process.exit(0);
}
writeFileSync(join(root, SHIPPED_FILE), shippedBiomesSource(plan.next));
console.log(`\nWrote ${SHIPPED_FILE} (${plan.changes.length} biome${plan.changes.length === 1 ? "" : "s"}). Run npm test, then commit.`);
