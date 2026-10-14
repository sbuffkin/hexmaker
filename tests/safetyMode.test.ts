/**
 * Loads the real HexmakerPlugin over an in-memory vault (tests/helpers/fakeApp)
 * and checks the read-only safety mode end to end: a vault updated by a newer
 * version (data.json `dataFormat` 2, or a map note) gets zero writes through a
 * full load and every edit path we can drive; an older vault behaves as before.
 */

import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { Notice } from "obsidian";
import HexmakerPlugin from "../src/HexmakerPlugin";
import { SafetyModeView } from "../src/safetyMode";
import { HexmakerSettingTab } from "../src/HexmakerSettingTab";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
  VIEW_TYPE_SETUP_WIZARD,
} from "../src/constants";
import { fakeApp, type FakeApp } from "./helpers/fakeApp";

type MockPlugin = HexmakerPlugin & {
  __data: unknown;
  __saves: Record<string, unknown>[];
  views: Map<string, unknown>;
  commands: { id: string; callback?: () => void; checkCallback?: (checking: boolean) => boolean }[];
  protocolHandlers: Map<string, (params: Record<string, string>) => void>;
  settingTabs: HexmakerSettingTab[];
};

/** A 1.5.x-shaped vault: a "coast" map with hex notes, one flat hex note left
 *  in the hex folder (1.0 layout), and an unregistered map folder "isles". */
const OLD_VAULT: Record<string, string> = {
  "world/hexes/coast/3_4.md": "---\nterrain: forest\n---\n### Towns\n",
  "world/hexes/coast/5_5.md": "---\nterrain: hills\n---\n### Towns\n",
  "world/hexes/9_9.md": "---\nterrain: sea\n---\n",
  "world/hexes/isles/1_1.md": "---\nterrain: sea\n---\n",
  "world/tables/terrain/forest - encounters.md": "---\ndice: 6\n---\n| Result | Weight |\n|---|---|\n| Wolves | 1 |\n",
  "world/workflows/trip.md": "---\nresults-folder: world/results\n---\n| Table | Rolls | Label |\n|---|---|---|\n| world/tables/terrain/forest - encounters | 1 | enc |\n",
};

/** What 1.6 leaves: the same vault plus a map note. */
const UPGRADED_VAULT: Record<string, string> = {
  ...OLD_VAULT,
  "world/hexes/coast/_coast.md": "---\nhexmaker-map: 6\npalette: Default\ncols: 10\nrows: 10\n---\n# Coast\n## Hexes\n| Hex | Terrain |\n|---|---|\n| 3_4 | forest |\n",
};

const BASE_DATA = {
  hexFolder: "world/hexes",
  tablesFolder: "world/tables",
  workflowsFolder: "world/workflows",
  setupComplete: true,
  maps: [{ name: "coast", paletteName: "Default", gridSize: { cols: 10, rows: 10 }, gridOffset: { x: 0, y: 0 }, pathChains: [] }],
  migrationsRun: ["v1.5-map-data-to-map-notes"],
  savedWith: "1.6.0",
  someFutureKey: { keep: true },
};

async function load(files: Record<string, string>, data: Record<string, unknown>): Promise<{ plugin: MockPlugin; fake: FakeApp }> {
  let plugin: MockPlugin | null = null;
  const fake = fakeApp(files, () => plugin as never);
  plugin = new HexmakerPlugin(fake.app, { id: "hexmaker", version: "1.5.7" } as never) as MockPlugin;
  plugin.__data = data;
  await plugin.onload();
  fake.layoutReady();
  await new Promise((r) => setTimeout(r, 10));
  return { plugin, fake };
}

/**
 * Everything a user (or sync) can do to the plugin without its views. The
 * UI parts (settings tab, commands, links) only run in read-only mode: in
 * normal mode they open the full views, which this fake app can't host.
 */
async function simulateEdits(plugin: MockPlugin, fake: FakeApp, ui = true): Promise<void> {
  plugin.settings.maps.push({ name: "new", paletteName: "Default", gridSize: { cols: 1, rows: 1 }, gridOffset: { x: 0, y: 0 }, pathChains: [] } as never);
  await plugin.saveSettings();
  await plugin.createHexNote(1, 1, "coast");
  await plugin.ensureTerrainTables();
  await plugin.ensureAllRollerLinks();
  await plugin.backfillTerrainLinks();
  await plugin.ensureHexTemplate();
  await plugin.renameTerrainInHexes("forest", "woods");
  await plugin.syncHexEncounterTableLink("world/hexes/coast/3_4.md", "forest");
  await plugin.updateSubmapReferences("coast", "shore");
  await plugin.createNewMap("fresh", 2, 2, "Default");
  // Vault events the plugin reacts to.
  const tables = fake.file("world/tables/terrain/forest - encounters.md");
  await fake.fire("delete", tables);
  await fake.fire("rename", fake.file("world/tables"), "world/old-tables");
  if (!ui) return;
  // Settings tab: both render paths.
  const tab = plugin.settingTabs[0];
  tab.display();
  tab.getSettingDefinitions();
  // Commands and links.
  for (const c of plugin.commands) {
    if (c.callback) c.callback();
    if (c.checkCallback) c.checkCallback(false);
  }
  plugin.protocolHandlers.get("duckmage-openmap")?.({ map: "coast" });
  plugin.protocolHandlers.get("duckmage-roll")?.({ file: "world/tables/terrain/forest - encounters.md" });
  await new Promise((r) => setTimeout(r, 10));
}

