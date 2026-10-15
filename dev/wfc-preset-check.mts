// Check a hand-written generator file: parse it (printing any format
// warnings), generate maps from a few seeds and print each as text, with
// terrain shares, path placement and solver warnings. Read-only.
//
// Usage (WSL, plugin root):
//   npx tsx dev/wfc-preset-check.mts <path/to/generator.md> [cols] [rows] [seeds] [first-seed]
// Odd columns are drawn half a row lower (flat-top hexes, "odd" stagger), so
// each pair of text rows is one hex row.
import { readFileSync } from "node:fs";
import { parseModelMarkdown, solve, cellKey } from "../packages/hex-wfc/src";

const [file, c = "30", r = "20", n = "3", s0 = "1"] = process.argv.slice(2);
if (!file) throw new Error("usage: wfc-preset-check.mts <generator.md> [cols] [rows] [seeds] [first-seed]");
const parsed = parseModelMarkdown(readFileSync(file, "utf8"));
if (!("model" in parsed)) {
  console.log("PARSE ERROR:", JSON.stringify(parsed));
  process.exit(1);
}
const { model, warnings } = parsed as { model: import("../packages/hex-wfc/src").HexWfcModel; warnings: string[] };
console.log(`${model.name}: ${model.terrains.length} terrains, ${model.adjacency.length} pairs, ${model.features?.length ?? 0} features, ${model.paths?.length ?? 0} path routes`);
if (warnings?.length) console.log("FORMAT WARNINGS:\n  " + warnings.join("\n  "));
console.log("settings:", JSON.stringify(model.settings ?? {}));

// One printable glyph per terrain, most common first.
const GLYPHS = "~.^#%*+=-:oO@&$!?ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijklmnpqrstuvwxyz0123456789";
const glyph = new Map(model.terrains.map((t, i) => [t.name, GLYPHS[i] ?? "?"]));
console.log("legend: " + model.terrains.map((t) => `${glyph.get(t.name)}=${t.name}`).join("  "));

const cols = Number(c), rows = Number(r);
for (let k = 0; k < Number(n); k++) {
  const seed = Number(s0) + k;
  const t0 = Date.now();
  const res = solve(model, { cols, rows, orientation: "flat", stagger: "odd", seed });
  if (!res.ok) {
    console.log(`\nseed ${seed}: FAILED (${res.reason}) ${res.message}`);
    continue;
  }
  const onPath = new Map<string, string>();
  for (const p of res.paths) for (const h of p.hexes) onPath.set(h, p.type === "Road" ? "R" : p.type[0].toLowerCase() === "r" ? "|" : "/");
  console.log(`\nseed ${seed}: ${cols}x${rows} in ${Date.now() - t0} ms`);
  // Two text rows per hex row: even columns on the first, odd columns (shifted down) on the second.
  for (let y = 0; y < rows; y++) {
    for (const parity of [0, 1]) {
      let line = "  ";
      for (let x = 0; x < cols; x++) {
        if (x % 2 !== parity) { line += " "; continue; }
        const key = cellKey(x, y);
        line += onPath.get(key) ?? glyph.get(res.cells.get(key) ?? "") ?? " ";
      }
      console.log(line);
    }
  }
  const counts = new Map<string, number>();
  for (const t of res.cells.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
  console.log("  shares: " + [...counts].sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${Math.round((100 * v) / res.cells.size)}%`).join(", "));
  if (res.paths.length) console.log("  paths: " + res.paths.map((p) => `${p.type} ${p.hexes.length} hexes`).join(", ") + "   (R road, | river, / other)");
  if (res.warnings.length) console.log("  warnings: " + res.warnings.join(" | "));
}
