/**
 * The generator page's preview column (sticky beside the controls): the
 * preview, its size, seed and palette, Reroll / Regenerate, Create map,
 * and saves. renderPreviewBox draws the top of it; renderPreviewActions
 * (after the Map settings section, which locks the size for a connected
 * region) wires the preview, Create map and the saves list.
 */

import { Notice, setIcon } from "obsidian";
import {
  generateTerrain,
  drawnPathType,
  paletteGapMessage,
  refreshGeneratorShares,
  pathColors,
  toMapPaths,
  addGeneratedPaths,
  generatorText,
} from "../generators";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "../preview";
import { renderPreviewLegend } from "../../hex-map/terrainLegend";
import { getIconUrl, linkLabel } from "../../utils";
import { makeScrubbable } from "../../ui/scrub";
import { regionBiome, generateConnected, neighbourSpec, placeNewRegion, regionNeighbourNames, type NewRegion } from "../neighbours";
import { listSaves, writeSave, readSave, applySave } from "../saves";
import { SAVE_FORMAT, type GeneratorSave } from "../saveFormat";
import { compareVersions, pluginVersion } from "../../compat";
import { formatShare, formatShareChange, hasTerrainTweaks, terrainShares, withoutTerrainTweaks } from "../shares";
import { generatorPageState } from "../generatorPageState";
import { pathsEnabled, randomSeed, type HexWfcModel, type RouteStat } from "../../../packages/hex-wfc/src";
import type { GeneratorPageCtx } from "./ctx";

/** The preview column's controls that later sections read or wire. */
export interface PreviewParts {
  /** The side column (the preview is drawn at its width). */
  side: HTMLElement;
  previewBox: HTMLElement;
  canvas: HTMLCanvasElement;
  legendBox: HTMLElement;
  status: HTMLElement;
  rerollBtn: HTMLButtonElement;
  colsInput: HTMLInputElement;
  rowsInput: HTMLInputElement;
  /** The seed control (placed in Advanced → Seed at the end). */
  seedBox: HTMLElement;
  seedInput: HTMLInputElement;
  lockBtn: HTMLButtonElement;
  paletteSelect: HTMLSelectElement;
}

/** The preview (in the sticky side column), with the map's seed, size and palette right under it. */
export function renderPreviewBox(ctx: GeneratorPageCtx, side: HTMLElement): PreviewParts {
  const { plugin, model, file } = ctx;
  const previewBox = side.createDiv({ cls: "duckmage-wfc-section" });
  previewBox.createEl("h4", { text: "Preview" });
  const canvas = previewBox.createEl("canvas", { cls: "duckmage-wfc-preview" });
  const legendBox = previewBox.createDiv();
  const status = previewBox.createEl("p", { cls: "duckmage-map-origin-desc" });
  const previewRow = previewBox.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
  const rerollBtn = previewRow.createEl("button");
  previewRow.createSpan({ text: "Size", cls: "duckmage-map-origin-label" });
  const colsInput = previewRow.createEl("input", { type: "number", value: String(ctx.local.previewCols), cls: "duckmage-wfc-num" });
  previewRow.createSpan({ text: "×" });
  const rowsInput = previewRow.createEl("input", { type: "number", value: String(ctx.local.previewRows), cls: "duckmage-wfc-num" });
  // The seed (Advanced → Seed, placed at the end): saved with every save
  // and shown in the saves list, so a save can always be remade.
  const seedBox = previewBox.createDiv({ cls: "duckmage-wfc-control" });
  const seedRow = seedBox.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
  const seedLabel = seedRow.createEl("label", { text: "Seed", cls: "duckmage-map-origin-label" });
  const seedInput = seedRow.createEl("input", { type: "number", value: String(ctx.local.seed), cls: "duckmage-wfc-seed" });
  linkLabel(seedLabel, seedInput);
  // Locked: the button regenerates with the same seed, so a settings change
  // can be compared on the same map (large maps don't preview on their own).
  const lockBtn = seedRow.createEl("button", { cls: "clickable-icon duckmage-wfc-lock" });
  seedBox.createEl("p", { text: "The preview's seed. Lock it to compare settings on the same map. Saves keep their seed.", cls: "duckmage-map-origin-desc" });
  const paletteRow = previewBox.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
  paletteRow.createSpan({ text: "Palette", cls: "duckmage-map-origin-label" });
  const paletteSelect = paletteRow.createEl("select");
  for (const p of plugin.settings.terrainPalettes) paletteSelect.createEl("option", { value: p.name, text: p.name });
  paletteSelect.value = generatorPageState.paletteName;
  paletteSelect.addEventListener("change", () => {
    generatorPageState.paletteName = paletteSelect.value;
    ctx.host.rerender();
  });
  // Name what the palette lacks (G2) rather than dropping it silently.
  const gap = paletteGapMessage(model, ctx.paletteTerrains());
  if (gap) {
    paletteRow.createSpan({
      text: `⚠ ${gap}`,
      cls: "duckmage-map-origin-desc",
      attr: { title: `Learned with palette ${model.meta.palette ?? "unknown"}` },
    });
  }
  // The note's derived Share column follows hand edits too (G1).
  if (file) void refreshGeneratorShares(plugin, file);
  return { side, previewBox, canvas, legendBox, status, rerollBtn, colsInput, rowsInput, seedBox, seedInput, lockBtn, paletteSelect };
}

