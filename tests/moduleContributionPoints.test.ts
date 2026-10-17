import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { readSource } from "./helpers/source";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  genPage,
  MODULE_RUNTIMES,
  moduleExportForm,
  moduleGridDecorations,
  moduleLogWriters,
  modulePartyClick,
  moduleRollTargets,
  moduleSettings,
  moduleTokenMenu,
  moduleViews,
  moduleWizardOffers,
  runModuleLoad,
  runModuleUnload,
} from "../src/modules/runtime";
import type { ModuleRuntime } from "../src/modules/types";
import { addModuleSettings, isModuleFolderKey, moduleSettingChanged, moduleSettingRow, MODULE_SETTINGS_SECTION } from "../src/settings/moduleSettings";
import { renderMapExportForm } from "../src/export/MapExportModal";
import { TableSections } from "../src/hex-map/editor/TableSections";
import { DEFAULT_SETTINGS } from "../src/constants";
import { HexmakerSettingTab } from "../src/HexmakerSettingTab";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { sliceOn } from "./helpers/slices";

/**
 * The runtime contribution points later slices plug into (S0.5 of the
 * "every major feature a slice" plan): settings, views, the Map export
 * form, setup wizard offers, start/stop, the generator page api and the
 * Play hooks. Each is tested with a fake module added to the runtime
 * list for the test, and its core call site checked to do nothing when no
 * module answers (the real modules that use one: Content packs, the Map
 * export form and the wizard's last step; tests/slice-packs.test.ts).
 */

const runtimes = MODULE_RUNTIMES as ModuleRuntime[];
/** Add a fake module runtime for one test (removed after each). */
function withFake(fake: Partial<ModuleRuntime>): ModuleRuntime {
  const m = { id: "fake", ...fake } as ModuleRuntime;
  runtimes.push(m);
  return m;
}
/** The real modules taken out for a test (put back after each): for the tests that need no module answering. */
let parked: ModuleRuntime[] = [];
function withoutRealModules(): void {
  parked = runtimes.splice(0, runtimes.length);
}
afterEach(() => {
  for (let i = runtimes.length - 1; i >= 0; i--) if (runtimes[i].id.startsWith("fake")) runtimes.splice(i, 1);
  runtimes.unshift(...parked);
  parked = [];
});

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("contribution points: nothing contributed, nothing changes", () => {
  it("every collector is empty or neutral without a module that uses it", () => {
    const plugin = {} as never;
    // The modules' folder settings come through as folder rows (World maps, Space, Hex flower).
    for (const s of moduleSettings()) expect(s.control.type).toBe("folder");
    withoutRealModules();
    expect(moduleViews()).toEqual([]);
    // With the real modules out (content packs included), nothing adds to the export form or the wizard.
    expect(moduleExportForm()).toEqual([]);
    expect(moduleWizardOffers("done")).toEqual([]);
    expect(genPage()).toBeUndefined();
    expect(modulePartyClick(plugin, { map: "m", token: "t.md", from: "0_0", to: "1_0", orientation: "flat", stagger: "odd" })).toBe("none");
    expect(moduleGridDecorations(plugin, { name: "m" } as never)("0_0")).toEqual([]);
    expect(moduleTokenMenu(plugin, { map: "m", hex: "0_0", token: "t.md", party: true })).toEqual([]);
    expect(moduleRollTargets(plugin, { map: "m", x: 0, y: 0, mode: "play" })).toEqual([]);
    expect(moduleLogWriters()).toEqual([]);
  });
});

