/**
 * The runtime halves of the modules compiled into this build (see
 * ./types.ts), in the same order as ./index.ts. Read by the plugin and the
 * services that need a module's host-bound pieces (generators, stores,
 * settings, commands). Only ever read inside functions, never at import
 * time: modules reach back into the core, so the import graph has cycles
 * through here.
 */

import { logError } from "../log";
import type HexmakerPlugin from "../HexmakerPlugin";
import type {
  CommandContribution,
  FolderSettingContribution,
  GeneratorPageTab,
  HexMenuContribution,
  PartyStep,
  GeneratorContribution,
  GeneratorHelpers,
  MapOverlayDef,
  MapPropertiesSection,
  NewMapSetupExtra,
  ModuleRuntime,
  ModuleStore,
  RefLinker,
  ScaleChoice,
  ScaleMapMade,
} from "./types";
import type { TableSource } from "../worldgen/tableRoles";
import type { WorldMapsApi } from "./world-maps/api";
import type { UndoItem } from "../hex-map/undoItems";
import { registry } from "./index";
import { worldRuntime } from "./world/runtime";
import { worldMapsRuntime } from "./world-maps/runtime";
import { spaceRuntime } from "./space/runtime";
import { hexFlowerRuntime } from "./hex-flower/runtime";

/** The runtime halves, by the same slice flags as ./index.ts. */
const compiled: ModuleRuntime[] = [worldRuntime];
if (__SLICE_WORLDMAPS__) compiled.push(worldMapsRuntime);
if (__SLICE_SPACE__) compiled.push(spaceRuntime);
if (__SLICE_HEXFLOWER__) compiled.push(hexFlowerRuntime);
export const MODULE_RUNTIMES: readonly ModuleRuntime[] = compiled;

/** Every module's built-in generators, in list order. */
export function moduleGenerators(plugin: HexmakerPlugin, helpers: GeneratorHelpers): GeneratorContribution[] {
  return MODULE_RUNTIMES
    .flatMap((m) => m.generators?.(plugin, helpers) ?? [])
    .sort((a, b) => a.order - b.order);
}

/** Every module's note stores, made once with the plugin (in module order). */
export function createModuleStores(plugin: HexmakerPlugin): ModuleStore[] {
  return MODULE_RUNTIMES.flatMap((m) => {
    const made = m.stores?.(plugin) ?? [];
    for (const s of made) storeOwner.set(s, m.id);
    return made;
  });
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

/** World maps' hooks into the map surfaces (undefined in a build without the World maps slice). */
export function worldMaps(): WorldMapsApi | undefined {
  for (const m of MODULE_RUNTIMES) if (m.worldMaps) return m.worldMaps();
  return undefined;
}

/** Each module's start-up upgrades, once the core's stores and its own have loaded. */
export function runAfterStoresReady(plugin: HexmakerPlugin, coreReady: Promise<unknown>, stores: readonly ModuleStore[], ready: ReadonlyMap<ModuleStore, Promise<unknown>>): void {
  for (const m of MODULE_RUNTIMES) {
    if (!m.afterStoresReady) continue;
    const own = (m.stores ? stores.filter((s) => storeOwner.get(s) === m.id) : []).map((s) => ready.get(s));
    void Promise.all([coreReady, ...own]).then(() => m.afterStoresReady!(plugin)).catch((e) => logError(`${m.id} start-up upgrade`, e));
  }
}

/** Which module made each store (createModuleStores). */
const storeOwner = new WeakMap<ModuleStore, string>();

/** Every module's extra note folders. */
export function moduleFolders(plugin: HexmakerPlugin): string[] {
  return MODULE_RUNTIMES.flatMap((m) => m.folders?.(plugin) ?? []);
}

/** Every module's sandbox dev helpers, merged. */
export function moduleDevTools(plugin: HexmakerPlugin): Record<string, (...args: never[]) => unknown> {
  return Object.assign({}, ...MODULE_RUNTIMES.map((m) => m.devTools?.(plugin) ?? {})) as Record<string, (...args: never[]) => unknown>;
}

/** Tell every module a map scale was picked (setup wizard), in module order. */
export async function runOnScalePicked(plugin: HexmakerPlugin, scaleId: string): Promise<void> {
  for (const m of MODULE_RUNTIMES) await m.onScalePicked?.(plugin, scaleId);
}

/** The choices scale `scaleId` shows beside generator `generatorId` (setup wizard, New map). */
export function moduleScaleChoices(scaleId: string | undefined, generatorId: string | undefined): ScaleChoice[] {
  if (!scaleId) return [];
  return MODULE_RUNTIMES.flatMap((m) => (m.scaleSetup ?? []).filter((x) => x.scaleId === scaleId).flatMap((x) => [...(x.choices ?? [])]))
    .filter((c) => !c.forGenerators || (generatorId !== undefined && c.forGenerators.includes(generatorId)));
}

/** The choices' values: each as set, else its default. */
export function scaleChoiceValues(choices: readonly ScaleChoice[], set: Readonly<Record<string, boolean>>): Record<string, boolean> {
  return Object.fromEntries(choices.map((c) => [c.key, set[c.key] ?? c.default]));
}

/** A map was just made on scale `scaleId`: each module that sets that scale up does, in module order. */
export async function runScaleMapMade(plugin: HexmakerPlugin, scaleId: string | undefined, made: ScaleMapMade): Promise<void> {
  if (!scaleId) return;
  for (const m of MODULE_RUNTIMES) for (const x of m.scaleSetup ?? []) if (x.scaleId === scaleId) await x.afterCreate(plugin, made);
}

/** Tell every module that map types were just turned on, in module order. */
export async function runOnKindsEnabled(plugin: HexmakerPlugin, kinds: readonly string[]): Promise<void> {
  for (const m of MODULE_RUNTIMES) await m.onKindsEnabled?.(plugin, kinds);
}

/**
 * The party entered a hex: each module's Play hook, in module order. The
 * undo entries of everything they wrote, for the map view to group with
 * the token's move. A hook that fails is logged and skipped.
 */
export async function runPartyEntered(plugin: HexmakerPlugin, step: PartyStep): Promise<UndoItem[]> {
  const out: UndoItem[] = [];
  for (const m of MODULE_RUNTIMES) {
    if (!m.play?.onEnter) continue;
    try {
      out.push(...await m.play.onEnter(plugin, step));
    } catch (e) {
      logError(`${m.id} party step`, e);
    }
  }
  return out;
}

/** Every module's items for the right-click menu of hex `hex` on map `map`. */
export function moduleHexMenu(plugin: HexmakerPlugin, map: string, hex: string): HexMenuContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => m.hexMenu?.(plugin, map, hex) ?? []);
}

/** The hexes the modules add to map `map`'s "?" layer. */
export function moduleUnchartedKeys(plugin: HexmakerPlugin, map: string): string[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.unchartedKeys?.(plugin, map) ?? [])]);
}

/** Every module's generator page tabs, in module order. */
export function moduleGeneratorTabs(): GeneratorPageTab[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.generatorPage ?? [])]);
}
