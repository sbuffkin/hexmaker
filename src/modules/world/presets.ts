/**
 * The World module's palette presets: Expanded (the default) and Limited.
 * Pure data.
 */

import type { PalettePreset } from "../../palettes/presets";
import {
  DEFAULT_TERRAIN_PALETTE,
  EXPANDED_PALETTE_NAME,
  LIMITED_PALETTE_NAME,
  LIMITED_TERRAIN_PALETTE,
} from "../../constants";

export const WORLD_PRESETS: PalettePreset[] = [
  {
    name: EXPANDED_PALETTE_NAME,
    description: "The full fantasy overland set with forests, mountains, wetlands, coasts, and more. The default; matches the generators.",
    terrains: DEFAULT_TERRAIN_PALETTE,
    kind: "world",
  },
  {
    name: LIMITED_PALETTE_NAME,
    description: "A small fantasy overland set: ocean, grass, hills, forest, mountains, desert, snow. Fewer, simpler terrains; quicker to paint.",
    terrains: LIMITED_TERRAIN_PALETTE,
    kind: "world",
  },
];