describe("settings[]: a module's settings in both settings paths", () => {
  it("folder settings become folder rows; settings of any kind follow, in module order", () => {
    const changed: string[] = [];
    withFake({
      folderSettings: [{ id: "Settings.fakeFolder", key: "fakeFolder", name: "Fake folder", placeholder: "World/fake", desc: "Where fakes go." }],
      settings: [
        { id: "Settings.fakeToggle", section: "Map look", name: "Fake marks", desc: "Show fakes.", control: { type: "toggle", key: "fakeOn", defaultValue: true }, changed: () => changed.push("toggle") },
        { id: "Settings.fakeCustom", section: "Fakes", name: "Fake button", desc: "Press it.", control: { type: "custom", render: (s) => void s } },
      ],
    });
    const mine = moduleSettings().filter((s) => s.id.startsWith("Settings.fake"));
    expect(mine.map((s) => [s.id, s.control.type])).toEqual([["Settings.fakeFolder", "folder"], ["Settings.fakeToggle", "toggle"], ["Settings.fakeCustom", "custom"]]);
    expect(isModuleFolderKey("fakeFolder")).toBe(true);
    expect(isModuleFolderKey("fakeOn")).toBe(false);
    moduleSettingChanged({} as never, "fakeOn");
    expect(changed).toEqual(["toggle"]);
  });

  it("rows: a folder is a text box, a toggle a toggle, a custom row draws itself", () => {
    const drawn: unknown[] = [];
    const plugin = { id: "p" } as never;
    expect(moduleSettingRow({ id: "S.a", name: "A", desc: "d", control: { type: "folder", key: "aFolder", placeholder: "x" } }, plugin)).toEqual({ name: "A", desc: "d", control: { type: "text", key: "aFolder", placeholder: "x" } });
    expect(moduleSettingRow({ id: "S.b", name: "B", desc: "d", aliases: ["bee"], control: { type: "toggle", key: "b", defaultValue: false } }, plugin)).toEqual({ name: "B", desc: "d", aliases: ["bee"], control: { type: "toggle", key: "b", defaultValue: false } });
    const row = moduleSettingRow({ id: "S.c", name: "C", desc: "d", control: { type: "custom", render: (s, p) => drawn.push([s, p]) } }, plugin);
    row.render!("setting" as never);
    expect(drawn).toEqual([["setting", plugin]]);
  });

  it("each joins the section it names (default Setup, at its end); an unknown heading gets a section at the end", () => {
    withFake({
      settings: [
        { id: "S.one", name: "One", desc: "", control: { type: "toggle", key: "one", defaultValue: false } },
        { id: "S.two", section: "Look", name: "Two", desc: "", control: { type: "toggle", key: "two", defaultValue: false } },
        { id: "S.three", section: "Brand new", name: "Three", desc: "", control: { type: "toggle", key: "three", defaultValue: false } },
      ],
    });
    const sections: { heading?: string; items: { id: string; item: string }[] }[] = [
      { heading: "Look", items: [{ id: "S.look", item: "look" }] },
      { heading: MODULE_SETTINGS_SECTION, items: [{ id: "S.setup", item: "setup" }] },
    ];
    addModuleSettings(sections, (c) => c.name);
    const ids = (h: string) => sections.find((s) => s.heading === h)!.items.map((i) => i.id).filter((id) => !/^Settings\./.test(id));
    expect(ids("Look")).toEqual(["S.look", "S.two"]);
    expect(ids("Setup")).toEqual(["S.setup", "S.one"]);
    expect(sections[sections.length - 1]).toEqual({ heading: "Brand new", items: [{ id: "S.three", item: "Three" }] });
  });

  it("the settings tab draws them (declarative definitions, which the display() fallback also draws)", () => {
    withFake({
      settings: [{ id: "Settings.fakeToggle", section: "Map look", name: "Fake marks on the map", desc: "Show fakes.", control: { type: "toggle", key: "fakeOn", defaultValue: true } }],
    });
    const store = { loadLocalStorage: () => null, saveLocalStorage: () => {} };
    const plugin = { settings: { ...DEFAULT_SETTINGS, maps: [], terrainPalettes: [] }, missingDefaultPalettes: () => [] };
    const defs = new HexmakerSettingTab(store as never, plugin as never).getSettingDefinitions() as { heading?: string; items?: { name: string; control?: unknown }[] }[];
    const look = defs.find((d) => d.heading === "Map look")!;
    expect(look.items!.find((i) => i.name === "Fake marks on the map")?.control).toEqual({ type: "toggle", key: "fakeOn", defaultValue: true });
    const tab = readSource("src", "HexmakerSettingTab.ts");
    expect(tab).toContain("addModuleSettings(sections, (c) => moduleSettingRow(c, this.plugin));");
    expect(tab).toContain("this.renderDefinitions(containerEl, this.getSettingDefinitions())");
    expect(tab).not.toContain("moduleFolderSettings");
  });
});

