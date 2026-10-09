/**
 * Sandbox for the procedural space generators (Star scatter, Orbits),
 * rendered with the same drawPreview the new-map setup modal uses.
 * Build: npx esbuild dev/space-gen-preview.ts --bundle --format=iife --outfile=dev/space-gen-preview.js
 * Serve: npm run sandbox → /dev/space-gen-preview.html
 */
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS, SPACE_PATH_TYPES, SYSTEM_PATH_TYPES } from "../src/palettes/presets";
import { starScatter, STAR_SCATTER_OPTIONS } from "../src/worldgen/procedural/starScatter";
import { orbits, ORBITS_OPTIONS } from "../src/worldgen/procedural/orbits";
import type { ProcGrid, ProcOption } from "../src/worldgen/procedural/common";
import { drawPreview } from "../src/worldgen/preview";

type Gen = "sector" | "system";
const state = {
  gen: "sector" as Gen,
  orientation: "flat" as "flat" | "pointy",
  cols: 8,
  rows: 10,
  seed: 1,
  options: {} as Record<string, string>,
};

const colors = (gen: Gen) =>
  new Map((gen === "sector" ? SPACE_SECTOR_TERRAINS : SPACE_SYSTEM_TERRAINS).map((t) => [t.name, t.color]));
const pathColors = new Map([...SPACE_PATH_TYPES, ...SYSTEM_PATH_TYPES].map((p) => [p.name, p.color]));

function controls(): void {
  const box = document.getElementById("controls")!;
  box.replaceChildren();
  const opts: ProcOption[] = state.gen === "sector" ? STAR_SCATTER_OPTIONS : ORBITS_OPTIONS;
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
      : orbits(SPACE_SYSTEM_TERRAINS, grid, seed, state.options, "Orbit");
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
  [state.cols, state.rows] = gen === "sector" ? [8, 10] : [13, 13];
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
