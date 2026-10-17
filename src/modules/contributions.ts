/**
 * The contribution points a slice plugs into (plan "every major feature a
 * slice", S0.4–S0.5): where its controls sit and how the work modes treat
 * them, its settings, views, Map export parts, setup wizard offers,
 * start/stop, the generator page api and its Play hooks. Each is a field
 * of HexmakerModule or ModuleRuntime (./types.ts) with a call site in the
 * core that does nothing while no module answers, so a lane making a new
 * slice adds module code only.
 *
 * Types only: no runtime code here.
 */

import type { Setting, View, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapPdfExportOptions } from "../export/exporters/mapWithTable";
import type { ModeAction, WorkMode } from "../workMode";

/** A module's rows of the work-mode tables (src/workMode.ts); ids never shadow the core's. */
export interface ModeActionContributions {
  /** Actions of its own: which modes allow each, and the verb for "Switch to Build to <verb>." */
  policy?: Readonly<Partial<Record<ModeAction, { modes: readonly WorkMode[]; verb: string }>>>;
  /** Its command ids → action. */
  commands?: Readonly<Record<string, ModeAction>>;
  /** Its map-view menu item ids ("hex.explore-roll", "ow.edit-region") → action. */
  menus?: Readonly<Record<string, ModeAction>>;
  /** Its drawing tools → action. */
  tools?: Readonly<Record<string, ModeAction>>;
}

/**
 * A setting a module adds to the settings tab (both paths: the declarative
 * definitions and the display() fallback draw the same rows). `id` is its
 * placement id (src/ui/placement.ts): where it shows (main, Advanced, Debug).
 * A folder setting (`folderSettings`) is this with a folder control.
 */
export interface SettingContribution {
  id: string;
  /** The heading of the settings section it joins ("Setup" when unset); one the tab doesn't have gets its own section at the end. */
  section?: string;
  name: string;
  desc: string;
  /** More words settings search finds it by. */
  aliases?: readonly string[];
  control:
    /** A vault folder path (normalised when saved). */
    | { type: "folder"; key: string; placeholder: string }
    /** A yes/no. Its key has no DEFAULT_SETTINGS entry (a build without the module never writes it): `defaultValue` is what unset means. */
    | { type: "toggle"; key: string; defaultValue: boolean }
    /** A row the module draws itself. */
    | { type: "custom"; render(setting: Setting, plugin: HexmakerPlugin): void };
  /** After its value is saved. */
  changed?(plugin: HexmakerPlugin): void;
}

/** A workspace view a module registers (its page: the generator page, the play log…). */
export interface ViewContribution {
  /** The view type (VIEW_TYPE_*): stable, never reused. */
  type: string;
  create(leaf: WorkspaceLeaf, plugin: HexmakerPlugin): View;
}

/** What a module's part of the Map export form can ask of the form. */
export interface ExportFormContext {
  plugin: HexmakerPlugin;
  mapName: string;
  /** The form's options area: a module's options (a Fold) go here, after the core's. */
  options: HTMLElement;
  /** Its options changed: redraw the "Writes: …" line. */
  changed(): void;
}

/** A module's part of the Map export form, made once per form (ExportFormContribution.render). */
export interface ExportFormPart {
  /** The file its button writes, from the form's base name (for "Writes: …" and its button). */
  fileName?(base: string): string;
  /** What that file is, in "Writes: …" ("manual"). */
  fileLabel?: string;
  /** Its button after the core's (Export PNG, Export PDF). `choices` are the form's own export options. */
  button?: { label: string; run(choices: MapPdfExportOptions, fileName: string | undefined): void | Promise<void> };
  /** One line for "What's in each file". */
  describe?: string;
  /** A box of its own after that list (Content pack), placed by its placement id; `done` closes the form. */
  box?: { placementId: string; render(el: HTMLElement, done: () => void): void };
}

/** Something a module adds to the Map export form (Hexcrawl manual, Content pack). */
export interface ExportFormContribution {
  id: string;
  render(ctx: ExportFormContext): ExportFormPart;
}

/** An offer a module makes on a setup wizard step (Content packs: "Import a content pack…"), never a step of its own. */
export interface WizardOfferContribution {
  id: string;
  /** The wizard step it shows on (its WizardStep id: "done"). */
  step: string;
  render(container: HTMLElement, plugin: HexmakerPlugin): void;
}

/** A module starting and stopping with the plugin (after the core's own start-up; before its own clean-up). */
export interface LifecycleHooks {
  /** At the end of the plugin's onload (views and commands are registered). A failure is logged, never fatal. */
  onload?(plugin: HexmakerPlugin): void | Promise<void>;
  onunload?(plugin: HexmakerPlugin): void;
}

/** The generator page, when a module provides it (genPage()): the core opens it only through this. */
export interface GenPageApi {
  /** Open the page (or bring it forward), with a map, generator, palette or biome picked. */
  open(plugin: HexmakerPlugin, select?: { mapName?: string; generatorPath?: string; paletteName?: string; biome?: string }): Promise<void>;
}

/** A click on a hex while a party token is selected in Play. */
export interface PartyClick {
  map: string;
  /** The party token's note, and the hex it stands on and the one clicked ("x_y"). */
  token: string;
  from: string;
  to: string;
  orientation: "flat" | "pointy";
  stagger: "odd" | "even";
}

/** A token right-clicked on the map. */
export interface TokenAt {
  map: string;
  hex: string;
  /** The token's note. */
  token: string;
  party: boolean;
}

/** An item a module adds to a token's right-click menu. */
export interface TokenMenuContribution {
  /** Menu item id (`token.<id>`; its module classifies it, modeActions.menus). */
  id: string;
  label: string;
  icon: string;
  checked?: boolean;
  /** Its placement id (src/ui/placement.ts). */
  placementId?: string;
  run(): void;
}

/** A hex a roll or a log line is about, and the map's mode. */
export interface HexAt {
  map: string;
  x: number;
  y: number;
  mode: WorkMode;
}

/** A place a roll made on a hex can go besides the hex's own sections (the play log). */
export interface RollTargetContribution {
  /** Its key in the "Add to" list (never a section's). */
  key: string;
  label: string;
  /** Picked first in these modes (Play: what happened goes to the log). */
  defaultIn?: readonly WorkMode[];
  add(text: string): Promise<void>;
}

/** "Add to log" in the hex editor: the module writes a line about the hex (its own modal). */
export interface LogWriterContribution {
  id: string;
  label: string;
  title: string;
  open(plugin: HexmakerPlugin, at: { map: string; x: number; y: number }): void;
}