beforeEach(() => {
  Notice.shown = [];
});

describe("1.5.7 safety mode: vault updated by a newer version", () => {
  it("dataFormat 2 → read-only, persistent notice naming the version", async () => {
    const { plugin } = await load(UPGRADED_VAULT, { ...BASE_DATA, dataFormat: 2 });
    expect(plugin.readOnly).toBe(true);
    expect(plugin.newerData).toEqual({ format: 2, savedWith: "1.6.0", source: "data.json" });
    const persistent = Notice.shown.filter((n) => n.timeout === 0);
    expect(persistent).toHaveLength(1);
    expect(persistent[0].message).toContain("updated by a newer Hexmap World Creator (version 1.6.0)");
  });

  it("zero vault writes and no data.json save through a full load and simulated edits", async () => {
    const { plugin, fake } = await load(UPGRADED_VAULT, { ...BASE_DATA, dataFormat: 2 });
    await simulateEdits(plugin, fake);
    for (const type of [VIEW_TYPE_HEX_MAP, VIEW_TYPE_HEX_TABLE, VIEW_TYPE_RANDOM_TABLES, VIEW_TYPE_SETUP_WIZARD]) {
      await fake.openView(type);
    }
    expect(fake.writes).toEqual([]);
    expect(plugin.__saves).toEqual([]);
  });

  it("every view is the read-only notice", async () => {
    const { fake } = await load(UPGRADED_VAULT, { ...BASE_DATA, dataFormat: 2 });
    for (const type of [VIEW_TYPE_HEX_MAP, VIEW_TYPE_HEX_TABLE, VIEW_TYPE_RANDOM_TABLES, VIEW_TYPE_SETUP_WIZARD]) {
      const view = await fake.openView(type);
      expect(view).toBeInstanceOf(SafetyModeView);
      expect((view as SafetyModeView).getViewType()).toBe(type);
      expect((view as unknown as { contentEl: { allText(): string } }).contentEl.allText()).toContain("Update this device's plugin");
    }
  });

  it("the settings tab shows only the notice", async () => {
    const { plugin } = await load(UPGRADED_VAULT, { ...BASE_DATA, dataFormat: 2 });
    const tab = plugin.settingTabs[0];
    tab.display();
    expect((tab.containerEl as unknown as { allText(): string }).allText()).toContain("Read-only on this device");
    expect(tab.getSettingDefinitions()).toHaveLength(1);
  });

  it("a map note alone (data.json not synced) is enough", async () => {
    const { plugin, fake } = await load(UPGRADED_VAULT, { ...BASE_DATA, savedWith: undefined });
    expect(plugin.newerData).toEqual({ format: 2, savedWith: null, source: "map note" });
    await simulateEdits(plugin, fake);
    expect(fake.writes).toEqual([]);
    expect(plugin.__saves).toEqual([]);
  });

  it("a stamp synced in while running switches to read-only", async () => {
    const { plugin, fake } = await load(OLD_VAULT, { ...BASE_DATA, dataFormat: 1 });
    expect(plugin.readOnly).toBe(false);
    const savesBefore = plugin.__saves.length;
    const writesBefore = fake.writes.length;
    plugin.__data = { ...BASE_DATA, dataFormat: 2, savedWith: "1.6.1" };
    await plugin.onExternalSettingsChange();
    expect(plugin.newerData?.savedWith).toBe("1.6.1");
    await simulateEdits(plugin, fake);
    expect(fake.writes.slice(writesBefore)).toEqual([]);
    expect(plugin.__saves.length).toBe(savesBefore);
    expect(await fake.openView(VIEW_TYPE_HEX_MAP)).toBeInstanceOf(SafetyModeView);
  });
});

describe("1.5.7: vaults without the stamp behave as before", () => {
  for (const [label, extra] of [["dataFormat missing", {}], ["dataFormat 1", { dataFormat: 1 }]] as const) {
    it(`${label} → normal mode, startup upkeep and edits write as in 1.5.6`, async () => {
      const { plugin, fake } = await load(OLD_VAULT, { ...BASE_DATA, ...extra });
      expect(plugin.readOnly).toBe(false);
      expect(Notice.shown.filter((n) => n.timeout === 0)).toEqual([]);
      // Startup upkeep ran: the flat hex note moved, the "isles" folder registered.
      expect(fake.writes).toContain("fileManager.renameFile world/hexes/9_9.md");
      expect(plugin.settings.maps.map((m) => m.name)).toContain("isles");
      await simulateEdits(plugin, fake, false);
      expect(fake.writes.length).toBeGreaterThan(1);
      expect(plugin.__saves.length).toBeGreaterThan(0);
      expect(await fake.openView(VIEW_TYPE_SETUP_WIZARD)).not.toBeInstanceOf(SafetyModeView);
    });
  }

  it("saving keeps keys this version doesn't know (dataFormat, savedWith, migrationsRun, …)", async () => {
    const { plugin } = await load(OLD_VAULT, { ...BASE_DATA, dataFormat: 1 });
    await plugin.saveSettings();
    const saved = plugin.__saves[plugin.__saves.length - 1];
    expect(saved["dataFormat"]).toBe(1);
    expect(saved["savedWith"]).toBe("1.6.0");
    expect(saved["migrationsRun"]).toEqual(["v1.5-map-data-to-map-notes"]);
    expect(saved["someFutureKey"]).toEqual({ keep: true });
  });
});
