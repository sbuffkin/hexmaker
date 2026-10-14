import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { numberBoxShown, setNumberBoxDebug } from "../src/ui/numberBoxes";
import { multiplierValue, renderLabeledSlider, renderMultiplierSlider, renderResetButton, sliderFormat } from "../src/ui/sliders";
import { armButton, ARM_MS, renderFooter } from "../src/ui/footer";
import { commitNumber, numberField } from "../src/ui/scrub";
import { oddsText, readOddsWeight } from "../src/ui/odds";
import { renderSaveStatusLine } from "../src/ui/saveStatusLine";
import { editorOdds } from "../src/random-tables/RandomTableEditorModal";
import { freeNoteName } from "../src/random-tables/WorkflowWizardModal";
import { biomePagePatch, setMixShares, setTypeTerrainWeights, typeTerrainShares } from "../src/overworld/biomePage/fields";
import { newBiomeFields } from "../src/overworld/BiomeLibraryModal";
import { biomeNameProblem } from "../src/overworld/biomeForm";
import { landOf } from "../src/overworld/biomeCombo";
import type { BiomeNoteFields } from "../src/overworld/biomeNote";
import { readSurface, readSource } from "./helpers/source";

/**
 * The shared controls and saving of the UI consistency fix plan (audit
 * 2026-10-12, owner answers 2026-10-13): LabeledSlider / MultiplierSlider /
 * ResetButton, number boxes in debug mode (Q13), number fields, the footer and
 * two-click guard (Q6, Q7), the save-status line (Q5), the % column (Q1)
 * and the one biome editor (Q14).
 */

const rangeOf = (root: FakeEl) => root.inputs("range")[0];
const valueOf = (root: FakeEl) => root.find("duckmage-labeled-slider-value")!.text;

describe("number boxes beside sliders (Q13, confirmed): every slider, debug mode only", () => {
  it("follows debug mode: a slider shows its box only while it's on", () => {
    setNumberBoxDebug(() => false);
    const off = fakeRoot();
    renderLabeledSlider(off.el, { label: "Opacity", min: 0, max: 1, step: 0.05, value: 0.5 });
    expect(off.root.inputs("number")).toHaveLength(0);
    setNumberBoxDebug(() => true);
    expect(numberBoxShown()).toBe(true);
    const on = fakeRoot();
    const changes: number[] = [];
    renderLabeledSlider(on.el, { label: "Opacity", min: 0, max: 1, step: 0.05, value: 0.5, onChange: (v) => changes.push(v) });
    const box = on.root.inputs("number")[0];
    expect(box.value).toBe("0.5");
    box.value = "0.83";
    box.fire("change");
    // Snapped to the step and clamped, then committed like the slider.
    expect(changes).toEqual([0.85]);
    expect(rangeOf(on.root).value).toBe("0.85");
    setNumberBoxDebug(() => false);
  });
});

