// For each terrain in a vault generator: its share of the example, its share
// under the example's paths (by type), and how often paths end on it. Terrain
// that is common but that paths avoid looks impassable. Read-only.
//   VAULT=/mnt/c/.../journal npx tsx dev/wfc-impassable-guess.mts <generator>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModelMarkdown } from "../packages/hex-wfc/src";

const vault = process.env.VAULT ?? join(process.cwd(), "../../../..");
const data = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/duckmage-plugin/data.json"), "utf8"));
const world = String(data.worldFolder ?? "").replace(/^\/+|\/+$/g, "");
const name = process.argv[2] ?? "the-coast";
const parsed = parseModelMarkdown(readFileSync(join(vault, world, "generators", `${name}.md`), "utf8"));
const model = "model" in parsed ? parsed.model : (parsed as never);
const total = model.terrains.reduce((n, t) => n + t.weight, 0);
const paths = model.paths ?? [];
const types = [...new Set(paths.map((p) => p.type))];
// Path-weighted share of each terrain under each type: sum(count * length * through).
const under = new Map<string, Map<string, number>>();
for (const ty of types) {
  const m = new Map<string, number>();
  let w = 0;
  for (const p of paths.filter((p) => p.type === ty)) {
    const pw = p.count * Math.max(p.length, 0.05);
    w += pw;
    for (const [t, s] of Object.entries(p.through)) m.set(t, (m.get(t) ?? 0) + s * pw);
  }
  for (const [t, v] of m) m.set(t, v / (w || 1));
  under.set(ty, m);
}
const ends = new Map<string, number>();
for (const p of paths) for (const e of [p.from, p.to]) if (!["edge", "none", "path"].includes(e)) ends.set(e, (ends.get(e) ?? 0) + p.count);
const rows = model.terrains.map((t) => ({
  terrain: t.name,
  map: t.weight / total,
  ...Object.fromEntries(types.map((ty) => [ty, under.get(ty)!.get(t.name) ?? 0])),
  ends: ends.get(t.name) ?? 0,
}));
const pct = (v: number) => (v * 100).toFixed(1).padStart(5) + "%";
console.log(`${name}: ${paths.length} routes (${types.join(", ")})`);
console.log("terrain".padEnd(20) + " map   " + types.map((t) => t.slice(0, 6).padStart(7)).join("") + "  ends");
for (const r of rows.sort((a, b) => b.map - a.map))
  console.log(r.terrain.padEnd(20) + pct(r.map) + types.map((t) => pct((r as Record<string, number>)[t]).padStart(7)).join("") + String(r.ends).padStart(6));
