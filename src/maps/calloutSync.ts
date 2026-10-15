/**
 * Phase 2 of the hex-note Map data callout (src/hexMapData.ts): hand edits
 * to Terrain, Region or Name go to the map, then the callout is rewritten.
 * Split from HexmakerPlugin so it can be tested on a small host.
 */
import { Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { mapDataLines, mapDataSyncMessage, moveBodyFieldsIntoMapData, oldFieldLine, planCalloutImport, setMapData, shownValues } from "../hexMapData";
import { lockedHint } from "../workMode";
import { sameName, takeBodyFields } from "../hexBodyFields";
import { hexKey } from "../hexKey";

/** What syncHexMapData needs from the plugin. */
export type CalloutSyncHost = Pick<HexmakerPlugin,
  "app" | "hexPath" | "mapLabel" | "calloutMemory" | "hexMapDataView" | "getMapPalette" | "undoableEdit" | "setHexName" | "syncHexEncounterTableLink" | "mapStore">;

export interface CalloutSyncResult {
  wrote: boolean;
  /** Edits put on the map ("Terrain: swamp"). */
  applied: string[];
  /** Edits that weren't, each with why. */
  notApplied: string[];
  /** Callout lines that couldn't be read. */
  unreadable: string[];
  /** Old "**Terrain:**" / "**Region:**" body lines moved into the callout ("Old terrain: forest"). */
  moved: string[];
}

/** See HexmakerPlugin.syncHexMapData. */
export async function syncHexMapData(
  host: CalloutSyncHost, mapName: string, x: number, y: number, opts: { insert?: boolean; quiet?: boolean } = {},
): Promise<CalloutSyncResult> {
  const out = { wrote: false, applied: [] as string[], notApplied: [] as string[], unreadable: [] as string[], moved: [] as string[] };
  const path = host.hexPath(x, y, mapName);
  const file = host.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return out;
  await host.calloutMemory.ready();
  // Read first: most notes need nothing, and a no-op process() still writes.
  const current = await host.app.vault.read(file);
  const now = () => shownValues(mapDataLines(host.hexMapDataView(mapName, x, y)));
  const plan = planCalloutImport(current, host.calloutMemory.get(path), now());
  // Old "**Terrain:**" / "**Region:**" body lines move into the callout (NF2),
  // which is added for them when the note has none.
  const hasOldLines = takeBodyFields(current).taken.length > 0;
  // No callout and none to add: nothing to do.
  if (!plan && !opts.insert && !hasOldLines) return out;
  if (plan) {
    out.notApplied.push(...plan.notApplied);
    out.unreadable.push(...plan.unreadable);
    const edits = Object.entries(plan.apply) as [keyof typeof plan.apply, string | null][];
    if (edits.length) {
      await host.undoableEdit(mapName, async () => {
        const key = hexKey(x, y);
        for (const [field, value] of edits) {
          const shown = `${field[0].toUpperCase()}${field.slice(1)}: ${value ?? "—"}`;
          if (field === "name") {
            await host.setHexName(mapName, x, y, value ?? "");
            out.applied.push(shown);
          } else if (field === "terrain") {
            // A terrain must be one the map's palette has (matched ignoring case).
            const terrain = value === null ? null : host.getMapPalette(mapName).find((t) => sameName(t.name, value))?.name;
            if (terrain === undefined) { out.notApplied.push(`${shown} (not in this map's palette)`); continue; }
            if (!host.mapStore.set(mapName, key, { terrain }, "paint-terrain")) { out.notApplied.push(`${shown} (${lockedHint("paint-terrain")})`); continue; }
            await host.syncHexEncounterTableLink(path, terrain);
            out.applied.push(shown);
          } else {
            if (!host.mapStore.set(mapName, key, { region: value }, "paint-region-area")) { out.notApplied.push(`${shown} (${lockedHint("paint-region-area")})`); continue; }
            out.applied.push(shown);
          }
        }
      });
    }
  }
  const view = host.hexMapDataView(mapName, x, y);
  const notes = [...out.notApplied.map((s) => `Not applied: ${s}`), ...out.unreadable.map((s) => `Not read: ${s}`)];
  const rewrite = (content: string) => {
    const m = moveBodyFieldsIntoMapData(content, view);
    return { next: setMapData(m.content, view, opts.insert, notes), moved: m.moved.map(oldFieldLine) };
  };
  const latest = await host.app.vault.read(file);
  if (rewrite(latest).next !== latest) {
    await host.app.vault.process(file, (content) => {
      const r = rewrite(content);
      out.wrote = r.next !== content;
      out.moved = r.moved;
      return r.next;
    });
  }
  // Remember what the callout shows now, so the next edit is told from a stale copy.
  if (plan || opts.insert || out.moved.length) host.calloutMemory.set(path, now());
  if (!opts.quiet) {
    const msg = mapDataSyncMessage(`${host.mapLabel(mapName)} ${x}, ${y}`, out);
    if (msg) new Notice(msg, 8000);
  }
  return out;
}
