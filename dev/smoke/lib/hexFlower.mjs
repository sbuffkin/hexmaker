/**
 * C10 hex flower solo (plan-hex-flower). Runs in the page like the other
 * helpers in page.mjs (sent as source text, so it must be self-contained).
 *
 * In a build with the hexflower slice (skipped otherwise): the setup
 * wizard doesn't list Hex flower (HF8: a kind of map, not a generator); a map made with it (as the
 * wizard does: generate, createNewMap, afterCreate) has only its middle
 * hex filled, a Party token there, a hex flower note and explore-with; in
 * Play a party step into a blank neighbour fills it, and the view's undo
 * (Ctrl+Z) takes the step and the fill back together; a hand-painted hex
 * the party walks into is untouched. HF4: walking north off the edge grows
 * the map (blank, no hex notes), Ctrl+Z shrinks it back, redo grows it
 * again. The map stays, so the C5 restart then checks that nothing is
 * rewritten (and the grown size is read back).
 */
export async function hexFlowerSolo(id) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const out = { ok: true, steps: [], problems: [] };
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  const kinds = p.moduleGenerators({ toPaths: () => ({ paths: [], missing: [] }), procGrid: (g) => ({ ...g, orientation: p.settings.hexOrientation }) });
  const kind = kinds.find((k) => k.id === "procedural:hex-flower");
  if (!kind) return { ok: true, skipped: "the hexflower slice isn't in this build", steps: [], problems: [] };
  // HF8: exploring is a kind of map (New map's Explore as you go), never in a generator list.
  const leaf = app.workspace.getLeavesOfType("duckmage-setup-wizard")[0];
  if (leaf) {
    const wiz = leaf.view;
    wiz.currentIndex = 2;
    wiz.renderView();
    const gens = () => [...wiz.contentEl.querySelectorAll(".duckmage-setup-gen .duckmage-setup-gen-title")].map((e) => e.textContent);
    await waitFor(() => gens().length > 1);
    if (gens().includes("Hex flower")) fail(`wizard lists Hex flower: ${gens().join(", ")}`);
    else out.steps.push("wizard: no Hex flower in the list");
  }
  // Make the map as the wizard does.
  const pal = p.settings.defaultPalette ?? p.settings.terrainPalettes[0].name;
  const terrains = p.getPaletteOrPresetTerrains(pal);
  const grid = { cols: 9, rows: 7, offset: { x: 0, y: 0 }, stagger: p.settings.staggerOffset ?? "odd" };
  const options = { flower: "new", start: "blank", party: "on", reveal: "entered" };
  const seed = 4242;
  const gen = kind.generate({ terrains, grid, seed, options });
  if (!gen.ok) return { ok: false, steps: [], problems: ["generate: " + gen.message] };
  const res = await p.createNewMap({ name: "Smoke Flower", cols: 9, rows: 7, palette: pal, terrain: gen.cells, quiet: true });
  if ("error" in res) return { ok: false, steps: [], problems: ["create: " + res.error] };
  const name = res.name;
  await kind.afterCreate(p, { mapName: name, generatorId: kind.id, options, seed, grid, paletteName: pal, choices: {}, onProgress: () => {} });
  await store.flush?.();
  await sleep(800);
  const map = p.getMap(name);
  const filled = [...store.all(name)].filter(([, h]) => h.terrain).map(([k]) => k);
  if (filled.length !== 1 || filled[0] !== "4_3") fail(`filled at start: ${JSON.stringify(filled)}`);
  if (!map.exploreWith?.length || !map.hexFlowerAt?.length || map.seed !== seed) fail(`map keys: ${JSON.stringify({ e: map.exploreWith, a: map.hexFlowerAt, s: map.seed })}`);
  const note = await app.vault.adapter.read(store.notePath(name));
  if (!/^explore-with:/m.test(note) || !/^hex-flower-at:/m.test(note)) fail("the map note has no explore-with / hex-flower-at");
  const flowerNote = app.vault.getMarkdownFiles().find((f) => /\/hex flowers\//.test(f.path));
  if (!flowerNote || !/hexmaker-hex-flower: 1/.test(await app.vault.read(flowerNote))) fail("no hex flower note");
  const party = app.vault.getMarkdownFiles().find((f) => /\/tokens\/Party( \d+)?\.md$/.test(f.path));
  const partyText = party ? await app.vault.read(party) : "";
  if (!/token-party: true/.test(partyText) || !/token-hex: "?4_3"?/.test(partyText)) fail("no Party token on 4_3");
  if (out.ok) out.steps.push(`made ${name}: only 4_3 filled (${store.get(name, "4_3")?.terrain}), Party there, ${flowerNote?.path}`);

  // Play: step into a blank neighbour.
  await p.showMap(name);
  await sleep(800);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view || view.activeMapName !== name) { fail("map view did not open " + name); return out; }
  view.setWorkMode("play");
  await sleep(400);
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.ownerDocument.dispatchEvent(new MouseEvent("mouseup", at));
  };
  // Pick the party up (if it isn't) and return the lit hexes.
  const pickUp = async () => {
    const t = await waitFor(() => view.containerEl.querySelector(".duckmage-token.is-party"));
    if (!t) return [];
    if (!view.containerEl.querySelector(".duckmage-token.is-party.is-selected")) press(t);
    await sleep(700);
    const lit = () => [...view.containerEl.querySelectorAll(".duckmage-hex-map-grid .duckmage-hex.duckmage-party-step")].filter((el) => el.isConnected);
    await waitFor(() => lit().length > 0);
    return lit();
  };
  const click = (el) => {
    view.contentEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  };
  let lit = await pickUp();
  const blank = lit.find((el) => !store.get(name, `${el.dataset.x}_${el.dataset.y}`)?.terrain);
  if (!blank) { fail("no blank neighbour lit"); return out; }
  const to = `${blank.dataset.x}_${blank.dataset.y}`;
  click(blank);
  const got = await waitFor(() => store.get(name, to)?.terrain, 5000);
  if (!got) fail(`stepping into ${to} didn't fill it`);
  else out.steps.push(`play: party 4_3 → ${to}, filled ${got}`);
  await sleep(600);
  // Ctrl+Z: the step and the fill come back together.
  await view.undo();
  await sleep(800);
  const tokText = party ? await app.vault.read(party) : "";
  if (store.get(name, to)?.terrain) fail(`undo left ${to} filled`);
  if (!/token-hex: "?4_3"?/.test(tokText)) fail("undo didn't take the party back to 4_3");
  if (out.ok) out.steps.push("undo: fill and step taken back together");
  // A hand-painted hex is untouched.
  lit = await pickUp();
  const other = lit.find((el) => `${el.dataset.x}_${el.dataset.y}` !== to) ?? lit[0];
  if (!other) { fail("no neighbour lit after undo"); return out; }
  const painted = `${other.dataset.x}_${other.dataset.y}`;
  const paintWith = terrains[terrains.length - 1].name;
  store.set(name, painted, { terrain: paintWith });
  await sleep(400);
  lit = await pickUp();
  const again = lit.find((el) => `${el.dataset.x}_${el.dataset.y}` === painted);
  if (!again) fail(`painted hex ${painted} wasn't lit`);
  else {
    click(again);
    await sleep(1500);
    if (store.get(name, painted)?.terrain !== paintWith) fail(`the painted hex ${painted} changed to ${store.get(name, painted)?.terrain}`);
    else out.steps.push(`painted hex ${painted} kept ${paintWith}`);
  }
  // HF4: walk north to the edge; the map grows (blank), undo shrinks it, redo grows it again.
  const gridNow = () => ({ ...p.getMap(name).gridOffset, ...p.getMap(name).gridSize });
  const start = gridNow();
  const partyNow = () => { view.tokens.loadTokensForMap(); return view.tokens.tokenEntries.find((t) => t.party); };
  let grewAt = null;
  for (let i = 0; i < 12 && !grewAt; i++) {
    const t = partyNow();
    if (!t) { fail("no party to walk north"); break; }
    const [x, y] = t.hex.split("_").map(Number);
    await view.tokens.moveParty(t, `${x}_${y - 1}`);
    await sleep(500);
    if (gridNow().y !== start.y) grewAt = `${x}_${y - 1}`;
  }
  if (!grewAt) fail(`walking north never grew the map (grid ${JSON.stringify(gridNow())})`);
  else {
    const grown = gridNow();
    const notes = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(store.mapFolder?.(name) ?? "\u0000") && /\/-?\d+_-\d+\.md$/.test(f.path));
    if (notes.length) fail(`growing made hex notes: ${notes.map((f) => f.path).join(", ")}`);
    await view.undo();
    await sleep(800);
    if (gridNow().y === grown.y) fail(`undo kept the grown rows (${JSON.stringify(gridNow())})`);
    await view.redo();
    await sleep(800);
    if (gridNow().y !== grown.y) fail(`redo didn't grow it again (${JSON.stringify(gridNow())})`);
    if (out.ok) out.steps.push(`grew at ${grewAt}: rows ${start.rows} → ${grown.rows}, undo and redo`);
  }
  view.setWorkMode("build");
  await p.saveSettings();
  await store.flush?.();
  await sleep(500);
  return out;
}

