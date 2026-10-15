/**
 * Overworld preview (plan-overworld-regions §6.1, phase 0 checkpoint).
 * Generates a 19-hex overworld with World biomes, then every region with
 * the real blend field + region generator, and draws the stitched world for
 * brick 8×8 and hex-flower r=4 regions, with per-seam continuity scores.
 *
 * Build: npx esbuild dev/overworld-preview.ts --bundle --format=iife --loader:.md=text --outfile=dev/overworld-preview.js
 * Serve: npm run sandbox → /dev/overworld-preview.html
 * Hooks: window.__runWorld(opts) → stats, window.__seamStats() → per-seam rows.
 */
import { hexCenter, hexDistance, type Orientation } from "../packages/hex-wfc/src/grid";
import { mulberry32 } from "../packages/hex-wfc/src/rng";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { inferTerrainType } from "../src/terrainTypes";
import { BUILTIN_GENERATORS, builtinModel } from "../src/worldgen/builtinGenerators";
import { BIOMES, biomeInfo, biomeProfiles } from "../src/overworld/biomes";
import { BlendField, REGION_WARP } from "../src/overworld/blendField";
import { childNeighbours, parentOf, regionCellCount, type RegionLayout } from "../src/overworld/layout";
import { generateRegion, interiorAgreement, seamStats, spiralOrder, type SeamStat } from "../src/overworld/regionGen";
import { worldBiomes, type Climate } from "../src/overworld/worldBiomes";

const PALETTE = DEFAULT_TERRAIN_PALETTE;
const COLOR = new Map(PALETTE.map((t) => [t.name, t.color]));
const TYPE = new Map(PALETTE.map((t) => [t.name, t.type ?? inferTerrainType(t.name, t.category, "world")]));
const typeOf = (t: string) => TYPE.get(t);
const MODELS = new Map(BUILTIN_GENERATORS.map((g) => [g.slug, builtinModel(g.slug)]));
const PROFILES = biomeProfiles(MODELS, PALETTE);

interface Opts {
  seed: number;
  k: number;
  warp: number;
  climate: Climate;
  water: number;
  view: "both" | "rect" | "hex";
  overworldOnly: boolean;
  order: "spiral" | "shuffled";
  heat: string;
  orientation: Orientation;
}
const opts: Opts = { seed: 7, k: 3.5, warp: REGION_WARP, climate: "varied", water: 0.25, view: "both", overworldOnly: false, order: "spiral", heat: "", orientation: "flat" };

interface Footprint { label: string; layout: RegionLayout; cells: Map<string, string>; field: BlendField; seams: SeamStat[]; interior: number; ms: number }
let last: { parents: [number, number][]; world: ReturnType<typeof worldBiomes>; prints: Footprint[] } | null = null;

const OW_R = 2; // 19 overworld hexes
const CENTRE: [number, number] = [OW_R, OW_R];

function overworldCells(o: Orientation): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x <= 2 * OW_R; x++) for (let y = 0; y <= 2 * OW_R; y++) if (hexDistance([x, y], CENTRE, o, "odd") <= OW_R) out.push([x, y]);
  return out;
}

