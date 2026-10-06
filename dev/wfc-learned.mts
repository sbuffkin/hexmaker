// Prints what a generator learns from the dev example maps.
// Usage (from WSL): npx tsx dev/wfc-learned.mts
import { learnModel, cellKey, hexNeighbors } from "../packages/hex-wfc/src";
const world = new Map<string, string>();
const lakes = [[12, 14, 4], [36, 34, 3.5]], forests = [[38, 10, 5], [10, 38, 4]];
for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) {
  let t = "Grass";
  for (const [fx, fy, r] of forests) if ((x - fx) ** 2 + (y - fy) ** 2 < r * r) t = "Forest";
  if (x > 18 && x < 46 && Math.abs(y - (0.6 * x + 8 + 3 * Math.sin(x / 5))) < 1.1) t = "Ridge";
  for (const [lx, ly, r] of lakes) { const d = Math.hypot(x - lx, y - ly); if (d < r) t = "Water"; else if (d < r + 1.3) t = "Sand"; }
  world.set(cellKey(x, y), t);
}
const coast = new Map<string, string>();
for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) {
  const c = 30 + 2 * Math.sin(x / 4);
  let t = y > c ? "Ocean" : y > c - 1.5 ? "Sand" : "Grass";
  if (t === "Grass" && Math.hypot(x - 8, y - 8) < 6) t = "Forest";
  if (t === "Grass" && y < 20 && x > 16 && (x * 7 + y * 13) % 29 === 0) t = "Town";
  coast.set(cellKey(x, y), t);
}
for (const [name, ex] of [["world", world], ["coast", coast]] as const) {
  const m = learnModel(ex, { name, orientation: "flat" });
  console.log(`\n${name}:`);
  for (const t of m.terrains) console.log(" ", t.name.padEnd(7), (t.shape ?? "").padEnd(8), `patch ${((t.patch ?? 0) * 100).toFixed(1)}%`, t.width ? `width ${t.width}` : "", t.turn ? `turn ${t.turn}` : "", t.spacing ? `spacing ${t.spacing}` : "", t.edge ? `edge ${t.edge}` : "");
  console.log("  features:", JSON.stringify(m.features ?? []));
}

// River example: a winding 1-wide river from the top edge into a lake,
// walked along real hex neighbours so it is one connected line.
export function riverExample(): Map<string, string> {
  const m = new Map<string, string>();
  for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) {
    const d = Math.hypot(x - 26, y - 28);
    m.set(cellKey(x, y), d < 4.5 ? "Water" : d < 5.8 ? "Sand" : "Grass");
  }
  let cur: [number, number] = [8, 0];
  for (let step = 0; step < 80; step++) {
    m.set(cellKey(cur[0], cur[1]), "River");
    const ns = hexNeighbors(cur[0], cur[1], "flat", "odd");
    if (ns.some(([x, y]) => m.get(cellKey(x, y)) === "Water")) break;
    // Head for the lake, wobbling sideways every few steps.
    const wobble = Math.sin(step / 3) * 6;
    const goal: [number, number] = [26 + wobble, 28];
    ns.sort((a, b) => Math.hypot(a[0] - goal[0], a[1] - goal[1]) - Math.hypot(b[0] - goal[0], b[1] - goal[1]));
    cur = ns.find(([x, y]) => m.get(cellKey(x, y)) !== "River" && x >= 0 && y >= 0)!;
  }
  return m;
}
const rm = learnModel(riverExample(), { name: "river", orientation: "flat" });
console.log("\nriver:");
for (const t of rm.terrains) console.log(" ", t.name.padEnd(7), (t.shape ?? "").padEnd(8), `patch ${((t.patch ?? 0) * 100).toFixed(1)}%`, t.width ? `width ${t.width}` : "", t.turn ? `turn ${t.turn}` : "");
console.log("  features:", JSON.stringify(rm.features ?? []));
