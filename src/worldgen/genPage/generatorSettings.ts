/**
 * The generator page's set-once parts: the unsaved-draft bar (Save /
 * Discard) and the "Generator settings" section (name, palette, where it
 * came from with Re-learn / Re-blend, the influence mix, reset).
 */

import { Notice } from "obsidian";
import {
  saveGeneratorModel,
  setGeneratorPalette,
  relearnGenerator,
  remakeBlend,
  regionSizes,
  sourceInfluenceOf,
  combinedSourcesOf,
  sourceDirectionsOf,
} from "../generators";
import { renameGenerator } from "../saves";
import { toPercents } from "../regionWeights";
import { renderShareSliders } from "../../ui/shareSliders";
import { VERSION_KEY } from "../../compat";
import { generatorPageState } from "../generatorPageState";
import { COMPASS, type Compass, type GeneratorSettings } from "../../../packages/hex-wfc/src";
import type { GeneratorPageCtx } from "./ctx";

/** An unsaved draft says so at the very top, with Save and Discard. */
export function renderDraftRow(ctx: GeneratorPageCtx, main: HTMLElement): void {
  const { plugin, model, file } = ctx;
  if (!file) {
    const draftRow = main.createDiv({ cls: "duckmage-region-row duckmage-wfc-draft" });
    draftRow.createSpan({
      text: "Not saved: this blend lives only on this page. Try it out, then save it to keep it in your generator list.",
      cls: "duckmage-map-origin-desc",
    });
    // Plain: Create map is this page's one primary.
    const keep = draftRow.createEl("button", { text: "Save generator" });
    keep.addEventListener("click", () => {
      keep.disabled = true;
      void saveGeneratorModel(plugin, model).then((r) => {
        generatorPageState.draft = null;
        generatorPageState.selectedPath = r.file.path;
        new Notice(`Saved generator "${r.model.name}".`);
        ctx.host.rerender();
      }, (e: unknown) => {
        new Notice(`Couldn't save the generator: ${e instanceof Error ? e.message : String(e)}`);
        keep.disabled = false;
      });
    });
    const discard = draftRow.createEl("button", { text: "Discard" });
    discard.addEventListener("click", () => {
      generatorPageState.draft = null;
      generatorPageState.selectedPath = "";
      ctx.host.rerender();
    });
  }
}

/**
 * The "Generator settings" section; returns its box, which the page moves
 * below the generating controls once they are drawn.
 */