describe("LabeledSlider: every single-value slider shows its value", () => {
  beforeEach(() => setNumberBoxDebug(() => false));

  it("shows the value at once and as it moves; previews on input, writes on change", () => {
    const { root, el } = fakeRoot();
    const inputs: number[] = [], changes: number[] = [];
    renderLabeledSlider(el, { label: "Width", min: 1, max: 10, step: 1, value: 4, format: sliderFormat.px, onInput: (v) => inputs.push(v), onChange: (v) => changes.push(v) });
    expect(valueOf(root)).toBe("4 px");
    const r = rangeOf(root);
    expect(r.attrs["aria-label"]).toBe("Width");
    r.value = "7";
    r.fire("input");
    expect(valueOf(root)).toBe("7 px");
    expect([inputs, changes]).toEqual([[7], []]);
    r.fire("change");
    expect(changes).toEqual([7]);
  });

  it("the wheel nudges by its step and commits once it settles", () => {
    const { root, el, timers } = fakeRoot();
    const changes: number[] = [];
    renderLabeledSlider(el, { label: "Water", min: 0, max: 60, step: 5, value: 20, format: sliderFormat.percent, onChange: (v) => changes.push(v) });
    const r = rangeOf(root);
    const wheel = (deltaY: number) => r.fire("wheel", { deltaY, preventDefault() {} });
    wheel(-100);
    wheel(-100);
    expect(valueOf(root)).toBe("30%");
    expect(changes).toEqual([]);
    timers.flush();
    expect(changes).toEqual([30]);
  });

  it("a reset: one rotate-icon button, disabled at the default, the row dimmed while unset", () => {
    const { root, el } = fakeRoot();
    const changes: number[] = [];
    renderLabeledSlider(el, { label: "Opacity", min: 0.1, max: 1, step: 0.05, value: 1, format: sliderFormat.fraction, reset: { value: 1 }, onChange: (v) => changes.push(v) });
    const reset = root.find("duckmage-reset-btn")!;
    expect(reset.classes.has("clickable-icon")).toBe(true);
    expect(reset.attrs["aria-label"]).toBe("Reset opacity to default (100%)");
    expect(reset.disabled).toBe(true);
    expect(root.find("duckmage-labeled-slider")!.classes.has("is-inherited")).toBe(true);
    const r = rangeOf(root);
    r.value = "0.5";
    r.fire("input");
    expect(reset.disabled).toBe(false);
    expect(root.find("duckmage-labeled-slider")!.classes.has("is-inherited")).toBe(false);
    reset.fire("click");
    expect(changes).toEqual([1]);
    expect(valueOf(root)).toBe("100%");
    expect(reset.disabled).toBe(true);
  });

  it("an inherited value shows dimmed until set; its reset puts it back to inheriting", () => {
    const { root, el } = fakeRoot();
    let own: number | undefined;
    const s = renderLabeledSlider(el, {
      label: "Land share", min: 0, max: 100, step: 1, value: 62, format: sliderFormat.percent,
      isSet: () => own !== undefined,
      reset: { value: 62, text: "from the type mix", onReset: () => { own = undefined; } },
      onChange: (v) => { own = v; },
    });
    expect(root.find("duckmage-labeled-slider")!.classes.has("is-inherited")).toBe(true);
    const r = rangeOf(root);
    r.value = "62";
    r.fire("change");
    // Set (even to the same number): no longer inherited.
    expect(own).toBe(62);
    expect(root.find("duckmage-labeled-slider")!.classes.has("is-inherited")).toBe(false);
    root.find("duckmage-reset-btn")!.fire("click");
    expect(own).toBeUndefined();
    s.refresh();
    expect(root.find("duckmage-labeled-slider")!.classes.has("is-inherited")).toBe(true);
  });

  it("formatters: one per kind of value", () => {
    expect(sliderFormat.percent(40)).toBe("40%");
    expect(sliderFormat.fraction(0.25)).toBe("25%");
    expect(sliderFormat.multiplier(1.25)).toBe("×1.25");
    expect(sliderFormat.multiplier(1)).toBe("×1");
    expect(sliderFormat.count(3.4)).toBe("3");
    expect(sliderFormat.px(4)).toBe("4 px");
    expect(sliderFormat.plain(0.3500001)).toBe("0.35");
  });
});

describe("MultiplierSlider (generator Bias, path knobs, biome pool weights)", () => {
  it("×0–3 in quarter steps, ×1 = not set (undefined), with a reset to ×1", () => {
    const { root, el } = fakeRoot();
    const changes: (number | undefined)[] = [];
    renderMultiplierSlider(el, { label: "", ariaLabel: "forest bias", value: undefined, onChange: (v) => changes.push(v) });
    const r = rangeOf(root);
    expect([r.attrs.min, r.attrs.max, r.attrs.step]).toEqual(["0", "3", "0.25"]);
    expect(valueOf(root)).toBe("×1");
    r.value = "1.75";
    r.fire("change");
    expect(changes).toEqual([1.75]);
    root.find("duckmage-reset-btn")!.fire("click");
    expect(changes).toEqual([1.75, undefined]);
    expect(multiplierValue(1)).toBeUndefined();
    expect(multiplierValue(0)).toBe(0);
  });

  it("a stored weight above ×3 widens the range instead of being cut", () => {
    const { root, el } = fakeRoot();
    renderMultiplierSlider(el, { label: "", value: 4.5, max: Math.max(3, Math.ceil(4.5)) });
    expect(rangeOf(root).value).toBe("4.5");
    expect(valueOf(root)).toBe("×4.5");
  });
});

