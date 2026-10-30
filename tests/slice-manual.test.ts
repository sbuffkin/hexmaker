import { describe, it } from "node:test";
import expect from "expect";
import { renderMapExportForm } from "../src/export/MapExportModal";
import { mapExportFileNames } from "../src/export/exportNames";
import { moduleExportForm } from "../src/modules/runtime";
import { manualExportForm, manualExportOptions } from "../src/modules/manual/exportForm";
import { MANUAL_PARTS } from "../src/modules/manual/manualModel";
import { manualModule } from "../src/modules/manual";
import { DEFAULT_SETTINGS } from "../src/constants";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { describeWith, describeWithout } from "./helpers/slices";
import { readSource } from "./helpers/source";

/**
 * The "manual" slice (Hexcrawl manual export): a part of the Map export
 * form (its Fold, file, button and line) and nothing else. Built off, the
 * form is PNG and PDF only and no file name says "manual"; built on, the
 * form is what it was before the manual became a slice.
 */

function plugin() {
  return {
    app: { loadLocalStorage: () => null, saveLocalStorage: () => {} },
    settings: { ...DEFAULT_SETTINGS, maps: [{ name: "Coast" }], mapExportPrefs: {}, showTerrainLegend: true },
    getMap: () => ({ name: "Coast" }),
    mapLabel: (n: string) => n,
    sectionWordsFor: () => (section: string) => ({ label: section, one: section, noun: section }),
    saveData: async () => {},
  };
}
function form(): FakeEl {
  const { root, el } = fakeRoot();
  renderMapExportForm(el, plugin() as never, "Coast");
  return root;
}
const texts = (root: FakeEl) => root.all(() => true).map((e) => e.text).filter(Boolean);
/** The map export buttons (not the content pack's). */
const mapButtons = (root: FakeEl) => root.buttons().map((b) => b.text).filter((t) => t.startsWith("Export") && !t.includes("pack"));
const writes = (root: FakeEl) => texts(root).find((t) => t.startsWith("Writes:"));

describeWithout("manual", "manual slice off: the Map export form without the Hexcrawl manual", () => {
  it("PNG and PDF only: no Fold, button, file or line of the manual", () => {
    const root = form();
    expect(mapButtons(root)).toEqual(["Export PNG", "Export PDF with reference table"]);
    expect(writes(root)).toBe("Writes: Coast.png (PNG) · Coast.pdf (PDF)");
    const all = texts(root).join("\n");
    for (const s of manualModule.owns.strings ?? []) expect({ s, shown: all.includes(s) }).toEqual({ s, shown: false });
    expect(all).not.toMatch(/manual/i);
  });

  it("no module part, so no file name says manual", () => {
    expect(moduleExportForm().some((c) => c.id === "manual")).toBe(false);
    const n = mapExportFileNames({ base: "", mapName: "Coast", showFactionOverlay: true }, moduleExportForm().map((c) => ({ id: c.id })));
    expect(JSON.stringify(n)).not.toMatch(/manual/);
  });
});

describeWith("manual", "manual slice on: the form as before", () => {
  it("its Fold among the options, its file in Writes:, its button third, its line", () => {
    const root = form();
    expect(mapButtons(root)).toEqual(["Export PNG", "Export PDF with reference table", "Export hexcrawl manual (PDF)"]);
    expect(writes(root)).toBe("Writes: Coast.png (PNG) · Coast.pdf (PDF) · Coast manual.pdf (manual)");
    const all = texts(root);
    expect(all).toContain("Hexcrawl manual");
    for (const p of MANUAL_PARTS) expect(all).toContain(p.label);
    expect(all.some((t) => t.startsWith("Hexcrawl manual: the full game master gazetteer"))).toBe(true);
    // The Fold sits between PDF table columns and Output size, where it always was.
    const order = all.filter((t) => ["PDF table columns", "Hexcrawl manual", "Output size"].includes(t));
    expect(order).toEqual(["PDF table columns", "Hexcrawl manual", "Output size"]);
  });

  it("the player version renames its file and Writes: follows; the PNG and PDF keep theirs", () => {
    const root = form();
    const player = root.all((e) => e.tag === "label" && e.text === "Player version (leave out the hidden and secret sections)")[0];
    const cb = root.all((e) => e.tag === "input" && e.attrs.id === player.attrs.for)[0] as FakeEl & { checked: boolean };
    cb.checked = true;
    cb.fire("change");
    expect(writes(root)).toBe("Writes: Coast.png (PNG) · Coast.pdf (PDF) · Coast player.pdf (manual)");
  });

  it("its file is named from the base name, and the button exports under the name shown", () => {
    let changed = 0;
    const { el } = fakeRoot();
    const part = manualExportForm.render({ plugin: plugin() as never, mapName: "Coast", options: el, changed: () => changed++ });
    expect(part.fileName?.("Barony")).toBe("Barony manual.pdf");
    expect(part.fileLabel).toBe("manual");
    expect(part.button?.label).toBe("Export hexcrawl manual (PDF)");
    const o = manualExportOptions(
      { outputName: "Coast-faction", showIcons: false, showPaths: true, boldPaths: false, showFactionOverlay: true, showRegionOverlay: false, showHexNames: true, showTokens: false, showCoords: true },
      "Barony player.pdf", true, ["index"],
    );
    expect(o).toEqual({
      outputName: "Barony player",
      player: true,
      showIcons: false,
      showPaths: true,
      boldPaths: false,
      showFactionOverlay: true,
      showRegionOverlay: false,
      showHexNames: true,
      showTokens: false,
      omit: ["index"],
    });
  });
});

describe("manual slice: the core never names it", () => {
  it("the export form and its file names know it only through exportForm[]", () => {
    const core = readSource("src", "export", "MapExportModal.ts") + readSource("src", "export", "exportNames.ts");
    expect(core).not.toMatch(/manual/i);
  });
});
