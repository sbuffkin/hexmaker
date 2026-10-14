/**
 * Functions evaluated INSIDE the sandboxed Obsidian (page.evaluate). Each
 * must be self-contained: no imports, no closure over module scope; only
 * `window.app` and its arguments. They drive the plugin the way its own
 * UI does (the map view's mouse handlers, its path tool, its undo), and
 * reach into private fields only to pick a tool without clicking through a
 * picker modal.
 */

/** Wait until the plugin's stores are loaded; installs a vault-write tracker. */
export async function waitReady(id, timeoutMs) {
  const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.app;
  if (!window.__smoke) {
    window.__smoke = { lastWrite: Date.now(), writes: [] };
    const note = (kind) => (f, old) => {
      window.__smoke.lastWrite = Date.now();
      if (window.__smoke.writes.length < 5000) window.__smoke.writes.push({ kind, path: f.path, old, t: Date.now() });
    };
    for (const k of ["modify", "create", "delete", "rename"]) app.vault.on(k, note(k));
  }
  while (Date.now() - t0 < timeoutMs) {
    const p = app.plugins.plugins[id];
    // A fresh install holds its stores' first writes until the setup wizard
    // confirms the world folder (F19). Note what was written meanwhile
    // (should be nothing), then go on as a user confirming would.
    if (app.workspace.layoutReady && p?.startupWritesHeld) {
      await sleep(1500);
      window.__smoke.held = { held: true, writes: window.__smoke.writes.map((w) => w.path) };
      p.releaseStartupWrites();
    }
    if (app.workspace.layoutReady && p?.mapStore?.isReady?.() && p.paletteStore?.isReady?.()) {
      return { ready: true, ms: Date.now() - t0 };
    }
    await sleep(250);
  }
  const p = app.plugins.plugins[id];
  return { ready: false, ms: Date.now() - t0, loaded: !!p, mapStore: !!p?.mapStore?.isReady?.(), palettes: !!p?.paletteStore?.isReady?.() };
}

/** Wait for `quietMs` with no vault writes (max `maxMs`), flushing the map store. */
export async function settle(id, quietMs, maxMs) {
  const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const p = window.app.plugins.plugins[id];
  for (;;) {
    try { await p?.mapStore?.flush?.(); } catch { /* reported by C1 */ }
    const quiet = Date.now() - (window.__smoke?.lastWrite ?? 0);
    const busy = [...document.querySelectorAll(".notice")].some((n) => /moving map data|Indexing/i.test(n.textContent ?? ""));
    if (quiet >= quietMs && !busy) return { ms: Date.now() - t0, quiet: true };
    if (Date.now() - t0 > maxMs) return { ms: Date.now() - t0, quiet: false };
    await sleep(250);
  }
}

/** Close modals (wizard nudges, prompts) so they don't swallow input. */
export function closeModals() {
  const n = document.querySelectorAll(".modal-container").length;
  document.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
  return n;
}

/** Notices on screen now. */
export function notices() {
  return [...document.querySelectorAll(".notice")].map((n) => (n.textContent ?? "").trim()).filter(Boolean);
}

/** The plugin's settings as the checks need them. */
export function state(id) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const s = p.settings;
  const seen = new Set();
  const maps = s.maps.filter((m) => !seen.has(m.name) && !!seen.add(m.name)).map((m) => ({
    name: m.name,
    cols: m.gridSize?.cols, rows: m.gridSize?.rows,
    overworld: !!m.regions,
    submapKind: m.submapKind ?? null,
    parent: m.parent?.map ?? null,
    world: m.world ? `${m.world.cx},${m.world.cy}` : null,
    workMode: m.workMode ?? null,
    paletteName: m.paletteName,
    paths: p.mapStore.paths(m.name)?.length ?? 0,
    hexes: p.mapStore.all(m.name).size,
    broken: !!p.mapStore.broken?.has?.(m.name),
    missing: !!p.mapStore.isMissing?.(m.name),
    noteExists: !!app.vault.getAbstractFileByPath(p.mapStore.notePath(m.name)),
    notePath: p.mapStore.notePath(m.name),
    // contextKinds since the module registry (P2); isSpaceMap on older builds.
    space: !!(p.contextKinds ? p.contextKinds(m.name).has("space") : p.isSpaceMap?.(m.name)),
  }));
  return {
    version: p.manifest.version,
    mapKinds: s.mapKinds,
    palettes: s.terrainPalettes.map((x) => x.name),
    pathTypes: (s.pathTypes ?? []).length,
    defaultMap: s.defaultMap,
    setupComplete: !!s.setupComplete,
    maps,
    mapEntries: s.maps.length,
    wizardOpen: app.workspace.getLeavesOfType("duckmage-setup-wizard").length,
    commands: Object.keys(app.commands.commands).filter((c) => c.startsWith(id + ":")),
  };
}

