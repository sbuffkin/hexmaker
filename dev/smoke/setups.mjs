/**
 * The vault setups of the smoke matrix (plan-work-modes §3.1, F1–F9; F10, the Simple-level setup, went with the feature level).
 * Every fixture is built from code into a temp folder, or copied; never the
 * main vault. A setup can:
 *   build(dir)   write seed notes / a data.json into `dir` → { seed?, pluginData? }
 *   recipe       an in-page function run in a first "prep" launch (makes
 *                maps through the plugin's own API), then Obsidian stops
 *   postPrep(vault, prepInfo)   change the vault on disk after prep
 *   migration    the check launch migrates legacy hex notes (verified)
 *   expect       what the checks assert for this setup
 *   extra        setup-specific checks in the check launch
 */
import fs from "node:fs";
import path from "node:path";

export const REAL_SEED = process.env.SMOKE_REAL_SEED ?? "C:/Users/markr/work/tmp/migtest/seedF";
export const REAL_DATA = process.env.SMOKE_REAL_DATA ?? "C:/Users/markr/Documents/KB/journal/.obsidian/plugins/duckmage-plugin/data.json";
export const MARKER = ".hexmaker-sandbox";

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const writeJson = (file, obj) => write(file, JSON.stringify(obj, null, 2));
const seedDir = (dir) => { const s = path.join(dir, "seed"); fs.mkdirSync(s, { recursive: true }); write(path.join(s, MARKER), "smoke suite sandbox\n"); return s; };

// ── F2: a small vault as plugin 1.5.5 left it ─────────────────────────────

const V155_TERRAINS = [
  { name: "ocean", color: "#29507f", category: "sea" },
  { name: "grass", color: "#69a168", icon: "bw-grassland.png", category: "lowlands" },
  { name: "hills", color: "#e0e8a1", icon: "bw-hills.png", category: "lowlands" },
  { name: "forest", color: "#2f6b3a", category: "forest" },
  { name: "mountains", color: "#8b7d6b", category: "mountains" },
  { name: "snow", color: "#e0f2fe", category: "snow" },
];

/** Hex note text in the 1.5.5 shape: map data in frontmatter, old template body. */
function v155Note(x, y, fm, body = "") {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) { lines.push(`${k}:`); for (const i of v) lines.push(`  - ${i}`); }
    else lines.push(`${k}: ${v}`);
  }
  lines.push("---", "", `# Hex ${x}, ${y}`, "", "**Region:**", "**Terrain:**", "", "### description", "", body, "", "### Towns", "", "### Dungeons", "", "### Features", "", "### Quests", "", "### Factions", "", "### Encounters Table", "");
  return lines.join("\n");
}

