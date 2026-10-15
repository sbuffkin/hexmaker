// Compare generators between two copies of the hex-wfc library (e.g. before
// and after a change): paths running along the map border, and how well
// terrain follows its layout. Read-only.
//   npx tsx dev/wfc-compare.mts <lib-dir> <generator.md>... (env SEEDS, COLS, ROWS)
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const [libDir, ...files] = process.argv.slice(2);
const lib = await import(pathToFileURL(`${libDir}/index.ts`).href);
const seeds = Number(process.env.SEEDS ?? 12), cols = Number(process.env.COLS ?? 38), rows = Number(process.env.ROWS ?? 25);

for (const file of files) {
  const parsed = lib.parseModelMarkdown(readFileSync(file, "utf8"));
  if (!("model" in parsed)) { console.log(basename(file), "parse failed"); continue; }
  const model = parsed.model;
  let pathHexes = 0, borderHexes = 0, paths = 0, fails = 0, warnings = 0;
  // Layout fit: mean layout value at the hexes each terrain lands on (1 = no better than chance).
  let fitSum = 0, fitN = 0;
  const layouts = new Map<string, number[]>(model.terrains.filter((t: { layout?: number[] }) => t.layout).map((t: { name: string; layout: number[] }) => [t.name, t.layout]));
  const valueAt = (lay: number[], fx: number, fy: number): number => {
    if (lib.layoutValue) return lib.layoutValue(lay, fx, fy);
    const bx = Math.min(2, Math.floor(fx * 3)), by = Math.min(2, Math.floor(fy * 3));
    return lay[by * 3 + bx];
  };
  for (let seed = 1; seed <= seeds; seed++) {
    const r = lib.solve(model, { cols, rows, orientation: "flat", stagger: "odd", seed });
    if (!r.ok) { fails++; continue; }
    warnings += r.warnings.length;
    for (const p of r.paths) {
      paths++;
      for (const h of p.hexes.slice(1, -1)) {
        const [x, y] = h.split("_").map(Number);
        pathHexes++;
        if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) borderHexes++;
      }
    }
    for (const [k, t] of r.cells) {
      const lay = layouts.get(t);
      if (!lay) continue;
      const [x, y] = k.split("_").map(Number);
      fitSum += valueAt(lay, (x + 0.5) / cols, (y + 0.5) / rows);
      fitN++;
    }
  }
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + "%" : "–");
  console.log(
    `${basename(file, ".md").padEnd(24)} paths ${String(paths).padStart(3)}  on-border ${pct(borderHexes, pathHexes).padStart(6)}  layout-fit ${fitN ? (fitSum / fitN).toFixed(2) : " –  "}  fails ${fails}  warnings ${warnings}`,
  );
}