/** Every map's hex data from the store: { map: { "x_y": HexData } }. */
export function dumpStore(id) {
  const p = window.app.plugins.plugins[id];
  const out = {};
  const seen = new Set();
  for (const m of p.settings.maps) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    out[m.name] = {};
    for (const [k, h] of p.mapStore.all(m.name)) out[m.name][k] = h;
  }
  return out;
}

/** Path counts per map and whether each map's paths resolve to hex chains. */
export function pathState(id) {
  const p = window.app.plugins.plugins[id];
  const out = {};
  const seen = new Set();
  for (const m of p.settings.maps) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    const paths = p.mapStore.paths(m.name) ?? [];
    let resolved = null;
    try { resolved = paths.length ? p.mapStore.resolved(m.name) : []; } catch (e) { resolved = "error: " + e; }
    out[m.name] = { paths: paths.length, resolved: Array.isArray(resolved) ? resolved.length : resolved };
  }
  return out;
}

/**
 * Open a map in the map view and wait for its hexes to render.
 * Returns { ms, hexes, expected, canvas, active }.
 */
export async function openMap(id, name, timeoutMs) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  await p.showMap(name);
  const view = () => app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  let last = -1, stable = 0, hexes = 0;
  while (performance.now() - t0 < timeoutMs) {
    const v = view();
    const root = v?.containerEl;
    hexes = root ? root.querySelectorAll(".duckmage-hex[data-x]").length : 0;
    const canvas = root ? root.querySelectorAll("canvas").length : 0;
    // A missing map (SM-DEL) shows its empty state instead of a grid.
    if (v?.activeMapName === name && root?.querySelector(".duckmage-map-missing-state")) break;
    if (v?.activeMapName === name && (hexes > 0 || canvas > 0)) {
      if (hexes === last) stable++; else stable = 0;
      if (stable >= 3) break;
    }
    last = hexes;
    await sleep(100);
  }
  const v = view();
  const m = p.getMap(name);
  return {
    ms: Math.round(performance.now() - t0),
    active: v?.activeMapName ?? null,
    hexes,
    expected: m ? m.gridSize.cols * m.gridSize.rows : null,
    canvas: v?.containerEl?.querySelectorAll("canvas").length ?? 0,
    workModeBtn: !!v?.containerEl?.querySelector(".duckmage-work-mode-btn"),
    missingState: !!v?.containerEl?.querySelector(".duckmage-map-missing-state"),
  };
}

/** Run a command by id; true if it ran (errors land in the console log). */
export async function runCommand(cmdId) {
  const ok = window.app.commands.executeCommandById(cmdId);
  await new Promise((r) => setTimeout(r, 600));
  return ok;
}

/**
 * C6 round trip on `name`, through the map view's own mouse handler and
 * undo: (a) paint a blank hex, check the map-note row, undo, row gone;
 * (b) paint over a painted hex, undo, the old terrain is back;
 * (c) reload the store from the note: same data as before.
 */
