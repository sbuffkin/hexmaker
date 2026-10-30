/**
 * C12 hex fields (plan-custom-hex-fields phase 1, #52). Runs in the page
 * like the other helpers in page.mjs (sent as source text, so it must be
 * self-contained).
 *
 * Declares a Population field (a one-row table: 100) and a Town influence
 * (+1000 on its hex, x2 within 2) in the world's fields note; on a new
 * map, paints three hexes through the map view's own mouse handler (each
 * gets Population 100 and its Field rolls); types 250 into one hex's
 * Fields box in the hex editor; links a town note under another hex's
 * Towns; runs the "Recalculate fields" command and clicks Update places.
 * Then: the town hex is 1100, its neighbour 200 (x2), the typed 250 is
 * kept; the map note's Population and Field rolls columns say so; the
 * map view's undo puts the recalculation back. The fields note is
 * removed again afterwards (the map stays, for the C5 restart).
 */
export async function hexFieldsCheck(id) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const store = p.mapStore;
  const fieldsSvc = p.moduleStore("hex-fields")?.service;
  if (!fieldsSvc) return { ok: true, skipped: "the fields slice is off in this build", steps: [], problems: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return fn(); };
  const out = { ok: true, steps: [], problems: [] };
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  const modalsBefore = document.querySelectorAll(".modal-container").length;
  // Close the modals this check opened (the top one each time: Escape, then its × if that didn't do it).
  const closeOurs = async () => {
    for (let i = 0; i < 10 && document.querySelectorAll(".modal-container").length > modalsBefore; i++) {
      const all = document.querySelectorAll(".modal-container");
      const top = all[all.length - 1];
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      await sleep(200);
      if (top.isConnected) { top.querySelector(".modal-close-button")?.click(); await sleep(200); }
    }
  };
  const world = p.settings.worldFolder || "world";
  const tables = (p.settings.tablesFolder || `${world}/tables`).replace(/\/+$/, "");
  // 1. A table and the declarations.
  const tablePath = `${tables}/fields/Smoke population.md`;
  if (!app.vault.getAbstractFileByPath(`${tables}/fields`)) await app.vault.createFolder(`${tables}/fields`).catch(() => {});
  if (!app.vault.getAbstractFileByPath(tablePath)) await app.vault.create(tablePath, "| d1 | Result | Weight |\n| --- | --- | --- |\n| 1 | 100 | 1 |\n");
  await waitFor(() => p.tableNotes.lookup().table(tablePath.replace(/\.md$/, "")));
  await fieldsSvc.store.save({
    fields: [{ name: "Population", type: "whole number", default: "0", table: tablePath.replace(/\.md$/, "") }],
    influences: [{ place: "Town", field: "Population", here: "+1000", nearby: "x2", radius: 2 }],
  });
  const notePath = fieldsSvc.store.notePath();
  const noteText = (await app.vault.adapter.exists(notePath)) ? await app.vault.adapter.read(notePath) : "";
  if (!/\| Population \| whole number \|/.test(noteText)) fail(`fields note ${notePath}: ${noteText.slice(0, 200)}`);
  else out.steps.push(`declared Population in ${notePath}`);
  // 2. A map, three hexes painted with the map view's mouse handler.
  const pal = p.settings.defaultPalette ?? p.settings.terrainPalettes[0].name;
  const res = await p.createNewMap({ name: "Smoke Fields", cols: 9, rows: 7, palette: pal, quiet: true });
  if ("error" in res) return { ok: false, steps: out.steps, problems: [`new map: ${res.error}`] };
  const map = res.name;
  await p.showMap(map);
  await sleep(800);
  const view = app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
  if (!view || view.activeMapName !== map) return { ok: false, steps: out.steps, problems: ["map view did not open " + map] };
  app.workspace.setActiveLeaf(view.leaf, { focus: true });
  const terrain = p.getMapPalette(map).map((t) => t.name).find((t) => t.toLowerCase() !== "town");
  const hexEl = (k) => view.containerEl.querySelector(`.duckmage-hex[data-x="${k.split("_")[0]}"][data-y="${k.split("_")[1]}"]`);
  const paint = async (k) => {
    const el = hexEl(k);
    if (!el) { fail(`no hex element ${k}`); return; }
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
  const pop = (k) => store.get(map, k)?.extra?.Population;
  for (const k of ["2_3", "4_3", "5_3"]) await paint(k);
  view.exitTerrainMode?.();
  view.drawingMode = null;
  const painted = ["2_3", "4_3", "5_3"].map((k) => `${k}=${pop(k)}`);
  if (["2_3", "4_3", "5_3"].some((k) => pop(k) !== "100")) fail(`painted hexes should roll Population 100: ${painted.join(", ")}`);
  else out.steps.push(`painted ${painted.join(", ")}`);
  // 3. Typed in the hex editor's Fields section.
  view.openHexEditorModal(2, 3);
  const box = await waitFor(() => document.querySelector(".modal .duckmage-editor-field-input"));
  if (!box) fail("the hex editor has no Fields box");
  else {
    box.value = "250";
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => pop("2_3") === "250");
    if (pop("2_3") !== "250") fail(`typed 250 in the editor; the map has ${pop("2_3")}`);
    else if (/Population/.test(store.get(map, "2_3")?.extra?.["Field rolls"] ?? "")) fail("a typed value kept its roll");
    else out.steps.push("typed 250 in the editor");
  }
  await closeOurs();
  // 4. A town linked under 5_3's Towns, then Recalculate fields → Update places.
  const link = await p.hexNotes.createAndLinkNote({ x: 5, y: 3, mapName: map, section: "Towns", folder: `${world}/towns`, name: "Smoke Fields Town" });
  await waitFor(() => fieldsSvc.places(map).some((pl) => pl.key === "5_3" && pl.type === "town"));
  if (!fieldsSvc.places(map).some((pl) => pl.key === "5_3")) fail(`the town ${link} under 5_3's Towns isn't a place`);
  app.workspace.setActiveLeaf(view.leaf, { focus: true });
  const ran = app.commands.executeCommandById(`${id}:recalculate-fields`);
  const btn = await waitFor(() => document.querySelector(".modal .duckmage-recalc-modifiers"));
  if (!ran || !btn) fail(`Recalculate fields: command ran ${ran}, Update places button ${!!btn}`);
  else btn.click();
  await waitFor(() => pop("5_3") === "1100");
  await store.flush();
  const after = { "5_3": pop("5_3"), "4_3": pop("4_3"), "2_3": pop("2_3") };
  if (after["5_3"] !== "1100" || after["4_3"] !== "200" || after["2_3"] !== "250") fail(`after Recalculate: ${JSON.stringify(after)} (want town 1100, next door 200, typed 250)`);
  else out.steps.push(`recalculated near the town: ${JSON.stringify(after)}`);
  const text = await app.vault.adapter.read(store.notePath(map));
  const row = /^\|\s*4_3\s*\|.*$/m.exec(text)?.[0] ?? "";
  if (!/\| Population \|/.test(text) || !/\b200\b/.test(row) || !/Population: 100/.test(row)) fail(`map note row 4_3: ${row}`);
  else out.steps.push("map note has the Population and Field rolls columns");
  // 5. Undo puts the recalculation back.
  await view.undo();
  await store.flush();
  if (pop("4_3") !== "100" || pop("5_3") !== "100") fail(`undo of Recalculate: 4_3=${pop("4_3")}, 5_3=${pop("5_3")}`);
  else out.steps.push("undo put the hexes back");
  await closeOurs();
  const left = document.querySelectorAll(".modal-container").length - modalsBefore;
  if (left > 0) fail(`${left} modal(s) this check opened are still open`);
  // Clean up the declarations (the map stays for the restart check).
  const fnote = app.vault.getAbstractFileByPath(notePath);
  if (fnote) await app.vault.delete(fnote);
  await waitFor(() => fieldsSvc.fields().length === 0);
  return out;
}
