/**
 * The runtime halves of the modules compiled into this build (see
 * ./types.ts), in the same order as ./index.ts. Read by the plugin and the
 * services that need a module's host-bound pieces (generators, stores,
 * settings, commands). Only ever read inside functions, never at import
 * time: modules reach back into the core, so the import graph has cycles
 * through here.
 */

import { logError } from "../log";
import type { NoteRewrite } from "../migrations/noteRewrites";
import type HexmakerPlugin from "../HexmakerPlugin";
import type {
  CommandContribution,
  ExportFormContribution,
  FolderSettingContribution,
  HexAt,
  LogWriterContribution,
  PartyClick,
  RollTargetContribution,
  SettingContribution,
  TokenAt,
  TokenMenuContribution,
  ViewContribution,
  WizardOfferContribution,
  HexMenuContribution,
  PartyAt,
  PartyControl,
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
import type { PackKind } from "./packs/packKinds";
import type { UndoItem } from "../hex-map/undoItems";
import type { MapData } from "../types";
import { registry } from "./index";
import { setActiveRuntimes } from "./active";
import { worldRuntime } from "./world/runtime";
import { worldMapsRuntime } from "./world-maps/runtime";
import { spaceRuntime } from "./space/runtime";
import { genPageRuntime } from "./gen-page/runtime";
import { playRuntime } from "./play/runtime";
import { hexFlowerRuntime } from "./hex-flower/runtime";
import { packsRuntime } from "./packs/runtime";

/** The runtime halves, by the same slice flags as ./index.ts. */
const compiled: ModuleRuntime[] = [worldRuntime];
if (__SLICE_WORLDMAPS__) compiled.push(worldMapsRuntime);
if (__SLICE_SPACE__) compiled.push(spaceRuntime);
if (__SLICE_GENPAGE__) compiled.push(genPageRuntime);
// Before Hex flower: a step is marked visited before exploring reads it.
if (__SLICE_PLAY__) compiled.push(playRuntime);
if (__SLICE_HEXFLOWER__) compiled.push(hexFlowerRuntime);
if (__SLICE_PACKS__) compiled.push(packsRuntime);
export const MODULE_RUNTIMES: readonly ModuleRuntime[] = compiled;
setActiveRuntimes(MODULE_RUNTIMES);
// genPage() and worldMaps() live in ./active.ts so module code can call them without importing this file.
export { genPage, worldMaps } from "./active";

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

/**
 * Every module's settings, in module order: its folder settings (as folder
 * rows) then its other settings. The settings tab draws these in both paths.
 */
export function moduleSettings(): SettingContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => [
    ...(m.folderSettings ?? []).map((d): SettingContribution => ({
      id: d.id,
      name: d.name,
      desc: d.desc,
      control: { type: "folder", key: d.key, placeholder: d.placeholder },
      ...(d.changed ? { changed: (plugin: HexmakerPlugin) => d.changed?.(plugin) } : {}),
    })),
    ...(m.settings ?? []),
  ]);
}

/** Every module's workspace views, in module order. */
export function moduleViews(): ViewContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.views ?? [])]);
}

/** Every module's parts of the Map export form, in module order. */
export function moduleExportForm(): ExportFormContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.exportForm ?? [])]);
}

/** The modules' offers on setup wizard step `step`, in module order. */
export function moduleWizardOffers(step: string): WizardOfferContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => (m.wizardOffers ?? []).filter((o) => o.step === step));
}

/** Each module's start-up, at the end of the plugin's onload, in module order. A failure is logged and skipped. */
export async function runModuleLoad(plugin: HexmakerPlugin): Promise<void> {
  for (const m of MODULE_RUNTIMES) {
    try {
      await m.lifecycle?.onload?.(plugin);
    } catch (e) {
      logError(`${m.id} start-up`, e);
    }
  }
}

/** Each module's clean-up, in reverse module order (before the core's). */
export function runModuleUnload(plugin: HexmakerPlugin): void {
  for (const m of [...MODULE_RUNTIMES].reverse()) {
    try {
      m.lifecycle?.onunload?.(plugin);
    } catch (e) {
      logError(`${m.id} clean-up`, e);
    }
  }
}

