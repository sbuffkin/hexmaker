/**
 * Sandbox for the procedural space generators (Star scatter, Orbits),
 * rendered with the same drawPreview the new-map setup modal uses.
 * Build: npx esbuild dev/space-gen-preview.ts --bundle --format=iife --outfile=dev/space-gen-preview.js
 * Serve: npm run sandbox → /dev/space-gen-preview.html
 */
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS, SPACE_PATH_TYPES, SYSTEM_PATH_TYPES } from "../src/palettes/presets";
import { starScatter, STAR_SCATTER_OPTIONS } from "../src/worldgen/procedural/starScatter";
import { orbits, ORBITS_OPTIONS } from "../src/worldgen/procedural/orbits";
import type { GenerationContext, ProcGrid, ProcOption, Side } from "../src/worldgen/procedural/common";
import { planetSurface, REGION_DETAIL_OPTIONS } from "../src/worldgen/procedural/planetSurface";
import { DEFAULT_TERRAIN_PALETTE, DEFAULT_PATH_TYPES } from "../src/constants";
import { routeContextPaths } from "../src/worldgen/procedural/contextPaths";
import { drawPreview } from "../src/worldgen/preview";

type Gen = "sector" | "system" | "region";
/** Region detail: the parent hex and its N/E/S/W neighbours (terrain names from Expanded). */
const region: { parent: string; sides: Partial<Record<Side, string>>; road: string; river: string } = {
  parent: "forest", sides: { E: "ocean" }, road: "W-E", river: "N-S",
};
/** "W-E" → { from: W, to: E }; "S-" → ends in the hex. */
const pathSpec = (v: string) => {
  const [from, to] = v.split("-") as [Side | "", Side | ""];
  return { from: from || undefined, to: to || undefined };
};
const state = {
  gen: "sector" as Gen,
  orientation: "flat" as "flat" | "pointy",
  cols: 8,
  rows: 10,
  seed: 1,
  options: {} as Record<string, string>,
};

const paletteOf = (gen: Gen) =>
  gen === "sector" ? SPACE_SECTOR_TERRAINS : gen === "system" ? SPACE_SYSTEM_TERRAINS : DEFAULT_TERRAIN_PALETTE;
const colors = (gen: Gen) => new Map(paletteOf(gen).map((t) => [t.name, t.color]));
const typed = (name: string) => ({ terrain: name, type: DEFAULT_TERRAIN_PALETTE.find((t) => t.name === name)?.type });
function regionContext(): GenerationContext {
  const sides: GenerationContext["sides"] = {};
  for (const [s, name] of Object.entries(region.sides)) if (name) sides[s as Side] = typed(name);
  return { parent: typed(region.parent), sides };
}
const pathColors = new Map([...SPACE_PATH_TYPES, ...SYSTEM_PATH_TYPES, ...DEFAULT_PATH_TYPES].map((p) => [p.name, p.color]));

function controls(): void {
  const box = document.getElementById("controls")!;
  box.replaceChildren();
  const opts: ProcOption[] = state.gen === "sector" ? STAR_SCATTER_OPTIONS : state.gen === "system" ? ORBITS_OPTIONS : REGION_DETAIL_OPTIONS;
  if (state.gen === "region") {
    const names = ["", ...DEFAULT_TERRAIN_PALETTE.map((t) => t.name)];
    const pick = (label: string, value: string, set: (v: string) => void) => {
      const l = document.createElement("label");
      l.textContent = label + " ";
      const sel = document.createElement("select");
      for (const n of names) sel.add(new Option(n || "—", n));
      sel.value = value;
      sel.onchange = () => { set(sel.value); render(); };
      l.append(sel);
      box.append(l);
    };
    pick("Parent hex", region.parent, (v) => { region.parent = v || "grass"; });
    const routes = ["", "W-E", "N-S", "NW-SE", "SW-NE", "W-", "S-"];
    const routePick = (label: string, value: string, set: (v: string) => void) => {
      const l = document.createElement("label");
      l.textContent = label + " ";
      const sel = document.createElement("select");
      for (const r of routes) sel.add(new Option(r ? r.replace("-", " → ").replace(/→ $/, "→ ends here") : "—", r));
      sel.value = value;
      sel.onchange = () => { set(sel.value); render(); };
      l.append(sel);
      box.append(l);
    };
    routePick("Road", region.road, (v) => { region.road = v; });
    routePick("River", region.river, (v) => { region.river = v; });
    for (const s of ["N", "E", "S", "W"] as Side[]) pick(s, region.sides[s] ?? "", (v) => { region.sides[s] = v || undefined; });
  }
  for (const o of opts) {
    const label = document.createElement("label");
    label.textContent = o.label + " ";
    const sel = document.createElement("select");
    for (const c of o.choices) sel.add(new Option(c.label, c.value));
    sel.value = state.options[o.key] ?? o.default;
    sel.onchange = () => { state.options[o.key] = sel.value; render(); };
    label.append(sel);
    box.append(label);
  }
}