describe("ResetButton", () => {
  it("says what it resets to, and does nothing while disabled", () => {
    const { el } = fakeRoot();
    let n = 0;
    const r = renderResetButton(el, { what: "the size", defaultText: "this scale's size", onReset: () => n++ });
    expect((r.el as unknown as FakeEl).attrs["aria-label"]).toBe("Reset the size to default (this scale's size)");
    r.sync(false);
    (r.el as unknown as FakeEl).fire("click");
    expect(n).toBe(0);
    r.sync(true);
    (r.el as unknown as FakeEl).fire("click");
    expect(n).toBe(1);
  });
});

describe("number fields: scrub to change, clamp on commit", () => {
  it("commitNumber clamps, rounds and reads blank as not set (or the fallback)", () => {
    expect(commitNumber("250", { min: 2, max: 60, whole: true })).toBe(60);
    expect(commitNumber("1", { min: 2, max: 60 })).toBe(2);
    expect(commitNumber("7.6", { min: 0, max: 99, whole: true })).toBe(8);
    expect(commitNumber("", { min: 0, max: 99, blank: true })).toBeUndefined();
    expect(commitNumber("", { min: 2, max: 32, fallback: 10 })).toBe(10);
    expect(commitNumber("abc", { min: 2, max: 32 })).toBe(2);
  });

  it("numberField writes the clamped value back and reports it", () => {
    const { root, el } = fakeRoot();
    const got: (number | undefined)[] = [];
    numberField(el, { min: 0, max: 99, whole: true, blank: true, ariaLabel: "Min islands", onChange: (v) => got.push(v) });
    const input = root.inputs("number")[0];
    expect(input.classes.has("duckmage-scrub")).toBe(true);
    input.value = "140";
    input.fire("change");
    input.value = "";
    input.fire("change");
    expect(got).toEqual([99, undefined]);
    expect(input.value).toBe("");
  });
});

describe("the modal footer (Q7) and the two-click guard (Q6)", () => {
  it("primary first and the only mod-cta; then secondary, destructive, Cancel", () => {
    const { root, el } = fakeRoot();
    const clicked: string[] = [];
    renderFooter(el, {
      cancel: () => clicked.push("cancel"),
      destructive: { text: "Delete", onClick: () => clicked.push("delete") },
      secondary: [{ text: "Export…", onClick: () => clicked.push("export") }, false],
      primary: { text: "Create", onClick: () => clicked.push("create") },
    });
    const foot = root.find("duckmage-modal-footer")!;
    expect(foot.buttons().map((b) => b.text)).toEqual(["Create", "Export…", "Delete", "Cancel"]);
    expect(foot.buttons().filter((b) => b.classes.has("mod-cta")).map((b) => b.text)).toEqual(["Create"]);
    expect(foot.buttons().filter((b) => b.classes.has("mod-warning")).map((b) => b.text)).toEqual(["Delete"]);
    for (const b of foot.buttons()) b.fire("click");
    expect(clicked).toEqual(["create", "export", "delete", "cancel"]);
  });

  it("a disabled footer button does nothing", () => {
    const { root, el } = fakeRoot();
    let n = 0;
    renderFooter(el, { primary: { text: "Add ranges", disabled: true, onClick: () => n++ } });
    root.buttons()[0].fire("click");
    expect(n).toBe(0);
  });

  it("two-click: the first click arms for a few seconds, the second runs it; it disarms on its own", () => {
    const { root, el, timers } = fakeRoot();
    const btn = root.createEl("button", { text: 'Delete "Chult"' });
    let deleted = 0;
    armButton(btn as unknown as HTMLButtonElement, { onConfirm: () => deleted++ });
    btn.fire("click");
    expect([btn.text, btn.classes.has("is-armed"), deleted]).toEqual(["Click again to delete", true, 0]);
    timers.flush();
    expect([btn.text, btn.classes.has("is-armed")]).toEqual(['Delete "Chult"', false]);
    btn.fire("click");
    btn.fire("click");
    expect(deleted).toBe(1);
    expect(btn.text).toBe('Delete "Chult"');
    expect(ARM_MS).toBeGreaterThanOrEqual(2000);
    void el;
  });
});

