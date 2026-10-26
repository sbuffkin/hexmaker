/**
 * End-to-end integration test for the map → PDF builder (1.4).
 * Drives the real `buildMapPdfMarkdown` against the simulated vault to
 * exercise the section subdivision + per-section hex row collection +
 * `computeSubdivisions` / `enumerateSections` together.
 *
 * The actual PDF + PNG rendering pipeline is tested separately by the
 * chromium-driver integration test.
 */

import { describe, it, before, after } from "node:test";
import expect from "expect";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { MockHexmakerPlugin } from "../helpers/simVault";
import {
  buildMapPdfMarkdown,
  computeSubdivisions,
  enumerateSections,
} from "../../src/export/exporters/mapWithTable";

let tmpDir: string;
let plugin: MockHexmakerPlugin;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "duckmage-e2e-map-"));
  plugin = new MockHexmakerPlugin(tmpDir);
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("e2e: map → PDF builder against sim-vault", () => {
  it("produces a 1×1 layout for the small 3×2 sim-vault map", () => {
    // 3×2 grid fits well within any sensible page area at minHexPxOnPage = 60.
    const layout = computeSubdivisions({
      gridCols: 3,
      gridRows: 2,
      pageWidthPx: 950,
      pageHeightPx: 360,
      minHexPxOnPage: 60,
    });
    expect(layout.colSections).toBe(1);
    expect(layout.rowSections).toBe(1);
  });

  it("buildMapPdfMarkdown emits cover + TOC + one section page with hex rows", async () => {
    const placeholderUri = "data:image/png;base64,AAA";
    const layout = computeSubdivisions({
      gridCols: 3,
      gridRows: 2,
      pageWidthPx: 950,
      pageHeightPx: 360,
      minHexPxOnPage: 60,
    });
    const sections = enumerateSections(layout, { cols: 3, rows: 2 });

    const md = await buildMapPdfMarkdown(
      plugin as never,
      "the-coast",
      placeholderUri,
      sections,
      // One placeholder uri per section (1×1 = 1 section)
      sections.map(() => placeholderUri),
    );

    // Cover
    expect(md).toMatch(/^# the-coast/m);
    expect(md).toMatch(/duckmage-pdf-fullmap/);

    // TOC table
    expect(md).toMatch(/## Section index/);
    expect(md).toMatch(/\| Section \| Hex range/);
    expect(md).toMatch(/\*\*A1\*\*/);

    // Section page heading + cropped image + reference table header
    expect(md).toMatch(/## Section A1/);
    expect(md).toMatch(/duckmage-pdf-sectionmap/);
    expect(md).toMatch(
      /\| Hex \| Terrain \| Towns \| Dungeons \| Features \| Quests \| Factions \| Encounters \| Description \|/,
    );

    // All six hexes appear — even 2,0 (only terrain: mountain) and 2,1 (only
    // terrain: hills) get a row because terrain alone counts as "populated".
    expect(md).toMatch(/\| 0,0 \| shallows/);
    expect(md).toMatch(/\| 1,0 \| forest/);
    expect(md).toMatch(/\| 0,1 \| ocean/);
    expect(md).toMatch(/\| 1,1 \| grass/);
    expect(md).toMatch(/\| 2,0 \| mountain/);
    expect(md).toMatch(/\| 2,1 \| hills/);

    // Notable cell content (joined basenames)
    expect(md).toMatch(/Saltwatch/);
    expect(md).toMatch(/The Old Spire/);
    expect(md).toMatch(/Standing Stone/);
    expect(md).toMatch(/The Reach/);
    expect(md).toMatch(/forest-encounters/);

    // Description excerpts (frontmatter not leaked, wikilinks stripped)
    expect(md).toMatch(/Calm shallow water/);
    expect(md).toMatch(/Dense pine forest/);
  });

  it("As the party has seen it (HF11 fog): a hidden hex gets no row, so its notes stay out of the handout", async () => {
    const placeholderUri = "data:image/png;base64,AAA";
    const layout = computeSubdivisions({ gridCols: 3, gridRows: 2, pageWidthPx: 950, pageHeightPx: 360, minHexPxOnPage: 60 });
    const sections = enumerateSections(layout, { cols: 3, rows: 2 });
    const md = await buildMapPdfMarkdown(plugin as never, "the-coast", placeholderUri, sections, sections.map(() => placeholderUri), undefined, (hex) => hex === "1_0");
    expect(md).not.toMatch(/\| 1,0 \| forest/);
    expect(md).not.toMatch(/Dense pine forest/);
    expect(md).toMatch(/\| 0,0 \| shallows/);
  });

  it("the palette duplicate 'ocean' regression: hex 0,1 (ocean) is still in the table", async () => {
    // This row would have been silently mis-rendered as `ocean = grey` in the
    // old code path. The MD builder doesn't render colors but it DOES look up
    // terrain by name when emitting the row; if the duplicate handling were
    // wrong, the row's terrain cell could be missing or empty.
    const placeholderUri = "data:image/png;base64,AAA";
    const layout = computeSubdivisions({
      gridCols: 3,
      gridRows: 2,
      pageWidthPx: 950,
      pageHeightPx: 360,
      minHexPxOnPage: 60,
    });
    const sections = enumerateSections(layout, { cols: 3, rows: 2 });
    const md = await buildMapPdfMarkdown(
      plugin as never,
      "the-coast",
      placeholderUri,
      sections,
      sections.map(() => placeholderUri),
    );
    expect(md).toMatch(/\| 0,1 \| ocean \|/);
  });
});
