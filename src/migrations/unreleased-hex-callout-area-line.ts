/**
 * Unreleased → 1.6 (owner MG5): the Map data box in hex notes said
 * `> Region: Dustbowl` for the hex's named zone; zones are areas now, so the
 * line becomes `> Area: Dustbowl`. Only that line inside the plugin's
 * `[!hexmaker]` box changes, its value as written; "Old region:" lines (a
 * 1.5 note's own words) stay. The box is rewritten the same way whenever a
 * hex note is opened; this step does every hex note once, backed up.
 * "Region:" still reads as the area forever (hexMapData.ts).
 */
import { hexNotes, type NoteRewrite } from "./noteRewrites";

/** The note with its Map data box's `Region:` line called `Area:` (unchanged when there's none). */
export function renameCalloutRegionLine(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^\s*>\s*\[!hexmaker\]/i.test(l));
  if (start < 0) return content;
  let changed = false;
  for (let i = start + 1; i < lines.length && /^\s*>/.test(lines[i]); i++) {
    const m = /^(\s*>\s*)region(\s*:.*)$/i.exec(lines[i]);
    if (!m) continue;
    lines[i] = `${m[1]}Area${m[2]}`;
    changed = true;
  }
  return changed ? lines.join(eol) : content;
}

export const hexCalloutAreaLine: NoteRewrite = {
  info: {
    id: "unreleased-hex-callout-area-line",
    from: "unreleased",
    to: "1.6",
    phase: "notes",
    change: "The Map data box in hex notes says Area for the hex's named zone (it said Region).",
    recordedBy: "noteFormatUpgrades: area-line",
  },
  recordId: "area-line",
  label: "Area lines in hex notes' Map data",
  async plan(host, add) {
    for (const { file } of hexNotes(host)) {
      const text = await host.app.vault.cachedRead(file);
      if (!/\[!hexmaker\]/i.test(text)) continue;
      add(file.path, text, renameCalloutRegionLine(text));
    }
  },
  replan(_host, _path, current) {
    return renameCalloutRegionLine(current);
  },
};

export const info = hexCalloutAreaLine.info;
