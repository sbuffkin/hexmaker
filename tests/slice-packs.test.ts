import { it, afterEach } from "node:test";
import expect from "expect";
import { moduleCommands, moduleExportForm, moduleWizardOffers } from "../src/modules/runtime";
import { MODULES } from "../src/modules";
import { PLACEMENT } from "../src/ui/placement";
import { COMMAND_ACTIONS } from "../src/workMode";
import { renderMapExportForm } from "../src/export/MapExportModal";
import { DEFAULT_SETTINGS } from "../src/constants";
import { PackExportModal } from "../src/modules/packs/PackExportModal";
import { PackImportModal } from "../src/modules/packs/PackImportModal";
import { readSource } from "./helpers/source";
import { fakeRoot } from "./helpers/fakeDom";
import { describeWith, describeWithout, sliceOn } from "./helpers/slices";

/**
 * The "packs" slice (content packs, SF1). Built on, the commands, the Map
 * export form's "Content pack (.zip)" box and the setup wizard's "Import a
 * content pack…" offer are there and behave as before the slice existed;
 * built off (HEXMAKER_SLICES_OFF=packs) none of them is, and the rest of
 * the export form and the wizard's last step are unchanged.
 */

const PACK_COMMANDS = ["export-content-pack", "import-content-pack"];

function plugin() {
  const app = { loadLocalStorage: () => null, saveLocalStorage: () => {} };
  const p = {
    app,
    settings: { ...DEFAULT_SETTINGS, worldFolder: "World", maps: [{ name: "Coast" }], mapExportPrefs: {}, showTerrainLegend: true },
    paletteStore: { folder: () => "World/palettes" },
    biomeStore: { folder: () => "World/biomes" },
    getMap: () => ({ name: "Coast" }),
    mapLabel: (n: string) => n,
    sectionWordsFor: () => (section: string) => ({ label: section, one: section, noun: section }),
    saveData: async () => {},
  };
  return p;
}

/** Which pack dialog opened (the mock Modal has no open()), and with which kinds. */
const opened: { dialog: string; kinds: string[] }[] = [];
for (const [cls, dialog] of [[PackExportModal, "export"], [PackImportModal, "import"]] as const) {
  (cls.prototype as unknown as { open(): void }).open = function (this: { kinds: { id: string }[] }) {
    opened.push({ dialog, kinds: this.kinds.map((k) => k.id) });
  };
}
afterEach(() => { opened.length = 0; });
/** Wait for a dialog to open (the openers read the modules' kinds through a dynamic import), up to 2 s. */
async function settle(): Promise<void> {
  for (let i = 0; i < 200 && !opened.length; i++) await new Promise((r) => setTimeout(r, 10));
}

const exportButtons = (root: ReturnType<typeof fakeRoot>["root"]) => root.buttons().map((b) => b.text).filter((t) => t.startsWith("Export"));