export function renderGeneratorSettings(ctx: GeneratorPageCtx, main: HTMLElement): HTMLElement | null {
  const { app, plugin, model, file, saved, save } = ctx;
  // Generator settings: what's saved on the generator itself (its name,
  // palette and where it came from), as opposed to how it generates. Set
  // once, so the section is moved below the generating controls at the end.
  const el = ctx.section(main, "Generator settings");
  const generatorSettingsBox = el.parentElement;
  const nameRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
  nameRow.createSpan({ text: "Name", cls: "duckmage-map-origin-label" });
  const nameInput = nameRow.createEl("input", { type: "text", value: model.name, attr: { placeholder: "Generator name" } });
  const renameBtn = nameRow.createEl("button", { text: "Rename" });
  renameBtn.disabled = true;
  nameInput.addEventListener("input", () => {
    renameBtn.disabled = !nameInput.value.trim() || nameInput.value.trim() === model.name;
  });
  const rename = () => {
    if (renameBtn.disabled) return;
    renameBtn.disabled = true;
    if (!saved) {
      // A draft just takes the name; it's tidied into a file name on save.
      model.name = nameInput.value.trim();
      ctx.host.rerender();
      return;
    }
    void renameGenerator(plugin, saved, nameInput.value).then((r) => {
      if ("error" in r) {
        new Notice(r.error);
        renameBtn.disabled = false;
        return;
      }
      new Notice(`Renamed to "${r.name}"${r.savesUpdated ? `; ${r.savesUpdated} save${r.savesUpdated === 1 ? "" : "s"} updated` : ""}.`);
      generatorPageState.selectedPath = r.file.path;
      ctx.host.rerender();
    });
  };
  renameBtn.addEventListener("click", rename);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") rename();
    if (e.key === "Escape") {
      nameInput.value = model.name;
      renameBtn.disabled = true;
    }
  });

  const ownPaletteRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
  ownPaletteRow.createSpan({ text: "Palette", cls: "duckmage-map-origin-label" });
  const ownPalette = ownPaletteRow.createEl("select", { attr: { title: "The palette this generator is for. The palette under the preview only changes the preview." } });
  const palettes = plugin.settings.terrainPalettes.map((p) => p.name);
  const learnedPalette = model.meta.palette ?? "";
  if (learnedPalette && !palettes.includes(learnedPalette)) ownPalette.createEl("option", { value: learnedPalette, text: `${learnedPalette} (not installed)` });
  for (const p of palettes) ownPalette.createEl("option", { value: p, text: p });
  ownPalette.value = learnedPalette;
  ownPalette.addEventListener("change", () => {
    model.meta.palette = ownPalette.value;
    void (file ? setGeneratorPalette(plugin, file, ownPalette.value) : Promise.resolve()).then(() => {
      generatorPageState.paletteName = ownPalette.value;
      ctx.host.rerender();
    });
  });

  const combo = combinedSourcesOf(model);
  const isBlend = combo.kind === "blend";
  const sources = combo.names;
  // Region sources are map slugs: show their display names.
  const sourceLabel = (n: string) => (isBlend ? n : plugin.mapLabel(n));
  const sourceRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
  sourceRow.createSpan({ text: isBlend ? "Blend of" : "From", cls: "duckmage-map-origin-label" });
  sourceRow.createSpan({ text: sources.length ? sources.map(sourceLabel).join(" + ") : "No map recorded", cls: "duckmage-wfc-source" });
  const relearnBtn = sourceRow.createEl("button", {
    text: isBlend ? "Re-blend" : "Re-learn",
    attr: { title: isBlend ? "Blend again from these generators' current files, keeping the settings below" : "Learn again from these maps, keeping the settings below" },
  });
  relearnBtn.disabled = !sources.length;
  relearnBtn.addEventListener("click", () => {
    relearnBtn.disabled = true;
    void (saved ? relearnGenerator(plugin, saved) : remakeBlend(plugin, model)).then((r) => {
      if ("error" in r) {
        new Notice(r.error);
        relearnBtn.disabled = false;
        return;
      }
      if (!saved) generatorPageState.draft = r.model;
      new Notice(`${isBlend ? "Re-blended" : "Re-learned"} "${model.name}" from ${sources.map(sourceLabel).join(" + ")}.`);
      ctx.host.rerender();
    });
  });
  if (file) {
    const openBtn = sourceRow.createEl("button", { text: "Open file" });
    openBtn.addEventListener("click", () => void app.workspace.getLeaf("tab").openFile(file));
  }

  // A combined generator (regions learned together, or a blend of
  // generators): how much each source counts, and which side of the map
  // it leans toward. The sliders always add up to 100%; letting go of one,
  // or picking a direction, re-makes the generator with the new mix.
  if (sources.length > 1) {
    const box = el.createDiv({ cls: "duckmage-wfc-influence" });
    box.createEl("label", { text: isBlend ? "Blend" : "Map influence", cls: "duckmage-map-field-label" });
    const stored = sourceInfluenceOf(model);
    let dirs: Compass[] = sourceDirectionsOf(model) ?? sources.map((): Compass => "C");
    const arrows: Record<Compass, string> = { NW: "↖", N: "↑", NE: "↗", W: "←", C: "•", E: "→", SW: "↙", S: "↓", SE: "↘" };
    const names: Record<Compass, string> = {
      NW: "north-west", N: "north", NE: "north-east", W: "west", C: "everywhere", E: "east", SW: "south-west", S: "south", SE: "south-east",
    };
    // The shared zero-sum sliders (src/ui/shareSliders.ts), each row
    // ending in its compass: which side of the map the source leans toward.
    const compasses: { d: Compass; b: HTMLButtonElement }[][] = [];
    const sliders = renderShareSliders(box, {
      items: sources.map((name) => ({ label: sourceLabel(name) })),
      weights: toPercents(stored ?? (isBlend ? sources.map(() => 1) : regionSizes(plugin, sources))),
      ariaLabel: (item) => `${item.label} influence`,
      extra: (row, i) => {
        const name = sources[i];
        const compass = row.createDiv({ cls: "duckmage-wfc-compass", attr: { role: "group", "aria-label": `${sourceLabel(name)} direction` } });
        compasses[i] = COMPASS.map((d) => {
          const b = compass.createEl("button", {
            text: arrows[d],
            cls: "duckmage-wfc-compass-point",
            attr: { title: d === "C" ? `${sourceLabel(name)}: everywhere (no direction)` : `${sourceLabel(name)}: lean ${names[d]}`, "aria-label": names[d] },
          });
          b.addEventListener("click", () => {
            if (dirs[i] === d) return;
            dirs = dirs.map((x, j) => (j === i ? d : x));
            showDirs();
            // A direction alone keeps a by-size mix by size.
            remake(stored || isBlend ? sliders.percents() : undefined, dirs);
          });
          return { d, b };
        });
      },
      onChange: (_shares, percents) => remake(percents, dirs),
    });
    const showDirs = () => compasses.forEach((points, i) => points.forEach((p) => p.b.toggleClass("is-active", p.d === dirs[i])));
    showDirs();
    const note = box.createEl("p", {
      text: (stored || isBlend
        ? `Each ${isBlend ? "generator" : "map"}'s share of the mix.`
        : "Set by each map's size (painted hexes). Move a slider to choose your own mix.")
        + " The arrows set which side of the map each one leans toward (• = everywhere); Directional bias sets how sharp the change is.",
      cls: "duckmage-map-origin-desc",
    });
    const remake = (next: number[] | null | undefined, nextDirs: Compass[]) => {
      note.setText(isBlend ? "Blending…" : "Re-learning…");
      sliders.setDisabled(true);
      for (const points of compasses) for (const p of points) p.b.disabled = true;
      void (saved ? relearnGenerator(plugin, saved, next, nextDirs) : remakeBlend(plugin, model, next, nextDirs)).then((res) => {
        if ("error" in res) new Notice(res.error);
        else if (!saved) generatorPageState.draft = res.model;
        ctx.host.rerender();
      });
    };
    if (stored && !isBlend) {
      const bySize = box.createEl("button", { text: "Back to map size", attr: { title: "Let each map count by how many hexes it has painted" } });
      bySize.addEventListener("click", () => remake(null, dirs));
    }
  }

  const info = [
    `${model.terrains.length} terrains`,
    model.exampleHexes ? `learned from ${model.exampleHexes} hexes` : "",
    model.meta.created ? `created ${model.meta.created}` : "",
    model.meta[VERSION_KEY] ? `v${model.meta[VERSION_KEY]}` : "",
    file?.path ?? "not saved",
  ].filter(Boolean);
  el.createEl("p", { text: info.join(" · "), cls: "duckmage-map-origin-desc" });
  const resetRow = el.createDiv({ cls: "duckmage-region-row" });
  const resetBtn = resetRow.createEl("button", { text: "Reset settings to defaults", attr: { title: "Clear every generating setting on this page back to its default" } });
  // No confirm (owner Q6): the reset says so, with an Undo that puts every setting back.
  resetBtn.addEventListener("click", () => {
    const before: Record<string, unknown> = { ...(model.settings ?? {}) };
    const cleared: Partial<Record<keyof GeneratorSettings, unknown>> = {};
    for (const k of Object.keys(before)) cleared[k as keyof GeneratorSettings] = undefined;
    if (!Object.keys(cleared).length) { new Notice("These settings are already the defaults."); return; }
    // Re-render once written, or the page re-reads the old settings.
    save(cleared);
    void ctx.lastWrite.then(() => ctx.host.rerender());
    const msg = createFragment((frag) => {
      frag.appendText(`${model.name}'s settings are back to their defaults. `);
      frag.createEl("button", { text: "Undo" }).addEventListener("click", () => {
        save(before);
        void ctx.lastWrite.then(() => ctx.host.rerender());
        notice.hide();
      });
    });
    const notice = new Notice(msg, 10000);
  });
  return generatorSettingsBox;
}
