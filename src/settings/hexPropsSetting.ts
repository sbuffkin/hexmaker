/**
 * The "Map data as hex note properties" setting (Advanced; owner MG4) and
 * what switching it does (owner HP3, 2026-10-16: "just stop updating
 * them"; turning back on must not risk the notes).
 *
 * On (the default): hex notes carry their hex's terrain, area, icon and
 * name as properties, kept up to date both ways (src/maps/hexPropsSync.ts).
 * Off: the plugin stops writing and reading them. Nothing is removed; the
 * notes keep what they show. Back on: the notes are brought in line with
 * the map notes (the source), rewriting only the ones that differ, backed
 * up first, every other key and the body untouched (resyncKeep).
 */
import { Notice, type Setting } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { needsWrite, propsOf, readProps, resyncKeep, setPropsInText, type HexProps } from "../maps/hexProps";
import { notePropsOfText } from "../maps/hexPropsSync";
import { hexNotes, runRewrite, type NoteFormatHost, type NoteRewrite } from "../migrations/noteRewrites";

export const HEX_PROPS_SETTING_NAME = "Map data as hex note properties";

export const HEX_PROPS_SETTING_DESC =
  "Hex notes show their hex's terrain, area, icon and name as properties, for Dataview, Bases and search. They're copies: the map note holds the data, and editing one of them changes the map. Off: the plugin stops updating them and leaves them in your notes as they are. Turning it back on updates only the notes that differ from the map (a backup is kept first).";

function propsAt(host: NoteFormatHost, map: string, key: string): HexProps {
  return propsOf(host.mapStore.get?.(map, key));
}

/** A note's text brought in line with the map (its own values the map lacks kept, resyncKeep). */
function resynced(host: NoteFormatHost, path: string, text: string, want: HexProps): string {
  return setPropsInText(text, want, resyncKeep(notePropsOfText(text), want, host.hexProps?.shown?.(path)));
}

/** Back on: the hex notes that differ from the map brought in line (not a migration; run by the setting). */
export const resyncHexNoteProperties: NoteRewrite = {
  info: {
    id: "hex-note-properties-on",
    from: "1.6",
    to: "1.6",
    phase: "notes",
    change: "Hex note properties were turned back on and updated from the map notes where they differed.",
    recordedBy: "the setting",
  },
  recordId: "hex-properties-on",
  label: "terrain, area, icon and name properties updated from the map",
  async plan(host, add, skip) {
    if (!host.mapStore.get) return;
    for (const { file, map } of hexNotes(host)) {
      if (!host.mapStore.isReady(map)) { skip(file.path, `its map (${map}) isn't loaded; it's updated when it is`); continue; }
      const want = propsAt(host, map, file.basename);
      const cache = host.app.metadataCache.getFileCache(file);
      if (cache && !needsWrite(readProps(cache.frontmatter), want)) continue;
      const text = await host.app.vault.cachedRead(file);
      const after = resynced(host, file.path, text, want);
      // Only values of its own differ: nothing to write; they go onto the map when the sync starts.
      if (after === text) host.hexProps?.remember(file.path, want);
      else add(file.path, text, after);
    }
  },
  replan(host, path, current) {
    const loc = host.mapStore.resolve(path);
    if (!loc || !host.mapStore.isReady(loc.map)) return current;
    return resynced(host, path, current, propsAt(host, loc.map, loc.key));
  },
  written(host, path) {
    const loc = host.mapStore.resolve(path);
    if (loc) host.hexProps?.remember(path, propsAt(host, loc.map, loc.key));
  },
};

/**
 * Switch the properties on or off. Off: the sync stops; no note is
 * touched. On: the notes that differ from the map are rewritten (backed
 * up), then the sync starts again.
 */
export async function setHexNoteProperties(plugin: HexmakerPlugin, on: boolean): Promise<void> {
  if (on === plugin.hexProps.enabled) return;
  if (on) delete plugin.settings.hexNoteProperties;
  else plugin.settings.hexNoteProperties = false;
  await plugin.saveSettings();
  plugin.hexProps.stop();
  if (!on) {
    new Notice("Hex note properties are no longer updated. Your notes keep the ones they have.", 8000);
    return;
  }
  await plugin.hexProps.memory.ready();
  const r = await runRewrite(plugin, resyncHexNoteProperties);
  await plugin.hexProps.start();
  const n = r.changed.length;
  if (r.error) new Notice(`Hex note properties: ${r.error}`, 10000);
  else if (n) new Notice(`Hex note properties updated from the map in ${n} hex note${n === 1 ? "" : "s"}. Backup: ${r.backup}`, 8000);
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