function buildV155(dir) {
  const seed = seedDir(dir);
  const hexRoot = path.join(seed, "world", "hexes");
  const maps = [
    { name: "coast", cols: 8, rows: 6 },
    { name: "north", cols: 6, rows: 5 },
    { name: "harbour", cols: 4, rows: 4 },
  ];
  const terr = V155_TERRAINS.map((t) => t.name);
  for (const m of maps) {
    for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) {
      const i = x * 7 + y * 3 + m.name.length;
      if (i % 5 === 4) continue; // some hexes have no note at all
      const fm = { terrain: terr[i % terr.length] };
      if (i % 7 === 0) fm.icon = "bw-hills.png";
      if (i % 11 === 0) fm["gm-icons"] = ["I_Ruins.png", "I_Monolith.png"];
      if (m.name === "coast" && x < 3) fm.region = "Saltmarsh";
      if (i % 13 === 0) fm.locked = true;
      if (i % 9 === 0) { fm.tags = "[hex, smoke]"; fm.aliases = `[Spot ${x}-${y}]`; }
      const body = i % 4 === 0 ? `Old notes for ${m.name} ${x},${y}. Keep me exactly.` : "";
      write(path.join(hexRoot, m.name, `${x}_${y}.md`), v155Note(x, y, fm, body));
    }
  }
  // The harbour is a submap of coast 2_2 (1.5.5: duckmage-submap on the hex note).
  write(path.join(hexRoot, "coast", "2_2.md"), v155Note(2, 2, { terrain: "grass", "duckmage-submap": "harbour" }, "The harbour town."));
  // A hex note with no frontmatter at all, and one with a typed body.
  write(path.join(hexRoot, "north", "5_4.md"), "# Hex 5, 4\n\nJust prose, no frontmatter.\n");
  write(path.join(seed, "world", "Lore.md"), "# Lore\n\nA note that isn't a hex. [[coast]]\n");
  const data = {
    mySetting: "default",
    worldFolder: "world",
    hexFolder: "world/hexes",
    townsFolder: "", dungeonsFolder: "", questsFolder: "", featuresFolder: "", iconsFolder: "",
    templatePath: "",
    hexGap: "0.2",
    terrainPalettes: [{ name: "Default", terrains: V155_TERRAINS }],
    maps: [
      {
        name: "coast", paletteName: "Default", gridSize: { cols: 8, rows: 6 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
        pathChains: [
          { typeName: "Road", hexes: ["0_1", "1_1", "2_2", "3_2", "4_3"] },
          { typeName: "River", hexes: ["6_0", "6_1", "5_2", "5_3"] },
          { typeName: "Road", hexes: ["2_2"] },
        ],
      },
      { name: "north", paletteName: "Default", gridSize: { cols: 6, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [{ typeName: "River", hexes: ["0_0", "1_0", "2_1"] }] },
      { name: "harbour", paletteName: "Default", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, pathChains: [] },
    ],
    zoomLevel: 1,
    pathTypes: [
      { name: "Road", color: "#a16207", width: 5, lineStyle: "solid", routing: "through" },
      { name: "River", color: "#3b82f6", width: 6, lineStyle: "solid", routing: "through" },
    ],
    hexOrientation: "flat",
    staggerOffset: "odd",
    tablesFolder: "world/tables",
    factionsFolder: "", regionsFolder: "",
    defaultTableDice: 100,
    rollTableExcludedFolders: ["terrain"],
    encounterTableExcludedFolders: ["terrain"],
    defaultMap: "coast",
    workflowsFolder: "",
    setupComplete: true,
    setupDismissed: false,
    roadColor: "#a16207",
    riverColor: "#3b82f6",
    savedWith: "1.5.5",
  };
  const pluginData = path.join(dir, "data.json");
  writeJson(pluginData, data);
  return { seed, pluginData };
}

// ── in-page recipes (self-contained; run with (pluginId, args)) ───────────

function recipeSpace(id) {
  return (async () => {
    const p = window.app.plugins.plugins[id];
    p.settings.setupComplete = true;
    window.app.workspace.getLeavesOfType("duckmage-setup-wizard").forEach((l) => l.detach());
    p.settings.mapKinds = ["space"];
    // As the wizard does (SP3): install what the picked map types ship, drop
    // the fresh install's untouched fantasy palettes.
    p.settings.setupComplete = false;
    if (p.applyKindContent) await p.applyKindContent({ fromSetup: true });
    else p.onMapKindsChanged?.();
    p.settings.setupComplete = true;
    const has = (n) => p.settings.terrainPalettes.some((x) => x.name === n);
    const sector = has("Space - Sector") ? "Space - Sector" : await p.installPalettePreset("Space - Sector");
    const system = has("Space - System") ? "Space - System" : await p.installPalettePreset("Space - System");
    const made = [];
    const mk = async (name, cols, rows, pal, parent) => {
      const r = await p.createNewMap(name, cols, rows, pal, 0, 0, undefined, undefined, undefined, { quiet: true, ...(parent ? { parent } : {}) });
      if ("error" in r) throw new Error(r.error);
      made.push(r.name);
      return r.name;
    };
    const s = await mk("Rim Sector", 10, 8, sector);
    const pal = p.getMapPalette(s).map((t) => t.name);
    p.mapStore.setMany(s, [["2_2", { terrain: pal[1] ?? pal[0] }], ["3_3", { terrain: pal[2] ?? pal[0] }], ["5_4", { terrain: pal[0] }]]);
    const sys = await mk("Vega System", 9, 9, system, { map: s, hex: "2_2" });
    await p.linkSubmap(s, 2, 2, sys);
    // Planets open on Space - Planet (the system's submap defaults), else the old child palette.
    const planetPal = p.getPaletteByName(system)?.submapDefaults?.["terrestrial planet"]?.palette ?? p.childPaletteFor(sys);
    const planet = await mk("Vega IV", 8, 6, planetPal, { map: sys, hex: "4_4" });
    await p.linkSubmap(sys, 4, 4, planet);
    await p.saveSettings();
    await p.mapStore.flush();
    const biomeFolder = p.biomeStore?.folder?.();
    const biomeNotes = biomeFolder ? window.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(biomeFolder + "/")).length : 0;
    return { made, palettes: p.settings.terrainPalettes.map((x) => x.name), planetPal, defaultPalette: p.settings.defaultPalette, biomeNotes };
  })();
}

/**
 * Built as dev/demo-world.mjs builds it: on a fresh install, while the
 * stores still wait for the setup wizard (F19, setup prepHeld), then the
 * wizard closes and the stores start. Incident 2026-10-14: every region
 * lost its kind, world slot and arrival here (notes written at creation
 * only, then read back over memory), and the overworld showed no regions.
 */
function recipeOverworld(id) {
  return (async () => {
    const p = window.app.plugins.plugins[id];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const t0 = Date.now();
    while (!p.devTools && Date.now() - t0 < 30000) await sleep(300);
    if (!p.devTools) throw new Error("devTools missing (sandbox marker?)");
    const heldAtBuild = !!p.startupWritesHeld && !p.mapStore.isReady();
    const demo = await p.devTools.buildDemoWorld({ seed: 7 });
    await p.saveSettings();
    await p.mapStore.flush();
    // The wizard closes: the stores start now.
    window.app.workspace.getLeavesOfType("duckmage-setup-wizard").forEach((l) => l.detach());
    p.releaseStartupWrites?.();
    while (!p.mapStore.isReady() && Date.now() - t0 < 120_000) await sleep(250);
    await p.mapStore.flush();
    const mine = p.settings.maps.filter((m) => m.parent?.map === demo.overworld);
    const regionsAfterStart = mine.filter((m) => m.submapKind === "region" && m.world && m.arrival).length;
    let regionNotes = 0;
    for (const m of mine) {
      const text = (await p.mapStore.readNoteText(m.name)) ?? "";
      if (/\nsubmap-kind: region\r?\n/.test(text) && /\nworld: /.test(text) && /\narrival: /.test(text)) regionNotes++;
    }
    await p.showMap(demo.overworld);
    await sleep(2500);
    const layerRegions = p.devTools.overworldStats?.()?.[0]?.regions ?? null;
    return { overworld: demo.overworld, regions: demo.regions, hexes: demo.overworldHexes, heldAtBuild, regionsAfterStart, regionNotes, layerRegions };
  })();
}

