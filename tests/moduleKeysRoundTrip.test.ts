import { describe, it } from "node:test";
import expect from "expect";
import { buildMapNote, parseMapNote, updateMapNote, type MapNoteData } from "../src/maps/mapNote";
import type { MapNoteField } from "../src/modules/types";
import { applyTokenFrontmatter, removeTokenFrontmatter, setTokenHex } from "../src/frontmatter";
import { MemVault } from "./helpers/memVault";
import { everyModule, moduleOn } from "./helpers/slices";

/**
 * The owner syncs one vault between builds with different slices on (a
 * full build on one device, the release build on another). A build without
 * a module must keep that module's data exactly as written when it writes
 * the same notes: its map-note keys (HexmakerModule.mapNoteFields) and the
 * party keys of token notes. Part of the contract suite (npm run
 * test:slices), so each slice is checked built off as well as on.
 */

/** A sample frontmatter block for a field, as a user (or another build) wrote it. */
function sample(f: MapNoteField): { block: string; value: unknown } {
  switch (f.kind) {
    case "list": return { block: `${f.key}: ["1_1", "2_2", "3, 4"]`, value: undefined };
    case "bool": return { block: `${f.key}: false`, value: false };
    case "num": return { block: `${f.key}: 3`, value: 3 };
    case "note": return { block: `${f.key}: "[[Some note]]"`, value: undefined };
    default: return { block: `${f.key}: rings`, value: "rings" };
  }
}

const base: MapNoteData = {
  settings: { paletteName: "P", gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 } } as MapNoteData["settings"],
  hexes: new Map(),
  paths: [],
};

/** A map note with `blocks` added to its frontmatter (after the plugin's own keys). */
function noteWith(blocks: string[]): string {
  return buildMapNote("m", base).replace(/^(hexmaker-map: .*)$/m, `$1\n${blocks.join("\n")}`);
}

/** Write the note as the plugin does after a change (a hex painted). */
function rewrite(note: string): string {
  const data = parseMapNote(note)!;
  data.hexes.set("1_1", { terrain: "forest" } as never);
  return updateMapNote(note, "m", data);
}

const frontmatter = (note: string) => /^---\n([\s\S]*?)\n---/.exec(note)![1];

describe("a module's map-note keys survive a build without it", () => {
  for (const m of everyModule()) {
    const fields = m.mapNoteFields ?? [];
    if (!fields.length) continue;
    const on = moduleOn(m.id);

    it(`${m.id} (${on ? "on" : "off"}): its keys, flow and block lists, after a write`, () => {
      const blocks = fields.map((f) => sample(f).block);
      // One list written as a YAML block list, the way a hand edit (or a YAML tool) writes it.
      const list = fields.find((f) => f.kind === "list");
      if (list) blocks.push(`${list.key}-hand:\n  - "5_5"\n  - "6_6"`);
      const note = noteWith(blocks);
      const out = rewrite(rewrite(note));
      expect(out).toMatch(/^\| 1_1 \|[^\n]*\| forest \|/m);
      if (!on) {
        // Built off: each key's lines come back exactly as written (they're the user's).
        for (const b of blocks) expect(frontmatter(out)).toContain(b);
      } else {
        // Built on: the module reads them, and writes them back with the same values.
        const back = parseMapNote(out)!.settings as Record<string, unknown>;
        const first = parseMapNote(note)!.settings as Record<string, unknown>;
        for (const f of fields) {
          expect({ key: f.key, value: back[f.field] }).toEqual({ key: f.key, value: first[f.field] });
          const v = sample(f).value;
          if (v !== undefined) expect(back[f.field]).toEqual(v);
        }
        // The extra block list isn't a key it knows: kept as written.
        if (list) expect(frontmatter(out)).toContain(`${list.key}-hand:\n  - "5_5"\n  - "6_6"`);
      }
    });
  }
});

describe("the party keys of a token note survive a build that doesn't use them", () => {
  const PATH = "world/tokens/Party.md";
  async function setup() {
    const vault = new MemVault({ [PATH]: "---\ntoken: true\ntoken-hex: 2_2\ntoken-map: m\ntoken-visible: true\ntoken-party: true\ntoken-log: Sessions/Brennar\n---\n# Party\n" });
    return { vault, app: vault.app() as never };
  }
  const partyLines = (text: string) => text.split("\n").filter((l) => /^token-(party|log):/.test(l));
  const BEFORE = ["token-party: true", "token-log: Sessions/Brennar"];

  it("moving it (drag or undo) leaves them", async () => {
    const s = await setup();
    await setTokenHex(s.app, PATH, "3_2", "m");
    expect(partyLines(s.vault.files.get(PATH)!)).toEqual(BEFORE);
    expect(s.vault.files.get(PATH)).toMatch(/^token-hex: 3_2$/m);
  });

  it("saving its look without the party fields (the token form of a build without them) leaves them", async () => {
    const s = await setup();
    await applyTokenFrontmatter(s.app, PATH, { icon: "", shape: "circle", size: "lg", color: "#aa0000", border: "", description: "" });
    expect(partyLines(s.vault.files.get(PATH)!)).toEqual(BEFORE);
    expect(s.vault.files.get(PATH)).toMatch(/^token-size: lg$/m);
  });

  it("removing it and undoing that puts them back as they were", async () => {
    const s = await setup();
    const fm = s.vault.frontmatter(PATH)!;
    const look = { party: fm["token-party"] === true, logFolder: String(fm["token-log"] ?? "") };
    await removeTokenFrontmatter(s.app, PATH);
    expect(partyLines(s.vault.files.get(PATH)!)).toEqual([]);
    await applyTokenFrontmatter(s.app, PATH, { ...look, hex: "2_2", map: "m", visible: true });
    expect(partyLines(s.vault.files.get(PATH)!)).toEqual(BEFORE);
  });
});
