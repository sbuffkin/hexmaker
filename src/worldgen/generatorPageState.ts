/**
 * The generator page's selections, kept for as long as the plugin is loaded
 * (they survive the page's re-renders and its being closed and reopened).
 * One module-level object: the page (GeneratorPanel and its genPage/
 * sections) reads and writes it, and HexmakerPlugin.openTerrainGenerator
 * sets it before showing the page.
 */

import type { HexWfcModel } from "../../packages/hex-wfc/src";
import type { GeneratorSave } from "./saveFormat";
import type { Side } from "./world";

export interface GeneratorPageState {
  /** The generator shown (its file path; DRAFT_PATH while the unsaved draft is). */
  selectedPath: string;
  /** The region (map) the page works with. */
  mapName: string;
  /** The palette the preview uses. */
  paletteName: string;
  /** Regenerate keeps the seed. */
  seedLocked: boolean;
  /** Generate the new map as a neighbouring region of an existing one. */
  connect: { anchor: string; side: Side } | null;
  /** When connected: blend toward the neighbours' terrain (see blendFromNeighbours). */
  leanToNeighbours: boolean;
  /**
   * The save last loaded. While the page still shows its generator, seed and
   * size (and no setting has changed), the preview and Create map use the
   * saved map, even if this version would generate a different one.
   */
  loadedSave: GeneratorSave | null;
  /**
   * A generator that only exists on this page (a new blend) until saved.
   * Settings, sliders and directions change it in memory; Save writes it to
   * the generators folder.
   */
  draft: HexWfcModel | null;
  /** A blend-field biome shown instead of a generator (its id; "" = none). See BiomePanel. */
  biome: string;
}

/** The page's state: one object for the plugin's lifetime. */
export const generatorPageState: GeneratorPageState = {
  selectedPath: "",
  mapName: "",
  paletteName: "",
  seedLocked: false,
  connect: null,
  leanToNeighbours: true,
  loadedSave: null,
  draft: null,
  biome: "",
};
