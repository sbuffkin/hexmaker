/**
 * Unreleased → 1.6 (NF1): hex notes linked their map note under
 * `hexmaker-map: "[[_coast]]"`; the key becomes `map:`. A note that uses
 * `map:` for something of its own is left alone and listed in the notice.
 * Readers accept both keys forever (noteFormats.ts).
 */
import { renameHexMapKey } from "../noteFormats";
import { hexNotes, mayHave, type NoteRewrite } from "./noteRewrites";

export const hexMapKey: NoteRewrite = {
  info: {
    id: "v1.5-hex-map-key",
    from: "unreleased",
    to: "1.6",
    phase: "notes",
    change: "Hex notes link their map note under map: (it was hexmaker-map:).",
    recordedBy: "noteFormatUpgrades: hex-map-key",
  },
  recordId: "hex-map-key",
  label: "map: links in hex notes",
  async plan(host, add, skip) {
    for (const { file } of hexNotes(host)) {
      if (!mayHave(host, file, ["hexmaker-map"])) continue;
      const text = await host.app.vault.cachedRead(file);
      if (!/hexmaker-map/.test(text)) continue;
      const r = renameHexMapKey(text);
      if (r.status === "conflict") skip(file.path, "it uses map: for something else, so its link stays under hexmaker-map:");
      else add(file.path, text, r.content);
    }
  },
  replan(_host, _path, current) {
    const r = renameHexMapKey(current);
    return r.status === "renamed" ? r.content : current;
  },
};

export const info = hexMapKey.info;