/**
 * The preview's behaviour: seed lock, Create map, saves, and the preview
 * itself. `connected` / `genModel` come from the Map settings section.
 * Returns schedulePreview (the page's ctx.schedulePreview calls it).
 */
export function renderPreviewActions(ctx: GeneratorPageCtx, preview: PreviewParts, connected: NewRegion | null, genModel: HexWfcModel): () => void {
  const { app, plugin, g, model, colors, isThisGenerator } = ctx;
  const { side, previewBox, canvas, legendBox, status, rerollBtn, colsInput, rowsInput, seedInput, lockBtn } = preview;
  const showLock = () => {
    const locked = generatorPageState.seedLocked;
    setIcon(lockBtn, locked ? "lock" : "lock-open");
    lockBtn.toggleClass("is-active", locked);
    lockBtn.setAttr("aria-pressed", String(locked));
    lockBtn.setAttr("aria-label", locked ? "Seed locked: regenerate keeps it" : "Lock the seed");
    // Owner Q4: Reroll = a new seed; Regenerate = remake on the same seed after a settings change.
    rerollBtn.setText(locked ? "Regenerate" : "Reroll");
  };
  lockBtn.addEventListener("click", () => {
    generatorPageState.seedLocked = !generatorPageState.seedLocked;
    showLock();
    schedulePreview();
  });
  const createRow = previewBox.createDiv({ cls: "duckmage-region-row" });
  const newNameInput = createRow.createEl("input", { type: "text", attr: { placeholder: "Name for the new map" } });
  const createBtn = createRow.createEl("button", { text: "Create map", cls: "mod-cta" });

  // Saves: keep a generated map and its settings without creating a map.
  const savesBox = previewBox.createDiv({ cls: "duckmage-wfc-saves" });
  savesBox.createEl("h5", { text: "Saves", cls: "duckmage-wfc-heading" });
  const saveRow = savesBox.createDiv({ cls: "duckmage-region-row" });
  const saveNameInput = saveRow.createEl("input", { type: "text", attr: { placeholder: "Save name (optional)" } });
  const saveBtn = saveRow.createEl("button", { text: "Save", attr: { title: "Save these settings, seed and size with the generated map" } });
  const loadRow = savesBox.createDiv({ cls: "duckmage-region-row" });
  const loadSelect = loadRow.createEl("select", { cls: "duckmage-wfc-save-select" });
  const loadBtn = loadRow.createEl("button", { text: "Load" });
  const fillSaves = () => {
    const current = pluginVersion(plugin);
    const saves = listSaves(plugin);
    loadSelect.empty();
    if (!saves.length) loadSelect.createEl("option", { value: "", text: "No saves yet" });
    for (const sv of saves) {
      const other = compareVersions(sv.version, current) !== 0 ? ` · v${sv.version}` : "";
      loadSelect.createEl("option", { value: sv.file.path, text: `${sv.name} · ${sv.generator} · seed ${sv.seed} · ${sv.size}${other}` });
    }
    loadBtn.disabled = !saves.length;
  };
  fillSaves();

  const previewGrid = () => {
    if (connected) return { cols: connected.cols, rows: connected.rows, offset: { ...connected.offset }, stagger: connected.stagger };
    const map = plugin.getMap(ctx.mapName);
    return {
      cols: Math.max(2, Math.min(200, Number(colsInput.value) || 30)),
      rows: Math.max(2, Math.min(200, Number(rowsInput.value) || 20)),
      offset: { x: 0, y: 0 },
      stagger: map?.staggerOffset ?? plugin.settings.staggerOffset ?? "odd",
    };
  };
  let baseline: { key: string; shares: Map<string, number> } | null = null;
  /**
   * Shares in the preview vs the same seed without per-terrain mix/counts,
   * so the table shows what those settings change. The untweaked run is
   * cached until something other than mix/counts changes.
   */
  const updateShares = (cells: Map<string, string>, grid: ReturnType<typeof previewGrid>, palette: string[]) => {
    const now = terrainShares(cells);
    let before = now;
    if (hasTerrainTweaks(model)) {
      const plain = withoutTerrainTweaks(model);
      const key = JSON.stringify([ctx.local.seed, grid, palette, plain.settings]);
      if (baseline?.key !== key) {
        const b = generateTerrain(plugin, plain, palette, grid, ctx.local.seed);
        baseline = { key, shares: b.ok ? terrainShares(b.cells) : now };
      }
      before = baseline.shares;
    }
    for (const [name, cell] of ctx.shareCells) {
      const n = now.get(name) ?? 0, b = before.get(name) ?? 0;
      cell.now.setText(formatShare(n));
      const change = formatShareChange(n, b);
      cell.change.setText(change);
      cell.change.toggleClass("is-up", change.startsWith("+"));
      cell.change.toggleClass("is-down", change.startsWith("−"));
      cell.change.setAttr("title", change ? `${formatShare(b)} without its bias and min/max settings` : "");
    }
  };
  const updatePathRows = (stats: RouteStat[]) => {
    const byRoute = new Map(stats.map((st) => [st.route, st]));
    for (const [route, row] of ctx.pathRows) {
      const st = byRoute.get(route);
      row.auto = st?.auto ?? row.auto;
      row.count.placeholder = `Auto (${row.auto})`;
      if (!st || !pathsEnabled(model) || st.wanted === 0) {
        row.placed.setText("Off");
        row.placed.removeClass("is-short");
        continue;
      }
      row.placed.setText(`${st.placed} of ${st.wanted}`);
      row.placed.toggleClass("is-short", st.placed < st.wanted);
    }
    for (const { el: placedEl, routes } of ctx.pathGroupPlaced.values()) {
      let placed = 0, wanted = 0;
      for (const r of routes) {
        const st = byRoute.get(r);
        if (!st || !pathsEnabled(model)) continue;
        placed += st.placed;
        wanted += st.wanted;
      }
      placedEl.setText(wanted ? `${placed} of ${wanted}` : "Off");
      placedEl.toggleClass("is-short", placed < wanted);
    }
  };
  /** The loaded save, while the page shows exactly its generator, seed and size. */
  const showingSave = (): GeneratorSave | null => {
    const sv = generatorPageState.loadedSave;
    if (!sv || !isThisGenerator(sv)) return null;
    if (sv.seed !== Number(seedInput.value) >>> 0 || sv.cols !== Number(colsInput.value) || sv.rows !== Number(rowsInput.value)) return null;
    return sv;
  };
  /** What the preview shows now, for Save. */
  let shown: { cells: Map<string, string>; paths: { type: string; route?: string; hexes: string[] }[] } | null = null;
  const runPreview = () => {
    const grid = previewGrid();
    ctx.local.previewCols = grid.cols;
    ctx.local.previewRows = grid.rows;
    ctx.local.seed = Number(seedInput.value) >>> 0;
    const palette = ctx.paletteTerrains().length ? ctx.paletteTerrains() : model.terrains.map((t) => t.name);
    const r = connected ? generateConnected(plugin, genModel, palette, connected, ctx.local.seed) : generateTerrain(plugin, model, palette, grid, ctx.local.seed);
    if (!r.ok) {
      status.setText(`Couldn't generate: ${r.message}`);
      return;
    }
    const shadow = connected && "shadow" in r ? (r.shadow as Map<string, string>) : undefined;
    // A loaded save shows its own map if this version generates a different one.
    let cells = r.cells;
    let rawPaths: { type: string; route?: string; hexes: string[] }[] = r.paths;
    let saveNote = "";
    const sv = showingSave();
    if (sv) {
      if (sameCells(sv.cells, r.cells)) saveNote = ` · save "${sv.name}"`;
      else {
        cells = sv.cells;
        rawPaths = sv.paths;
        saveNote = ` · saved map "${sv.name}" (from v${sv.version}; this version generates it differently)`;
      }
    } else generatorPageState.loadedSave = null;
    shown = { cells, paths: rawPaths };
    // Paths are coloured as the map path type they'll become.
    const paths = rawPaths.map((p) => ({ ...p, type: drawnPathType(model, p) }));
    ctx.preview.lastDraw = (highlight?: string) => {
      // Draw at the side column's device-pixel width so it stays sharp when stretched.
      const dpr = activeWindow.devicePixelRatio || 1;
      drawPreview(canvas, cells, grid, plugin.settings.hexOrientation, colors, r.featureCells, paths, pathColors(plugin, generatorPageState.paletteName),
        Math.max(420, side.clientWidth) * dpr, 40 * dpr, highlight, { shadow });
    };
    ctx.preview.lastDraw(ctx.preview.hoveredRoute);
    renderPreviewLegend(legendBox, plugin,
      plugin.getPaletteByName(generatorPageState.paletteName)?.terrains ?? plugin.settings.terrainPalettes[0]?.terrains ?? [],
      cells.values(), (i) => getIconUrl(plugin, i));
    updateShares(cells, grid, palette);
    updatePathRows(r.pathRoutes);
    // Short: size and time, plus a hoverable count if anything didn't fit.
    status.setText(`${grid.cols}×${grid.rows} · ${r.stats.ms} ms${r.warnings.length ? ` · ⚠ ${r.warnings.length}` : ""}${saveNote}`);
    status.setAttr("title", r.warnings.join("\n"));
  };
  const schedulePreview = () => {
    if (ctx.local.previewTimer !== null) window.clearTimeout(ctx.local.previewTimer);
    if (Number(colsInput.value) * Number(rowsInput.value) > PREVIEW_AUTO_LIMIT) {
      status.setText(generatorPageState.seedLocked
        ? "Large map: press Regenerate to see your changes on this seed."
        : "Large map: press Reroll to preview it, or lock the seed (Advanced → Seed) to compare settings.");
      return;
    }
    ctx.local.previewTimer = window.setTimeout(() => {
      ctx.local.previewTimer = null;
      runPreview();
    }, 200);
  };
  saveBtn.addEventListener("click", () => {
    if (!shown) {
      new Notice("Generate a preview first: reroll it, or lock the seed and regenerate.");
      return;
    }
    const grid = previewGrid();
    const snapshot = shown;
    saveBtn.disabled = true;
    void (async () => {
      try {
        const saved: GeneratorSave = {
          name: saveNameInput.value.trim() || `${model.name}-${ctx.local.seed}`,
          version: pluginVersion(plugin),
          format: SAVE_FORMAT,
          created: new Date().toISOString().slice(0, 10),
          generatorName: model.name,
          generatorPath: g.file?.path ?? "",
          palette: generatorPageState.paletteName,
          seed: ctx.local.seed,
          cols: grid.cols,
          rows: grid.rows,
          stagger: grid.stagger,
          orientation: plugin.settings.hexOrientation,
          settings: { ...(model.settings ?? {}) },
          cells: snapshot.cells,
          paths: snapshot.paths,
          // A draft has no file; the save keeps its own copy either way.
          generatorMarkdown: g.file ? await app.vault.read(g.file) : generatorText(plugin, model),
        };
        const file = await writeSave(plugin, saved);
        generatorPageState.loadedSave = { ...saved, name: file.basename };
        saveNameInput.value = "";
        new Notice(`Saved "${file.basename}".`);
        // The new file may not be in the metadata cache yet.
        window.setTimeout(fillSaves, 300);
      } catch (e) {
        new Notice(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        saveBtn.disabled = false;
      }
    })();
  });
  loadBtn.addEventListener("click", () => {
    const file = app.vault.getFileByPath(loadSelect.value);
    if (!file) return;
    loadBtn.disabled = true;
    void (async () => {
      const read = await readSave(plugin, file);
      if ("error" in read) {
        new Notice(`Couldn't load "${file.basename}": ${read.error}`);
        loadBtn.disabled = false;
        return;
      }
      const { save: sv, warnings } = read;
      const applied = await applySave(plugin, sv);
      if ("error" in applied) {
        new Notice(applied.error);
        loadBtn.disabled = false;
        return;
      }
      generatorPageState.loadedSave = { ...sv, generatorPath: applied.file.path };
      generatorPageState.selectedPath = applied.file.path;
      if (plugin.settings.terrainPalettes.some((p) => p.name === sv.palette)) generatorPageState.paletteName = sv.palette;
      generatorPageState.seedLocked = true;
      const notes = [
        applied.recreated ? `recreated generator "${applied.file.basename}" from the save` : "",
        compareVersions(sv.version, pluginVersion(plugin)) !== 0 ? `saved with v${sv.version}` : "",
        ...warnings,
      ].filter(Boolean);
      new Notice(`Loaded "${sv.name}"${notes.length ? ` (${notes.join("; ")})` : ""}.`);
      ctx.host.rerender();
    })();
  });
  rerollBtn.addEventListener("click", () => {
    if (!generatorPageState.seedLocked) seedInput.value = String(randomSeed());
    runPreview();
  });
  showLock();
  // Create a new map that is exactly the preview: same size, seed, palette and paths.
  createBtn.addEventListener("click", () => {
    const grid = previewGrid();
    const seed = Number(seedInput.value) >>> 0;
    const palette = ctx.paletteTerrains().length ? ctx.paletteTerrains() : model.terrains.map((t) => t.name);
    // A neighbour slot may have been taken since this page was drawn.
    if (connected?.anchor && connected.side) {
      const again = neighbourSpec(plugin, connected.anchor, connected.side);
      if (!again.ok) {
        new Notice(again.reason);
        return;
      }
    }
    const generated = connected ? generateConnected(plugin, genModel, palette, connected, seed) : generateTerrain(plugin, model, palette, grid, seed);
    if (!generated.ok) {
      new Notice(`Couldn't generate: ${generated.message}`);
      return;
    }
    // While a loaded save is shown, create exactly the saved map.
    const sv = showingSave();
    const r = sv ? { ...generated, cells: sv.cells, paths: sv.paths } : generated;
    // The choice this map is made with; the page may be redrawn (and the
    // choice changed) while a big map is still being written.
    const usedConnect = generatorPageState.connect;
    createBtn.disabled = true;
    void plugin
      .createNewMap(
        newNameInput.value.trim() || `${model.name}-${seed}`,
        grid.cols, grid.rows, generatorPageState.paletteName, grid.offset.x, grid.offset.y, grid.stagger,
        (done, total) => createBtn.setText(`Creating ${done} / ${total}…`),
        r.cells,
      )
      .then(async (result) => {
        createBtn.disabled = false;
        createBtn.setText("Create map");
        if ("error" in result) {
          new Notice(result.error);
          return;
        }
        if (connected) {
          // Record its biome (and what it was blended with) for later neighbours.
          const around = Object.values(regionNeighbourNames(plugin, connected))
            .map((n) => regionBiome(plugin, n, ctx.generators)?.name)
            .filter((n): n is string => !!n && n !== model.name);
          const made = plugin.getMap(result.name);
          if (made) made.biome = generatorPageState.leanToNeighbours && around.length
            ? { generator: model.name, from: [...new Set(around)] }
            : { generator: model.name };
          await placeNewRegion(plugin, result.name, connected);
          // Only clear the choice if it's still the one used; a newer one stays.
          if (generatorPageState.connect === usedConnect) generatorPageState.connect = null;
        }
        // Generated paths become the map's anchored paths (after placing:
        // that sets the stagger they're routed with).
        const { paths, missing } = toMapPaths(plugin, r.paths, model, result.name);
        if (paths.length) {
          addGeneratedPaths(plugin, result.name, paths);
          await plugin.saveSettings();
        }
        if (missing.length) new Notice(`No path type named ${missing.join(", ")}, so those paths were skipped.`);
        new Notice(`Created map "${result.name}"${connected ? ` ${connected.side} of ${connected.anchor}` : ""}.`);
        generatorPageState.mapName = result.name;
        await plugin.showMap(result.name);
        ctx.host.rerender();
      });
  });
  for (const input of [seedInput, colsInput, rowsInput]) input.addEventListener("change", schedulePreview);
  // Drag up/down on size and seed; the preview follows while dragging.
  makeScrubbable(colsInput, { min: 2, max: 200, pxPerStep: 4 });
  makeScrubbable(rowsInput, { min: 2, max: 200, pxPerStep: 4 });
  makeScrubbable(seedInput, { min: 0, max: 0xffffffff, pxPerStep: 8 });
  for (const input of [seedInput, colsInput, rowsInput]) {
    input.addEventListener("input", () => {
      if (input.hasClass("is-scrubbing")) schedulePreview();
    });
  }
  return schedulePreview;
}

/** Same terrain on every hex. */
function sameCells(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, t] of a) if (b.get(k) !== t) return false;
  return true;
}
