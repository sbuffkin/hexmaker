/**
 * B2 (release plan): "Undo the 2.0 upgrade". Feasibility was checked in a
 * real Obsidian sandbox (dev/smoke, the upgrade case); these tests hold the
 * order that makes it safe and the choice of which notes go back.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { Modal, Notice } from "obsidian";
import { backUpDataJson, listSnapshots, oldestSince, planUndo, writePreUpgradeSnapshot } from "../src/upgrade/undoUpgrade";
import { runUndo, undoUpgradeCommand } from "../src/upgrade/undoRun";
import { writeJsonBackup } from "../src/backup";
import { SettingsPersistence } from "../src/plugin/settingsPersistence";
import { MemVault } from "./helpers/memVault";
import { readSource } from "./helpers/source";
import type HexmakerPlugin from "../src/HexmakerPlugin";

(globalThis as Record<string, unknown>).window ??= globalThis;

const DIR = ".obsidian/plugins/hexmaker";
const BACKUPS = `${DIR}/backups`;
const DATA_OLD = JSON.stringify({ savedWith: "1.5.8", maps: [{ name: "coast" }] });
const DATA_NEW = JSON.stringify({ dataFormat: 2, savedWith: "2.0.0-rc.2", maps: [{ name: "coast" }] });
const HEX = "world/hexes/coast/1_2.md";
const T0 = new Date("2026-11-16T10:00:00.000Z");

/** A vault as 1.5.8 left it, upgraded: the snapshot, two rewrites of one hex note, a table backup, a self-made backup. */
async function upgraded() {
  const vault = new MemVault({
    [`${DIR}/data.json`]: DATA_NEW,
    [HEX]: "---\nhexmaker-map: x\n---\nthird\n",
    "world/tables/beach.md": "| d6 | Result | Weight |\nnow\n",
  });
  const a = vault.app().vault.adapter;
  // Before the snapshot: an older backup of the same hex, which must not go back.
  await writeJsonBackup(a, `${BACKUPS}/map-notes-2026-10-01`, "old", JSON.stringify({ savedAt: "2026-10-01T08:00:00.000Z", notes: { [HEX]: "older still\n" } }));
  vault.files.set(`${DIR}/data.json`, DATA_OLD);
  await writePreUpgradeSnapshot(a as never, BACKUPS, `${DIR}/data.json`, T0);
  vault.files.set(`${DIR}/data.json`, DATA_NEW);
  await writeJsonBackup(a, `${BACKUPS}/map-notes-2026-11-16`, "coast-hex-notes", JSON.stringify({ map: "coast", savedAt: "2026-11-16T10:00:05.000Z", notes: { [HEX]: "first\n" } }));
  await writeJsonBackup(a, `${BACKUPS}/note-formats-2026-11-16`, "hex-map-key", JSON.stringify({ kind: "note-format-hex-map-key", savedAt: "2026-11-16T10:00:09.000Z", notes: { [HEX]: "second\n", "world/tables/beach.md": "| d6 | Result |\n" } }));
  await writeJsonBackup(a, `${BACKUPS}/restore-2026-11-16`, "before-restore", JSON.stringify({ kind: "before-restore", savedAt: "2026-11-16T11:00:00.000Z", notes: { "world/other.md": "2.0 text\n" } }));
  return vault;
}

describe("B2: which notes go back", () => {
  it("each note's text in the OLDEST backup made since the snapshot", () => {
    const got = oldestSince([
      { savedAt: "2026-11-16T10:00:09Z", notes: { "a.md": "second", "b.md": "b-only" } },
      { savedAt: "2026-11-16T10:00:05Z", notes: { "a.md": "first" } },
      { savedAt: "2026-10-01T00:00:00Z", notes: { "a.md": "before the snapshot" } },
      { savedAt: "2026-11-16T12:00:00Z", kind: "before-restore", notes: { "c.md": "2.0 text" } },
      { savedAt: "2026-11-16T12:00:01Z", kind: "before-undo-2.0", notes: { "d.md": "2.0 text" } },
      { notes: { "e.md": "undated" } },
    ], "2026-11-16T10:00:00Z");
    expect(got).toEqual({ "a.md": "first", "b.md": "b-only" });
  });

  it("drops unsafe paths", () => {
    expect(oldestSince([{ savedAt: "2026-11-17T00:00:00Z", notes: { "../x.md": "x", "ok.md": "y" } }], "2026-11-16T00:00:00Z")).toEqual({ "ok.md": "y" });
  });

  it("plans from the newest snapshot and its backups, leaving out the older and the restore ones", async () => {
    const vault = await upgraded();
    const plan = await planUndo(vault.app().vault.adapter as never, BACKUPS);
    expect(plan?.snapshot.dataJson).toBe(DATA_OLD);
    expect(plan?.notes).toEqual({ [HEX]: "first\n", "world/tables/beach.md": "| d6 | Result |\n" });
    expect(plan?.backups).toBe(2);
  });

  it("no snapshot, no plan", async () => {
    expect(await planUndo(new MemVault().app().vault.adapter as never, BACKUPS)).toBeNull();
    const vault = new MemVault();
    await writeJsonBackup(vault.app().vault.adapter, `${BACKUPS}/x`, "n", JSON.stringify({ savedAt: "2026-11-16T10:00:00Z", notes: { "a.md": "t" } }));
    expect(await planUndo(vault.app().vault.adapter as never, BACKUPS)).toBeNull();
    expect((await listSnapshots(vault.app().vault.adapter as never, BACKUPS)).length).toBe(0);
  });

  it("an upgrade done twice undoes the later one", async () => {
    const vault = await upgraded();
    await writePreUpgradeSnapshot(vault.app().vault.adapter as never, BACKUPS, `${DIR}/data.json`, new Date("2026-11-20T09:00:00.000Z"));
    const snaps = await listSnapshots(vault.app().vault.adapter as never, BACKUPS);
    expect(snaps.map((s) => s.savedAt)).toEqual(["2026-11-20T09:00:00.000Z", "2026-11-16T10:00:00.000Z"]);
  });
});

