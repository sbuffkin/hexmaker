/**
 * Links in generator notes (NF3 follow-up): the palette a generator was
 * learned with, the region(s) it came from and the generators a blend was
 * made from are written as links, so renaming one of those notes through
 * Obsidian updates the generator:
 *
 *   palette: "[[world/palettes/Default]]"
 *   source-map: "[[_the-coast]]"
 *   source-maps: ["[[_the-coast]]", "[[_the-north]]"]
 *   blend-of: ["[[world/generators/valley]]", "[[world/generators/deep-forest]]"]
 *
 * The older plain forms (`palette: Default`, `source-maps: a + b`) are read
 * forever. In memory (HexWfcModel.meta) the values are always plain names,
 * lists joined with " + " as before, so every reader of the meta keeps
 * working: names on read (generatorMetaNames), links on write
 * (generatorMetaLinks). A name that names no note is written as typed.
 *
 * Pure: no Obsidian imports.
 */

import { flowList, mapNameFromRef, mapNoteLink, pathLink, refBasename, refListItems } from "../noteFormats";

export const GEN_PALETTE_KEY = "palette";
export const GEN_SOURCE_MAP_KEY = "source-map";
export const GEN_SOURCE_MAPS_KEY = "source-maps";
export const GEN_BLEND_OF_KEY = "blend-of";
const JOIN = " + ";

/** Where the notes a generator names are (each undefined when there is none). */
export interface GeneratorRefNotes {
  /** A palette's note path. */
  palette?: (name: string) => string | undefined;
  /** Does the map have a map note? */
  map?: (name: string) => boolean;
  /** A generator's note path. */
  generator?: (name: string) => string | undefined;
}

/** The meta with every reference read as a plain name (lists joined with " + "). */
export function generatorMetaNames(meta: Record<string, string>): Record<string, string> {
  const out = { ...meta };
  if (out[GEN_PALETTE_KEY] !== undefined) out[GEN_PALETTE_KEY] = refBasename(out[GEN_PALETTE_KEY]);
  if (out[GEN_SOURCE_MAP_KEY] !== undefined) out[GEN_SOURCE_MAP_KEY] = mapNameFromRef(out[GEN_SOURCE_MAP_KEY]);
  if (out[GEN_SOURCE_MAPS_KEY] !== undefined) out[GEN_SOURCE_MAPS_KEY] = refListItems(out[GEN_SOURCE_MAPS_KEY]).map(mapNameFromRef).filter(Boolean).join(JOIN);
  if (out[GEN_BLEND_OF_KEY] !== undefined) out[GEN_BLEND_OF_KEY] = refListItems(out[GEN_BLEND_OF_KEY]).map(refBasename).filter(Boolean).join(JOIN);
  return out;
}

const mapLink = (notes: GeneratorRefNotes) => (name: string): string | undefined =>
  notes.map?.(name) ? linkOr(mapNoteLink(name)) : undefined;
const notePathLink = (find: ((name: string) => string | undefined) | undefined) => (name: string): string | undefined => {
  const link = pathLink(find?.(name));
  return link && refBasename(link) === name ? link : undefined;
};
const linkOr = (s: string) => (s.startsWith("[[") ? s : undefined);

/** The meta to write: names that have a note become links to it (lists as flow lists). */
export function generatorMetaLinks(meta: Record<string, string>, notes: GeneratorRefNotes): Record<string, string> {
  const out = { ...meta };
  const one = (key: string, link: (name: string) => string | undefined) => {
    const v = out[key];
    if (!v || v.startsWith("[")) return;
    const l = link(v.trim());
    if (l) out[key] = l;
  };
  const many = (key: string, link: (name: string) => string | undefined) => {
    const v = out[key];
    if (!v || v.startsWith("[")) return;
    const names = v.split(JOIN).map((s) => s.trim()).filter(Boolean);
    const items = names.map((n) => link(n) ?? n);
    if (items.some((x, i) => x !== names[i])) out[key] = flowList(items);
  };
  one(GEN_PALETTE_KEY, notePathLink(notes.palette));
  one(GEN_SOURCE_MAP_KEY, mapLink(notes));
  many(GEN_SOURCE_MAPS_KEY, mapLink(notes));
  many(GEN_BLEND_OF_KEY, notePathLink(notes.generator));
  return out;
}
