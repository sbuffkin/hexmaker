/**
 * The World maps module's hooks into the core's map surfaces (plan-code-
 * modules P7): what the map view, the hex editor, Map properties, arrival
 * and the generator page call on overworlds, regions, biomes and walking.
 *
 * The core never imports this: it asks src/modules/runtime.ts
 * `worldMaps()`, which is undefined in a build without the World maps
 * slice, and types its calls with `import type` only. Each entry is the
 * module's own function or class, unchanged, so behaviour is identical
 * with the slice on. These are the hooks still named after the module
 * (the remaining coupling, listed in ARCHITECTURE.md); the generic
 * contributions (stores, commands, folder settings, start-up upgrades)
 * are in ./runtime.ts.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import { OverworldLayer, REGION_PATHS_ROW } from "../../overworld/overworldLayer";
import type { LayerRow } from "../../hex-map/HexSidePanel";
import { OverworldMinimap } from "../../overworld/overworldMinimap";
import { RegionGenModal, rerollRegionAt } from "../../overworld/BiomeModals";
import { BiomePaletteModal } from "../../overworld/BiomePaletteModal";
import { BiomeStroke, strokeNotice } from "../../overworld/biomePainter";
import { BIOMES, biomeInfo, biomeNoteOf } from "../../overworld/biomes";
import { EditRegionModal } from "../../overworld/EditRegionModal";
import {
  createRegion,
  hexBiomeAt,
  inOverworldGrid,
  missingRegionHexes,
  overworldOf,
  paintBiomeHex,
  regenerateRegion,
  regionHome,
  regionPalette,
  walkLock,
} from "../../overworld/regionsVault";
import {
  applyProjectionUndo,
  confirmOverworldPath,
  draftPathNames,
  isPathOverworld,
  prepareProjectionUndo,
  removeOverworldPath,
} from "../../overworld/overworldPaths";
import { draftsAfterEdit, isApplied } from "../../overworld/pathProjection";
import {
  PAINT_LOCKED_HINT,
  PAINT_NO_REGION_HINT,
  TERRAIN_IN_BIOMES_HINT,
  brushCells,
  overworldLeftClick,
  overworldMenu,
  paintTargets,
} from "../../overworld/overworldInput";
import { WalkRegionModal } from "../../overworld/WalkRegionModal";
import { overworldRefreshFor } from "../../overworld/overworldChanges";
import { parentOf } from "../../overworld/layout";
import { addNewOverworldTab, openNewOverworld, renderOverworldRegionRows } from "../../overworld/mapModalParts";
import { openMakeGenerator } from "../../overworld/MakeGeneratorModal";
import { blendMenuLabel, openBlendIntoBiome } from "../../overworld/BlendIntoBiomeModal";
import { BiomePanel } from "../../overworld/BiomePanel";

/** An overworld hex's biome for its Map data callout: its label, and its biome note when it has one. */
function hexBiomeRef(plugin: HexmakerPlugin, mapName: string, key: string): { label: string; note?: string } | undefined {
  if (!overworldOf(plugin, mapName)) return undefined;
  const id = hexBiomeAt(plugin, mapName, key);
  if (!id) return undefined;
  const label = biomeNoteOf(id)?.label ?? BIOMES.find((b) => b.id === id)?.label ?? id;
  return { label, note: plugin.biomeStore.pathOf(id) };
}

/** The layers-menu rows World maps adds: paths between regions, on overworlds. */
function layerRows(plugin: HexmakerPlugin): LayerRow[] {
  return [{ ...REGION_PATHS_ROW, shows: (map) => REGION_PATHS_ROW.shows(plugin, map) }];
}

/** The hooks, made on first use (never at import time: the overworld code imports the core, which reaches here through the runtime). */
function makeApi() {
  return {
  // Overworlds and their regions.
  overworldOf,
  regionHome,
  inOverworldGrid,
  regionPalette,
  missingRegionHexes,
  createRegion,
  regenerateRegion,
  rerollRegionAt,
  walkLock,
  parentOf,
  hexBiomeAt,
  hexBiomeRef,
  // Biomes.
  biomeInfo,
  biomeNoteOf,
  paintBiomeHex,
  BiomeStroke,
  strokeNotice,
  // Overworld paths confirmed into regions.
  applyProjectionUndo,
  confirmOverworldPath,
  draftPathNames,
  isPathOverworld,
  prepareProjectionUndo,
  removeOverworldPath,
  draftsAfterEdit,
  isApplied,
  // The map view on an overworld: its layer, minimap, clicks and brush.
  OverworldLayer,
  OverworldMinimap,
  layerRows,
  overworldRefreshFor,
  overworldLeftClick,
  overworldMenu,
  brushCells,
  paintTargets,
  PAINT_LOCKED_HINT,
  PAINT_NO_REGION_HINT,
  TERRAIN_IN_BIOMES_HINT,
  // The Maps modal's parts.
  openNewOverworld,
  addNewOverworldTab,
  renderOverworldRegionRows,
  // Dialogs.
  BiomePaletteModal,
  EditRegionModal,
  WalkRegionModal,
  RegionGenModal,
  openMakeGenerator,
  // "Blend into <biome>…" (the Maps right-click menu).
  blendMenuLabel,
  openBlendIntoBiome,
  // The generator page's biome view.
  BiomePanel,
  };
}

let made: ReturnType<typeof makeApi> | undefined;

/** World maps' hooks (one object, made once). */
export function worldMapsApi(): ReturnType<typeof makeApi> {
  return (made ??= makeApi());
}

export type WorldMapsApi = ReturnType<typeof makeApi>;