/**
 * Does this build have party tokens: a module that moves one in Play (its
 * partyClick)? Without one, a token marked as the party is a plain token.
 */
export function partyTokensOn(): boolean {
  return MODULE_RUNTIMES.some((m) => !!m.play?.partyClick);
}

/** The party took a step: each module's marks (onStep), in module order; their undo entries. */
export function runPartyStep(plugin: HexmakerPlugin, step: PartyStep): UndoItem[] {
  return MODULE_RUNTIMES.flatMap((m) => {
    try {
      return m.play?.onStep?.(plugin, step) ?? [];
    } catch (e) {
      logError(`${m.id} party step marks`, e);
      return [];
    }
  });
}

/** Does any module make this click on a hex the selected party's step? */
export function modulePartyClick(plugin: HexmakerPlugin, click: PartyClick): "move" | "none" {
  return MODULE_RUNTIMES.some((m) => m.play?.partyClick?.(plugin, click) === "move") ? "move" : "none";
}

/**
 * The modules' extra CSS classes per hex of map `map`, asked once per render
 * (read-then-write: call it before drawing, then per hex while drawing).
 */
export function moduleGridDecorations(plugin: HexmakerPlugin, map: MapData): (hex: string) => string[] {
  const each = MODULE_RUNTIMES.flatMap((m) => {
    const f = m.play?.gridDecorations?.(plugin, map);
    return f ? [f] : [];
  });
  return each.length ? (hex) => each.flatMap((f) => [...f(hex)]) : () => [];
}

/** The modules' items for a token's right-click menu, in module order. */
export function moduleTokenMenu(plugin: HexmakerPlugin, token: TokenAt): TokenMenuContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => m.play?.tokenMenu?.(plugin, token) ?? []);
}

/** The places a roll made on a hex can go besides its sections, in module order. */
export function moduleRollTargets(plugin: HexmakerPlugin, at: HexAt): RollTargetContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => m.play?.rollTargets?.(plugin, at) ?? []);
}

/** The modules' "Add to log" links for the hex editor, in module order. */
export function moduleLogWriters(): LogWriterContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.play?.logWriters ?? [])]);
}

/** Every module's "ref-links" rewriters for its own notes. */
export function moduleRefLinkers(plugin: HexmakerPlugin): RefLinker[] {
  return MODULE_RUNTIMES.flatMap((m) => m.refLinkers?.(plugin) ?? []);
}

/** Each module's one-time rewrites of its own notes (run after the core's). */
export function moduleNoteRewrites(plugin: HexmakerPlugin): NoteRewrite[] {
  return MODULE_RUNTIMES.flatMap((m) => m.noteRewrites?.(plugin) ?? []);
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

/** Every module's content pack kinds, in module order. */
export function modulePackKinds(plugin: HexmakerPlugin): PackKind[] {
  return MODULE_RUNTIMES.flatMap((m) => m.packKinds?.(plugin) ?? []);
}

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

/** Every module's controls for the party controls (the selected party in Play), in module order. */
export function modulePartyControls(plugin: HexmakerPlugin, party: PartyAt): PartyControl[] {
  return MODULE_RUNTIMES.flatMap((m) => {
    try {
      return m.play?.partyControls?.(plugin, party) ?? [];
    } catch (e) {
      logError(`${m.id} party controls`, e);
      return [];
    }
  });
}

/** Every module's items for the right-click menu of hex `hex` on map `map`. */
export function moduleHexMenu(plugin: HexmakerPlugin, map: string, hex: string): HexMenuContribution[] {
  return MODULE_RUNTIMES.flatMap((m) => m.hexMenu?.(plugin, map, hex) ?? []);
}

/** The hexes the modules add to map `map`'s "?" layer. */
export function moduleUnchartedKeys(plugin: HexmakerPlugin, map: string): string[] {
  return MODULE_RUNTIMES.flatMap((m) => [...(m.unchartedKeys?.(plugin, map) ?? [])]);
}