export async function paintRoundTrip(id, name) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await p.showMap(name);
  await sleep(800);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view || view.activeMapName !== name) return { ok: false, error: "map view did not open " + name };
  const palette = p.getMapPalette(name).map((t) => t.name);
  if (palette.length < 2) return { ok: true, skipped: "palette has fewer than 2 terrains" };
  const notePath = store.notePath(name);
  const readNote = async () => ((await app.vault.adapter.exists(notePath)) ? app.vault.adapter.read(notePath) : null);
  const rowFor = (text, key) => {
    // The Hexes table writes "3_4"; people may write "3, 4".
    const [x, y] = key.split("_");
    const re = new RegExp(`^\\|\\s*${x}(?:_|,\\s*)${y}\\s*\\|.*$`, "m");
    return text ? (re.exec(text)?.[0] ?? null) : null;
  };
  const hexEls = [...view.containerEl.querySelectorAll(".duckmage-hex[data-x]")];
  const keyOf = (el) => `${el.dataset.x}_${el.dataset.y}`;
  const blankEl = hexEls.find((el) => !store.get(name, keyOf(el)));
  // Order-free: a reload may list hexes (and fields) in another order.
  const canon = () => JSON.stringify([...store.all(name)].map(([k, h]) => [k, Object.fromEntries(Object.entries(h).sort())]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const before = canon();
  const textBefore = await readNote();
  const paint = async (el, terrain) => {
    view.leaveOtherToolFor?.("terrain");
    view.drawingMode = "terrain";
    view.isErasingMode = false;
    view.terrainPickMode = false;
    view.paintTerrainName = terrain;
    view.paintBrushSize = 1;
    el.scrollIntoView?.({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.ownerDocument.dispatchEvent(new MouseEvent("mouseup", at));
    await view.terrainWritesSettled?.();
    await store.flush();
  };
  const undo = async () => {
    await view.undo();
    await view.terrainWritesSettled?.();
    await store.flush();
  };
  const out = { ok: true, steps: [], problems: [] };
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  // (a) blank hex
  if (!blankEl) out.steps.push("no blank hex on this map");
  else {
    const key = keyOf(blankEl);
    const t1 = palette[0];
    await paint(blankEl, t1);
    const got = store.get(name, key)?.terrain;
    if (got !== t1) fail(`paint ${key}: store has ${got}, wanted ${t1}`);
    const row = rowFor(await readNote(), key);
    if (!row || !row.includes(t1)) fail(`paint ${key}: map note row missing or wrong: ${row}`);
    await undo();
    if (store.get(name, key)?.terrain) fail(`undo ${key}: store still has ${store.get(name, key)?.terrain}`);
    if (rowFor(await readNote(), key)) fail(`undo ${key}: map note row still there`);
    out.steps.push(`blank ${key}: painted ${t1}, undone`);
  }
  // (b) painted hex: the one painted before, or paint one first (and undo that too)
  let paintedEl = hexEls.find((el) => store.get(name, keyOf(el))?.terrain && palette.includes(store.get(name, keyOf(el)).terrain));
  let seeded = false;
  if (!paintedEl && blankEl) {
    await paint(blankEl, palette[0]);
    paintedEl = blankEl;
    seeded = true;
  }
  if (paintedEl) {
    const key = keyOf(paintedEl);
    const t0 = store.get(name, key).terrain;
    const t2 = palette.find((t) => t !== t0);
    await paint(paintedEl, t2);
    if (store.get(name, key)?.terrain !== t2) fail(`overpaint ${key}: store has ${store.get(name, key)?.terrain}, wanted ${t2}`);
    await undo();
    const back = store.get(name, key)?.terrain ?? null;
    if (back !== t0) fail(`undo overpaint ${key}: terrain is ${back}, wanted the old ${t0}`);
    const row = rowFor(await readNote(), key);
    if (back === t0 && (!row || !row.includes(t0))) fail(`undo overpaint ${key}: map note row ${row}`);
    out.steps.push(`painted ${key}: ${t0} → ${t2}, undone → ${back}`);
    if (seeded) { await undo(); out.steps.push("seed undone"); }
  }
  view.exitTerrainMode?.();
  view.drawingMode = null;
  await store.flush();
  // (c) the note reads back to the same data
  await store.reloadFromNotes();
  await sleep(300);
  const after = canon();
  if (after !== before) {
    const was = new Map(JSON.parse(before)), now = new Map(JSON.parse(after));
    const keys = [...new Set([...was.keys(), ...now.keys()])].filter((k) => JSON.stringify(was.get(k)) !== JSON.stringify(now.get(k)));
    fail(`store after undo + reload differs from before: ${keys.slice(0, 5).map((k) => `${k} ${JSON.stringify(was.get(k))} → ${JSON.stringify(now.get(k))}`).join(", ")}`);
  }
  const textAfter = await readNote();
  out.noteUnchanged = textAfter === textBefore;
  return out;
}

/**
 * C8 mode locks on `name` (a plain map): in Play the path tool's edits are
 * refused and nothing is written; in Build the same edit goes through and
 * undoes. Terrain paint likewise: Play refuses it, Build paints and undoes.
 */
export async function modeLocks(id, name) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await p.showMap(name);
  await sleep(600);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view || view.activeMapName !== name) return { ok: false, problems: ["map view did not open " + name] };
  const out = { ok: true, problems: [], steps: [], gaps: [] };
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  const map = p.getMap(name);
  const startMode = map.workMode;
  const notePath = store.notePath(name);
  const readNote = async () => ((await app.vault.adapter.exists(notePath)) ? app.vault.adapter.read(notePath) : null);
  const types = p.getMapPathTypes(name);
  const cols = map.gridSize.cols, rows = map.gridSize.rows;
  // Candidate start/end hexes: a route may be refused (impassable ends,
  // no way round), so Build tries a few pairs and Play reuses the one that drew.
  const ox = map.gridOffset.x, oy = map.gridOffset.y;
  const at = (fx, fy) => `${ox + Math.min(cols - 1, Math.max(0, Math.round(fx * (cols - 1))))}_${oy + Math.min(rows - 1, Math.max(0, Math.round(fy * (rows - 1))))}`;
  const pairs = [[at(0.2, 0.2), at(0.5, 0.4)], [at(0.5, 0.5), at(0.7, 0.6)], [at(0.1, 0.8), at(0.3, 0.8)], [at(0.8, 0.2), at(0.8, 0.4)], [at(0.4, 0.1), at(0.6, 0.1)], [at(0, 0), at(0.2, 0)]]
    .filter(([a, b]) => a !== b);
  const draw = async ([a, b]) => {
    const tool = view.pathTool;
    tool.reset();
    tool.setType(types[0].name);
    for (const k of [a, b]) {
      const [x, y] = k.split("_").map(Number);
      tool.click(x, y, undefined, false);
      await sleep(50);
    }
    tool.done();
    await store.flush();
    await sleep(200);
  };
  const pathsJson = () => JSON.stringify(store.paths(name));
  try {
    if (!types.length) out.steps.push("no path types: path lock not tested");
    else {
      // Build: a path draws and undoes (so the lock isn't simply everything).
      view.setWorkMode("build");
      await store.flush();
      await sleep(300);
      const b0 = pathsJson();
      let drawn = null;
      for (const pair of pairs) {
        await draw(pair);
        if (pathsJson() !== b0) { drawn = pair; break; }
      }
      if (!drawn) fail(`Build: no path could be drawn (tried ${pairs.map((x) => x.join("→")).join(", ")})`);
      else {
        await view.undo();
        await store.flush();
        await sleep(200);
        if (pathsJson() !== b0) fail("Build: undo didn't remove the drawn path");
        out.steps.push(`build: path ${drawn.join("→")} drawn and undone`);
        // Play: the same edit is refused and nothing is written.
        view.setWorkMode("play");
        await store.flush();
        await sleep(300);
        const before = pathsJson(), text = await readNote();
        await draw(drawn);
        if (pathsJson() !== before) fail("Play: a path was drawn");
        if ((await readNote()) !== text) fail("Play: the map note changed after a refused path edit");
        else out.steps.push("play: the same path edit refused, map note unchanged");
      }
    }
    // Terrain paint on a plain map, through the real mouse handlers: Play
    // refuses it (nothing written), Build paints it, and Build's undo takes
    // it back (WM6: Play's queue is untouched).
    const hexEl = view.containerEl.querySelector(".duckmage-hex[data-x]");
    if (hexEl) {
      const key = `${hexEl.dataset.x}_${hexEl.dataset.y}`;
      const terrain = p.getMapPalette(name).map((t) => t.name).find((t) => t !== store.get(name, key)?.terrain);
      if (terrain) {
        const paint = async () => {
          view.leaveOtherToolFor?.("terrain");
          view.drawingMode = "terrain";
          view.isErasingMode = false;
          view.terrainPickMode = false;
          view.paintTerrainName = terrain;
          view.paintBrushSize = 1;
          const el = view.containerEl.querySelector(`.duckmage-hex[data-x="${hexEl.dataset.x}"][data-y="${hexEl.dataset.y}"]`) ?? hexEl;
          const r = el.getBoundingClientRect();
          const at = { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
          el.dispatchEvent(new MouseEvent("mousedown", at));
          el.ownerDocument.dispatchEvent(new MouseEvent("mouseup", at));
          await view.terrainWritesSettled?.();
          await sleep(100);
          view.exitTerrainMode?.();
          view.drawingMode = null;
        };
        const now = () => JSON.stringify(store.get(name, key) ?? null);
        view.setWorkMode("play");
        await sleep(200);
        const before = now(), text = await readNote();
        await paint();
        await store.flush();
        if (now() !== before) {
          fail("Play: terrain paint was written");
          view.setWorkMode("build");
          await view.undo();
          await view.terrainWritesSettled?.();
        } else if ((await readNote()) !== text) fail("Play: the map note changed after a refused terrain paint");
        else out.steps.push("play: terrain paint refused, map note unchanged");
        view.setWorkMode("build");
        await sleep(200);
        await paint();
        if (store.get(name, key)?.terrain !== terrain) fail("Build: terrain paint was not written");
        else {
          out.steps.push("build: terrain paint written");
          await view.undo();
          await view.terrainWritesSettled?.();
          await sleep(100);
          if (now() !== before) fail("Build: undo didn't take the paint back");
          else out.steps.push("build: undo took it back");
        }
      }
    }
  } finally {
    view.setWorkMode(startMode === "god" || startMode === "play" ? startMode : "build");

    await store.flush();
  }
  return out;
}

/**
 * C9 solo play on `name` (SF3/SF5), through the map view's own handlers:
 * a party token note on a middle hex; in Play, a click on the token picks
 * it up (its neighbours light up), a click on a lit hex moves it there
 * (token note and the map note's `visited:` list); "Add to play log…"
 * writes today's log note and links it from the hex note. Everything it
 * made is removed again (the map's visited list and mode restored).
 */
export async function partyPlay(id, name) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  await p.showMap(name);
  await sleep(600);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view || view.activeMapName !== name) return { ok: false, steps: [], problems: ["map view did not open " + name] };
  const out = { ok: true, steps: [], problems: [] };
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  const map = p.getMap(name);
  const startMode = map.workMode;
  const visitedBefore = map.visited ? [...map.visited] : undefined;
  const hexEls = [...view.containerEl.querySelectorAll(".duckmage-hex[data-x]")];
  const mid = hexEls[Math.floor(hexEls.length / 2)];
  if (!mid) return { ok: true, steps: ["no hexes: skipped"], problems: [] };
  const key = `${mid.dataset.x}_${mid.dataset.y}`;
  const tokPath = "smoke-party-token.md";
  const made = [tokPath];
  try {
    await app.vault.create(tokPath, `---\ntoken: true\ntoken-hex: "${key}"\ntoken-map: "${name}"\ntoken-party: true\n---\n# Smoke party\n`);
    view.setWorkMode("play");
    await sleep(300);
    const tokenEl = await waitFor(() => view.containerEl.querySelector(".duckmage-token.is-party"));
    if (!tokenEl) { fail("the party token wasn't drawn"); return out; }
    const press = (el) => {
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      el.dispatchEvent(new MouseEvent("mousedown", at));
      el.ownerDocument.dispatchEvent(new MouseEvent("mouseup", at));
    };
    press(tokenEl);
    // The map may still redraw after the mode switch: let it settle, then
    // take the lit hex from the grid as it is now (not a detached one).
    await sleep(800);
    const step = await waitFor(() => [...view.containerEl.querySelectorAll(".duckmage-hex-map-grid .duckmage-hex.duckmage-party-step")].find((el) => el.isConnected));
    if (!view.containerEl.querySelector(".duckmage-token.is-party.is-selected")) fail("a click didn't pick the party up");
    if (!step) { fail("no neighbouring hex lit up"); return out; }
    const to = `${step.dataset.x}_${step.dataset.y}`;
    const party = view.activeParty?.();
    let reached = false;
    const onHexClick = view.onHexClick;
    view.onHexClick = function (...a) { reached = true; return onHexClick.apply(this, a); };
    try {
      // A real mouseup is always followed by a click; the synthetic strokes
      // of earlier checks aren't, which leaves the view's "that was a drag,
      // swallow the next click" flag set. A click on the view's own box
      // (no hex) clears it.
      view.contentEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      step.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    } finally { view.onHexClick = onHexClick; }
    if (!reached || !party) out.problems.push(`(click reached the map: ${reached}; target ${step.className} in ${step.parentElement?.className}; party picked up: ${party ? party.hex : "none"}; mode ${p.getMap(name).workMode})`);
    const readTok = async () => (await app.vault.adapter.exists(tokPath)) ? app.vault.adapter.read(tokPath) : "";
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) { moved = new RegExp(`^token-hex: "?${to}"?\\s*$`, "m").test(await readTok()); if (!moved) await sleep(100); }
    if (!moved) fail(`the party didn't move to ${to}`);
    await store.flush?.();
    await sleep(300);
    const visited = p.getMap(name).visited ?? [];
    if (!visited.includes(key) || !visited.includes(to)) fail(`visited is ${JSON.stringify(visited)}, wanted ${key} and ${to}`);
    const note = await app.vault.adapter.read(store.notePath(name));
    if (!/^visited:/m.test(note)) fail("the map note has no visited: line");
    if (!view.containerEl.querySelector(`.duckmage-hex.duckmage-hex-visited[data-x="${step.dataset.x}"][data-y="${step.dataset.y}"]`)) fail("the new hex has no visited mark");
    if (out.ok) out.steps.push(`play: party picked up, stepped ${key} → ${to}, both visited`);
    // The play log.
    const stepPath = p.hexPath(Number(step.dataset.x), Number(step.dataset.y), name);
    const hadStepNote = !!app.vault.getAbstractFileByPath(stepPath);
    view.openPlayLog(Number(step.dataset.x), Number(step.dataset.y));
    const box = await waitFor(() => document.querySelector(".duckmage-play-log-text"));
    if (!box) fail("Add to play log didn't open");
    else {
      box.value = "Smoke: wolves on the ridge.";
      box.closest(".modal")?.querySelector("button.mod-cta")?.click();
      let found = null;
      for (let i = 0; i < 50 && !found; i++) {
        await sleep(100);
        for (const f of app.vault.getMarkdownFiles().filter((f) => /\/log\/\d{4}-\d\d-\d\d\.md$/.test(f.path))) {
          if ((await app.vault.read(f)).includes("Smoke: wolves on the ridge.")) found = f;
        }
      }
      await sleep(400);
      if (!found) fail("no log note holds the entry");
      else {
        const text = await app.vault.read(found);
        if (!/\[\[smoke-party-token(\|[^\]]*)?\]\]/.test(text)) fail("the log entry doesn't name the party");
        const hexNote = app.vault.getAbstractFileByPath(stepPath);
        const hexText = hexNote ? await app.vault.read(hexNote) : "";
        if (!/^#{1,6} Log\s*$/m.test(hexText) || !hexText.includes(found.basename)) fail("the hex note has no link to the log day");
        if (!hadStepNote) made.push(stepPath);
        // The day's note: remove it only if this check made it (nothing else in it).
        if (text.split("\n").filter((l) => l.startsWith("- ")).length === 1) made.push(found.path);
        if (out.ok) out.steps.push(`log: entry in ${found.path}, hex links back`);
      }
    }
  } finally {
    document.querySelectorAll(".modal-close-button").forEach((b) => b.click());
    for (const path of made) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.delete(f);
    }
    const m = p.getMap(name);
    if (visitedBefore) m.visited = visitedBefore; else delete m.visited;
    view.setWorkMode(startMode === "god" || startMode === "play" ? startMode : "build");
    await p.saveSettings();
    await store.flush?.();
    await sleep(300);
  }
  return out;
}

