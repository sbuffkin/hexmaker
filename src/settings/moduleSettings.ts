/**
 * The modules' settings in the settings tab (SettingContribution,
 * src/modules/types.ts): one row each, in the section its module names
 * ("Setup" when it names none), placed by its placement id like the core's
 * rows. The tab draws the same definitions in both settings paths
 * (getSettingDefinitions and the display() fallback), so a module's row
 * shows in both.
 */
import type { Setting } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { moduleSettings } from "../modules/runtime";
import type { SettingContribution } from "../modules/types";

/** The section a module's setting joins when it names none. */
export const MODULE_SETTINGS_SECTION = "Setup";

/** A settings row (the shape of the tab's setting definitions). */
export interface ModuleSettingRow {
  name: string;
  desc: string;
  aliases?: string[];
  control?: { type: "text"; key: string; placeholder: string } | { type: "toggle"; key: string; defaultValue: boolean };
  render?: (setting: Setting) => void;
}

/** One module setting as a settings row. */
export function moduleSettingRow(c: SettingContribution, plugin: HexmakerPlugin): ModuleSettingRow {
  const base = { name: c.name, desc: c.desc, ...(c.aliases ? { aliases: [...c.aliases] } : {}) };
  const control = c.control;
  if (control.type === "folder") return { ...base, control: { type: "text", key: control.key, placeholder: control.placeholder } };
  if (control.type === "toggle") return { ...base, control: { type: "toggle", key: control.key, defaultValue: control.defaultValue } };
  return { ...base, render: (setting) => control.render(setting, plugin) };
}

/**
 * Add every module's settings to the tab's sections: each at the end of the
 * section with its heading (default Setup); a heading the tab doesn't have
 * gets a section of its own, after the others.
 */
export function addModuleSettings<T>(
  sections: { heading?: string; items: { id: string; item: T }[] }[],
  row: (c: SettingContribution) => T,
): void {
  for (const c of moduleSettings()) {
    const heading = c.section ?? MODULE_SETTINGS_SECTION;
    let section = sections.find((s) => s.heading === heading);
    if (!section) sections.push((section = { heading, items: [] }));
    section.items.push({ id: c.id, item: row(c) });
  }
}

/** Is `key` a module's folder setting (normalised like the core's folder paths)? */
export function isModuleFolderKey(key: string): boolean {
  return moduleSettings().some((c) => c.control.type === "folder" && c.control.key === key);
}

/** After a module setting's value was saved: its module's follow-up (re-read its notes). */
export function moduleSettingChanged(plugin: HexmakerPlugin, key: string): void {
  for (const c of moduleSettings()) if (c.control.type !== "custom" && c.control.key === key) c.changed?.(plugin);
}

/**
 * The modules' folder settings the setup wizard asks for with the core's
 * folders (SettingContribution.wizard), in module order: key, label, and
 * the subfolder of the world folder each starts as.
 */
export function moduleWizardFolders(): { key: string; label: string; suffix: string }[] {
  return moduleSettings().flatMap((c) => (c.control.type === "folder" && c.wizard ? [{ key: c.control.key, ...c.wizard }] : []));
}
