/**
 * Unreleased → 1.6 (owner MG4): moving map data into map notes left hex
 * notes with only `map: "[[_<map>]]"`, so Dataview, Bases and search on
 * `terrain:` / `region:` found nothing. Hex notes get their hex's terrain,
 * area, icon and name back as properties (copies of the map note's data,
 * kept up to date by src/maps/hexPropsSync.ts; `region:` becomes `area:`).
 *
 * A 1.5.x vault keeps its `terrain:` / `icon:` keys through the map-note
 * move (cleanHexNotes in v1.5-map-data-to-map-notes.ts writes them in the
 * same pass), so this step only has work in vaults upgraded by an
 * unreleased build, and in notes added since. A note's own `name:` or
 * `area:` the map lacks is left as it is (the sync takes it onto the map,
 * hexProps.ts). Skipped when the setting is off.
 */
import { needsWrite, propsOf, readProps, setPropsInText, type HexProps, type PropField } from "../maps/hexProps";
import { notePropsOfText } from "../maps/hexPropsSync";
import { hexNotes, type NoteFormatHost, type NoteRewrite } from "./noteRewrites";

/** The note's text with the properties its hex has (its own values the map lacks kept). */
export function withHexProps(text: string, props: HexProps): string {
  const note = notePropsOfText(text);
  const keep = (Object.keys(note.props) as PropField[]).filter((f) => !props[f]);
  return setPropsInText(text, props, keep);
}

function propsAt(host: NoteFormatHost, map: string, key: string): HexProps {
  return propsOf(host.mapStore.get?.(map, key));
}

export const hexNoteProperties: NoteRewrite = {
  info: {
    id: "unreleased-hex-note-properties",
    from: "unreleased",
    to: "1.6",
    phase: "notes",
    change: "Hex notes show their hex's terrain, area, icon and name as properties again (copies of the map note's data, for Dataview, Bases and search).",
    recordedBy: "noteFormatUpgrades: hex-properties",
  },
  recordId: "hex-properties",
  label: "terrain, area, icon and name properties in hex notes",
  async plan(host, add, skip) {
    if (host.settings.hexNoteProperties === false || !host.mapStore.get) return;
    for (const { file, map } of hexNotes(host)) {
      if (!host.mapStore.isReady(map)) { skip(file.path, `its map (${map}) isn't loaded; its properties are added when it is`); continue; }
      const props = propsAt(host, map, file.basename);
      // Most notes can be told from the metadata cache without a read.
      const cache = host.app.metadataCache.getFileCache(file);
      if (cache && !needsWrite(readProps(cache.frontmatter), props)) continue;
      const text = await host.app.vault.cachedRead(file);
      add(file.path, text, withHexProps(text, props));
    }
  },
  replan(host, path, current) {
    const loc = host.mapStore.resolve(path);
    if (!loc || !host.mapStore.isReady(loc.map)) return current;
    return withHexProps(current, propsAt(host, loc.map, loc.key));
  },
  written(host, path) {
    const loc = host.mapStore.resolve(path);
    if (loc) host.hexProps?.remember(path, propsAt(host, loc.map, loc.key));
  },
};

export const info = hexNoteProperties.info;
