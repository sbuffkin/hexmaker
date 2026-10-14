/**
 * Owner MG5 + O7: a map's named zones are areas; maps are regions and
 * locations. Stored names: the Hexes table's Area column, `> Area:` in hex
 * notes' Map data, `show-area-overlay`, the `areas` folder for new vaults,
 * `color:` in biome notes and `on-arrival: make submaps`. Every old name
 * still reads.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { MAP_NOTE_FORMAT, parseMapNote, updateMapNote, buildMapNote } from "../src/maps/mapNote";
import { mapDataLines, readMapData, shownValues, planCalloutImport } from "../src/hexMapData";
import { renameCalloutRegionLine } from "../src/migrations/unreleased-hex-callout-area-line";
import { upgradeMapSettings } from "../src/migrations/map-note-5-to-6-area-names";
import { renameColourKey } from "../src/overworld/migrations/biome-colour-key-to-color";
import { buildBiomeNote, parseBiomeNote, updateBiomeNote } from "../src/overworld/biomeNote";
import { ARRIVAL_MODE_WORDS, parseArrivalMode } from "../src/arrival/arrival";
import { migrateMapData } from "../src/compat";
import { CONTENT_FOLDER_DEFAULTS, pickerFolders } from "../src/notePickers";

const FORMAT_5 = readFileSync("tests/fixtures/compat/map-note-formats/format-5.md", "utf8").replace(/\r\n/g, "\n");

describe("MG5: map notes (format 6)", () => {
  it("reads a format-5 note: Region column, show-region-overlay, make places", () => {
    const d = parseMapNote(FORMAT_5)!;
    expect(d.format).toBe(5);
    expect(d.hexes.get("3_4")?.region).toBe("Basin");
    expect(d.settings.showRegionOverlay).toBe(false);
    expect(d.settings.arrivalMode).toBe("make places");
    expect(parseArrivalMode(d.settings.arrivalMode)).toBe("make");
  });

  it("writes it back with the new names, keeping every value", () => {
    const d = parseMapNote(FORMAT_5)!;
    expect(upgradeMapSettings(d.settings)).toBe(true);
    const out = updateMapNote(FORMAT_5, "coast", d);
    expect(MAP_NOTE_FORMAT).toBe(6);
    expect(out).toMatch(/^hexmaker-map: 6$/m);
    expect(out).toContain("| Hex | Name | Terrain | Icon | GM icons | Area | Locations | Locked |");
    expect(out).not.toMatch(/\| Region \|/);
    expect(out).toMatch(/^show-area-overlay: false$/m);
    expect(out).not.toContain("show-region-overlay");
    expect(out).toMatch(/^on-arrival: make submaps$/m);
    expect(out).toContain("- **Areas:** [[Basin]] (1 hex)");
    expect(out).toContain("*Area* links the area's note");
    expect(out).not.toContain("*Region* links the region's note");
    const back = parseMapNote(out)!;
    expect(back.hexes).toEqual(d.hexes);
    expect(back.settings.showRegionOverlay).toBe(false);
    expect(back.paths).toEqual(d.paths);
  });

  it("a hand-typed Region or Area column both read as the area; Region map stays a map", () => {
    const note = (col: string) => `---\nhexmaker-map: 6\n---\n# m\n\n## Hexes\n\n| Hex | Terrain | ${col} | Region map |\n| --- | --- | --- | --- |\n| 1_1 | forest | [[Basin]] | [[_m-1-1]] |\n`;
    for (const col of ["Area", "Region", "area", "Areas"]) {
      const h = parseMapNote(note(col))!.hexes.get("1_1")!;
      expect(h.region).toBe("Basin");
      expect(h.regionMap).toBe("m-1-1");
    }
  });

  it("new notes are written in the new names", () => {
    const out = buildMapNote("m", { settings: { showRegionOverlay: false, arrivalMode: ARRIVAL_MODE_WORDS.make }, hexes: new Map([["0_0", { region: "Basin" }]]), paths: [] });
    expect(out).toMatch(/^show-area-overlay: false$/m);
    expect(out).toMatch(/^on-arrival: make submaps$/m);
    expect(out).toMatch(/\| Area \|/);
  });

  it("data.json's map entries: make places becomes make submaps; other words stay", () => {
    expect(migrateMapData({ name: "w", arrivalMode: "Make places" }).arrivalMode).toBe("make submaps");
    expect(migrateMapData({ name: "w", arrivalMode: "generate" }).arrivalMode).toBe("generate");
    expect(ARRIVAL_MODE_WORDS.make).toBe("make submaps");
  });
});

describe("MG5: hex notes' Map data box", () => {
  const view = { map: "coast", mapLabel: "Coast", x: 1, y: 2, terrain: "forest", region: "Basin" };

  it("says Area, and reads Area or Region as the same field", () => {
    expect(mapDataLines(view)).toContain("> Area: Basin");
    expect(readMapData("> [!hexmaker] Map data\n> Area: Basin\n")).toEqual({ region: "Basin" });
    expect(readMapData("> [!hexmaker] Map data\n> Region: [[Basin]]\n")).toEqual({ region: "Basin" });
    expect(shownValues(["> Region: Basin"])).toEqual(shownValues(["> Area: Basin"]));
  });

  it("a box shown with Region before still tells a hand edit from the map's value", () => {
    const shownBefore = shownValues(["> Region: Basin", "> Terrain: forest"]);
    const now = shownValues(mapDataLines(view));
    const note = "> [!hexmaker] Map data\n> Terrain: forest\n> Area: Dustbowl\n";
    expect(planCalloutImport(note, shownBefore, now)!.apply).toEqual({ region: "Dustbowl" });
    const unchanged = "> [!hexmaker] Map data\n> Terrain: forest\n> Area: Basin\n";
    expect(planCalloutImport(unchanged, shownBefore, now)!.apply).toEqual({});
  });

  it("the one-time rewrite renames only the box's Region line, keeping its value and line endings", () => {
    const note = "---\nmap: \"[[_coast]]\"\n---\n# Hex\n\n> [!hexmaker] Map data\n> Map: [[_coast|Coast]], hex 1, 2\n> Region: [[Basin]]\n> Old region: [[Dustbowl]]\n\nRegion: my own words\n";
    const out = renameCalloutRegionLine(note);
    expect(out).toContain("> Area: [[Basin]]");
    expect(out).toContain("> Old region: [[Dustbowl]]");
    expect(out).toContain("\nRegion: my own words\n");
    expect(renameCalloutRegionLine(out)).toBe(out);
    expect(renameCalloutRegionLine("# no box\n> Region: x\n")).toBe("# no box\n> Region: x\n");
    expect(renameCalloutRegionLine(note.replace(/\n/g, "\r\n"))).toBe(out.replace(/\n/g, "\r\n"));
  });
});

describe("O7: biome notes write color:", () => {
  const fields = { id: "taiga", label: "Taiga", color: "#d8e4ea", mix: [{ type: "forest", weight: 1 }], transitions: [] };

  it("new notes write color:, and colour: still reads", () => {
    const note = buildBiomeNote(fields);
    expect(note).toMatch(/^color: "#d8e4ea"$/m);
    expect(note).not.toMatch(/^colour:/m);
    expect(parseBiomeNote(note.replace(/^color:/m, "colour:"), "Taiga").fields.color).toBe("#d8e4ea");
  });

  it("an update keeps a hand-written colour: line when the value is the same (no churn)", () => {
    const old = buildBiomeNote(fields).replace(/^color:/m, "colour:");
    expect(updateBiomeNote(old, fields)).toBe(old);
  });

  it("the one-time rewrite renames the key in the frontmatter only", () => {
    const old = "---\nid: taiga\ncolour: \"#d8e4ea\"\n---\n# Taiga\n\ncolour: words in the body\n";
    const out = renameColourKey(old);
    expect(out).toBe("---\nid: taiga\ncolor: \"#d8e4ea\"\n---\n# Taiga\n\ncolour: words in the body\n");
    expect(renameColourKey(out)).toBe(out);
    // Both keys: left for the user.
    const both = "---\ncolour: red\ncolor: blue\n---\n";
    expect(renameColourKey(both)).toBe(both);
  });
});

describe("MG5: the areas folder", () => {
  it("new vaults use <world>/areas; a blank setting also lists the old regions folder", () => {
    expect(CONTENT_FOLDER_DEFAULTS.regionsFolder).toBe("areas");
    expect(pickerFolders({ worldFolder: "World" }, "token")).toEqual(expect.arrayContaining(["World/areas", "World/regions"]));
    expect(pickerFolders({ worldFolder: "World", regionsFolder: "World/regions" }, "token")).not.toContain("World/areas");
    const wizard = readFileSync("src/SetupWizardView.ts", "utf8");
    expect(wizard).toMatch(/key: "regionsFolder",\s+label: "Areas",\s+suffix: "areas"/);
    const tab = readFileSync("src/HexmakerSettingTab.ts", "utf8");
    expect(tab).toContain('["regionsFolder", `${world}/areas`]');
  });
});