describe("views[], lifecycle and genPage()", () => {
  it("views: each registered by the plugin with its type", () => {
    const made: unknown[] = [];
    withoutRealModules();
    withFake({ views: [{ type: "fake-view", create: (leaf, plugin) => { made.push([leaf, plugin]); return {} as never; } }] });
    expect(moduleViews().map((v) => v.type)).toEqual(["fake-view"]);
    expect(readSource("src", "HexmakerPlugin.ts")).toContain("for (const v of moduleViews()) this.registerView(v.type, (leaf) => v.create(leaf, this));");
  });

  it("lifecycle: load in module order at the end of onload, unload in reverse before the core's; a failure is skipped", async () => {
    const calls: string[] = [];
    withFake({ id: "fake-a", lifecycle: { onload: async () => { calls.push("load a"); }, onunload: () => calls.push("unload a") } });
    withFake({ id: "fake-b", lifecycle: { onload: () => { throw new Error("boom"); }, onunload: () => { throw new Error("boom"); } } });
    withFake({ id: "fake-c", lifecycle: { onload: () => { calls.push("load c"); }, onunload: () => calls.push("unload c") } });
    const errors = console.error;
    console.error = () => {};
    try {
      await runModuleLoad({} as never);
      runModuleUnload({} as never);
    } finally {
      console.error = errors;
    }
    expect(calls).toEqual(["load a", "load c", "unload c", "unload a"]);
    const plugin = readSource("src", "HexmakerPlugin.ts");
    expect(plugin).toMatch(/registerProtocolHandlers\(this\);\n\s+await runModuleLoad\(this\);\n\s+\}/);
    expect(plugin).toMatch(/onunload\(\) \{\n\s+runModuleUnload\(this\);/);
  });

  it("genPage: the first module that provides it; the core opens the page only through it", async () => {
    withoutRealModules();
    withFake({ id: "fake-none" });
    const opened: unknown[] = [];
    withFake({ genPage: () => ({ open: async (plugin, select) => { opened.push([plugin, select]); }, refresh: () => {} }) });
    const self = { app: {} };
    await genPage()!.open(self as never, { mapName: "Coast" });
    expect(opened).toEqual([[self, { mapName: "Coast" }]]);
    // The plugin has no page code of its own: map types changing only asks the page to redraw.
    const plugin = readSource("src", "HexmakerPlugin.ts");
    expect(plugin).not.toContain("openTerrainGenerator");
    expect(plugin).toContain("genPage()?.refresh(this);");
  });
});

describe("exportForm[]: a module's part of the Map export form", () => {
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
  const texts = (root: FakeEl) => root.all(() => true).map((e) => e.text).filter(Boolean);

  it("its options, its file in Writes:, its button, its line and its box; the core's parts unchanged", () => {
    const ran: unknown[] = [];
    let changed: () => void = () => {};
    withFake({
      exportForm: [{
        id: "fake",
        render: (ctx) => {
          ctx.options.createDiv({ text: "Fake options" });
          changed = ctx.changed;
          return {
            fileName: (base) => `${base} fake.pdf`,
            fileLabel: "fake",
            button: { label: "Export fake", run: (choices, file) => { ran.push([choices.outputName, file]); } },
            describe: "Fake: a fake file.",
            box: { placementId: "MapExport.fakeBox", render: (el) => { el.createDiv({ text: "Fake box" }); } },
          };
        },
      }],
    });
    const { root, el } = fakeRoot();
    let closed = 0;
    renderMapExportForm(el, plugin() as never, "Coast", { onExport: () => closed++ });
    const all = texts(root);
    expect(all).toContain("Fake options");
    expect(all.find((t) => t.startsWith("Writes:"))).toMatch(/· Coast fake\.pdf \(fake\)$/);
    expect(all).toContain("Fake: a fake file.");
    expect(all).toContain("Fake box");
    // The core's buttons first, then the module's.
    const buttons = root.buttons().map((b) => b.text);
    expect(buttons.slice(0, 3)).toEqual(["Export PNG", "Export PDF with reference table", "Export hexcrawl manual (PDF)"]);
    const fake = root.buttons().find((b) => b.text === "Export fake")!;
    fake.fire("click");
    expect(ran).toEqual([["Coast", "Coast fake.pdf"]]);
    expect(closed).toBe(1);
    // Its changed() redraws Writes: (after the form is built, never during).
    expect(() => changed()).not.toThrow();
  });

  it("without a module part the form is what it was", () => {
    const { root, el } = fakeRoot();
    renderMapExportForm(el, plugin() as never, "Coast");
    // The core's three, then Content pack's box when that slice is built.
    expect(root.buttons().map((b) => b.text).filter((t) => t.startsWith("Export"))).toEqual(["Export PNG", "Export PDF with reference table", "Export hexcrawl manual (PDF)", ...(sliceOn("packs") ? ["Export content pack…"] : [])]);
    expect(texts(root).find((t) => t.startsWith("Writes:"))).toMatch(/\(manual\)$/);
  });
});

describe("wizardOffers[]: offers on a setup wizard step", () => {
  it("by step, in module order; the done step draws them after its own", () => {
    withFake({ wizardOffers: [{ id: "a", step: "done", render: () => {} }, { id: "b", step: "folders", render: () => {} }] });
    expect(moduleWizardOffers("done").map((o) => o.id).filter((id) => id !== "packs.import")).toEqual(["a"]);
    expect(moduleWizardOffers("folders").map((o) => o.id)).toEqual(["b"]);
    expect(readSource("src", "SetupWizardView.ts")).toMatch(/exploreBtn\.addEventListener\("click", \(\) => void cb\.onComplete\(false\)\);\n[^\n]*\n\s+for \(const offer of moduleWizardOffers\("done"\)\) offer\.render\(container, plugin\);/);
  });
});

