/**
 * World maps module, unreleased → 1.6 (owner O7): biome notes wrote their
 * swatch as `colour: "#d8e4ea"`; the key is `color:` now, like every other
 * note. Once per vault, every biome note's frontmatter `colour:` key is
 * renamed (its value as written), backed up first by the note-rewrite
 * runner (src/migrations/noteRewrites.ts). A note that has both keys is left
 * alone. `colour:` still reads forever (biomeNote.ts).
 *
 * Module-owned (the core never imports module code): contributed to the
 * notes phase through the module runtime's `noteRewrites`.
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { NoteRewrite } from "../../migrations/noteRewrites";
import { normalizeFolder } from "../../utils";

/** The note with its frontmatter `colour:` key called `color:` (unchanged when it has none, or both). */
export function renameColourKey(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return content;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (close < 0) return content;
  const fm = lines.slice(1, close);
  const at = fm.findIndex((l) => /^colour\s*:/i.test(l));
  if (at < 0 || fm.some((l) => /^color\s*:/i.test(l))) return content;
  lines[at + 1] = lines[at + 1].replace(/^colour/i, "color");
  return lines.join(eol);
}

/** The step, for the biomes folder of `plugin`. */
export function biomeColorKey(plugin: HexmakerPlugin): NoteRewrite {
  const folder = () => normalizeFolder(plugin.biomeStore?.folder() ?? "");
  return {
    info: {
      id: "unreleased-biome-colour-key-to-color",
      from: "unreleased",
      to: "1.6",
      phase: "notes",
      change: "Biome notes write their swatch as color: (it was colour:).",
      recordedBy: "noteFormatUpgrades: biome-color",
    },
    recordId: "biome-color",
    label: "color: in biome notes",
    async plan(host, add) {
      const f = folder();
      if (!f) return;
      for (const file of host.app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(f + "/")) continue;
        const text = await host.app.vault.cachedRead(file);
        if (!/^colour\s*:/im.test(text)) continue;
        add(file.path, text, renameColourKey(text));
      }
    },
    replan(_host, _path, current) {
      return renameColourKey(current);
    },
  };
}