function recipeNeighbours(id) {
  return (async () => {
    const p = window.app.plugins.plugins[id];
    p.settings.setupComplete = true;
    window.app.workspace.getLeavesOfType("duckmage-setup-wizard").forEach((l) => l.detach());
    const pal = p.settings.defaultPalette ?? p.settings.terrainPalettes[0].name;
    const wid = "wsmoke1";
    const names = [];
    const slots = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (const [i, [cx, cy]] of slots.entries()) {
      // Legacy worlds: every map numbers its own hexes from 0 (no shared coordinates).
      const r = await p.createNewMap(`Shire ${String.fromCharCode(65 + i)}`, 10, 8, pal, 0, 0, "odd", undefined, undefined, { quiet: true });
      if ("error" in r) throw new Error(r.error);
      p.getMap(r.name).world = { id: wid, cx, cy };
      const terr = p.getMapPalette(r.name).map((t) => t.name);
      const cells = [];
      for (let x = 0; x < 10; x++) for (let y = 0; y < 8; y++) if ((x + y + i) % 3 === 0) cells.push([`${x}_${y}`, { terrain: terr[(x * 3 + y + i) % terr.length] }]);
      p.mapStore.setMany(r.name, cells);
      names.push(r.name);
    }
    await p.saveSettings();
    await p.mapStore.flush();
    return { maps: names };
  })();
}

function recipeCustomPalette(id) {
  return (async () => {
    const p = window.app.plugins.plugins[id];
    const app = window.app;
    p.settings.setupComplete = true;
    app.workspace.getLeavesOfType("duckmage-setup-wizard").forEach((l) => l.detach());
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.settings.terrainPalettes.push({
      name: "Moorland",
      terrains: [
        { name: "bog", color: "#556b2f" },
        { name: "crag", color: "#7a7a7a" },
        { name: "heath", color: "#9a7b9a", type: "grassland" },
        { name: "tarn", color: "#24466b", type: "water" },
        { name: "barrow", color: "#3b2f2f" },
      ],
    });
    p.settings.defaultPalette = "Moorland";
    await p.saveSettings();
    await sleep(1500);
    // Delete every other palette's note: the store drops them from settings.
    for (const pal of p.settings.terrainPalettes.map((x) => x.name)) {
      if (pal === "Moorland") continue;
      const f = p.paletteStore.noteFor(pal);
      if (f) await app.vault.delete(f);
      await sleep(300);
    }
    await sleep(1500);
    // The default map from a fresh install (on a default palette) goes too.
    for (const m of [...p.settings.maps]) if (m.paletteName !== "Moorland") p.settings.maps.splice(p.settings.maps.indexOf(m), 1);
    const r = await p.createNewMap("The Moor", 9, 7, "Moorland", 0, 0, undefined, undefined, undefined, { quiet: true });
    if ("error" in r) throw new Error(r.error);
    p.settings.defaultMap = r.name;
    const terr = ["bog", "crag", "heath", "tarn", "barrow"];
    const cells = [];
    for (let x = 0; x < 9; x++) for (let y = 0; y < 7; y++) if ((x * y) % 2 === 0) cells.push([`${x}_${y}`, { terrain: terr[(x + y) % 5] }]);
    p.mapStore.setMany(r.name, cells);
    await p.saveSettings();
    await p.mapStore.flush();
    return { palettes: p.settings.terrainPalettes.map((x) => x.name), map: r.name };
  })();
}

function recipeDeleted(id) {
  return (async () => {
    const p = window.app.plugins.plugins[id];
    p.settings.setupComplete = true;
    window.app.workspace.getLeavesOfType("duckmage-setup-wizard").forEach((l) => l.detach());
    const pal = p.settings.defaultPalette ?? p.settings.terrainPalettes[0].name;
    const made = [];
    for (const n of ["Gone One", "Gone Two"]) {
      const r = await p.createNewMap(n, 8, 6, pal, 0, 0, undefined, undefined, undefined, { quiet: true });
      if ("error" in r) throw new Error(r.error);
      const terr = p.getMapPalette(r.name).map((t) => t.name);
      p.mapStore.setMany(r.name, [["1_1", { terrain: terr[0] }], ["2_2", { terrain: terr[1] }], ["3_3", { terrain: terr[2] }]]);
      made.push(r.name);
    }
    const types = p.getMapPathTypes(made[0]);
    if (types.length) p.mapStore.setPaths(made[0], [{ name: "Old road", typeName: types[0].name, branches: [{ anchors: ["0_1", "4_3"] }] }]);
    await p.saveSettings();
    await p.mapStore.flush();
    return {
      made,
      folders: [p.settings.hexFolder, p.paletteStore.folder(), p.settings.tablesFolder, p.settings.workflowsFolder, p.templatesFolder?.()].filter(Boolean),
    };
  })();
}