/** Region mode: carry the parent hex's road / river across the generated map. */
function withPaths<T extends { cells: Map<string, string>; paths: { type: string; hexes: string[] }[] }>(r: T, grid: ProcGrid, seed: number): T {
  const carry = [
    ...(region.road ? [{ type: "Road", routing: "through" as const, ...pathSpec(region.road) }] : []),
    ...(region.river ? [{ type: "River", routing: "meander" as const, ...pathSpec(region.river) }] : []),
  ];
  return { ...r, paths: [...r.paths, ...routeContextPaths(r.cells, DEFAULT_TERRAIN_PALETTE, grid, carry, seed)] };
}

function render(): void {
  const grid: ProcGrid = {
    cols: state.cols, rows: state.rows, offset: { x: 0, y: 0 }, stagger: "odd", orientation: state.orientation,
  };
  const wall = document.getElementById("wall")!;
  wall.replaceChildren();
  // Six seeds side by side so the variety is visible at a glance.
  for (let i = 0; i < 6; i++) {
    const seed = state.seed + i;
    const r = state.gen === "sector"
      ? starScatter(SPACE_SECTOR_TERRAINS, grid, seed, state.options, "Jump route")
      : state.gen === "system"
        ? orbits(SPACE_SYSTEM_TERRAINS, grid, seed, state.options, "Orbit")
        : withPaths(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, state.options, regionContext()), grid, seed);
    const fig = document.createElement("figure");
    const canvas = document.createElement("canvas");
    drawPreview(canvas, r.cells, grid, state.orientation, colors(state.gen), undefined, r.paths, pathColors, 300, 18);
    const cap = document.createElement("figcaption");
    cap.textContent = `seed ${seed}` + (r.warnings.length ? ` — ${r.warnings.join(" ")}` : "");
    fig.append(canvas, cap);
    wall.append(fig);
  }
  const legend = document.getElementById("legend")!;
  legend.replaceChildren(...[...colors(state.gen)].map(([name, color]) => {
    const s = document.createElement("span");
    s.innerHTML = `<i style="background:${color}"></i>${name}`;
    return s;
  }));
}

function setGen(gen: Gen): void {
  state.gen = gen;
  state.options = {};
  [state.cols, state.rows] = gen === "sector" ? [8, 10] : gen === "system" ? [13, 13] : [20, 14];
  (document.getElementById("cols") as HTMLInputElement).value = String(state.cols);
  (document.getElementById("rows") as HTMLInputElement).value = String(state.rows);
  document.querySelectorAll<HTMLButtonElement>("[data-gen]").forEach((b) => b.classList.toggle("on", b.dataset.gen === gen));
  controls();
  render();
}

document.querySelectorAll<HTMLButtonElement>("[data-gen]").forEach((b) => (b.onclick = () => setGen(b.dataset.gen as Gen)));
(document.getElementById("reroll") as HTMLButtonElement).onclick = () => { state.seed += 6; render(); };
(document.getElementById("orient") as HTMLSelectElement).onchange = (e) => {
  state.orientation = (e.target as HTMLSelectElement).value as "flat" | "pointy";
  render();
};
for (const id of ["cols", "rows"] as const) {
  (document.getElementById(id) as HTMLInputElement).onchange = (e) => {
    state[id] = Math.max(3, Math.min(60, Number((e.target as HTMLInputElement).value) || 3));
    render();
  };
}
(window as unknown as { __render: typeof render; __state: typeof state; __setGen: typeof setGen }).__render = render;
(window as unknown as { __state: typeof state }).__state = state;
(window as unknown as { __setGen: typeof setGen }).__setGen = setGen;
setGen("sector");
document.title = "ready";
