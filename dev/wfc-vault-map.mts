// Learn a generator from a real map in the vault (read-only) and print it plus
// a generated sample. Usage (from WSL, plugin root):
//   npx tsx dev/wfc-vault-map.mts <map-name> [seed] [cols] [rows]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { learnModel, solve, modelToMarkdown, cellKey } from "../packages/hex-wfc/src";
const vault = join(process.cwd(), "../../../.."); // plugin lives in <vault>/.obsidian/plugins/<id>
const pluginDir = existsSync("data.json") ? "." : join(vault, ".obsidian/plugins/duckmage-plugin");
const data = JSON.parse(readFileSync(join(pluginDir, "data.json"), "utf8"));
const name = process.argv[2] ?? "bay-area";
const map = data.maps.find((m: { name: string }) => m.name === name);
if (!map) throw new Error(`no map ${name}`);
const vaultRoot = join(pluginDir, "../../..");
const cells = new Map<string, string>();
for (let x = map.gridOffset.x; x < map.gridOffset.x + map.gridSize.cols; x++)
  for (let y = map.gridOffset.y; y < map.gridOffset.y + map.gridSize.rows; y++) {
    const f = join(vaultRoot, data.hexFolder, name, `${x}_${y}.md`);
    if (!existsSync(f)) continue;
    const m = /^---[\s\S]*?\nterrain:\s*(.*)\n/.exec(readFileSync(f, "utf8"));
    const t = m?.[1].trim().replace(/^"|"$/g, "");
    if (t) cells.set(cellKey(x, y), t);
  }
const orientation = data.hexOrientation ?? "flat";
const stagger = map.staggerOffset ?? data.staggerOffset ?? "odd";
const model = learnModel(cells, {
  name, orientation, stagger,
  paths: map.pathChains.map((p: { typeName: string; hexes: string[] }) => ({ type: p.typeName, hexes: p.hexes })),
  meta: { palette: map.paletteName, "source-map": name },
});
console.log(modelToMarkdown(model).split("\n").filter((l) => l.startsWith("|") || l.startsWith("##")).join("\n"));
const seed = Number(process.argv[3] ?? 1), cols = Number(process.argv[4] ?? map.gridSize.cols), rows = Number(process.argv[5] ?? map.gridSize.rows);
const glyphs = new Map<string, string>();
const g = (t: string) => { if (!glyphs.has(t)) glyphs.set(t, "abcdefghijklmnop"[glyphs.size]); return glyphs.get(t)!; };
for (const t of model.terrains) g(t.name);
const r = solve(model, { cols, rows, orientation, stagger, seed });
if (!r.ok) { console.log(r.message); process.exit(); }
const onPath = new Map<string, string>();
for (const p of r.paths) for (const h of p.hexes) onPath.set(h, p.type[0].toUpperCase());
console.log(`\n${cols}x${rows}`, JSON.stringify(r.stats), r.warnings, [...glyphs].map(([t, c]) => `${c}=${t}`).join(" "));
console.log("paths:", r.paths.map((p) => `${p.type}:${p.hexes.length} ${p.hexes[0]}→${p.hexes[p.hexes.length - 1]}`).join(", "));
for (let y = 0; y < rows; y++) { let s = ""; for (let x = 0; x < cols; x++) { const k = cellKey(x, y); s += onPath.get(k) ?? g(r.cells.get(k)!); } console.log(s); }
