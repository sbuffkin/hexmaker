/**
 * C10 hex flower solo (plan-hex-flower). Runs in the page like the other
 * helpers in page.mjs (sent as source text, so it must be self-contained).
 *
 * In a build with the hexflower slice (skipped otherwise): the setup
 * wizard lists Hex flower right after Blank; a map made with it (as the
 * wizard does: generate, createNewMap, afterCreate) has only its middle
 * hex filled, a Party token there, a hex flower note and explore-with; in
 * Play a party step into a blank neighbour fills it, and the view's undo
 * (Ctrl+Z) takes the step and the fill back together; a hand-painted hex
 * the party walks into is untouched. The map stays, so the C5 restart then
 * checks that nothing is rewritten.
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
  // The wizard's generator list: Blank, then Hex flower.
  const leaf = app.workspace.getLeavesOfType("duckmage-setup-wizard")[0];
  if (leaf) {
    const wiz = leaf.view;
    wiz.currentIndex = 2;
    wiz.renderView();
    const gens = () => [...wiz.contentEl.querySelectorAll(".duckmage-setup-gen .duckmage-setup-gen-title")].map((e) => e.textContent);
    await waitFor(() => gens().length > 1);
    if (gens()[1] !== "Hex flower") fail(`wizard generators: ${gens().join(", ")}`);
    else out.steps.push("wizard: Blank, Hex flower, …");
  }
  // Make the map as the wizard does.
  const pal = p.settings.defaultPalette ?? p.settings.terrainPalettes[0].name;
  const terrains = p.getPaletteOrPresetTerrains(pal);
  const grid = { cols: 9, rows: 7, offset: { x: 0, y: 0 }, stagger: p.settings.staggerOffset ?? "odd" };
  const options = { flower: "new", start: "blank", party: "on", reveal: "entered" };
  const seed = 4242;
  const gen = kind.generate({ terrains, grid, seed, options });
  if (!gen.ok) return { ok: false, steps: [], problems: ["generate: " + gen.message] };
  const res = await p.createNewMap("Smoke Flower", 9, 7, pal, 0, 0, undefined, undefined, gen.cells, { quiet: true });
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
  view.setWorkMode("build");
  await p.saveSettings();
  await store.flush?.();
  await sleep(500);
  return out;
}
