/**
 * The "Map data as hex note properties" setting (Advanced; owner MG4) and
 * what switching it does. On (the default): hex notes carry their hex's
 * terrain, area, icon and name as properties, kept up to date both ways
 * (src/maps/hexPropsSync.ts). Off: the plugin stops and removes them from
 * the hex notes. Either way the notes it rewrites are backed up first.
 */
import { Notice, type Setting } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { PROP_FIELDS, readProps, setPropsInText } from "../maps/hexProps";
import { hexNoteProperties } from "../migrations/unreleased-hex-note-properties";
import { hexNotes, runRewrite, type NoteRewrite } from "../migrations/noteRewrites";

export const HEX_PROPS_SETTING_NAME = "Map data as hex note properties";

export const HEX_PROPS_SETTING_DESC =
  "Hex notes show their hex's terrain, area, icon and name as properties, for Dataview, Bases and search. They're copies: the map note holds the data, and editing one of them changes the map. Off: the plugin stops writing them and removes them from hex notes (a backup is kept).";

/** Off: the properties come out of every hex note (not a migration; run when the setting is switched off). */
export const removeHexNoteProperties: NoteRewrite = {
  info: {
    id: "hex-note-properties-off",
    from: "1.6",
    to: "1.6",
    phase: "notes",
    change: "Hex note properties were turned off and removed from hex notes.",
    recordedBy: "the setting",
  },
  recordId: "hex-properties-off",
  label: "terrain, area, icon and name properties removed from hex notes",
  async plan(host, add) {
    for (const { file } of hexNotes(host)) {
      const fm = host.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && !PROP_FIELDS.some((f) => f in fm) && !readProps(fm).oldAreaKey) continue;
      const text = await host.app.vault.cachedRead(file);
      add(file.path, text, setPropsInText(text, {}));
    }
  },
  replan: (_host, _path, current) => setPropsInText(current, {}),
};

/** Switch the properties on or off: rewrite the hex notes (backed up), then start or stop the sync. */
export async function setHexNoteProperties(plugin: HexmakerPlugin, on: boolean): Promise<void> {
  if (on === plugin.hexProps.enabled) return;
  if (on) delete plugin.settings.hexNoteProperties;
  else plugin.settings.hexNoteProperties = false;
  await plugin.saveSettings();
  plugin.hexProps.stop();
  const r = await runRewrite(plugin, on ? hexNoteProperties : removeHexNoteProperties);
  if (on) await plugin.hexProps.start();
  else for (const p of r.changed) plugin.hexProps.memory.forget(p);
  const n = r.changed.length;
  const notes = `${n} hex note${n === 1 ? "" : "s"}`;
  if (r.error) new Notice(`Hex note properties: ${r.error}`, 10000);
  else if (n) new Notice(on ? `Map data added to ${notes} as properties. Backup: ${r.backup}` : `Map data properties removed from ${notes}. Backup: ${r.backup}`, 8000);
}

/** The settings row (the toggle). */
export function hexPropsSettingItem(plugin: HexmakerPlugin): { name: string; desc: string; aliases: string[]; render: (setting: Setting) => void } {
  return {
    name: HEX_PROPS_SETTING_NAME,
    desc: HEX_PROPS_SETTING_DESC,
    aliases: ["dataview", "bases", "properties", "frontmatter", "terrain property", "area property"],
    render: (setting) => {
      setting.addToggle((t) => t.setValue(plugin.hexProps.enabled).onChange((v) => void setHexNoteProperties(plugin, v)));
    },
  };
}
