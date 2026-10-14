/**
 * 1.5.x → 1.6 (NF2): older hex templates had filled `**Terrain:**` /
 * `**Region:**` lines in the note body. They move into the note's Map data
 * callout as "Old terrain:" / "Old region:" lines; the map keeps its own
 * values (a moved line never changes the map). A hex whose map isn't
 * loaded is skipped: its lines move when the note is next opened.
 */
import { mapDataLines, moveBodyFieldsIntoMapData, shownValues } from "../hexMapData";
import { takeBodyFields } from "../hexBodyFields";
import { hexNotes, type NoteRewrite } from "./noteRewrites";

export const hexBodyLines: NoteRewrite = {
  info: {
    id: "v1.5-hex-body-lines",
    from: "1.5.x",
    to: "1.6",
    phase: "notes",
    change: "Filled Terrain and Region lines in hex notes moved into the note's Map data box as \"Old terrain\" and \"Old region\".",
    recordedBy: "noteFormatUpgrades: hex-body-lines",
  },
  recordId: "hex-body-lines",
  label: "old Terrain/Region lines moved into Map data",
  async plan(host, add, skip) {
    for (const { file, map, x, y } of hexNotes(host)) {
      const text = await host.app.vault.cachedRead(file);
      if (!/\*\*(terrain|region)/i.test(text) || !takeBodyFields(text).taken.length) continue;
      // The callout shows the map's values: a map that isn't loaded can't say them.
      if (!host.mapStore.isReady(map)) { skip(file.path, `its map (${map}) isn't loaded; the lines move when the note is next opened`); continue; }
      add(file.path, text, moveBodyFieldsIntoMapData(text, host.hexMapDataView(map, x, y)).content);
    }
  },
  replan(host, path, current) {
    const loc = host.mapStore.resolve(path);
    if (!loc || !host.mapStore.isReady(loc.map)) return current;
    const [x, y] = loc.key.split("_").map(Number);
    return moveBodyFieldsIntoMapData(current, host.hexMapDataView(loc.map, x, y)).content;
  },
  written(host, path) {
    if (!host.calloutMemory) return;
    // What the callout shows now, so a later hand edit is told from it.
    const loc = host.mapStore.resolve(path);
    if (loc) {
      const [x, y] = loc.key.split("_").map(Number);
      host.calloutMemory.set(path, shownValues(mapDataLines(host.hexMapDataView(loc.map, x, y))));
    }
  },
};

export const info = hexBodyLines.info;
