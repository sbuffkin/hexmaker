import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  missingTerrains,
  modelToMarkdown,
  parseModelMarkdown,
  refreshShareColumn,
  shareCell,
  type HexWfcModel,
} from "../packages/hex-wfc/src";
import { exampleShares } from "../src/worldgen/shares";
import { paletteGapMessage } from "../src/worldgen/generators";

const model = (): HexWfcModel => ({
  name: "m",
  meta: { palette: "Default" },
  terrains: [
    { name: "grass", weight: 3 },
    { name: "forest", weight: 1, shape: "blob", patch: 0.05 },
    { name: "lava", weight: 0.5, near: { terrain: "volcano", distance: 1 } },
    { name: "volcano", weight: 0.5, shape: "scatter" },
  ],
  adjacency: [
    { a: "grass", b: "grass", weight: 5 },
    { a: "grass", b: "forest", weight: 1 },
    { a: "lava", b: "volcano", weight: 1 },
  ],
});

const row = (md: string, name: string) => md.split(/\r?\n/).find((l) => l.startsWith(`| ${name} |`))!;
const share = (md: string, name: string) => row(md, name).split("|").slice(1, -1).map((c) => c.trim()).pop();

// G1: a derived Share column in the Terrains table.
describe("generator note Share column (G1)", () => {
  it("shows each terrain's share by weight, the same as the generator page", () => {
    const m = model();
    const md = modelToMarkdown(m);
    expect(md).toContain("| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near | Share |");
    expect(share(md, "grass")).toBe("60%");
    expect(share(md, "forest")).toBe("20%");
    expect(share(md, "lava")).toBe("10%");
    const page = exampleShares(m);
    expect(Math.round(page.get("forest")! * 100)).toBe(20);
  });

  it("marks what the frontmatter changes: mix, counts, near", () => {
    const m = model();
    m.settings = { mix: { forest: 2 }, counts: { volcano: { min: 1, max: 3 } }, near: { lava: { terrain: "volcano", distance: 3 } } };
    const md = modelToMarkdown(m);
    // forest: 1×2 of 3 + 2 + 0.5 + 0.5 = 6 → 33%; grass 3/6 = 50%.
    expect(share(md, "forest")).toBe("20% (×2 mix → 33%)");
    expect(share(md, "grass")).toBe("60% (→ 50%)");
    expect(share(md, "volcano")).toBe("10% (→ 8%) · 1–3 patches (frontmatter)");
    expect(share(md, "lava")).toBe("10% (→ 8%) · near volcano 1 → volcano 3 (frontmatter)");
    expect(shareCell({ ...m, settings: { near: { lava: null } } }, m.terrains[2])).toBe("10% · near volcano 1 → off (frontmatter)");
    expect(shareCell({ ...m, settings: { counts: { grass: { min: 2, max: 2 } } } }, m.terrains[0])).toBe("60% · 2 patches (frontmatter)");
  });

  it("round-trips: the parser ignores the derived column", () => {
    const m = model();
    m.settings = { mix: { forest: 2 } };
    const back = parseModelMarkdown(modelToMarkdown(m), "x");
    expect(back.warnings).toEqual([]);
    expect(back.model.terrains).toEqual(m.terrains);
    expect(back.model.settings).toEqual(m.settings);
  });

  it("an older-format note (no Share column) still reads, and gets the column, nothing else changed", () => {
    const old = modelToMarkdown(model());
    // Rebuild the old table by hand to be sure of its shape.
    const oldTable = [
      "| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near | My notes |",
      "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |",
      "| grass | 3 |  |  |  |  |  |  |  | open plains |",
      "| forest | 1 | 5 | blob |  |  |  |  |  |  |",
      "| lava | 0.5 |  |  |  |  |  |  | volcano 1 |  |",
      "| volcano | 0.5 |  | scatter |  |  |  |  |  |  |",
    ];
    const start = old.indexOf("## Terrains");
    const end = old.indexOf("## Adjacency");
    const note = `${old.slice(0, start)}## Terrains\n\nPlains first.\n\n${oldTable.join("\n")}\n\n${old.slice(end)}`;
    const before = parseModelMarkdown(note, "x");
    const fresh = refreshShareColumn(note);
    expect(row(fresh, "grass")).toBe("| grass | 3 |  |  |  |  |  |  |  | open plains | 60% |");
    expect(fresh).toContain("| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near | My notes | Share |");
    expect(fresh).toContain("Plains first.");
    expect(parseModelMarkdown(fresh, "x")).toEqual(before);
    expect(refreshShareColumn(fresh)).toBe(fresh);
  });

  it("follows hand edits to the frontmatter and weights, and keeps CRLF", () => {
    const md = modelToMarkdown(model());
    const edited = md.replace("hex-wfc: 1\n", "hex-wfc: 1\nmix: \"forest 2\"\n");
    const fresh = refreshShareColumn(edited);
    expect(share(fresh, "forest")).toBe("20% (×2 mix → 33%)");
    const crlf = edited.replace(/\n/g, "\r\n");
    const freshCrlf = refreshShareColumn(crlf);
    expect(freshCrlf).toBe(fresh.replace(/\n/g, "\r\n"));
    // A hand-typed Share cell is just regenerated: it's derived.
    const typed = fresh.replace("20% (×2 mix → 33%)", "99%");
    expect(refreshShareColumn(typed)).toBe(fresh);
  });

  it("leaves non-generator text alone", () => {
    expect(refreshShareColumn("# Hello\n\n| a | b |\n| - | - |\n")).toBe("# Hello\n\n| a | b |\n| - | - |\n");
  });

  it("the shipped compat example still loads with the column added", () => {
    const text = readFileSync(path.join(process.cwd(), "tests", "fixtures", "compat", "1.5.6", "generator.md"), "utf8");
    const before = parseModelMarkdown(text, "example");
    const fresh = refreshShareColumn(text);
    expect(fresh).toContain("| Share |");
    expect(parseModelMarkdown(fresh, "example")).toEqual(before);
  });
});

// G2: terrains the palette lacks are named, not dropped silently.
describe("generator terrains missing from a palette (G2)", () => {
  it("lists each missing name and where the generator uses it", () => {
    const m = model();
    m.features = [{ terrain: "lava", from: "volcano", to: "edge", count: 1 }];
    m.paths = [{ type: "Road", from: "edge", to: "volcano", count: 1, turn: 0, length: 0.5, through: { grass: 0.8, ash: 0.2 } }];
    expect(missingTerrains(m, ["grass", "forest", "lava"])).toEqual([
      { name: "volcano", where: ["terrains", "near", "adjacency", "features", "paths"] },
      { name: "ash", where: ["paths"] },
    ]);
    expect(missingTerrains(m, ["grass", "forest", "lava", "volcano", "ash"])).toEqual([]);
  });

  it("the fit message names them", () => {
    const m = model();
    expect(paletteGapMessage(m, ["grass", "forest", "lava", "volcano"])).toBe("");
    expect(paletteGapMessage(m, ["grass", "forest"], "Limited")).toBe(
      "Not in palette Limited: lava (terrains, adjacency); volcano (terrains, near, adjacency). Generating leaves them out.",
    );
  });
});
