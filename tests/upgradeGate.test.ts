/**
 * B1 (release plan, owner 2026-11-16): a vault 1.5.x wrote is converted only
 * after "Upgrade now". Not now = the plugin stays idle and writes nothing.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { Notice } from "./__mocks__/obsidian";
import { needsUpgradeAsk, UPGRADE_LEAD } from "../src/upgrade/upgradeGate";
import { holdForUpgrade, upgradeNow } from "../src/upgrade/hold";
import { PRE_UPGRADE_KIND, listSnapshots } from "../src/upgrade/undoUpgrade";
import { readSource, readSurface } from "./helpers/source";
import { MemVault } from "./helpers/memVault";
import type HexmakerPlugin from "../src/HexmakerPlugin";

(globalThis as Record<string, unknown>).window ??= globalThis;

const OLD = JSON.stringify({ savedWith: "1.5.8", maps: [{ name: "coast" }] });

describe("B1: who is asked", () => {
  it("asks for data 1.5.x wrote: no dataFormat, or an older one", () => {
    expect(needsUpgradeAsk({ savedWith: "1.5.8", maps: [] })).toBe(true);
    expect(needsUpgradeAsk({ dataFormat: 1, maps: [] })).toBe(true);
  });

  it("doesn't ask on a fresh install, an empty file, or data this build or a newer one wrote", () => {
    expect(needsUpgradeAsk(null)).toBe(false);
    expect(needsUpgradeAsk(undefined)).toBe(false);
    expect(needsUpgradeAsk({})).toBe(false);
    expect(needsUpgradeAsk({ dataFormat: 2, savedWith: "2.0.0-rc.1" })).toBe(false);
    expect(needsUpgradeAsk({ dataFormat: 3, savedWith: "3.0.0" })).toBe(false);
  });

  it("says what the owner asked it to say", () => {
    expect(UPGRADE_LEAD).toBe("This update converts your maps. Back up your vault first.");
  });
});

/** A plugin stub: its data.json, the commands it registered, whether start() ran. */
function stub(dataJson: string | null) {
  const vault = new MemVault(dataJson === null ? {} : { ".obsidian/plugins/hexmaker/data.json": dataJson });
  const commands: { id: string; name: string; checkCallback?: (c: boolean) => boolean }[] = [];
  let layout: (() => void) | undefined;
  const plugin = {
    app: { ...vault.app(), workspace: { onLayoutReady: (f: () => void) => { layout = f; } } },
    manifest: { dir: ".obsidian/plugins/hexmaker", id: "hexmaker" },
    started: false,
    loadData: async () => (dataJson === null ? null : (JSON.parse(dataJson) as unknown)),
    addCommand: (c: (typeof commands)[number]) => { commands.push(c); },
    backupsFolder: () => ".obsidian/plugins/hexmaker/backups",
    start: async () => { plugin.started = true; },
  };
  return { vault, plugin: plugin as unknown as HexmakerPlugin & { started: boolean }, commands, layout: () => layout };
}

describe("B1: holding the start-up", () => {
  it("holds a 1.5.x vault: one command, a modal once the layout is ready, nothing started or written", async () => {
    const s = stub(OLD);
    expect(await holdForUpgrade(s.plugin)).toBe(true);
    expect(s.plugin.started).toBe(false);
    expect(s.commands.map((c) => c.name)).toEqual(["Upgrade to 2.0…"]);
    expect(s.layout()).toBeDefined();
    expect(s.vault.writes).toEqual([]);
    expect([...s.vault.files.keys()]).toEqual([".obsidian/plugins/hexmaker/data.json"]);
    expect(s.vault.binaries.size).toBe(0);
  });

  it("the command is offered only while the plugin hasn't started", async () => {
    const s = stub(OLD);
    await holdForUpgrade(s.plugin);
    const cmd = s.commands[0];
    expect(cmd.checkCallback?.(true)).toBe(true);
    s.plugin.started = true;
    expect(cmd.checkCallback?.(true)).toBe(false);
  });

  it("lets a fresh install and a 2.0 vault start as usual", async () => {
    for (const data of [null, JSON.stringify({ dataFormat: 2, savedWith: "2.0.0-rc.1" })]) {
      const s = stub(data);
      expect(await holdForUpgrade(s.plugin)).toBe(false);
      expect(s.commands).toEqual([]);
      expect(s.layout()).toBeUndefined();
    }
  });
});

describe("B1: Upgrade now", () => {
  it("saves data.json first, then starts", async () => {
    const s = stub(OLD);
    let startedWithSnapshot = false;
    s.plugin.start = async () => {
      startedWithSnapshot = (await listSnapshots(s.vault.app().vault.adapter as never, s.plugin.backupsFolder())).length === 1;
      s.plugin.started = true;
    };
    await upgradeNow(s.plugin);
    expect(startedWithSnapshot).toBe(true);
    const [snap] = await listSnapshots(s.vault.app().vault.adapter as never, s.plugin.backupsFolder());
    expect(snap.dataJson).toBe(OLD);
    expect(snap.from).toBe("1.5.8");
    expect(PRE_UPGRADE_KIND).toBe("pre-2.0-upgrade");
  });

  it("converts nothing when the copy can't be saved", async () => {
    const s = stub(OLD);
    s.vault.failBinary = true;
    Notice.shown.length = 0;
    await upgradeNow(s.plugin);
    expect(s.plugin.started).toBe(false);
    expect(Notice.shown.some((n) => /nothing was converted/.test(n.msg))).toBe(true);
  });

  it("does nothing twice", async () => {
    const s = stub(OLD);
    await upgradeNow(s.plugin);
    const files = s.vault.binaries.size;
    await upgradeNow(s.plugin);
    expect(s.vault.binaries.size).toBe(files);
  });
});

describe("B1: wiring", () => {
  it("onload holds before anything loads, start() is the old onload, and an idle plugin's unload does nothing", () => {
    const src = readSource("src", "HexmakerPlugin.ts");
    expect(src).toMatch(/async onload\(\) \{\s+if \(await holdForUpgrade\(this\)\) return;\s+await this\.start\(\);/);
    expect(src).toMatch(/async start\(\) \{\s+this\.started = true;\s+await this\.loadSettings\(\);/);
    expect(src).toMatch(/onunload\(\) \{\s+if \(!this\.started\) return;/);
  });

  it("both modals extend HexmakerModal", () => {
    const src = readSource("src", "upgrade", "UpgradeModals.ts");
    expect(src).not.toMatch(/extends Modal\b/);
    expect([...src.matchAll(/class \w+ extends HexmakerModal/g)].length).toBe(3);
    expect(src).toContain('text: "Upgrade now"');
    expect(src).toContain('text: "Not now"');
    // Closing it any other way (Esc, the cross) is Not now.
    expect(src).toMatch(/onClose\(\): void \{\s+this\.contentEl\.empty\(\);\s+this\.answer\(this\.onLater\);/);
  });

  it("the idle plugin registers no view, store or save: only the one command", () => {
    const src = readSource("src", "upgrade", "hold.ts");
    expect(src).not.toMatch(/registerView|saveData|saveSettings|writeJsonBackup\(/);
    expect(readSurface("plugin")).toContain('id: "upgrade-to-2"');
  });
});
