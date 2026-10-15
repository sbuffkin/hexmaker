// Load a generator file from the vault and time solve() on it, with the
// settings saved in the file. Read-only. Usage (from WSL, plugin root):
//   npx tsx dev/wfc-generator-file.mts <generator-name> [cols] [rows] [seeds]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModelMarkdown, solve } from "../packages/hex-wfc/src";

const vault = process.env.VAULT ?? join(process.cwd(), "../../../..");
const pluginDir = join(vault, ".obsidian/plugins/duckmage-plugin");
const data = JSON.parse(readFileSync(join(pluginDir, "data.json"), "utf8"));
const world = String(data.worldFolder ?? "").replace(/^\/+|\/+$/g, "");
const name = process.argv[2] ?? "bay-area-and-the-coast";
const text = readFileSync(join(vault, world, "generators", `${name}.md`), "utf8");
const parsed = parseModelMarkdown(text);
if ("error" in parsed) throw new Error(String(parsed.error));
const model = "model" in parsed ? parsed.model : parsed;
console.log(`${model.name}: ${model.terrains.length} terrains, ${model.adjacency.length} pairs, ${model.features?.length ?? 0} features, ${model.paths?.length ?? 0} path routes, example ${model.exampleHexes}`);
console.log("settings:", JSON.stringify(model.settings ?? {}));
const cols = Number(process.argv[3] ?? 38), rows = Number(process.argv[4] ?? 25);
const seeds = Number(process.argv[5] ?? 3);
for (let seed = 1; seed <= seeds; seed++) {
  const t0 = Date.now();
  const r = solve(model, { cols, rows, orientation: data.hexOrientation ?? "flat", stagger: data.staggerOffset ?? "odd", seed });
  console.log(`seed ${seed}: ${Date.now() - t0} ms ok=${r.ok}`, r.ok ? JSON.stringify(r.stats) : r.message, r.ok ? r.warnings.length + " warnings" : "");
}