function recipeManyMaps(id) {
  return (async () => {
    const p = window.app.plugins.plugins[id];
    p.settings.setupComplete = true;
    window.app.workspace.getLeavesOfType("duckmage-setup-wizard").forEach((l) => l.detach());
    const pal = p.settings.defaultPalette ?? p.settings.terrainPalettes[0].name;
    const made = [];
    const errors = [];
    const mk = async (raw, parent) => {
      const r = await p.createNewMap(raw, 6, 5, pal, 0, 0, undefined, undefined, undefined, { quiet: true, ...(parent ? { parent: { map: parent, hex: "2_2" } } : {}) });
      if ("error" in r) { errors.push(`${raw}: ${r.error}`); return null; }
      const terr = p.getMapPalette(r.name).map((t) => t.name);
      p.mapStore.setMany(r.name, [["0_0", { terrain: terr[made.length % terr.length] }], ["2_2", { terrain: terr[(made.length + 1) % terr.length] }]]);
      if (parent) await p.linkSubmap(parent, 2, 2, r.name);
      made.push(r.name);
      return r.name;
    };
    // Duplicate-ish names: same words, different case/spacing/punctuation.
    const tops = ["Ash Vale", "Ash  Vale!", "ash vale 2", "Ashvale", "Ash-Vale (old)", "Brine", "BRINE", "Brine 1", "Cinder", "Cinder Isle",
      "Dune", "Dunes", "Elder", "Elder Wood", "Fen", "Fenn", "Gale", "Gale's End", "Hollow", "Hollows"];
    const topNames = [];
    for (const t of tops) { const n = await mk(t); if (n) topNames.push(n); }
    // Names that slug to a folder already taken are refused (as they should be): top up to 20.
    for (let i = 1; topNames.length < 20; i++) { const n = await mk(`Isle ${i}`); if (n) topNames.push(n); }
    // Nested locations four deep under the first 15 tops (15 × 4 = 60).
    for (const top of topNames.slice(0, 15)) {
      let parent = top;
      for (let d = 1; d <= 4; d++) parent = (await mk(`${top} L${d}`, parent)) ?? parent;
    }
    await p.saveSettings();
    await p.mapStore.flush();
    return { made: made.length, errors };
  })();
}

// ── setup-specific checks (Node side; ctx.ev(fn, ...args) evaluates in page) ──

async function freshExtra(ctx) {
  const out = [];
  const st = ctx.state;
  out.push({ check: "F1-wizard", ok: st.wizardOpen > 0, detail: `setup wizard leaves: ${st.wizardOpen}` });
  // F19: nothing is written while the wizard still asks where the world goes.
  const held = await ctx.ev(() => window.__smoke.held ?? null);
  out.push({ check: "F1-nothing-before-folder", ok: !!held?.held && held.writes.length === 0, detail: held ? `held; wrote ${held.writes.join(", ") || "nothing"} meanwhile` : "stores were not held" });
  // Create a map + paint through the API: only the map note may be written.
  const r = await ctx.ev((id) => (async () => {
    const app = window.app, p = app.plugins.plugins[id];
    const t = Date.now();
    const pal = p.settings.defaultPalette ?? p.settings.terrainPalettes[0].name;
    const res = await p.createNewMap("Smoke Fresh", 8, 6, pal, 0, 0, undefined, undefined, undefined, { quiet: true });
    if ("error" in res) return { error: res.error };
    const terr = p.getMapPalette(res.name).map((x) => x.name);
    p.mapStore.set(res.name, "1_1", { terrain: terr[0] });
    p.mapStore.set(res.name, "2_3", { terrain: terr[1] });
    await p.mapStore.flush();
    await new Promise((r2) => setTimeout(r2, 1500));
    const files = [...new Set(window.__smoke.writes.filter((w) => w.t >= t && /\.md$/.test(w.path)).map((w) => w.path))];
    const note = p.mapStore.notePath(res.name);
    // First hex note: links its map note; its terrain is a copy of the map's (hex-note properties, MG4).
    await p.createHexNote(1, 1, res.name);
    const hexPath = p.hexPath(1, 1, res.name);
    const text = (await app.vault.adapter.exists(hexPath)) ? await app.vault.adapter.read(hexPath) : null;
    return { map: res.name, files, note, hexPath, hasLink: !!text && /^map:\s*"\[\[_/m.test(text), terrainProp: text ? (/^terrain\s*:\s*"?([^"\r\n]*)"?\s*$/m.exec(text)?.[1] ?? null) : null, terrain: terr[0] };
  })(), ctx.pluginId);
  if (r.error) out.push({ check: "F1-create-paint", ok: false, detail: r.error });
  else {
    const others = r.files.filter((f) => f !== r.note);
    out.push({ check: "F1-create-paint", ok: r.files.includes(r.note) && others.length === 0, detail: `wrote ${r.files.join(", ") || "(nothing)"}` });
    out.push({ check: "F1-first-hex-note", ok: r.hasLink && r.terrainProp === r.terrain, detail: `${r.hexPath}: map link ${r.hasLink}, terrain property ${r.terrainProp} (map: ${r.terrain})` });
  }
  out.push(...(await wizardMapStepChecks(ctx)));
  return out;
}

/**
 * The setup wizard's map step (owner 2026-10-12): "What are you mapping?"
 * then a generator list (Blank first) that swaps with it; the grid size
 * steps with the wheel and resets to the scale's size; the generator's
 * options are above the fold and Advanced holds 5–10 tuning sliders that
 * count in its header once moved. Nothing is created (no map name).
 */
async function wizardMapStepChecks(ctx) {
  const r = await ctx.ev(() => (async () => {
    const leaf = window.app.workspace.getLeavesOfType("duckmage-setup-wizard")[0];
    if (!leaf) return { error: "no wizard leaf" };
    // Shown and focused: a hidden leaf's fields can't take focus (the wheel steps a focused field).
    await window.app.workspace.revealLeaf(leaf);
    window.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r2) => setTimeout(r2, 100)); } return fn(); };
    view.currentIndex = 2;
    view.renderView();
    const root = view.contentEl;
    const scales = [...root.querySelectorAll(".duckmage-wizard-scale-btn")];
    const scaleLabels = scales.map((c) => c.querySelector(".duckmage-wizard-orient-label")?.textContent);
    const gens = () => [...root.querySelectorAll(".duckmage-setup-gen .duckmage-setup-gen-title")].map((e) => e.textContent);
    await until(() => gens().length > 0);
    const first = { scale: root.querySelector(".duckmage-wizard-scale-btn.is-active")?.dataset.scale, gens: gens() };
    const cols = root.querySelector('input[aria-label="Columns"]');
    const colsAt = { start: cols.value };
    // Another scale (Biomes when World maps is built); a build with one scale only checks the size.
    const other = scales.find((c) => c.dataset.scale === "biomes") ?? scales.find((c) => c.dataset.scale !== first.scale);
    other?.click();
    // Biomes gets its biome notes when picked, then lists World biomes.
    if (other) await until(() => gens()[1] !== first.gens[1] && (other.dataset.scale !== "biomes" || gens().includes("World biomes")));
    const second = { scale: root.querySelector(".duckmage-wizard-scale-btn.is-active")?.dataset.scale, gens: gens() };
    colsAt.biomes = cols.value;
    cols.focus();
    colsAt.focused = document.activeElement === cols;
    cols.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    colsAt.wheel = cols.value;
    root.querySelector(".duckmage-wizard-size-reset")?.click();
    colsAt.reset = cols.value;
    // Back to the first scale: options main, Advanced = tuning sliders.
    scales.find((c) => c.dataset.scale === first.scale)?.click();
    await until(() => gens()[1] === first.gens[1]);
    const opts = [...root.querySelectorAll(".duckmage-wizard-generator-option")];
    const optsInAdvanced = opts.filter((o) => o.closest(".duckmage-disclosure")).length;
    const sliders = [...root.querySelectorAll(".duckmage-wizard-tuning")];
    const slidersInAdvanced = sliders.filter((s) => s.closest(".duckmage-disclosure")).length;
    const summary = () => root.querySelector(".duckmage-wizard-generator-options .duckmage-disclosure-summary")?.textContent ?? "";
    const before = summary();
    const range = sliders[0]?.querySelector('input[type="range"]');
    if (range) { range.value = String(Number(range.max)); range.dispatchEvent(new Event("input", { bubbles: true })); }
    const after = summary();
    sliders[0]?.querySelector(".duckmage-reset-btn")?.click();
    const reset = summary();
    return { single: !other, scaleLabels, first, second, colsAt, opts: opts.length, optsInAdvanced, sliders: sliders.length, slidersInAdvanced, before, after, reset };
  })());
  if (r.error) return [{ check: "F1-wizard-scales", ok: false, detail: r.error }];
  return [
    { check: "F1-wizard-scales", ok: r.first.gens[0] === "Blank" && (r.single ? r.scaleLabels.length === 1 : r.second.gens[0] === "Blank" && r.first.scale !== r.second.scale && JSON.stringify(r.first.gens) !== JSON.stringify(r.second.gens) && (r.second.scale !== "biomes" || r.second.gens.includes("World biomes"))),
      detail: `scales ${r.scaleLabels.join(", ")}; ${r.first.scale}: ${r.first.gens.join(", ")}; ${r.second.scale}: ${r.second.gens.join(", ")}` },
    { check: "F1-wizard-size", ok: (r.single || r.colsAt.biomes !== r.colsAt.start) && Number(r.colsAt.wheel) === Number(r.colsAt.biomes) + 1 && r.colsAt.reset === r.colsAt.biomes,
      detail: `columns: start ${r.colsAt.start}, ${r.single ? "same scale" : r.second.scale} ${r.colsAt.biomes}, wheel up ${r.colsAt.wheel} (focused ${r.colsAt.focused}), reset ${r.colsAt.reset}` },
    { check: "F1-wizard-advanced", ok: r.opts > 0 && r.optsInAdvanced === 0 && r.sliders >= 5 && r.sliders <= 10 && r.slidersInAdvanced === r.sliders && /· 1 set/.test(r.after) && !/set/.test(r.reset),
      detail: `options ${r.opts} (${r.optsInAdvanced} in Advanced); sliders ${r.sliders} (${r.slidersInAdvanced} in Advanced); header "${r.before}" → "${r.after}" → "${r.reset}"` },
  ];
}

