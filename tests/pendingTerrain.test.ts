import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { TFile, type App } from "obsidian";
import { clearPendingTerrain, getTerrainFromFile, notePendingTerrain, pendingTerrainOf } from "../src/frontmatter";
import { insertLinkInSection } from "../src/sections";

/**
 * Regression: creating a map writes every hex note and opens the map
 * straight away. Obsidian indexes the notes over the next seconds (tens of
 * seconds on a large vault), so the first render read no terrain for most
 * hexes, and nothing re-rendered afterwards: the map stayed mostly blank.
 * Terrain the plugin just wrote is now read from memory until indexed.
 */

const PATH = "world/hexes/m/1_2.md";

/** App whose metadata cache has (or hasn't yet) indexed one note. */
function appWith(frontmatter: Record<string, unknown> | undefined): App {
  const file = Object.create(TFile.prototype) as TFile;
  file.path = PATH;
  return {
    vault: { getAbstractFileByPath: (p: string) => (p === PATH ? file : null) },
    metadataCache: { getFileCache: () => (frontmatter ? { frontmatter } : null) },
  } as unknown as App;
}

describe("terrain of notes not indexed yet", () => {
  afterEach(() => clearPendingTerrain());

  it("is read from memory until the metadata cache has the note", () => {
    notePendingTerrain(PATH, "Forest");
    expect(getTerrainFromFile(appWith(undefined), PATH)).toBe("Forest");
    expect(pendingTerrainOf(PATH)).toBe("Forest");
  });

  it("the indexed frontmatter wins once it's there", () => {
    notePendingTerrain(PATH, "Forest");
    expect(getTerrainFromFile(appWith({ terrain: "Water" }), PATH)).toBe("Water");
  });

  it("is forgotten when cleared (on the note's metadata change)", () => {
    notePendingTerrain(PATH, "Forest");
    clearPendingTerrain(PATH);
    expect(getTerrainFromFile(appWith(undefined), PATH)).toBeNull();
  });
});

describe("insertLinkInSection", () => {
  it("adds the link under an existing heading, once", () => {
    const note = "---\nterrain: grass\n---\n\n### Encounters Table\n\n### Notes\n";
    const once = insertLinkInSection(note, "Encounters Table", "[[grass]]");
    expect(once).toMatch(/### Encounters Table\n+\[\[grass\]\]/);
    expect(once.indexOf("[[grass]]")).toBeLessThan(once.indexOf("### Notes"));
    expect(insertLinkInSection(once, "Encounters Table", "[[grass]]")).toBe(once);
  });

  it("appends the heading when the note doesn't have it", () => {
    expect(insertLinkInSection("# Hex\n", "Encounters Table", "[[grass]]")).toBe("# Hex\n\n### Encounters Table\n\n[[grass]]\n");
  });
});