describeWith("packs", "packs on: content packs as they were", () => {
  it("the module is built, with its two commands placed and classified for the work modes", () => {
    expect(MODULES.some((m) => m.id === "packs")).toBe(true);
    const cmds = moduleCommands().filter((c) => PACK_COMMANDS.includes(c.command.id));
    expect(cmds.map((c) => [c.command.id, c.command.name, c.command.placementId, c.kind])).toEqual([
      ["export-content-pack", "Export content pack…", "Plugin.cmd.exportContentPack", undefined],
      ["import-content-pack", "Import content pack…", "Plugin.cmd.importContentPack", undefined],
    ]);
    expect(PLACEMENT["Plugin.cmd.exportContentPack"]).toBe("main");
    expect(PLACEMENT["Plugin.cmd.importContentPack"]).toBe("main");
    expect(COMMAND_ACTIONS["export-content-pack"]).toBe("export");
    expect(COMMAND_ACTIONS["import-content-pack"]).toBe("settings");
  });

  it("each command opens its dialog with this vault's kinds (core folders first)", async () => {
    const p = plugin();
    for (const c of moduleCommands().filter((x) => PACK_COMMANDS.includes(x.command.id))) await c.command.run(p as never);
    expect(opened.map((o) => o.dialog)).toEqual(["export", "import"]);
    expect(opened[0].kinds.slice(0, 2)).toEqual(["tables", "workflows"]);
    expect(opened[0].kinds).toEqual(opened[1].kinds);
  });

  it("the Map export form ends with the Content pack box; its button closes the form and opens the export dialog", async () => {
    const { root, el } = fakeRoot();
    let closed = 0;
    renderMapExportForm(el, plugin() as never, "Coast", { onExport: () => closed++ });
    expect(exportButtons(root)).toEqual(["Export PNG", "Export PDF with reference table", ...(sliceOn("manual") ? ["Export hexcrawl manual (PDF)"] : []), "Export content pack…"]);
    const box = root.all((e) => e.classes.has("duckmage-export-pack"));
    expect(box.length).toBe(1);
    expect(box[0].classes.has("duckmage-export-group")).toBe(true);
    expect(box[0].all((e) => e.classes.has("duckmage-export-group-title")).map((e) => e.text)).toEqual(["Content pack (.zip)"]);
    root.buttons().find((b) => b.text === "Export content pack…")!.fire("click");
    await settle();
    expect(closed).toBe(1);
    expect(opened.map((o) => o.dialog)).toEqual(["export"]);
  });

  it("the setup wizard's last step offers Import a content pack…, which opens the import dialog", async () => {
    expect(moduleWizardOffers("done").map((o) => o.id)).toEqual(["packs.import"]);
    const { root, el } = fakeRoot();
    for (const offer of moduleWizardOffers("done")) offer.render(el, plugin() as never);
    const button = root.buttons().find((b) => b.text === "Import a content pack…");
    expect(button?.classes.has("duckmage-wizard-pack-btn")).toBe(true);
    button!.fire("click");
    await settle();
    expect(opened.map((o) => o.dialog)).toEqual(["import"]);
  });
});

describeWithout("packs", "packs off: no trace of content packs in the plugin", () => {
  it("no module, commands, placement rows or work-mode rows", () => {
    expect(MODULES.some((m) => m.id === "packs")).toBe(false);
    expect(moduleCommands().map((c) => c.command.id).filter((id) => PACK_COMMANDS.includes(id))).toEqual([]);
    for (const id of ["Plugin.cmd.exportContentPack", "Plugin.cmd.importContentPack", "MapExport.contentPack", "Wizard.importPack", "PackExport.export", "PackImport.import"]) {
      expect({ id, placed: id in PLACEMENT }).toEqual({ id, placed: false });
    }
    for (const id of PACK_COMMANDS) expect({ id, classified: id in COMMAND_ACTIONS }).toEqual({ id, classified: false });
  });

  it("the Map export form has no Content pack box or button", () => {
    expect(moduleExportForm().map((c) => c.id)).not.toContain("packs.export");
    const { root, el } = fakeRoot();
    renderMapExportForm(el, plugin() as never, "Coast");
    expect(exportButtons(root)).toEqual(["Export PNG", "Export PDF with reference table", ...(sliceOn("manual") ? ["Export hexcrawl manual (PDF)"] : [])]);
    expect(root.all((e) => e.classes.has("duckmage-export-pack"))).toEqual([]);
  });

  it("the setup wizard's last step has no pack offer", () => {
    expect(moduleWizardOffers("done").map((o) => o.id)).not.toContain("packs.import");
  });
});

describeWith("foundation", "packs: the core reaches content packs only through the module", () => {
  it("no core file names the pack code; the wizard and the export form draw the modules' parts", () => {
    for (const f of ["src/plugin/commands.ts", "src/SetupWizardView.ts", "src/export/MapExportModal.ts", "src/ui/placement.ts", "src/workMode.ts"]) {
      const text = readSource(f);
      expect({ f, packs: /modules\/packs|content-pack|ContentPack|importPack/.test(text) }).toEqual({ f, packs: false });
    }
    expect(readSource("src/SetupWizardView.ts")).toContain('for (const offer of moduleWizardOffers("done")) offer.render(container, plugin);');
    expect(readSource("src/export/MapExportModal.ts")).toContain("moduleExportForm()");
  });
});