async function spaceExtra(ctx) {
  const st = ctx.state;
  const out = [];
  out.push({ check: "F4-kinds", ok: JSON.stringify(st.mapKinds) === JSON.stringify(["space"]), detail: `mapKinds ${JSON.stringify(st.mapKinds)}` });
  const spaceMaps = st.maps.filter((m) => m.space).map((m) => m.name);
  out.push({ check: "F4-space-maps", ok: spaceMaps.length >= 2, detail: `space maps: ${spaceMaps.join(", ")}` });
  const chain = st.maps.filter((m) => m.parent).map((m) => `${m.parent} → ${m.name}`);
  out.push({ check: "F4-chain", ok: chain.length >= 2, detail: chain.join("; ") });
  // SP3: a space-only setup has nothing fantasy.
  const fantasy = st.palettes.filter((n) => n === "Expanded" || n === "Limited");
  out.push({ check: "F4-no-fantasy-palettes", ok: fantasy.length === 0, detail: `palettes: ${st.palettes.join(", ")}` });
  // After a restart: startup wrote no biome notes; planets sit on Space - Planet.
  const r = await ctx.ev((id) => {
    const p = window.app.plugins.plugins[id];
    const folder = p.biomeStore?.folder?.();
    return {
      biomeNotes: folder ? window.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/")).length : 0,
      defaultPalette: p.settings.defaultPalette,
      planet: p.getMap("vega-iv")?.paletteName ?? p.getMap("Vega IV")?.paletteName,
      kindContent: p.settings.kindContent,
      // Shipped tables come with their map type (phase 6): no fantasy starters here.
      fantasyTables: ["weather.md", "rumors.md"].filter((n) => window.app.vault.getAbstractFileByPath(`${p.settings.tablesFolder}/${n}`)),
    };
  }, ctx.pluginId);
  out.push({ check: "F4-no-fantasy-tables", ok: r.fantasyTables.length === 0, detail: `starter tables: ${r.fantasyTables.join(", ") || "none"}` });
  out.push({ check: "F4-no-biome-notes", ok: r.biomeNotes === 0, detail: `biome notes: ${r.biomeNotes}` });
  out.push({ check: "F4-default-palette", ok: r.defaultPalette === "Space - Sector", detail: `Palette for new maps: ${r.defaultPalette}; kindContent ${JSON.stringify(r.kindContent)}` });
  out.push({ check: "F4-planet-palette", ok: r.planet === "Space - Planet", detail: `planet palette: ${r.planet}` });

  // Tables everywhere phases 3-4: convert World types to tables, then arrive
  // in Play at an unknown sector hex (SP4/SP5/GM4/T5). The C5 restart that
  // follows checks none of it is rewritten on load.
  const a = await ctx.ev(async (id) => {
    const p = window.app.plugins.plugins[id];
    const steps = [], problems = [];
    try {
      if (!p.arrival || !p.worldTypeStore?.convertAll) return { skipped: "build has no arrival" };
      const s = p.settings.maps.find((m) => m.displayName === "Rim Sector" || m.name === "rim-sector")?.name;
      if (!s) return { skipped: "no Rim Sector" };
      const sector = p.getMap(s);
      if (p.arrival.canArrive(s, 6, 6)) problems.push("arrival on by default");
      await p.worldTypeStore.ensureDefault();
      const conv = await p.worldTypeStore.convertAll();
      steps.push(`converted ${conv.converted.join(", ")} (${conv.written.length} notes)`);
      const again = await p.worldTypeStore.convertAll();
      if (again.converted.length || again.written.length) problems.push("converting twice wrote again");
      const mainworlds = conv.written.find((f) => f.endsWith("/Sector/Mainworlds.md"));
      if (!mainworlds) return { steps, problems: [...problems, "no Mainworlds table written"] };
      const before = sector.workMode;
      sector.arrivalMode = "make places";
      sector.workMode = "play";
      p.mapStore.set(s, "6_6", { terrain: "star system", onArrival: mainworlds.replace(/\.md$/, "") });
      await p.saveSettings();
      await p.mapStore.flush();
      const made = await p.arrival.arrive(s, 6, 6);
      const hex = p.mapStore.get(s, "6_6") ?? {};
      if (!made) problems.push("no place made");
      else {
        steps.push(`arrived: 6,6 is now ${hex.terrain}; made ${made}`);
        if (hex.onArrival) problems.push("On arrival cell not cleared");
        if (!hex.terrain || hex.terrain === "star system") problems.push(`hex terrain ${hex.terrain}`);
        if (!(hex.locations ?? []).includes(made)) problems.push("place not linked");
        const child = p.getMap(made);
        if (child?.arrival !== "open" || child?.workMode !== "play") problems.push(`new place ${child?.arrival}/${child?.workMode}`);
        const note = await p.mapStore.readNoteText(made);
        if (!note?.includes("## Arrival")) problems.push("no Arrival section");
        if (!(await p.arrival.reroll(made))) problems.push("Play couldn't reroll an open place");
        await p.arrival.lock(made);
        if (await p.arrival.reroll(made)) problems.push("Play rerolled a locked place");
        else steps.push("reroll then lock: Play can't reroll after the lock");
        if ((await p.arrival.arrive(s, 6, 6)) !== null) problems.push("second visit made another place");
      }
      sector.workMode = before;
      delete sector.arrivalMode;
      await p.saveSettings();
      await p.mapStore.flush();
    } catch (e) {
      problems.push(String(e?.stack ?? e).slice(0, 400));
    }
    return { steps, problems };
  }, ctx.pluginId);
  out.push({ check: "F13-arrival", ok: !a.skipped && a.problems.length === 0, detail: a.skipped ?? [...a.steps, ...a.problems].join("; ") });
  return out;
}