/** A plugin stub that logs the order of what the undo does. */
function plugin(vault: MemVault, log: string[]) {
  const app = vault.app();
  const p = {
    app: { ...app, plugins: { disablePlugin: async (id: string) => { log.push(`disable ${id}`); } } },
    manifest: { dir: DIR, id: "hexmaker" },
    backupsFolder: () => BACKUPS,
    mapStore: { flush: async () => { log.push("flush"); } },
    settingsIO: { freeze: () => { log.push("freeze"); } },
  };
  // Every write after the disable is logged too (the notes, then data.json).
  const write = app.vault.adapter.write;
  app.vault.adapter.write = async (path: string, c: string) => { log.push(`write ${path}`); return write(path, c); };
  const process = app.vault.process;
  app.vault.process = async (f: never, fn: (s: string) => string) => { log.push(`process ${(f as { path: string }).path}`); return process(f, fn); };
  return p as unknown as HexmakerPlugin;
}

describe("B2: running the undo", () => {
  it("backs up, lets writes finish, freezes saves, disables, THEN puts the notes and data.json back", async () => {
    const vault = await upgraded();
    const log: string[] = [];
    const p = plugin(vault, log);
    const plan = (await planUndo(vault.app().vault.adapter as never, BACKUPS))!;
    log.length = 0;
    await runUndo(p, plan);
    const at = (s: string) => log.findIndex((l) => l.startsWith(s));
    expect(log.slice(0, 3)).toEqual(["flush", "freeze", "disable hexmaker"]);
    expect(at("process " + HEX)).toBeGreaterThan(at("disable"));
    expect(at(`write ${DIR}/data.json`)).toBeGreaterThan(at("process " + HEX));
    // The notes are 1.5.x's again and data.json is byte for byte what it was.
    expect(vault.files.get(HEX)).toBe("first\n");
    expect(vault.files.get("world/tables/beach.md")).toBe("| d6 | Result |\n");
    expect(vault.files.get(`${DIR}/data.json`)).toBe(DATA_OLD);
  });

  it("keeps 2.0's data.json and the notes as they were, in the backups folder, before changing anything", async () => {
    const vault = await upgraded();
    const p = plugin(vault, []);
    const plan = (await planUndo(vault.app().vault.adapter as never, BACKUPS))!;
    await runUndo(p, plan);
    const names = [...vault.binaries.keys()];
    expect(names.some((n) => n.includes("undo-2026-11-16") || n.includes("undo-2.0-"))).toBe(true);
    expect(names.some((n) => n.includes("restore-") && n.endsWith("before-restore.json.gz"))).toBe(true);
    // Running it again undoes the same upgrade: the self-made backups aren't read as upgrade backups.
    const again = await planUndo(vault.app().vault.adapter as never, BACKUPS);
    expect(again?.notes).toEqual(plan.notes);
  });

  it("stops before touching anything when data.json can't be backed up", async () => {
    const vault = await upgraded();
    const log: string[] = [];
    const p = plugin(vault, log);
    const plan = (await planUndo(vault.app().vault.adapter as never, BACKUPS))!;
    log.length = 0;
    vault.failBinary = true;
    Notice.shown.length = 0;
    await runUndo(p, plan);
    expect(log).toEqual([]);
    expect(vault.files.get(HEX)).toBe("---\nhexmaker-map: x\n---\nthird\n");
    expect(Notice.shown.some((n) => /nothing was undone/.test(n.msg))).toBe(true);
  });

  it("with nothing to undo it says so and opens no modal", async () => {
    const vault = new MemVault();
    Modal.opened.length = 0;
    Notice.shown.length = 0;
    await undoUpgradeCommand(plugin(vault, []));
    expect(Modal.opened).toEqual([]);
    expect(Notice.shown.some((n) => /nothing to undo/.test(n.msg))).toBe(true);
  });

  it("with a record it asks first", async () => {
    const vault = await upgraded();
    Modal.opened.length = 0;
    await undoUpgradeCommand(plugin(vault, []));
    expect(Modal.opened.length).toBe(1);
  });

  it("the backup of 2.0's data.json is its own file", async () => {
    const vault = await upgraded();
    const path = await backUpDataJson(vault.app().vault.adapter as never, BACKUPS, `${DIR}/data.json`, T0);
    expect(path).toContain("undo-2.0-2026-11-16");
  });
});

describe("B2: once undone, nothing writes data.json again", () => {
  it("a frozen SettingsPersistence drops every save", async () => {
    const written: unknown[] = [];
    const io = new SettingsPersistence({ settings: { maps: [] }, mapStore: { isReady: () => false } } as never, async (d) => { written.push(d); });
    await io.saveData({ a: 1 });
    expect(written.length).toBe(1);
    io.freeze();
    await io.saveData({ a: 2 });
    expect(written.length).toBe(1);
  });

  it("the command is registered, and the plugin's own disable is the Obsidian one", () => {
    expect(readSource("src", "plugin", "commands.ts")).toContain('id: "undo-2-0-upgrade", name: "Undo the 2.0 upgrade"');
    expect(readSource("src", "upgrade", "undoRun.ts")).toContain("disablePlugin");
  });
});
