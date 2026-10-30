/**
 * Load a generator save onto the page: its settings go back on its generator
 * (recreated from the save's copy if it's gone), and the page shows its
 * generator, palette, seed and size, connected where it was made when it
 * still can be. Used by the preview's Load button and the Saves tab.
 */

import { Notice, type TFile } from "obsidian";
import type HexmakerPlugin from "../../../HexmakerPlugin";
import { applySave, readSave } from "../saves";
import type { GeneratorSave } from "../../../worldgen/saveFormat";
import { neighbourSpec } from "../../../worldgen/neighbours";
import { generatorPageState } from "../generatorPageState";
import { compareVersions, pluginVersion } from "../../../compat";

/** Load `file` and redraw the page (`rerender`). Resolves false (with a notice) if it couldn't. */
export async function loadSaveOntoPage(plugin: HexmakerPlugin, file: TFile, rerender: () => void): Promise<boolean> {
  const read = await readSave(plugin, file);
  if ("error" in read) {
    new Notice(`Couldn't load "${file.basename}": ${read.error}`);
    return false;
  }
  const { save: sv, warnings } = read;
  const applied = await applySave(plugin, sv);
  if ("error" in applied) {
    new Notice(applied.error);
    return false;
  }
  generatorPageState.loadedSave = { ...sv, generatorPath: applied.file.path };
  generatorPageState.selectedPath = applied.file.path;
  generatorPageState.biome = "";
  generatorPageState.draft = null;
  // Put it back beside the map it was made next to, if that slot is still free.
  const reconnect = connectionForSave(plugin, sv);
  generatorPageState.connect = reconnect.connect;
  if (plugin.settings.terrainPalettes.some((p) => p.name === sv.palette)) generatorPageState.paletteName = sv.palette;
  generatorPageState.seedLocked = true;
  const notes = [
    applied.recreated ? `recreated generator "${applied.file.basename}" from the save` : "",
    compareVersions(sv.version, pluginVersion(plugin)) !== 0 ? `saved with v${sv.version}` : "",
    reconnect.note,
    ...warnings,
  ].filter(Boolean);
  new Notice(`Loaded "${sv.name}"${notes.length ? ` (${notes.join("; ")})` : ""}.`);
  rerender();
  return true;
}

/**
 * Where a loaded save goes: connected where it was made when that map is
 * still there and its slot there still starts at the save's origin with the
 * save's size; else a separate map, shown at its own origin. `note` says
 * which, when the save was made connected.
 */
export function connectionForSave(
  plugin: HexmakerPlugin,
  sv: Pick<GeneratorSave, "connect" | "origin" | "cols" | "rows">,
): { connect: NonNullable<GeneratorSave["connect"]> | null; note: string } {
  if (!sv.connect) return { connect: null, note: "" };
  const spec = neighbourSpec(plugin, sv.connect.anchor, sv.connect.side);
  const where = `${sv.connect.side} of ${plugin.mapLabel(sv.connect.anchor)}`;
  if (!spec.ok) return { connect: null, note: `couldn't connect it ${where} again (${spec.reason}), so it's shown as a separate map` };
  if (spec.offset.x !== sv.origin.x || spec.offset.y !== sv.origin.y || spec.cols !== sv.cols || spec.rows !== sv.rows)
    return { connect: null, note: `the space ${where} has changed, so it's shown as a separate map` };
  return { connect: { ...sv.connect }, note: `connected ${where}` };
}
