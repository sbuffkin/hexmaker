import { describe, it } from "node:test";
import expect from "expect";
import { FILTER_FROM, editToggleText, filterMatches, filterPlaceholder, noMatchText, wantsFilter } from "../src/ui/pickers";
import { BACKGROUND_PREFIX, backgroundText } from "../src/ui/notify";
import { submapKindLabel } from "../src/maps/submaps";
import { mapExportSuffix } from "../src/export/exportNames";
import { toolModeLabel } from "../src/hex-map/toolMode";
import { ARRIVAL_MODE_TEXT, ARRIVAL_MODE_WORDS, parseArrivalMode } from "../src/arrival/arrival";

describe("picker standard (audit L1–L6)", () => {
  it("one filter threshold: a handful shows no box, more does", () => {
    expect(wantsFilter(FILTER_FROM - 1)).toBe(false);
    expect(wantsFilter(FILTER_FROM)).toBe(true);
    expect(FILTER_FROM).toBeGreaterThan(3);
    expect(FILTER_FROM).toBeLessThan(13);
  });

  it("one wording: Filter <things>… and No <things> match.", () => {
    expect(filterPlaceholder("terrains")).toBe("Filter terrains…");
    expect(noMatchText("areas")).toBe("No areas match.");
  });

  it("matches any of a tile's words, case-insensitively; blank matches all", () => {
    expect(filterMatches("HILL", "forested hills")).toBe(true);
    expect(filterMatches("water", "lake", "water")).toBe(true);
    expect(filterMatches("ocean", "cliffs", undefined)).toBe(false);
    expect(filterMatches("   ", "cliffs")).toBe(true);
  });

  it("the edit toggle says Edit / Done editing", () => {
    expect(editToggleText(false)).toBe("Edit");
    expect(editToggleText(true)).toBe("Done editing");
  });
});

describe("notice prefix (owner Q10)", () => {
  it("background notices start with the plugin's name, once", () => {
    expect(backgroundText("moved 3 maps.")).toBe("Hexmap World Creator: moved 3 maps.");
    expect(backgroundText(`${BACKGROUND_PREFIX} already said`)).toBe("Hexmap World Creator: already said");
  });
});

describe("words (owner Q8, Q9/R1)", () => {
  it("a submap is a Region or a Location, never a Place", () => {
    expect(submapKindLabel({ parent: { map: "w", hex: "1_1" }, submapKind: "region" })).toBe("Region");
    expect(submapKindLabel({ parent: { map: "w", hex: "1_1" } })).toBe("Location");
    expect(submapKindLabel({ submapKind: "location" })).toBe("Location");
    expect(submapKindLabel({})).toBe("Map");
    expect(submapKindLabel(undefined)).toBe("Map");
  });

  it("the arrival choices say submap; the stored words still read", () => {
    expect(Object.values(ARRIVAL_MODE_TEXT).join(" ")).not.toMatch(/\bplace\b/i);
    expect(parseArrivalMode(ARRIVAL_MODE_WORDS.make)).toBe("make");
    expect(parseArrivalMode("make places")).toBe("make");
  });

  it("painted areas say Area: the tool's status line and the export file name", () => {
    expect(toolModeLabel({ mode: "regionLink", erasing: true })).toBe("Erasing areas");
    expect(mapExportSuffix({ showFactionOverlay: true, showRegionOverlay: true })).toBe("-faction-area");
  });
});