describe("play hooks: party click, grid marks, token menu, roll targets, log writers", () => {
  it("partyClick: any module saying move makes it a step; the map view asks after the core's rule", () => {
    withFake({ play: { partyClick: (_p, c) => (c.to === "5_5" ? "move" : "none") } });
    const click = { map: "m", token: "t.md", from: "0_0", to: "5_5", orientation: "flat" as const, stagger: "odd" as const };
    expect(modulePartyClick({} as never, click)).toBe("move");
    expect(modulePartyClick({} as never, { ...click, to: "9_9" })).toBe("none");
    expect(readSource("src", "hex-map", "HexMapView.ts")).toMatch(/partyClick\(party, click\.to, click\.orientation, click\.stagger\) === "move" \|\| modulePartyClick\(this\.plugin, click\) === "move"/);
  });

  it("gridDecorations: asked once per render, then per hex; classes from every module", () => {
    let asked = 0;
    withFake({ id: "fake-a", play: { gridDecorations: () => { asked++; return (hex) => (hex === "1_1" ? ["fake-a"] : []); } } });
    withFake({ id: "fake-b", play: { gridDecorations: () => undefined } });
    withFake({ id: "fake-c", play: { gridDecorations: () => () => ["fake-c"] } });
    const decorate = moduleGridDecorations({} as never, { name: "m" } as never);
    expect(decorate("1_1")).toEqual(["fake-a", "fake-c"]);
    expect(decorate("0_0")).toEqual(["fake-c"]);
    expect(asked).toBe(1);
    const grid = readSource("src", "hex-map", "view", "gridRenderer.ts");
    expect(grid).toMatch(/const decorate = moduleGridDecorations\(this\.plugin, region\);/);
    expect(grid).toMatch(/for \(const cls of decorate\(hexKey\(x, y\)\)\) hexEl\.addClass\(cls\);/);
  });

  it("tokenMenu: the modules' items, added to the token's menu after the core's", () => {
    withFake({ play: { tokenMenu: (_p, t) => [{ id: "token.fake", label: `Fake ${t.hex}`, icon: "dot", run: () => {} }] } });
    expect(moduleTokenMenu({} as never, { map: "m", hex: "2_3", token: "t.md", party: false }).map((i) => [i.id, i.label])).toEqual([["token.fake", "Fake 2_3"]]);
    expect(readSource("src", "hex-map", "view", "tokenLayer.ts")).toMatch(/for \(const it of moduleTokenMenu\(this\.plugin, \{ map: token\.map, hex: token\.hex, token: token\.filePath, party: !!token\.party \}\)\)/);
  });

  it("rollTargets: listed first, picked first in their modes, and a roll added to one goes to it", async () => {
    const added: string[] = [];
    withFake({ play: { rollTargets: (_p, at) => [{ key: "fake-log", label: `Fake log ${at.x},${at.y}`, defaultIn: ["play"], add: async (t) => { added.push(t); } }] } });
    let mode = "play";
    const host = {
      app: { vault: { getAbstractFileByPath: () => null }, metadataCache: { getFileCache: () => null } },
      plugin: { hexPath: () => "nowhere.md", getMapPalette: () => [], getMap: () => ({ workMode: mode }) },
      x: 2, y: 3, mapName: "Coast", options: {},
      textBoxes: new Map(), allText: new Map(), allLinks: new Map(), choiceRefreshers: new Map(), hexExists: false,
      onChanged: () => {},
    };
    const target = new TableSections(host as never).rollTarget("description");
    expect(target.sections[0]).toEqual({ key: "fake-log", label: "Fake log 2,3" });
    expect(target.defaultSection).toBe("fake-log");
    await target.add("fake-log", "A bear.");
    expect(added).toEqual(["A bear."]);
    mode = "build";
    expect(new TableSections(host as never).rollTarget("description").defaultSection).toBe("description");
  });

  it("logWriters: one link each in the hex editor, opening the module's own writer for the hex", () => {
    withFake({ play: { logWriters: [{ id: "fake", label: "Add to fake log", title: "Write it down", open: () => {} }] } });
    expect(moduleLogWriters().map((w) => w.label)).toEqual(["Add to fake log"]);
    expect(readSource("src", "hex-map", "HexEditorModal.ts")).toMatch(/for \(const w of moduleLogWriters\(\)\) titleLeft\.createEl\("a", \{ text: w\.label[^\n]*w\.open\(this\.plugin, \{ map: this\.mapName, x: this\.x, y: this\.y \}\)\);/);
  });
});