/**
 * C10b Explore as you go (HF8). Through the real New map form: Terrain →
 * Explore as you go (the size row says the map starts 3 × 3, a start grid
 * of 9 hexes), the generator list picks the home generator, Add another
 * area puts a second one north and near, a click on a hex moves the start,
 * Create. Then the map: 3 × 3, two areas in explore-realms, the realms rule,
 * the start hex filled from the home area's terrains and the party there;
 * in Play, five steps north fill each hex from the areas' terrains and grow
 * the map. The map stays for the C5 restart (nothing rewritten).
 */
export async function exploreAsYouGo(id) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const out = { ok: true, steps: [], problems: [] };
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  const kinds = p.moduleGenerators({ toPaths: () => ({ paths: [], missing: [] }), procGrid: (g) => ({ ...g, orientation: p.settings.hexOrientation }) });
  if (!kinds.some((k) => k.id === "procedural:hex-flower")) return { ok: true, skipped: "the hexflower slice isn't in this build", steps: [], problems: [] };
  const first = p.settings.maps[0]?.name;
  if (!first) return { ok: false, steps: [], problems: ["no map to open New map from"] };
  await p.showMap(first);
  await sleep(800);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view) return { ok: false, steps: [], problems: ["no map view"] };
  view.setWorkMode("build");
  view.containerEl.querySelector(".duckmage-region-btn")?.click();
  const newBtn = await waitFor(() => document.querySelector(".duckmage-map-new-btn"));
  if (!newBtn) return { ok: false, steps: [], problems: ["the Maps modal has no New map… button"] };
  newBtn.click();
  const modal = await waitFor(() => document.querySelector(".duckmage-setup-modal .duckmage-setup-form")?.closest(".modal"));
  if (!modal) return { ok: false, steps: [], problems: ["New map didn't open"] };
  const q = (sel) => modal.querySelector(sel);
  const qa = (sel) => [...modal.querySelectorAll(sel)];
  const visible = (el) => !!el && el.isConnected && el.offsetParent !== null;
  const name = modal.querySelector(".duckmage-setup-name");
  name.value = "Smoke Explore";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  // Terrain: Generate it now / Explore as you go / Blank.
  const cards = () => qa(".duckmage-wizard-scale-btn");
  const modes = cards().map((c) => c.querySelector(".duckmage-wizard-orient-label")?.textContent);
  if (!["Generate it now", "Explore as you go", "Blank"].every((m) => modes.includes(m))) fail(`Terrain choices: ${modes.join(", ")}`);
  cards().find((c) => c.querySelector(".duckmage-wizard-orient-label")?.textContent === "Explore as you go")?.click();
  const startGrid = await waitFor(() => qa(".duckmage-explore-start-hex").length === 9);
  if (!startGrid) fail(`start grid: ${qa(".duckmage-explore-start-hex").length} hexes`);
  const sizeSet = q(".duckmage-setup-size-set");
  if (!visible(sizeSet) || !/^Starts 3 × 3/.test(sizeSet.textContent)) fail(`size line: ${sizeSet?.textContent} (shown ${visible(sizeSet)})`);
  if (visible(q(".duckmage-setup-size-custom input"))) fail("the size fields still show");
  // The home generator: the first row of the list (the default), its mix said under it.
  const mixOf = () => (q(".duckmage-explore-mix")?.textContent ?? "").replace(/^Rolls on: |\.$/g, "").split(", ").map((t) => t.replace(/ \d+%$/, "")).filter(Boolean);
  const homeMix = mixOf();
  const homeName = q(".duckmage-explore-area.is-active")?.textContent?.replace(/^Home: /, "");
  if (!homeMix.length) fail(`no mix for home: ${q(".duckmage-explore-mix")?.textContent}`);
  // Another area: north, near, a different generator.
  q(".duckmage-explore-area-add")?.click();
  await waitFor(() => qa(".duckmage-explore-area").length === 2);
  qa(".duckmage-explore-dir").find((d) => d.getAttribute("aria-label") === "north")?.click();
  await sleep(200);
  const far = q(".duckmage-explore-where select");
  if (far) { far.value = "near"; far.dispatchEvent(new Event("change", { bubbles: true })); }
  await sleep(200);
  // The Explore setup's own list (the Generate list is on the form too, hidden): open its first group.
  const groups = qa(".duckmage-setup-mode .duckmage-gen-pick-group");
  groups[0]?.click();
  await sleep(200);
  const rows = qa(".duckmage-setup-mode .duckmage-gen-pick-row");
  const other = rows.find((r) => !r.classList.contains("is-active"));
  const otherName = other?.querySelector(".duckmage-gen-pick-name")?.textContent ?? "";
  other?.click();
  await sleep(300);
  const areaMix = mixOf();
  const areaChip = (qa(".duckmage-explore-area")[1]?.textContent ?? "").replace(/✕$/, "");
  if (areaChip !== `North, near: ${otherName}`) fail(`second area: ${areaChip} (picked ${otherName} of ${rows.length} rows, ${groups.length} groups)`);
  // Start on the bottom-middle hex.
  qa(".duckmage-explore-start-hex").find((h) => h.getAttribute("aria-label") === "1, 2")?.click();
  await sleep(300);
  if (q(".duckmage-explore-start-hex.is-active")?.getAttribute("aria-label") !== "1, 2") fail("the start hex didn't move");
  if (out.ok) out.steps.push(`New map: Explore as you go, home ${homeName} (${homeMix.join(", ")}), ${areaChip} (${areaMix.join(", ")}), start 1, 2`);
  q(".duckmage-setup-actions .mod-cta")?.click();
  const made = await waitFor(() => p.settings.maps.find((m) => p.mapLabel(m.name) === "Smoke Explore"), 10000);
  if (!made) { fail("the map wasn't made"); return out; }
  await store.flush?.();
  await sleep(1200);
  const map = p.getMap(made.name);
  if (map.gridSize.cols !== 3 || map.gridSize.rows !== 3) fail(`size ${map.gridSize.cols}×${map.gridSize.rows}`);
  if ((map.exploreRealms ?? []).length !== 2) fail(`explore-realms: ${JSON.stringify(map.exploreRealms)}`);
  if (JSON.stringify(map.exploreWith) !== JSON.stringify(["(realms) -> terrain"])) fail(`explore-with: ${JSON.stringify(map.exploreWith)}`);
  const startTerrain = store.get(made.name, "1_2")?.terrain;
  if (!startTerrain) fail("start hex 1_2 is blank");
  // Not out at sea: the start is the biggest terrain the party can walk on.
  const startColor = p.getPaletteOrPresetTerrains(map.paletteName).find((t) => t.name === startTerrain);
  if (startColor && (startColor.impassable ?? /water/.test(startColor.type ?? ""))) fail(`the party starts on ${startTerrain} (impassable)`);
  const note = await app.vault.adapter.read(store.notePath(made.name));
  if (!/^explore-realms:/m.test(note)) fail("the map note has no explore-realms");
  // HF10: hexes reveal the areas' hidden generated land (every terrain the
  // generators make, not only the mix's top few): palette terrains only.
  const palette = new Set(p.getPaletteOrPresetTerrains(map.paletteName).map((t) => t.name));
  const bad = [...store.all(made.name)].filter(([, h]) => h.terrain && !palette.has(h.terrain)).map(([k, h]) => `${k} ${h.terrain}`);
  if (bad.length) fail(`terrain not in the palette: ${bad.join(", ")}`);
  if (out.ok) out.steps.push(`made ${made.name}: 3×3, 2 areas, 1_2 ${startTerrain}, ${[...store.all(made.name)].filter(([, h]) => h.terrain).length} hexes seen`);
  // Play: five steps north.
  await waitFor(() => view.activeMapName === made.name, 4000);
  if (view.activeMapName !== made.name) { await p.showMap(made.name); await sleep(800); }
  view.setWorkMode("play");
  await sleep(400);
  const partyNow = () => { view.tokens.loadTokensForMap(); return view.tokens.tokenEntries.find((t) => t.party); };
  if (partyNow()?.hex !== "1_2") fail(`party on ${partyNow()?.hex}`);
  const rows0 = map.gridSize.rows;
  const walked = [];
  for (let i = 0; i < 5; i++) {
    const t = partyNow();
    if (!t) { fail("no party"); break; }
    const [x, y] = t.hex.split("_").map(Number);
    await view.tokens.moveParty(t, `${x}_${y - 1}`);
    await sleep(600);
    walked.push(`${x}_${y - 1} ${store.get(made.name, `${x}_${y - 1}`)?.terrain ?? "?"}`);
  }
  const blank = walked.filter((w) => / \?$/.test(w));
  if (blank.length) fail(`steps left blank: ${blank.join(", ")}`);
  const outside = [...store.all(made.name)].filter(([, h]) => h.terrain && !palette.has(h.terrain)).map(([k, h]) => `${k} ${h.terrain}`);
  if (outside.length) fail(`after the walk, terrain not in the palette: ${outside.join(", ")}`);
  // The GM's peek (HF10): Peek → Show tints the blank hexes with their hidden land, never a filled one.
  p.getMap(made.name).explorePeek = "on";
  p.refreshHexMap();
  const peeked = await waitFor(() => { const els = [...view.containerEl.querySelectorAll(".duckmage-hex.duckmage-hex-peek")]; return els.length ? els : null; }, 10000);
  if (!peeked) fail("peek on: no blank hex shows its hidden land");
  else {
    const labels = peeked.map((el) => (el.getAttribute("aria-label") ?? "").replace(/^Hidden: /, ""));
    const wrong = labels.filter((t) => !palette.has(t));
    if (wrong.length) fail(`peek shows terrain not in the palette: ${[...new Set(wrong)].join(", ")}`);
    const onFilled = peeked.filter((el) => store.get(made.name, `${el.dataset.x}_${el.dataset.y}`)?.terrain);
    if (onFilled.length) fail(`peek tints ${onFilled.length} filled hexes`);
    if (out.ok) out.steps.push(`peek: ${peeked.length} blank hexes show hidden land (${[...new Set(labels)].slice(0, 4).join(", ")})`);
  }
  delete p.getMap(made.name).explorePeek;
  p.refreshHexMap();
  await sleep(600);
  // Owner addition (HF11): Sees 2 on the party bar, then a click on the party's own hex: ring 2 filled, the token unmoved.
  {
    const t = partyNow();
    const grid = () => view.containerEl.querySelector(".duckmage-hex-map-grid");
    const tokEl = await waitFor(() => grid()?.querySelector(".duckmage-token.is-party"));
    if (tokEl && !grid().querySelector(".duckmage-token.is-party.is-selected")) {
      const r = tokEl.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      tokEl.dispatchEvent(new MouseEvent("mousedown", at));
      tokEl.ownerDocument.dispatchEvent(new MouseEvent("mouseup", at));
    }
    const sees2 = await waitFor(() => view.containerEl.querySelector('.duckmage-party-controls button[aria-label="Sees 2"]'));
    if (!t || !sees2) fail(`no ${t ? "Sees 2 on the party bar" : "party"}`);
    else {
      sees2.click();
      await sleep(300);
      const [x, y] = t.hex.split("_").map(Number);
      const hexOf = (k) => { const [a, b] = k.split("_"); return grid()?.querySelector(`.duckmage-hex[data-x="${a}"][data-y="${b}"]`); };
      const stagger = p.getMap(made.name).staggerOffset ?? p.settings.staggerOffset ?? "odd";
      const flat = p.settings.hexOrientation === "flat";
      const near = (k) => {
        const [a, b] = k.split("_").map(Number);
        const sh = (n) => (stagger === "odd" ? n % 2 !== 0 : n % 2 === 0);
        const d = flat
          ? (!sh(a) ? [[0, -1], [0, 1], [1, -1], [1, 0], [-1, -1], [-1, 0]] : [[0, -1], [0, 1], [1, 0], [1, 1], [-1, 0], [-1, 1]])
          : (!sh(b) ? [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]] : [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]);
        return d.map(([dx, dy]) => `${a + dx}_${b + dy}`);
      };
      const ring2 = () => { const seen = new Set([t.hex]); let edge = [t.hex]; for (let i = 0; i < 2; i++) { const nx = []; for (const k of edge) for (const n of near(k)) if (!seen.has(n)) { seen.add(n); nx.push(n); } edge = nx; } return [...seen].filter((k) => hexOf(k)); };
      const visited = JSON.stringify(p.getMap(made.name).visited ?? null);
      const own = hexOf(t.hex);
      view.contentEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      own?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      await waitFor(() => ring2().every((k) => store.get(made.name, k)?.terrain), 8000);
      const blankLeft = ring2().filter((k) => !store.get(made.name, k)?.terrain);
      if (blankLeft.length) fail(`look from ${t.hex} with Sees 2: still blank ${blankLeft.slice(0, 5).join(", ")}`);
      if (partyNow()?.hex !== t.hex) fail(`the party moved on a look: ${t.hex} → ${partyNow()?.hex}`);
      if (JSON.stringify(p.getMap(made.name).visited ?? null) !== visited) fail("a look marked a visit");
      if (p.getMap(made.name).exploreReveal !== "2 rings") fail(`Sees 2 stored ${p.getMap(made.name).exploreReveal}`);
      if (out.ok) out.steps.push(`Sees 2 + click on the party's hex ${x}_${y}: ${ring2().length} hexes within 2 rings filled, token unmoved`);
    }
  }
  if (p.getMap(made.name).gridSize.rows <= rows0) fail(`the map didn't grow (rows ${p.getMap(made.name).gridSize.rows})`);
  const areaBtn = view.containerEl.querySelector(".duckmage-party-controls")?.textContent ?? "";
  if (out.ok) out.steps.push(`walked north: ${walked.join(", ")}; rows ${rows0} → ${p.getMap(made.name).gridSize.rows}${areaBtn ? `; party controls: ${areaBtn.trim().slice(0, 60)}` : ""}`);
  view.setWorkMode("build");
  await p.saveSettings();
  await store.flush?.();
  await sleep(500);
  return out;
}