function run(o: Partial<Opts> = {}) {
  Object.assign(opts, o);
  const parents = overworldCells(opts.orientation);
  const world = worldBiomes(parents, opts.orientation, "odd", PALETTE, { seed: opts.seed, climate: opts.climate, water: opts.water });
  const layouts: [string, RegionLayout][] = [
    ["Brick 8×8", { footprint: "rect", size: 8, orientation: opts.orientation, parentStagger: "odd", childStagger: "odd" }],
    ["Hex flower r=4", { footprint: "hex", size: 4, orientation: opts.orientation, parentStagger: "odd", childStagger: "odd" }],
  ];
  const prints: Footprint[] = layouts.map(([label, layout]) => {
    const t0 = performance.now();
    const field = new BlendField(layout, world.biomes, opts.k, { warp: opts.warp, seed: opts.seed });
    let order = spiralOrder(parents, CENTRE, (a, b) => hexDistance(a, b, opts.orientation, "odd"));
    if (opts.order === "shuffled") {
      const rng = mulberry32(opts.seed ^ 0xabc);
      order = order.map((p) => [rng(), p] as [number, [number, number]]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    }
    const cells = new Map<string, string>();
    for (const p of order) {
      for (const [k, v] of generateRegion({ layout, parent: p, field, profiles: PROFILES, pinned: cells, typeOf, seed: opts.seed })) cells.set(k, v);
    }
    return { label, layout, cells, field, seams: seamStats(layout, cells, typeOf), interior: interiorAgreement(layout, cells, typeOf), ms: performance.now() - t0 };
  });
  last = { parents, world, prints };
  draw();
  return stats();
}

function stats() {
  if (!last) return null;
  return {
    seed: opts.seed,
    k: opts.k,
    warp: opts.warp,
    overworld: Object.fromEntries([...last.world.biomes]),
    footprints: last.prints.map((p) => ({
      label: p.label,
      cellsPerRegion: regionCellCount(p.layout),
      totalCells: p.cells.size,
      ms: Math.round(p.ms),
      seamTypeAgreement: weighted(p.seams, "typeAgreement"),
      seamNameAgreement: weighted(p.seams, "nameAgreement"),
      interiorTypeAgreement: p.interior,
      worstSeam: [...p.seams].sort((a, b) => a.typeAgreement - b.typeAgreement)[0],
    })),
  };
}
const weighted = (s: SeamStat[], f: "typeAgreement" | "nameAgreement") => s.reduce((a, x) => a + x[f] * x.pairs, 0) / Math.max(1, s.reduce((a, x) => a + x.pairs, 0));

// ── drawing ──────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, o: Orientation) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + (o === "pointy" ? Math.PI / 6 : 0);
    const x = cx + s * Math.cos(a), y = cy + s * Math.sin(a);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** Red (0) → amber → green (1). */
const scoreColour = (v: number) => `hsl(${Math.round(Math.max(0, Math.min(1, (v - 0.4) / 0.6)) * 120)}, 85%, 55%)`;

function drawOverworld() {
  const cv = $<HTMLCanvasElement>("ow");
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!last) return;
  const pts = last.parents.map(([x, y]) => hexCenter(x, y, opts.orientation, "odd"));
  const minX = Math.min(...pts.map((p) => p[0])), minY = Math.min(...pts.map((p) => p[1]));
  const s = 20;
  last.parents.forEach(([x, y], i) => {
    const k = `${x}_${y}`;
    const cx = (pts[i][0] - minX) * s + 30, cy = (pts[i][1] - minY) * s + 30;
    hexPath(ctx, cx, cy, s, opts.orientation);
    ctx.fillStyle = COLOR.get(last!.world.terrain.get(k) ?? "") ?? "#333";
    ctx.fill();
    ctx.strokeStyle = last!.world.ecotones.has(k) ? "#fff" : "#111";
    ctx.lineWidth = last!.world.ecotones.has(k) ? 2.5 : 1;
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.font = "9px system-ui";
    ctx.textAlign = "center";
    ctx.fillText((biomeInfo(last!.world.biomes.get(k)!)?.label ?? "").slice(0, 10), cx, cy + 3);
  });
  // river
  if (last.world.river.length > 1) {
    ctx.beginPath();
    last.world.river.forEach((k, i) => {
      const [x, y] = k.split("_").map(Number);
      const [px, py] = hexCenter(x, y, opts.orientation, "odd");
      const X = (px - minX) * s + 30, Y = (py - minY) * s + 30;
      if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    });
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawFootprint(fp: Footprint, cv: HTMLCanvasElement) {
  const ctx = cv.getContext("2d")!;
  const l = fp.layout;
  const keys = [...fp.cells.keys()];
  const pts = keys.map((k) => { const [x, y] = k.split("_").map(Number); return hexCenter(x, y, l.orientation, l.childStagger); });
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const W = cv.width - 20, H = cv.height - 20;
  const scale = Math.min(W / (maxX - minX + 2), H / (maxY - minY + 2));
  const X = (v: number) => (v - minX + 1) * scale + 10, Y = (v: number) => (v - minY + 1) * scale + 10;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const owner = new Map<string, string>();
  keys.forEach((k, i) => {
    const [x, y] = k.split("_").map(Number);
    const p = parentOf(l, x, y).join("_");
    owner.set(k, p);
    const t = opts.overworldOnly ? last!.world.terrain.get(p) ?? "" : fp.cells.get(k)!;
    hexPath(ctx, X(pts[i][0]), Y(pts[i][1]), scale * 1.02, l.orientation);
    ctx.fillStyle = COLOR.get(t) ?? "#333";
    ctx.fill();
    if (opts.heat) {
      const v = fp.field.at(x, y).get(opts.heat) ?? 0;
      ctx.fillStyle = `rgba(255, 0, 200, ${(v * 0.75).toFixed(3)})`;
      ctx.fill();
    }
  });
  // Seams, coloured by that seam's type agreement.
  const score = new Map(fp.seams.map((s) => [`${s.a}|${s.b}`, s.typeAgreement]));
  ctx.lineWidth = Math.max(1.5, scale * 0.28);
  keys.forEach((k, i) => {
    const [x, y] = k.split("_").map(Number);
    const me = owner.get(k)!;
    for (const [a, b] of childNeighbours(l, x, y)) {
      const nk = `${a}_${b}`;
      const other = owner.get(nk);
      if (!other || other === me || nk < k) continue;
      const [qx, qy] = hexCenter(a, b, l.orientation, l.childStagger);
      const mx = (pts[i][0] + qx) / 2, my = (pts[i][1] + qy) / 2;
      const dx = qx - pts[i][0], dy = qy - pts[i][1];
      const len = Math.hypot(dx, dy);
      const ux = -dy / len / 2, uy = dx / len / 2; // half an edge (edge = 1 unit)
      const id = me < other ? `${me}|${other}` : `${other}|${me}`;
      ctx.strokeStyle = scoreColour(score.get(id) ?? 1);
      ctx.beginPath();
      ctx.moveTo(X(mx - ux), Y(my - uy));
      ctx.lineTo(X(mx + ux), Y(my + uy));
      ctx.stroke();
    }
  });
}

function draw() {
  if (!last) return;
  drawOverworld();
  const wall = $("wall");
  wall.replaceChildren();
  for (const fp of last.prints) {
    if (opts.view === "rect" && fp.layout.footprint !== "rect") continue;
    if (opts.view === "hex" && fp.layout.footprint !== "hex") continue;
    const fig = document.createElement("figure");
    const cv = document.createElement("canvas");
    cv.width = opts.view === "both" ? 620 : 1000;
    cv.height = opts.view === "both" ? 620 : 900;
    fig.appendChild(cv);
    const cap = document.createElement("figcaption");
    cap.textContent = `${fp.label} · ${regionCellCount(fp.layout)} hexes per region · ${fp.cells.size} total · ${Math.round(fp.ms)} ms · seam type agreement ${(weighted(fp.seams, "typeAgreement") * 100).toFixed(0)}% (name ${(weighted(fp.seams, "nameAgreement") * 100).toFixed(0)}%) vs interior ${(fp.interior * 100).toFixed(0)}%`;
    fig.appendChild(cap);
    wall.appendChild(fig);
    drawFootprint(fp, cv);
  }
  drawSeamTable();
  drawLegend();
  document.title = "ready";
}

function drawSeamTable() {
  const box = $("seams");
  box.replaceChildren();
  if (!last) return;
  for (const fp of last.prints) {
    const t = document.createElement("table");
    const cap = t.createCaption();
    cap.textContent = `${fp.label}: per-seam continuity (worst first)`;
    const head = t.insertRow();
    for (const h of ["Seam", "Biomes", "Pairs", "Type", "Name"]) { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); }
    for (const s of [...fp.seams].sort((a, b) => a.typeAgreement - b.typeAgreement)) {
      const r = t.insertRow();
      const label = (k: string) => biomeInfo(last!.world.biomes.get(k) ?? "")?.label ?? k;
      for (const v of [`${s.a} | ${s.b}`, `${label(s.a)} / ${label(s.b)}`, String(s.pairs), `${(s.typeAgreement * 100).toFixed(0)}%`, `${(s.nameAgreement * 100).toFixed(0)}%`]) r.insertCell().textContent = v;
      (r.cells[3] as HTMLElement).style.color = scoreColour(s.typeAgreement);
    }
    box.appendChild(t);
  }
}

function drawLegend() {
  const box = $("legend");
  box.replaceChildren();
  if (!last) return;
  const used = new Set<string>();
  for (const fp of last.prints) for (const t of fp.cells.values()) used.add(t);
  for (const t of PALETTE) {
    if (!used.has(t.name)) continue;
    const s = document.createElement("span");
    const i = document.createElement("i");
    i.style.background = t.color;
    s.append(i, t.name);
    box.appendChild(s);
  }
}

// ── controls ─────────────────────────────────────────────────────────────

function wire() {
  const seed = $<HTMLInputElement>("seed");
  const k = $<HTMLInputElement>("k");
  const kv = $("kv");
  const warp = $<HTMLInputElement>("warp");
  const wv = $("wv");
  const heat = $<HTMLSelectElement>("heat");
  for (const b of BIOMES) { const o = document.createElement("option"); o.value = b.id; o.textContent = b.label; heat.appendChild(o); }
  const sync = () => {
    seed.value = String(opts.seed);
    k.value = String(opts.k);
    warp.value = String(opts.warp);
    wv.textContent = opts.warp.toFixed(2);
    kv.textContent = `k = ${opts.k.toFixed(2)} ${opts.k >= 5.5 ? "(narrow)" : opts.k <= 2.25 ? "(wide)" : Math.abs(opts.k - 3.5) < 0.3 ? "(normal)" : ""}`;
  };
  const go = (o: Partial<Opts>) => { document.title = "drawing"; run(o); sync(); };
  seed.addEventListener("change", () => go({ seed: Number(seed.value) >>> 0 }));
  $("reroll").addEventListener("click", () => go({ seed: Math.floor(Math.random() * 1e6) }));
  k.addEventListener("input", () => { opts.k = Number(k.value); sync(); });
  k.addEventListener("change", () => go({ k: Number(k.value) }));
  warp.addEventListener("input", () => { wv.textContent = Number(warp.value).toFixed(2); });
  warp.addEventListener("change", () => go({ warp: Number(warp.value) }));
  $<HTMLSelectElement>("climate").addEventListener("change", (e) => go({ climate: (e.target as HTMLSelectElement).value as Climate }));
  $<HTMLInputElement>("water").addEventListener("change", (e) => go({ water: Number((e.target as HTMLInputElement).value) / 100 }));
  $<HTMLSelectElement>("view").addEventListener("change", (e) => { opts.view = (e.target as HTMLSelectElement).value as Opts["view"]; draw(); });
  $<HTMLSelectElement>("order").addEventListener("change", (e) => go({ order: (e.target as HTMLSelectElement).value as Opts["order"] }));
  $<HTMLSelectElement>("orient").addEventListener("change", (e) => go({ orientation: (e.target as HTMLSelectElement).value as Orientation }));
  $<HTMLInputElement>("owonly").addEventListener("change", (e) => { opts.overworldOnly = (e.target as HTMLInputElement).checked; draw(); });
  heat.addEventListener("change", () => { opts.heat = heat.value; draw(); });
  sync();
}

declare global {
  interface Window {
    __runWorld: (o?: Partial<Opts>) => ReturnType<typeof stats>;
    __seamStats: () => { label: string; seams: SeamStat[] }[];
  }
}
window.__runWorld = (o) => run(o);
window.__seamStats = () => (last ? last.prints.map((p) => ({ label: p.label, seams: p.seams })) : []);

wire();
run();