describe("the save-status line (Q5)", () => {
  it("says changes save automatically, then saving, then saved", async () => {
    const { root, el } = fakeRoot();
    const line = renderSaveStatusLine(el);
    const status = root.find("duckmage-save-status-line")!;
    expect(status.text).toBe("Changes save automatically");
    line.pending();
    expect(status.text).toBe("Saving shortly…");
    let done!: () => void;
    const work = new Promise<void>((r) => (done = r));
    const tracked = line.track(work);
    expect(status.text).toBe("Saving…");
    done();
    await tracked;
    expect(status.text).toBe("✓ All changes saved");
    expect(status.attrs["data-state"]).toBe("saved");
  });
});

describe("% column beside free weights (Q1)", () => {
  it("whole percentages adding up to 100; a sliver reads <1%; nothing at all reads –", () => {
    expect(oddsText([1, 1, 1])).toEqual(["34%", "33%", "33%"]);
    expect(oddsText([3, 1, 0])).toEqual(["75%", "25%", "0%"]);
    expect(oddsText([1000, 1])).toEqual(["100%", "<1%"]);
    expect(oddsText([0, 0])).toEqual(["–", "–"]);
    expect(oddsText([])).toEqual([]);
  });

  it("a world-type weight cell: blank is 1, unreadable or negative is 0", () => {
    expect(["", " 2 ", "0.5", "x", "-3"].map((t) => readOddsWeight(t))).toEqual([1, 2, 0.5, 0, 0]);
  });

  it("the table editor: the note's own ranges until rows or weights change, then the weights (added / removed rows too)", () => {
    const entries = [{ result: "Wolves", weight: 1 }, { result: "Bandits", weight: 3 }];
    expect(editorOdds(0, entries, false)).toEqual(["25%", "75%"]);
    // Changed: from the weights as they are now.
    entries[0].weight = 3;
    expect(editorOdds(6, entries, true)).toEqual(["50%", "50%"]);
    // A row added.
    expect(editorOdds(6, [...entries, { result: "Ogre", weight: 2 }], true)).toEqual(["38%", "37%", "25%"]);
  });

  it("the table editor and world types both show it, and update it live", () => {
    const editor = readSurface("table-editor");
    expect(editor).toContain("oddsEls.forEach");
    // Recomputed on every weight input and every redraw of the rows.
    expect(editor).toMatch(/weightInput\.addEventListener\("input", \(\) => \{\s*entries\[i\]\.weight = readWeight\(weightInput\.value\);\s*onWeightsChanged\(\);/);
    // A hand edit to the note redraws the editor (when nothing was changed in it).
    expect(editor).toContain('this.app.vault.on("modify"');
    const wt = readSurface("world-types-modal");
    expect(wt).toContain('if (c === "Weight") this.refreshOdds();');
    expect(wt).toMatch(/el\.scrollTop = scrollTop;\s*this\.refreshOdds\(\);/);
  });
});

describe("no confirm dialogs (Q6)", () => {
  it("a workflow result whose name is taken gets a number instead of 'Replace note?'", () => {
    const taken = new Set(["Loot", "Loot 2"]);
    expect(freeNoteName("Loot", (n) => taken.has(n))).toBe("Loot 3");
    expect(freeNoteName("Treasure", (n) => taken.has(n))).toBe("Treasure");
  });

  it("only the module offer and the debug-mode confirm still open a ConfirmModal", () => {
    const users = ["HexmakerPlugin.ts", "HexmakerSettingTab.ts", "random-tables/WorkflowWizardModal.ts", "worldgen/GeneratorLibrary.ts", "worldgen/GeneratorPanel.ts", "random-tables/RandomTableView.ts", "hex-map/MapModal.ts", "hex-map/PathTypeEditorModal.ts"]
      .map((p) => [p, (readSource("src", p).match(/new ConfirmModal\(/g) ?? []).length] as const);
    expect(Object.fromEntries(users)).toEqual({
      "HexmakerPlugin.ts": 1, // the module offer
      "HexmakerSettingTab.ts": 1, // debug mode
      "random-tables/WorkflowWizardModal.ts": 0,
      "worldgen/GeneratorLibrary.ts": 0,
      "worldgen/GeneratorPanel.ts": 0,
      "random-tables/RandomTableView.ts": 0,
      "hex-map/MapModal.ts": 0,
      "hex-map/PathTypeEditorModal.ts": 0,
    });
    expect(readSurface("map-modal")).toContain('armButton(del, { armedText: "Click again to delete"');
  });
});

describe("autosaving editors have no footer button (Q5)", () => {
  it("no Close / Save / Cancel on the table, workflow, path type, terrain, faction and region-area editors", () => {
    for (const p of ["random-tables/RandomTableEditorModal.ts", "random-tables/WorkflowEditorModal.ts", "hex-map/PathTypeEditorModal.ts", "hex-map/TerrainEntryEditorModal.ts", "hex-map/AreaNotePickerModal.ts"]) {
      const s = readSource("src", p);
      expect({ p, close: /text: "(Close|Save|Cancel)"/.test(s) }).toEqual({ p, close: false });
      expect({ p, line: s.includes("renderSaveStatusLine(") }).toEqual({ p, line: true });
    }
  });
});

// ── the one biome editor (Q14) ─────────────────────────────────────────────

const biome = (over: Partial<BiomeNoteFields> = {}): BiomeNoteFields => ({
  id: "tundra",
  label: "Tundra",
  color: "#aabbcc",
  mix: [{ type: "grassland", weight: 60 }, { type: "water", weight: 30, minPatches: 2 }, { type: "hills", weight: 10 }],
  transitions: [],
  ...over,
});

describe("the biome page is the one biome editor", () => {
  it("its patch carries everything the old form edited (name, colour, generator, blank, climate, terrain weights)", () => {
    const f = biome({ generator: "world/generators/Ice", blank: true, climate: { elevation: "high" }, terrainWeights: [{ terrain: "tundra moss", weight: 2 }] });
    const patch = biomePagePatch(f);
    expect([patch.label, patch.color, patch.generator, patch.blank, patch.climate, patch.terrainWeights]).toEqual(["Tundra", "#aabbcc", "world/generators/Ice", true, { elevation: "high" }, [{ terrain: "tundra moss", weight: 2 }]]);
    // Off is written as removed.
    const off = biomePagePatch(biome());
    expect(Object.prototype.hasOwnProperty.call(off, "generator") && off.generator === undefined && off.blank === undefined && off.terrainWeights === undefined).toBe(true);
  });

  it("Type mix from the share sliders: whole percentages; 0% drops a type, its min patches come back with it", () => {
    const f = biome();
    const types = ["grassland", "water", "hills"];
    const kept = new Map([["water", 2]]);
    setMixShares(f, types, [70, 0, 30], kept);
    expect(f.mix.map((r) => [r.type, r.weight])).toEqual([["grassland", 70], ["hills", 30]]);
    setMixShares(f, types, [60, 25, 15], kept);
    expect(f.mix.find((r) => r.type === "water")).toEqual({ type: "water", weight: 25, minPatches: 2 });
    expect(f.mix.reduce((s, r) => s + r.weight, 0)).toBe(100);
  });

  it("Terrain weights from the share sliders: small whole weights; an even split stores nothing", () => {
    const f = biome({ terrainWeights: [{ terrain: "dunes", weight: 2 }] });
    const names = ["Tundra", "Tundra moss"];
    expect(typeTerrainShares(f, names)).toEqual([0.5, 0.5]);
    setTypeTerrainWeights(f, names, [67, 33]);
    // Tundra 2, Tundra moss 1 (1 is the default, so left out); another type's row kept.
    expect(f.terrainWeights).toEqual([{ terrain: "dunes", weight: 2 }, { terrain: "Tundra", weight: 2 }]);
    expect(typeTerrainShares(f, names).map((x) => Math.round(x * 100))).toEqual([67, 33]);
    setTypeTerrainWeights(f, names, [50, 50]);
    expect(f.terrainWeights).toEqual([{ terrain: "dunes", weight: 2 }]);
    const g = biome();
    setTypeTerrainWeights(g, names, [100, 0]);
    expect(g.terrainWeights).toEqual([{ terrain: "Tundra moss", weight: 0 }]);
  });

  it("an unset land share shows the one its type mix gives", () => {
    expect(landOf(biome().mix)).toBeCloseTo(0.7, 6);
  });

  it("New biome: the basics only; a copy of the biome it starts from, or an empty mix", () => {
    const from = biome({ climate: { elevation: "high" }, tuning: { smoothing: 5 } });
    const made = newBiomeFields(" Ice sheet ", "#ffffff", from);
    expect(made).toMatchObject({ label: "Ice sheet", color: "#ffffff", parent: "Tundra", climate: { elevation: "high" }, tuning: { smoothing: 5 } });
    expect("id" in made).toBe(false);
    expect(made.mix).toEqual(from.mix);
    expect(made.mix).not.toBe(from.mix);
    expect(newBiomeFields("Glass wastes", "#7a9a5a")).toEqual({ label: "Glass wastes", color: "#7a9a5a", mix: [], transitions: [] });
    expect(biomeNameProblem("tundra", [{ id: "tundra", label: "Tundra" }])).toBe("There's already a biome called tundra.");
    expect(biomeNameProblem("  ", [])).toBe("Give the biome a name.");
    expect(biomeNameProblem("Ice sheet", [{ id: "tundra", label: "Tundra" }])).toBeUndefined();
  });

  it("the form is gone: Biomes… › Edit… opens the page; New biome… creates and opens it", () => {
    const lib = readSurface("biome-library");
    expect(lib).not.toMatch(/class BiomeFormModal|type: "range"|"Fewest islands"/);
    expect(lib).toContain("void plugin.openTerrainGenerator({ biome: b.id });");
    expect(lib).toContain("await plugin.openTerrainGenerator({ biome: res.id });");
    expect(lib).toContain('text: "New biome…"');
    const page = readSurface("biome-page");
    // One label for the fewest islands; the page's Type mix and Terrain weights on ShareSliders.
    expect(page).toContain('"Min islands"');
    expect(page).not.toContain("Fewest islands");
    expect((page.match(/renderShareSliders\(/g) ?? []).length).toBe(2);
    expect(page).toContain("renderSaveStatusLine(");
  });
});

describe("Bias (Q2) and pool weights (Q3)", () => {
  it("the generator's terrain multiplier is called Bias, on the shared MultiplierSlider", () => {
    const gen = readSurface("generator-page");
    expect(gen).toContain('["Bias", ');
    expect(gen).not.toContain('["Mix", ""]');
    expect(gen).toContain("ariaLabel: `${t.name} bias`");
    // The resulting-share column stays.
    expect(gen).toContain('["Map", "Share of the preview');
    // The zero-sum influence / blend sliders stay on ShareSliders.
    expect(gen).toContain("renderShareSliders(");
  });

  it("biome pool weights are a MultiplierSlider, not a number box", () => {
    const ow = readSurface("overworld-modals");
    expect(ow).toContain("renderMultiplierSlider(item, {");
    expect(ow).not.toMatch(/cls: "duckmage-biome-weight"/);
  });
});