/**
 * C10c Explore a finished map with fog of war (HF11). On map `mapName`, in
 * Play, through the real UI: the hex menu's "Start exploring from here…"
 * (the dialog: Party sees 1, a new party token), then the fog: hidden hexes
 * dark with no labels, no other tokens; three steps reveal the sight; Sees 2
 * and a click on the party's own hex reveal ring 2 with the token unmoved
 * (owner addition); Peek draws the hidden hexes faded; the GM reveals one
 * distant hex (only that hex); the Reveal hexes brush reveals a stroke as
 * one undo; Stop lifts the fog. No map data (hexes, the map note's tables)
 * changes. Render time with and without fog is measured (median of `runs`).
 */
export async function exploreFog(id, mapName, opts = {}) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const out = { ok: true, steps: [], problems: [], bench: {} };
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  const kinds = p.moduleGenerators({ toPaths: () => ({ paths: [], missing: [] }), procGrid: (g) => ({ ...g, orientation: p.settings.hexOrientation }) });
  if (!kinds.some((k) => k.id === "procedural:hex-flower")) return { ok: true, skipped: "the hexflower slice isn't in this build", steps: [], problems: [] };
  const map0 = p.getMap(mapName);
  if (!map0) return { ok: false, steps: [], problems: [`no map ${mapName}`] };
  const modeBefore = map0.workMode;
  const canonHexes = () => JSON.stringify([...store.all(mapName)].sort(([a], [b]) => (a < b ? -1 : 1)));
  const tables = async () => { const t = (await store.readNoteText?.(mapName)) ?? ""; return t.slice(t.indexOf("\n## ")); };
  const hexesBefore = canonHexes();
  const tablesBefore = await tables();
  await p.showMap(mapName);
  await sleep(1200);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view || view.activeMapName !== mapName) { fail(`map view did not open ${mapName}`); return out; }
  // Shown and in front: the brush is hit-tested where the pointer is.
  // A hidden sandbox window can start 1×1: give it a size (it stays on the hidden desktop).
  if (innerWidth < 600) { try { window.require("@electron/remote").getCurrentWindow().setSize(1280, 900); } catch { /* not Electron */ } await sleep(800); }
  // Nothing over the map (an upgrade report left open, say): a pointer lands on what's on top.
  document.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
  // The throwaway sandbox's "trust the author" prompt has no close button: take it off the page (never answered).
  document.querySelectorAll(".modal-container").forEach((c) => { if (/trust the author/i.test(c.querySelector(".modal-title")?.textContent ?? "")) c.remove(); });
  await sleep(300);
  app.workspace.leftSplit?.collapse?.();
  app.workspace.rightSplit?.collapse?.();
  await app.workspace.revealLeaf(view.leaf);
  app.workspace.setActiveLeaf(view.leaf, { focus: true });
  view.setWorkMode("play");
  await sleep(600);
  const grid = () => view.containerEl.querySelector(".duckmage-hex-map-grid");
  const hexEl = (k) => { const [x, y] = k.split("_"); return grid()?.querySelector(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`); };
  const fogged = () => new Set([...(grid()?.querySelectorAll(".duckmage-hex-fogged") ?? [])].map((el) => `${el.dataset.x}_${el.dataset.y}`));
  const total = () => grid()?.querySelectorAll(".duckmage-hex[data-x]").length ?? 0;
  const stagger = map0.staggerOffset ?? p.settings.staggerOffset ?? "odd";
  const flat = p.settings.hexOrientation === "flat";
  const near = (k) => {
    const [x, y] = k.split("_").map(Number);
    const sh = (n) => (stagger === "odd" ? n % 2 !== 0 : n % 2 === 0);
    const d = flat
      ? (!sh(x) ? [[0, -1], [0, 1], [1, -1], [1, 0], [-1, -1], [-1, 0]] : [[0, -1], [0, 1], [1, 0], [1, 1], [-1, 0], [-1, 1]])
      : (!sh(y) ? [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]] : [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]);
    return d.map(([dx, dy]) => `${x + dx}_${y + dy}`).filter((n) => !!hexEl(n));
  };
  const sight = (c, r) => { const seen = new Set([c]); let edge = [c]; for (let i = 0; i < r; i++) { const nx = []; for (const k of edge) for (const n of near(k)) if (!seen.has(n)) { seen.add(n); nx.push(n); } edge = nx; } return seen; };
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.ownerDocument.dispatchEvent(new MouseEvent("mouseup", at));
  };
  const click = (el) => {
    view.contentEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  };
  const menuItem = async (k, title) => {
    const el = hexEl(k);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    const item = await waitFor(() => [...document.querySelectorAll(".menu .menu-item")].find((i) => i.querySelector(".menu-item-title")?.textContent === title), 2000);
    if (!item) { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.querySelector(".menu")?.remove(); return false; }
    item.click();
    await sleep(300);
    return true;
  };
  const barButton = (label) => view.containerEl.querySelector(`.duckmage-party-controls button[aria-label="${label}"]`);
  const seen = () => {
    const s = new Set();
    for (const row of p.getMap(mapName).exploreSeen ?? []) {
      const m = /^(-?\d+)\s*:\s*(.*)$/.exec(row);
      if (!m) continue;
      for (const part of m[2].split(",")) {
        const r = /^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/.exec(part);
        if (r) for (let x = Number(r[1]); x <= Number(r[2] ?? r[1]); x++) s.add(`${x}_${Number(m[1])}`);
      }
    }
    return s;
  };
  const bench = (n) => {
    const t = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      view.renderGrid();
      void document.body.offsetHeight;
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    return Math.round(t[Math.floor(t.length / 2)]);
  };
  const runs = opts.runs ?? 5;
  try {
    out.bench.noFog = bench(runs);
    // Start exploring from the middle, through the hex menu and its dialog.
    const o = map0.gridOffset ?? { x: 0, y: 0 };
    const start = opts.start ?? `${o.x + Math.floor(map0.gridSize.cols / 2)}_${o.y + Math.floor(map0.gridSize.rows / 2)}`;
    if (!(await menuItem(start, "Start exploring from here…"))) { fail(`no "Start exploring from here…" on ${start}`); return out; }
    const modal = await waitFor(() => document.querySelector(".modal.duckmage-start-exploring, .duckmage-start-exploring")?.closest(".modal"));
    if (!modal) { fail("Start exploring didn't open its dialog"); return out; }
    const startInput = modal.querySelector("#duckmage-explore-start");
    if (startInput?.value.replace(/\s/g, "") !== start.replace("_", ",")) fail(`the dialog starts at ${startInput?.value}, not ${start}`);
    [...modal.querySelectorAll(".duckmage-explore-sees button")].find((b) => b.textContent === "1")?.click();
    const tokenSel = modal.querySelector("#duckmage-explore-token");
    if (tokenSel) { tokenSel.value = ""; tokenSel.dispatchEvent(new Event("change", { bubbles: true })); }
    const reset = modal.querySelector("#duckmage-explore-reset");
    if (reset) { reset.value = "reset"; reset.dispatchEvent(new Event("change", { bubbles: true })); }
    modal.querySelector(".mod-cta")?.click();
    await waitFor(() => p.getMap(mapName).exploreFog === "on" && fogged().size > 0, 8000);
    await sleep(800);
    const m = p.getMap(mapName);
    if (m.exploreFog !== "on") { fail("the fog isn't on"); return out; }
    const want = sight(start, 1);
    const s0 = seen();
    if ([...want].some((k) => !s0.has(k)) || s0.size !== want.size) fail(`seen after start: ${s0.size} (want ${want.size} around ${start})`);
    const f0 = fogged();
    if (f0.size !== total() - want.size) fail(`fogged ${f0.size} of ${total()} (want ${total() - want.size})`);
    if ([...want].some((k) => f0.has(k))) fail("a hex in sight is fogged");
    // Nothing of a hidden hex's own: no coordinate label, no other token, no name.
    const labels = [...(grid()?.querySelectorAll(".duckmage-coord-label-html") ?? [])].map((l) => l.textContent.replace(",", "_"));
    const leaked = labels.filter((k) => f0.has(k));
    if (leaked.length) fail(`coordinates shown on hidden hexes: ${leaked.slice(0, 5).join(", ")}`);
    view.tokens.loadTokensForMap();
    const party = view.tokens.tokenEntries.find((t) => t.party && t.hex === start);
    if (!party) { fail(`no party token on ${start}`); return out; }
    const others = view.tokens.tokenEntries.filter((t) => !t.party && t.visible && f0.has(t.hex));
    const drawnOthers = others.filter((t) => [...grid().querySelectorAll(".duckmage-token")].some((el) => el.title === t.title));
    if (drawnOthers.length) fail(`tokens drawn on hidden hexes: ${drawnOthers.map((t) => t.title).join(", ")}`);
    out.bench.fog = bench(runs);
    if (opts.benchOnly) {
      out.steps.push(`${mapName} (${total()} hexes): render ${out.bench.noFog} ms → ${out.bench.fog} ms with fog (median of ${runs}); ${f0.size} fogged`);
      if (!(await menuItem(start, "Stop exploring"))) fail("no Stop exploring in the hex menu");
      await waitFor(() => !p.getMap(mapName).exploreFog, 3000);
      if (p.getMap(mapName).exploreFog) fail("Stop exploring left the fog on");
      return out;
    }
    out.steps.push(`started at ${start}: ${s0.size} hexes seen, ${f0.size} fogged; ${others.length} other tokens hidden; render ${out.bench.noFog} ms → ${out.bench.fog} ms with fog (median of ${runs})`);
    // Three steps: each reveals the ring around the hex entered.
    const pick = async () => {
      // Our party's token (the vault may hold other parties).
      // The token on the party's hex with its title (the vault may hold other parties, even of the same name).
      const now = () => { view.tokens.loadTokensForMap(); return view.tokens.tokenEntries.find((t) => t.filePath === party.filePath)?.hex; };
      const mine = () => { const [x, y] = (now() ?? "").split("_"); const c = hexEl(`${x}_${y}`)?.getBoundingClientRect(); return [...(grid()?.querySelectorAll(".duckmage-token.is-party") ?? [])].filter((el) => el.title === `${party.title} (party)`).sort((a, b) => { const d = (el) => { const r = el.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - (c?.x ?? 0) - (c?.width ?? 0) / 2, r.y + r.height / 2 - (c?.y ?? 0) - (c?.height ?? 0) / 2); }; return d(a) - d(b); })[0]; };
      const t = await waitFor(mine);
      if (view.tokens.selectedParty !== party.filePath) {
        if (t && t.classList.contains("is-selected")) press(t);
        if (t) press(t);
        await sleep(400);
      }
      if (view.tokens.selectedParty !== party.filePath) fail(`pressing the party token didn't select it (${t ? "pressed" : "no token element"}; selected ${view.tokens.selectedParty})`);
      await sleep(300);
      return [...grid().querySelectorAll(".duckmage-hex.duckmage-party-step")];
    };
    let at = start;
    const walked = [];
    for (let i = 0; i < 3; i++) {
      const lit = await pick();
      const to = lit.map((el) => `${el.dataset.x}_${el.dataset.y}`).find((k) => k !== at && [...near(k)].some((n) => !seen().has(n))) ?? (lit[0] && `${lit[0].dataset.x}_${lit[0].dataset.y}`);
      if (!to) { fail("no hex lit to step to"); break; }
      click(hexEl(to));
      await waitFor(() => [...sight(to, 1)].every((k) => seen().has(k)), 4000);
      if ([...sight(to, 1)].some((k) => !seen().has(k) || fogged().has(k))) fail(`step to ${to}: its ring isn't revealed`);
      at = to;
      walked.push(to);
      await sleep(400);
    }
    out.steps.push(`walked ${walked.join(" → ")}: ${seen().size} seen`);
    // Owner addition: Sees 2, then the party's own hex: ring 2 revealed, the token stays.
    await pick();
    const sees2 = barButton("Sees 2");
    if (!sees2) fail("no Sees 2 on the party bar");
    else {
      sees2.click();
      await sleep(300);
      if (p.getMap(mapName).exploreReveal !== "2 rings") fail(`Sees 2 stored ${p.getMap(mapName).exploreReveal}`);
      if (barButton("Sees 2")?.getAttribute("aria-pressed") !== "true") fail("Sees 2 isn't shown selected");
      const visited = JSON.stringify(p.getMap(mapName).visited ?? null);
      const undoBefore = p.undoBook?.size(mapName, "play")?.undo;
      click(hexEl(at));
      await waitFor(() => [...sight(at, 2)].every((k) => seen().has(k)), 4000);
      const missing = [...sight(at, 2)].filter((k) => !seen().has(k));
      if (missing.length) fail(`look from ${at}: ring 2 not revealed (${missing.slice(0, 4).join(", ")})`);
      view.tokens.loadTokensForMap();
      const still = view.tokens.tokenEntries.find((t) => t.filePath === party.filePath)?.hex;
      if (still !== at) fail(`the party moved on a look: ${at} → ${still}`);
      if (JSON.stringify(p.getMap(mapName).visited ?? null) !== visited) fail("a look marked a visit");
      await sleep(500);
      const undoAfter = p.undoBook?.size(mapName, "play")?.undo;
      if (typeof undoBefore === "number" && undoAfter !== undoBefore + 1) fail(`a look made ${undoAfter - undoBefore} undo entries`);
      out.steps.push(`Sees 2 + click on the party's hex ${at}: ring 2 revealed (${sight(at, 2).size} hexes), token unmoved`);
    }
    // Peek: hidden hexes drawn faded.
    const peekBtn = barButton("Peek Show");
    if (!peekBtn) fail("no Peek on the party bar");
    else {
      peekBtn.click();
      await sleep(600);
      const faded = grid()?.querySelectorAll(".duckmage-hex-fogged.duckmage-hex-peek").length ?? 0;
      if (!faded) fail("Peek: no hidden hex drawn faded");
      barButton("Peek Hide")?.click();
      await sleep(400);
      out.steps.push(`peek: ${faded} hidden hexes faded`);
    }
    // The GM reveals one distant hex: only that one.
    const far = [...fogged()].filter((k) => near(k).every((n) => !seen().has(n)))[0];
    if (!far) fail("no distant hidden hex to reveal");
    else {
      const before = seen();
      if (!(await menuItem(far, "Reveal this hex"))) fail(`no "Reveal this hex" on ${far}`);
      await waitFor(() => seen().has(far), 3000);
      const added = [...seen()].filter((k) => !before.has(k));
      if (added.length !== 1 || added[0] !== far) fail(`reveal ${far}: revealed ${added.join(", ")}`);
      if (fogged().has(far)) fail(`${far} is still drawn fogged`);
      if (near(far).some((n) => !fogged().has(n))) fail(`a neighbour of ${far} was revealed too`);
      if (!(await menuItem(far, "Hide again"))) fail(`no "Hide again" on ${far}`);
      await waitFor(() => !seen().has(far), 3000);
      if (seen().has(far)) fail(`Hide again left ${far} revealed`);
      out.steps.push(`GM revealed only ${far}, then hid it again`);
    }
    // The Reveal hexes brush: a press and drag over two hidden hexes, one undo.
    await pick();
    const pickBtn = barButton("Reveal hexes Pick");
    // Two neighbouring hidden hexes, both on screen (a drag is hit-tested where the pointer is).
    const clip = grid().closest(".duckmage-hex-map-clip").getBoundingClientRect();
    const onScreen = (k) => { const r = hexEl(k)?.getBoundingClientRect(); if (!r) return false; const cx = r.left + r.width / 2, cy = r.top + r.height / 2; return cx > clip.left + 2 && cx < clip.right - 2 && cy > clip.top + 2 && cy < clip.bottom - 2 && view.hexElAt(document.elementFromPoint(cx, cy), cx, cy) === hexEl(k); };
    const pair = [...fogged()].filter(onScreen).map((k) => [k, near(k).find((n) => fogged().has(n) && onScreen(n))]).find(([, n]) => n);
    if (!pickBtn || !pair) fail(`brush: ${pickBtn ? `no pair of hidden hexes on screen (${fogged().size} hidden, ${(() => { const inClip = [...fogged()].filter((k) => { const r = hexEl(k).getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; return cx > clip.left && cx < clip.right && cy > clip.top && cy < clip.bottom; }); const k = inClip[0]; if (!k) return "none in the clip"; const r = hexEl(k).getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return `${inClip.length} in the clip; modals: ${[...document.querySelectorAll(".modal")].map((m) => m.querySelector(".modal-title")?.textContent || m.className).join(" | ")}; ${k} hit ${at?.className} → ${view.hexElAt(at, r.left + r.width / 2, r.top + r.height / 2)?.dataset.x}`; })()}, clip ${Math.round(clip.width)}×${Math.round(clip.height)}, window ${innerWidth}×${innerHeight})` : "no Reveal hexes Pick"}`);
    else {
      pickBtn.click();
      await sleep(200);
      if (view.drawingMode !== "hexBrush") fail(`the brush isn't on (${view.drawingMode})`);
      const before = seen();
      const [a, b] = pair.map(hexEl);
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      a.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: ra.x + ra.width / 2, clientY: ra.y + ra.height / 2 }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: rb.x + rb.width / 2, clientY: rb.y + rb.height / 2 }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rb.x + rb.width / 2, clientY: rb.y + rb.height / 2 }));
      await waitFor(() => pair.every((k) => seen().has(k)), 3000);
      const added = [...seen()].filter((k) => !before.has(k)).sort();
      if (added.join() !== [...pair].sort().join()) fail(`brush stroke over ${pair.join(", ")} revealed ${added.join(", ")}`);
      await view.undo();
      await sleep(600);
      if (pair.some((k) => seen().has(k))) fail("one undo didn't take the whole stroke back");
      view.exitCurrentMode();
      await sleep(200);
      if (view.drawingMode !== null) fail("the brush didn't stop");
      out.steps.push(`brush: ${pair.join(" + ")} in one stroke, one undo`);
    }
    // Stop lifts the fog; what was seen is kept.
    const stop = barButton("Exploring Stop");
    if (!stop) fail("no Stop on the party bar");
    else {
      const kept = seen().size;
      stop.click();
      await waitFor(() => !p.getMap(mapName).exploreFog && fogged().size === 0, 3000);
      if (fogged().size) fail(`Stop left ${fogged().size} hexes fogged (explore-fog ${p.getMap(mapName).exploreFog}, bar ${!!view.containerEl.querySelector(".duckmage-party-controls")})`);
      if (seen().size !== kept) fail("Stop dropped what was seen");
      out.steps.push(`stopped: fog lifted, ${kept} seen kept`);
    }
    await p.saveSettings();
    await store.flush?.();
    await sleep(400);
    if (canonHexes() !== hexesBefore) fail("map data (hexes) changed while exploring");
    if ((await tables()) !== tablesBefore) fail("the map note's tables changed while exploring");
  } catch (e) {
    fail(String(e?.stack ?? e).slice(0, 400));
  } finally {
    view.tokens.selectParty?.(null);
    view.setWorkMode(modeBefore ?? "build");
    await p.saveSettings();
    await store.flush?.();
  }
  return out;
}
