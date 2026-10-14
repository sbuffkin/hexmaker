import { describe, it } from "node:test";
import expect from "expect";
import {
  dataFormatOf,
  isMapNoteText,
  KNOWN_DATA_FORMAT,
  newerDataFrom,
  newerDataMessage,
} from "../src/dataStamp";
import { hasNewerMapNotes, isMapNotePath, type ReadOnlyAdapter } from "../src/safetyMode";

describe("data stamp", () => {
  it("this build knows format 1 only", () => {
    expect(KNOWN_DATA_FORMAT).toBe(1);
  });

  it("no stamp (1.5.x and earlier) is format 1", () => {
    expect(dataFormatOf({})).toBe(1);
    expect(dataFormatOf(null)).toBe(1);
    expect(dataFormatOf({ dataFormat: "junk" })).toBe(1);
    expect(dataFormatOf({ dataFormat: 0 })).toBe(1);
    expect(newerDataFrom({})).toBeNull();
    expect(newerDataFrom({ dataFormat: 1, savedWith: "1.5.6" })).toBeNull();
  });

  it("dataFormat 2 or more means a newer version wrote it", () => {
    expect(newerDataFrom({ dataFormat: 2, savedWith: "1.6.0" })).toEqual({
      format: 2,
      savedWith: "1.6.0",
      source: "data.json",
    });
    expect(newerDataFrom({ dataFormat: "3" })).toEqual({ format: 3, savedWith: null, source: "data.json" });
  });

  it("the message names the version when savedWith says it", () => {
    const withVersion = newerDataMessage({ format: 2, savedWith: "1.6.0", source: "data.json" });
    expect(withVersion).toContain("updated by a newer Hexmap World Creator (version 1.6.0)");
    expect(withVersion).toContain("Update this device's plugin");
    expect(withVersion).toContain("won't change your map data");
    expect(newerDataMessage({ format: 2, savedWith: null, source: "map note" })).not.toContain("(version");
  });
});

describe("map notes from a newer version", () => {
  it("reads hexmaker-map: <number> in frontmatter", () => {
    expect(isMapNoteText("---\nhexmaker-map: 6\npalette: Default\n---\n# Coast\n")).toBe(true);
    expect(isMapNoteText("﻿---\r\nhexmaker-map: \"2\"\r\n---\r\n")).toBe(true);
  });

  it("ignores hex notes linking a map under the same key, and body text", () => {
    expect(isMapNoteText('---\nhexmaker-map: "[[_coast]]"\n---\n')).toBe(false);
    expect(isMapNoteText("---\nterrain: forest\n---\nhexmaker-map: 6\n")).toBe(false);
    expect(isMapNoteText("hexmaker-map: 6")).toBe(false);
  });

  it("only _name.md one folder down from the hex folder is a map note path", () => {
    expect(isMapNotePath("world/hexes/coast/_coast.md", "world/hexes")).toBe(true);
    expect(isMapNotePath("world/hexes/coast/3_4.md", "world/hexes")).toBe(false);
    expect(isMapNotePath("world/hexes/_coast.md", "world/hexes")).toBe(false);
    expect(isMapNotePath("other/coast/_coast.md", "world/hexes")).toBe(false);
    expect(isMapNotePath("world/hexes/coast/_coast.md", "")).toBe(false);
  });

  const adapter = (files: Record<string, string>): ReadOnlyAdapter => {
    const folders = new Set<string>();
    for (const p of Object.keys(files)) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    const children = (dir: string) => [...Object.keys(files), ...folders].filter(
      (p) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/"),
    );
    return {
      exists: (p) => Promise.resolve(p in files || folders.has(p)),
      list: (p) => Promise.resolve({
        files: children(p).filter((c) => c in files),
        folders: children(p).filter((c) => folders.has(c)),
      }),
      read: (p) => Promise.resolve(files[p]),
    };
  };

  it("finds a newer map note in the hex folder", async () => {
    const a = adapter({
      "world/hexes/coast/3_4.md": "---\nterrain: forest\n---\n",
      "world/hexes/coast/_coast.md": "---\nhexmaker-map: 6\n---\n",
    });
    expect(await hasNewerMapNotes(a, "world/hexes")).toBe(true);
  });

  it("a 1.5.x vault has none (and _ notes without the marker don't count)", async () => {
    const a = adapter({
      "world/hexes/default/3_4.md": "---\nterrain: forest\n---\n",
      "world/hexes/default/_notes.md": "---\ntags: gm\n---\n",
    });
    expect(await hasNewerMapNotes(a, "world/hexes")).toBe(false);
    expect(await hasNewerMapNotes(a, "missing")).toBe(false);
    expect(await hasNewerMapNotes(a, "")).toBe(false);
  });
});