/**
 * Overworld paint lock: in Play, the terrain brush over the Regions view
 * is refused (Notice) and no region's data changes.
 */
export async function overworldPaintLock(id, name) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await p.showMap(name);
  await sleep(1500);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view || view.activeMapName !== name) return { ok: false, problems: ["overworld did not open"] };
  const all = () => JSON.stringify(p.settings.maps.map((m) => [m.name, [...store.all(m.name)]]));
  const startMode = p.getMap(name).workMode;
  const out = { ok: true, problems: [], steps: [] };
  try {
    view.setWorkMode("play");
    await store.flush();
    await sleep(300);
    const before = all();
    view.showOverworldRegions?.();
    await sleep(800);
    view.leaveOtherToolFor?.("terrain");
    view.drawingMode = "terrain";
    view.paintTerrainName = p.getMapPalette(name)[0]?.name ?? null;
    const shown = view.overworldLayer?.showsRegions?.(view.getActiveMap?.());
    const box = view.containerEl.querySelector(".duckmage-hex-map-clip") ?? view.containerEl;
    const r = box.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    const n0 = document.querySelectorAll(".notice").length;
    box.dispatchEvent(new MouseEvent("mousedown", at));
    box.ownerDocument.dispatchEvent(new MouseEvent("mouseup", at));
    await sleep(400);
    await store.flush();
    const said = [...document.querySelectorAll(".notice")].slice(n0).map((n) => n.textContent);
    if (all() !== before) { out.ok = false; out.problems.push("Play: overworld paint changed region data"); }
    out.steps.push(`regions view shown: ${shown}; notice: ${said.join(" | ") || "(none)"}`);
    if (shown && !said.some((t) => /Switch to Build/i.test(t ?? ""))) { out.ok = false; out.problems.push("Play: no locked-paint notice"); }
    view.exitTerrainMode?.();
    view.drawingMode = null;
  } finally {
    view.setWorkMode(startMode === "god" || startMode === "play" ? startMode : "build");

    await store.flush();
  }
  return out;
}