/** The demo world's overworld is a radius-2 hex of 19 hexes, each with its region. */
const DEMO_REGIONS = 19;

async function overworldExtra(ctx) {
  const ow = ctx.state.maps.find((m) => m.overworld);
  if (!ow) return [{ check: "F5-overworld", ok: false, detail: "no overworld map" }];
  const regions = ctx.state.maps.filter((m) => m.submapKind === "region" && m.parent === ow.name && m.world);
  // Incident 2026-10-14: the region fields (kind, world slot, arrival) reach the
  // notes and survive the stores starting late and a restart; the overworld draws them all.
  const prep = ctx.prepInfo ?? {};
  const out = [{
    check: "F5-regions-prep",
    ok: prep.regions === DEMO_REGIONS && prep.regionsAfterStart === DEMO_REGIONS && prep.regionNotes === DEMO_REGIONS && prep.layerRegions === DEMO_REGIONS,
    detail: `built ${prep.regions} (stores held: ${prep.heldAtBuild}); after the stores started: ${prep.regionsAfterStart} in memory, ${prep.regionNotes} notes, ${prep.layerRegions} on the overworld layer (want ${DEMO_REGIONS})`,
  }];
  const layer = await ctx.ev(async (id, n) => {
    const p = window.app.plugins.plugins[id];
    await p.showMap(n);
    await new Promise((r) => setTimeout(r, 2500));
    return p.devTools?.overworldStats?.()?.[0]?.regions ?? null;
  }, ctx.pluginId, ow.name);
  out.push({ check: "F5-regions", ok: regions.length === DEMO_REGIONS && layer === DEMO_REGIONS, detail: `after a restart: ${ow.name}: ${regions.length} region maps with a world slot, ${layer} on the overworld layer (want ${DEMO_REGIONS})` });
  const lock = await ctx.ev((id, n) => window.__smokePage.overworldPaintLock(id, n), ctx.pluginId, ow.name);
  out.push({ check: "C8-overworld-paint", ok: lock.ok, detail: [...lock.steps, ...lock.problems].join("; ") });

  // GM4 on overworlds: with arrival on, going to a hex with a biome and no
  // region makes the region in Play (seeded, no form); Reroll until Lock.
  // The hex's unresolved On arrival cell shows the uncharted "?" first.
  const a = await ctx.ev(async (id, owName) => {
    const p = window.app.plugins.plugins[id];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const steps = [], problems = [];
    const ow = p.getMap(owName);
    const before = { mode: ow.workMode, cols: ow.gridSize.cols };
    try {
      if (!p.arrival?.isOverworld || !p.events) return { skipped: "build has no overworld arrival" };
      if (p.arrival.canArrive(owName, ow.gridOffset.x, ow.gridOffset.y)) problems.push("arrival on by default");
      const hasRegion = (k) => p.settings.maps.some((m) => m.submapKind === "region" && m.parent?.map === owName && m.parent.hex === k);
      let key;
      for (let y = ow.gridOffset.y; !key && y < ow.gridOffset.y + ow.gridSize.rows; y++)
        for (let x = ow.gridOffset.x; !key && x < ow.gridOffset.x + ow.gridSize.cols; x++) if (!hasRegion(`${x}_${y}`)) key = `${x}_${y}`;
      if (!key) {
        // Every hex has a region: take in one more column.
        ow.gridSize = { ...ow.gridSize, cols: ow.gridSize.cols + 1 };
        key = `${ow.gridOffset.x + ow.gridSize.cols - 1}_${ow.gridOffset.y}`;
        steps.push("grew the overworld by a column");
      }
      const [x, y] = key.split("_").map(Number);
      const terrain = [...p.mapStore.all(owName).values()].find((h) => h.terrain)?.terrain;
      ow.arrivalMode = "make places";
      ow.workMode = "play";
      p.mapStore.set(owName, key, { terrain, onArrival: "Smoke uncharted" });
      await p.saveSettings();
      await p.mapStore.flush();
      await p.showMap(owName);
      p.refreshHexMap();
      await sleep(1500);
      const marks = document.querySelectorAll(".duckmage-uncharted-layer .duckmage-uncharted-mark").length;
      steps.push(`uncharted marks: ${marks}`);
      if (marks < 1) problems.push("no uncharted mark on the unresolved hex");
      if (!p.arrival.canArrive(owName, x, y)) problems.push(`can't arrive at ${key}: ${p.arrival.blocker(owName, x, y)}`);
      const made = await p.arrival.arrive(owName, x, y);
      if (!made) problems.push("no region made");
      else {
        const r = p.getMap(made);
        steps.push(`arrived at ${key}: made ${made}`);
        if (r?.submapKind !== "region" || r?.parent?.hex !== key) problems.push(`not the hex's region: ${r?.submapKind} ${r?.parent?.hex}`);
        if (r?.arrival !== "open" || r?.workMode !== "play") problems.push(`new region ${r?.arrival}/${r?.workMode}`);
        if (p.mapStore.get(owName, key)?.onArrival) problems.push("On arrival cell not cleared");
        if (!p.mapStore.all(made).size) problems.push("region has no terrain");
        const note = await p.mapStore.readNoteText(made);
        if (!note?.includes("## Arrival")) problems.push("no Arrival section");
        const seed = r.regionSeed;
        if (!(await p.arrival.reroll(made))) problems.push("Play couldn't reroll an open region");
        else if (r.regionSeed === seed) problems.push("reroll kept the seed");
        await p.arrival.lock(made);
        if (await p.arrival.reroll(made)) problems.push("Play rerolled a locked region");
        else steps.push("reroll then lock: Play can't reroll after the lock");
        if (p.arrival.canArrive(owName, x, y)) problems.push("can arrive again");
      }
    } catch (e) {
      problems.push(String(e?.stack ?? e).slice(0, 400));
    } finally {
      ow.workMode = before.mode;
      delete ow.arrivalMode;
      await p.saveSettings();
      await p.mapStore.flush();
    }
    return { steps, problems };
  }, ctx.pluginId, ow.name);
  out.push({ check: "GM4-overworld-arrival", ok: !a.skipped && a.problems.length === 0, detail: a.skipped ?? [...a.steps, ...a.problems].join("; ") });
  return out;
}

