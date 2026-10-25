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
  if (p.getMap(made.name).gridSize.rows <= rows0) fail(`the map didn't grow (rows ${p.getMap(made.name).gridSize.rows})`);
  const areaBtn = view.containerEl.querySelector(".duckmage-party-controls")?.textContent ?? "";
  if (out.ok) out.steps.push(`walked north: ${walked.join(", ")}; rows ${rows0} → ${p.getMap(made.name).gridSize.rows}${areaBtn ? `; party controls: ${areaBtn.trim().slice(0, 60)}` : ""}`);
  view.setWorkMode("build");
  await p.saveSettings();
  await store.flush?.();
  await sleep(500);
  return out;
}
