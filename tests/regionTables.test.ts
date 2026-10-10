import { describe, it } from "node:test";
import expect from "expect";
import {
  isRolledSection,
  mapSectionTable,
  pickSectionTable,
  starterTablePath,
  STARTER_RUMORS,
  STARTER_WEATHER,
} from "../src/regionTables";
import { appendSectionText, joinSectionText, replaceSectionText, sectionText } from "../src/sections";
import { makeTableTemplate } from "../src/utils";
import { parseRandomTable } from "../src/random-tables/randomTable";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import { ROLLED_TEXT_SECTIONS } from "../src/types";

describe("region weather / rumours tables (E2)", () => {
  const all = new Set(["t/hex.md", "t/map.md", "t/weather.md"]);
  const exists = (p: string) => all.has(p);

  it("the hex's own table wins, then the map's, then the starter", () => {
    expect(pickSectionTable({ hex: "t/hex.md", map: "t/map.md", starter: "t/weather.md" }, exists)).toEqual({ path: "t/hex.md", source: "hex" });
    expect(pickSectionTable({ hex: null, map: "t/map.md", starter: "t/weather.md" }, exists)).toEqual({ path: "t/map.md", source: "map" });
    expect(pickSectionTable({ starter: "t/weather.md" }, exists)).toEqual({ path: "t/weather.md", source: "starter" });
  });

  it("skips tables that no longer exist", () => {
    expect(pickSectionTable({ hex: "gone.md", map: "t/map.md" }, exists)).toEqual({ path: "t/map.md", source: "map" });
    expect(pickSectionTable({ map: "gone.md" }, exists)).toBeNull();
  });

  it("reads the map's table per section", () => {
    const map = { weatherTable: "t/w.md", rumorsTable: " " };
    expect(mapSectionTable(map, "weather")).toBe("t/w.md");
    expect(mapSectionTable(map, "hooks & rumors")).toBeUndefined();
    expect(mapSectionTable(undefined, "weather")).toBeUndefined();
  });

  it("starter tables live at the root of the tables folder", () => {
    expect(starterTablePath("world/tables", "weather")).toBe("world/tables/weather.md");
    expect(starterTablePath("", "hooks & rumors")).toBe("rumors.md");
  });

  it("the rolled sections are Weather and Hooks & Rumors (the hex template's headings)", () => {
    expect(ROLLED_TEXT_SECTIONS.map((s) => s.key)).toEqual(["weather", "hooks & rumors"]);
    expect(isRolledSection("weather")).toBe(true);
    expect(isRolledSection("description")).toBe(false);
  });

  it("starter tables are real, rollable tables", () => {
    for (const rows of [STARTER_WEATHER, STARTER_RUMORS]) {
      const table = parseRandomTable(makeTableTemplate(20, { "table-type": "weather" }, undefined, rows));
      expect(table.entries.map((e) => e.result)).toEqual(rows.map(([r]) => r));
    }
  });

  it("the map's tables are saved in the map note", () => {
    const note = buildMapNote("Saltmere", {
      settings: { paletteName: "Limited", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, weatherTable: "world/tables/coast weather.md", rumorsTable: "world/tables/rumors.md" },
      hexes: new Map(),
      paths: [],
    });
    expect(note).toContain("weather-table:");
    const back = parseMapNote(note)!;
    expect(back.settings.weatherTable).toBe("world/tables/coast weather.md");
    expect(back.settings.rumorsTable).toBe("world/tables/rumors.md");
  });
});

describe("Add to this hex (P2)", () => {
  const note = "# Hex 1, 2\n\n---\n### description\n*What the party sees and feels. Terrain, atmosphere, any obvious features.*\n\nOld text\n\n---\n### weather\n*Normal for region, or special (e.g. always pleasant, sandstorms, magic zone effect).*\n\n\n---\n";

  it("appends a result under the section, keeping its text and the guidance prompt", () => {
    const out = appendSectionText(note, "description", "A ruined tower");
    expect(sectionText(out, "description")).toBe("Old text\nA ruined tower");
    expect(out).toContain("*What the party sees and feels.");
  });

  it("fills an empty section", () => {
    const out = appendSectionText(note, "weather", "Fog until midday");
    expect(sectionText(out, "weather")).toBe("Fog until midday");
    expect(out).toContain("*Normal for region, or special");
  });

  it("adds the heading when the note has no such section", () => {
    const out = appendSectionText(note, "hooks & rumors", "Lights in the hills");
    expect(out).toMatch(/### hooks & rumors\nLights in the hills/);
  });

  it("ignores an empty result", () => {
    expect(appendSectionText(note, "description", "  ")).toBe(note);
  });

  it("replaceSectionText is what setSectionContent writes", () => {
    expect(sectionText(replaceSectionText(note, "description", "New"), "description")).toBe("New");
  });

  it("joinSectionText puts the addition on its own line", () => {
    expect(joinSectionText("", "a")).toBe("a");
    expect(joinSectionText("a\n", "b")).toBe("a\nb");
    expect(joinSectionText("a", "")).toBe("a");
  });
});
