/**
 * The runtime halves of the modules compiled into this build (see
 * ./types.ts), in the same order as ./index.ts. Read by the plugin and the
 * services that need a module's host-bound pieces (generators, stores,
 * settings, commands). Only ever read inside functions, never at import
 * time: modules reach back into the core, so the import graph has cycles
 * through here.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type {
  CommandContribution,
  FolderSettingContribution,
  GeneratorContribution,
  GeneratorHelpers,
  MapOverlayDef,
  MapPropertiesSection,
  NewMapSetupExtra,
  ModuleRuntime,
  ModuleStore,
  RefLinker,
} from "./types";
import type { TableSource } from "../worldgen/tableRoles";
import { registry } from "./index";
import { worldRuntime } from "./world/runtime";
import { worldMapsRuntime } from "./world-maps/runtime";
import { spaceRuntime } from "./space/runtime";

export const MODULE_RUNTIMES: readonly ModuleRuntime[] = [worldRuntime, worldMapsRuntime, spaceRuntime];

/** Every module's built-in generators, in list order. */
export function moduleGenerators(plugin: HexmakerPlugin, helpers: GeneratorHelpers): GeneratorContribution[] {
  return MODULE_RUNTIMES
    .flatMap((m) => m.generators?.(plugin, helpers) ?? [])
    .sort((a, b) => a.order - b.order);
}

/** Every module's note stores, made once with the plugin (in module order). */
export function createModuleStores(plugin: HexmakerPlugin): ModuleStore[] {
  return MODULE_RUNTIMES.flatMap((m) => m.stores?.(plugin) ?? []);
}

/** Every module's commands, each with the map type it waits on (onlyWhenOn). */
export function moduleCommands(): { command: CommandContribution; kind?: string }[] {
  return MODULE_RUNTIMES.flatMap((m) => (m.commands ?? []).map((command) => ({
    command,
    ...(command.onlyWhenOn ? { kind: registry.module(m.id)?.kind?.id } : {}),
  })));
}

/** Every module's folder settings, in module order. */
export function moduleFolderSettings(): FolderSettingContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.folderSettings ?? [])]);
}

/** Every module's "ref-links" rewriters for its own notes. */
export function moduleRefLinkers(plugin: HexmakerPlugin): RefLinker[] {
  return MODULE_RUNTIMES.flatMap((m) => m.refLinkers?.(plugin) ?? []);
}

/** Run the onEnabled hook of each module whose map type is in `kinds` (just turned on), in module order. */
export async function runOnEnabled(plugin: HexmakerPlugin, kinds: readonly string[]): Promise<void> {
  for (const m of MODULE_RUNTIMES) {
    const kind = registry.module(m.id)?.kind?.id;
    if (kind && kinds.includes(kind)) await m.onEnabled?.(plugin);
  }
}

/** Every module's map overlays, in module order (map view and PNG export). */
export function moduleOverlays(): MapOverlayDef[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.overlays ?? [])]);
}

/** Every module's Map properties sections, in module order. */
export function moduleMapProperties(): MapPropertiesSection[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.mapProperties ?? [])]);
}

/** The New map setup extras for generator `generatorId`, in module order. */
export function moduleNewMapSetup(generatorId: string): NewMapSetupExtra[] {
  return MODULE_RUNTIMES.flatMap((m) => (m.newMapSetup ?? []).filter((x) => x.forGenerators.includes(generatorId)));
}

/** The table source for rolls on arrival: the first module that answers. */
export function moduleArrivalTables(plugin: HexmakerPlugin, terrains: string[], mapName: string): TableSource | undefined {
  for (const m of MODULE_RUNTIMES) {
    const source = m.arrival?.tableSourceFor?.(plugin, terrains, mapName);
    if (source) return source;
  }
  return undefined;
}

/** Every module's New map option inventory ids: generator id → option key → id. */
export function moduleNewMapOptionIds(): Record<string, Readonly<Record<string, string>>> {
  return Object.assign({}, ...MODULE_RUNTIMES.map((m) => m.newMapOptionIds ?? {})) as Record<string, Readonly<Record<string, string>>>;
}
