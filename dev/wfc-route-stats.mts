// Per-route placement over several seeds of a vault generator, with its saved
// settings, optionally overriding impassable. Read-only. Usage (WSL, plugin root):
//   VAULT=/mnt/c/.../journal npx tsx --tsconfig ./tsconfig.test.json --import ./tests/register.mjs \
//     dev/wfc-route-stats.ts <generator> [cols] [rows] [seeds] [impassable,list|-]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModelMarkdown, solve } from "../packages/hex-wfc/src";

const vault = process.env.VAULT ?? join(process.cwd(), "../../../..");
const data = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/duckmage-plugin/data.json"), "utf8")) as Record<string, unknown>;
const world = String(data.worldFolder ?? "").replace(/^\/+|\/+$/g, "");
const [name = "bay-area", c = "25", r = "16", n = "10", imp] = process.argv.slice(2);
const parsed = parseModelMarkdown(readFileSync(join(vault, world, "generators", `${name}.md`), "utf8"));
if (!("model" in parsed)) throw new Error("not a generator");
const model = parsed.model;
const override = imp === undefined ? {} : { impassable: imp === "-" ? [] : imp.split(",") };
const stats = new Map<string, { wanted: number; placed: number }>();
for (let seed = 1; seed <= Number(n); seed++) {
  const res = solve(model, { cols: Number(c), rows: Number(r), orientation: (data.hexOrientation as "flat") ?? "flat", seed, ...override });
  if (!res.ok) continue;
  for (const st of res.pathRoutes) {
    const e = stats.get(st.route) ?? { wanted: 0, placed: 0 };
    e.wanted += st.wanted;
    e.placed += st.placed;
    stats.set(st.route, e);
  }
}
console.log(`${name} ${c}x${r}, ${n} seeds, impassable ${JSON.stringify(override.impassable ?? model.settings?.impassable ?? "(saved/default)")}`);
for (const [route, e] of stats) console.log(`  ${route.padEnd(40)} placed ${e.placed} of ${e.wanted}`);