async function neighboursExtra(ctx) {
  const inWorld = ctx.state.maps.filter((m) => m.world);
  return [{ check: "F6-world", ok: inWorld.length === 4, detail: inWorld.map((m) => `${m.name}@${m.world}`).join(", ") }];
}

async function customPaletteExtra(ctx) {
  const st = ctx.state;
  return [
    { check: "F7-palettes", ok: st.palettes.length === 1 && st.palettes[0] === "Moorland", detail: `palettes: ${st.palettes.join(", ")}` },
  ];
}

async function deletedExtra(ctx) {
  const st = ctx.state;
  const notices = await ctx.ev(() => window.__smokePage.notices());
  const errLoop = ctx.log.length;
  await new Promise((r) => setTimeout(r, 8000));
  const grew = ctx.log.length - errLoop;
  const gone = st.maps.filter((m) => m.name.startsWith("gone-"));
  // Owner call SM-DEL: maps whose folder and note are gone are marked missing, never re-created;
  // an emptied palette list stays empty (no automatic defaults).
  const out = [
    { check: "F8-missing", ok: gone.length === 2 && gone.every((m) => m.missing && !m.noteExists), detail: `maps: ${st.maps.map((m) => `${m.name} (${m.missing ? "missing" : !m.noteExists ? "no note" : ctx.snap0[m.notePath] ? "note kept" : "note re-created, " + m.hexes + " hexes"})`).join(", ")}` },
    { check: "F8-no-refill", ok: st.palettes.length === 0, detail: `palettes: ${st.palettes.join(", ") || "(none)"}; path types: ${st.pathTypes}` },
    { check: "F8-no-loop", ok: grew === 0, detail: `console errors/warnings added in 8 s idle: ${grew}; notices: ${notices.join(" | ") || "(none)"}` },
  ];
  // Restore one from its cached note: hexes and the path come back exactly; Remove the other.
  const r = await ctx.ev((id) => (async () => {
    const p = window.app.plugins.plugins[id];
    const ok = await p.restoreMissingMap("gone-one");
    await p.mapStore.flush();
    const hexes = [...p.mapStore.all("gone-one")].map(([k, h]) => `${k}=${h.terrain}`).sort();
    const paths = p.mapStore.paths("gone-one").map((x) => `${x.name}:${x.branches[0]?.anchors.join(">")}`);
    const note = !!window.app.vault.getAbstractFileByPath(p.mapStore.notePath("gone-one"));
    await p.removeMapEntry("gone-two");
    return { ok, hexes, paths, note, missing: p.mapStore.isMissing("gone-one"), maps: p.settings.maps.map((m) => m.name) };
  })(), ctx.pluginId);
  out.push({ check: "F8-restore", ok: r.ok && r.note && !r.missing && r.hexes.length === 3 && r.paths.length === 1 && r.paths[0].startsWith("Old road:0_1>4_3"), detail: `restored gone-one: note ${r.note}, hexes ${r.hexes.join(" ")}, paths ${r.paths.join(" ")}` });
  out.push({ check: "F8-remove", ok: !r.maps.includes("gone-two"), detail: `maps now: ${r.maps.join(", ")}` });
  return out;
}

async function manyMapsExtra(ctx) {
  const n = ctx.state.maps.length;
  const deep = ctx.state.maps.filter((m) => / L4$/i.test(m.name) || /-l4$/.test(m.name)).length;
  return [{ check: "F9-count", ok: n >= 80, detail: `${n} maps, ${deep} at depth 4, store ready in ${ctx.readyMs} ms` }];
}

// ── the matrix ────────────────────────────────────────────────────────────

export const SETUPS = [
  {
    id: "real-data", title: "Owner real-data copy (seedF + live data.json), migrates", slow: true,
    // Private data on the owner's machine (SMOKE_REAL_SEED / SMOKE_REAL_DATA elsewhere): skipped, loudly, without it.
    unavailable: () => (!fs.existsSync(REAL_SEED) ? `real seed missing: ${REAL_SEED}` : !fs.existsSync(REAL_DATA) ? `live data.json missing: ${REAL_DATA}` : null),
    build(dir) {
      if (!fs.existsSync(REAL_SEED)) throw new Error(`real seed missing: ${REAL_SEED}`);
      if (!fs.existsSync(REAL_DATA)) throw new Error(`live data.json missing: ${REAL_DATA}`);
      const pluginData = path.join(dir, "data.json");
      fs.copyFileSync(REAL_DATA, pluginData); // a COPY: the sandbox never sees the live file
      return { seed: REAL_SEED, pluginData };
    },
    migration: true,
    expect: { readyMs: 600_000, openMs: 60_000 },
  },
  { id: "fresh", title: "Fresh install", build: (dir) => ({ seed: seedDir(dir) }), expect: { wizard: true }, extra: freshExtra, skipPaint: true },
  { id: "v155", title: "Synthetic 1.5.5 vault (hex-note frontmatter + data.json maps), migrates", build: buildV155, migration: true, expect: {} },
  { id: "space", title: "Space only (sector → system → planet)", build: (dir) => ({ seed: seedDir(dir) }), recipe: recipeSpace, expect: {}, extra: spaceExtra },
  { id: "overworld", title: "Overworld + regions (demo world, seed 7)", build: (dir) => ({ seed: seedDir(dir) }), recipe: recipeOverworld, prepHeld: true, expect: { openMs: 60_000 }, extra: overworldExtra },
  { id: "neighbours", title: "Neighbours world (legacy 2×2, own coordinates)", build: (dir) => ({ seed: seedDir(dir) }), recipe: recipeNeighbours, expect: {}, extra: neighboursExtra },
  { id: "custom-palette", title: "One custom palette, no default names", build: (dir) => ({ seed: seedDir(dir) }), recipe: recipeCustomPalette, expect: {}, extra: customPaletteExtra },
  {
    id: "deleted", title: "Everything deleted (no palettes, path types or map folders)",
    build: (dir) => ({ seed: seedDir(dir) }), recipe: recipeDeleted,
    postPrep(vault, info, pluginId) {
      for (const f of info.folders ?? []) {
        const p = path.join(vault, f);
        if (fs.existsSync(p) && path.resolve(p).startsWith(path.resolve(vault) + path.sep)) fs.rmSync(p, { recursive: true, force: true });
      }
      const dataFile = path.join(vault, ".obsidian", "plugins", pluginId, "data.json");
      const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      data.terrainPalettes = [];
      data.pathTypes = [];
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    },
    expect: {}, extra: deletedExtra, skipModeLocks: true,
  },
  { id: "many-maps", title: "Many maps (80, nested 4 deep, look-alike names)", build: (dir) => ({ seed: seedDir(dir) }), recipe: recipeManyMaps, expect: {}, extra: manyMapsExtra },
];

