/**
 * The 2.0 upgrade question and its undo (release plan B1, B2), on a vault
 * 1.5.x wrote. Runs the plugin as a user meets it:
 *
 *   1. the question shows, the plugin is idle, Not now writes nothing;
 *   2. the next load asks again; Upgrade now converts (data.json saved first);
 *   3. Undo the 2.0 upgrade puts every rewritten note and data.json back, byte
 *      for byte, switches the plugin off, and nothing re-migrates or rewrites
 *      them afterwards (the feasibility question in src/upgrade/undoUpgrade.ts);
 *   4. a restart before 1.5.8 is installed sees the old data and asks again.
 *
 * Screenshots go to the run's shots folder: upgrade-ask, undo-confirm, undo-done.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Every .md file of the vault outside .obsidian: path → hash. */
function notes(vault) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== ".obsidian" && e.name !== ".trash") walk(p); }
      else if (e.isFile() && e.name.endsWith(".md")) out[path.relative(vault, p).replace(/\\/g, "/")] = sha(fs.readFileSync(p));
    }
  };
  walk(vault);
  return out;
}

/** Wait in the page for a selector (a modal), returning its text, or null. */
const modal = (c, selector, ms = 90_000) => c.ev(async (sel, limit) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    const el = document.querySelector(sel);
    if (el) return el.innerText;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}, selector, ms);

const click = (c, selector) => c.ev((sel) => { const b = document.querySelector(sel); if (b) b.click(); return !!b; }, selector);

export async function upgradeUndoCase(c) {
  const out = [];
  const rec = (check, ok, detail) => out.push({ check, ok: !!ok, detail: String(detail) });
  const id = c.pluginId;
  const pluginDir = path.join(c.vault, ".obsidian", "plugins", id);
  const loaded = () => c.ev((pid) => ({ loaded: !!window.app.plugins.plugins[pid], started: !!window.app.plugins.plugins[pid]?.started, commands: Object.keys(window.app.commands.commands).filter((k) => k.startsWith(`${pid}:`)) }), id);

  // 1. The question, with the plugin idle.
  const first = await modal(c, ".duckmage-upgrade-ask");
  const idle = await loaded();
  rec("B1-asks", !!first && /This update converts your maps\. Back up your vault first\./.test(first) && /Upgrade now/.test(first) && /Not now/.test(first), first ? first.replace(/\s+/g, " ").slice(0, 200) : "no question was shown");
  rec("B1-idle", idle.loaded && !idle.started && idle.commands.join(",") === `${id}:upgrade-to-2`, JSON.stringify(idle));
  // Modals centre on the viewport as they open: close it, size the headless window, open it again for the picture.
  await click(c, ".duckmage-upgrade-later");
  await c.fixViewport();
  await c.ev((pid) => { void window.app.commands.executeCommandById(`${pid}:upgrade-to-2`); }, id);
  await modal(c, ".duckmage-upgrade-ask", 15_000);
  await c.sleep(600);
  await c.shot("upgrade-ask");
  const dataBefore = fs.readFileSync(c.dataFile);
  const filesBefore = c.snapshot(c.vault, id);
  const notesBefore = notes(c.vault);

  // Not now: nothing is written, the plugin stays idle.
  await click(c, ".duckmage-upgrade-later");
  await c.sleep(5000);
  const afterLater = c.diff(filesBefore, c.snapshot(c.vault, id));
  const idle2 = await loaded();
  rec("B1-not-now", !idle2.started && afterLater.added.length + afterLater.removed.length + afterLater.changed.length === 0 && Buffer.compare(dataBefore, fs.readFileSync(c.dataFile)) === 0,
    `started ${idle2.started}; added ${afterLater.added.length}, removed ${afterLater.removed.length}, changed ${afterLater.changed.length}`);

  // 2. The next load asks again.
  await c.stop();
  await c.launch();
  const again = await modal(c, ".duckmage-upgrade-ask");
  rec("B1-asks-again", !!again, again ? "the question came back on the next load" : "no question on the next load");

  // Upgrade now: data.json is saved first, then the vault is converted.
  await click(c, ".duckmage-upgrade-now");
  const ready = await c.ev(c.P.waitReady, id, 240_000);
  await c.ev(c.P.settle, id, 4000, 180_000);
  const snapDir = path.join(pluginDir, "backups");
  const snaps = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter((d) => d.startsWith("upgrade-2.0-")) : [];
  const dataAfter = JSON.parse(fs.readFileSync(c.dataFile, "utf8"));
  const mapNotes = Object.keys(notes(c.vault)).filter((p) => /\/_[^/]+\.md$/.test(p));
  rec("B1-upgrade-now", ready.ready && snaps.length === 1 && dataAfter.dataFormat >= 2 && mapNotes.length > 0, `ready ${ready.ready}; data.json copy in ${snaps.join(", ") || "(none)"}; dataFormat ${dataAfter.dataFormat}; ${mapNotes.length} map notes`);

  // 3. Undo.
  const ran = await c.ev(c.P.runCommand, `${id}:undo-2-0-upgrade`);
  const confirm = await modal(c, ".duckmage-undo-upgrade", 30_000);
  rec("B2-confirm", !!confirm && /puts back \d+ notes?/.test(confirm), `${ran}; ${confirm ? confirm.replace(/\s+/g, " ").slice(0, 200) : "no confirmation"}`);
  await c.shot("undo-confirm");
  await click(c, ".duckmage-undo-upgrade-go");
  const done = await modal(c, ".duckmage-undo-done", 90_000);
  await c.shot("undo-done");
  const off = await loaded();
  rec("B2-switched-off", !!done && !off.loaded, `${done ? done.replace(/\s+/g, " ").slice(0, 160) : "no result page"}; plugin loaded ${off.loaded}`);
  const verify = () => {
    const now = notes(c.vault);
    const bad = Object.keys(notesBefore).filter((p) => now[p] !== notesBefore[p]);
    return { bad, dataSame: Buffer.compare(dataBefore, fs.readFileSync(c.dataFile)) === 0 };
  };
  const v1 = verify();
  rec("B2-restored", v1.bad.length === 0 && v1.dataSame, `${Object.keys(notesBefore).length} notes compared, ${v1.bad.length} differ${v1.bad.length ? `: ${v1.bad.slice(0, 5).join(", ")}` : ""}; data.json byte for byte ${v1.dataSame}`);
  // Nothing migrates or rewrites them afterwards.
  await c.sleep(8000);
  const v2 = verify();
  rec("B2-stays-undone", v2.bad.length === 0 && v2.dataSame, `after 8 s: ${v2.bad.length} notes differ; data.json same ${v2.dataSame}`);

  // 4. A restart before 1.5.8 is installed.
  await c.stop();
  await c.launch();
  const asked = await modal(c, ".duckmage-upgrade-ask");
  const idle3 = await loaded();
  rec("B2-restart-asks", !!asked && !idle3.started, asked ? "the 2.0 build loaded the old data, asked, and stayed idle" : "no question after the restart");
  const v3 = verify();
  rec("B2-restart-writes-nothing", v3.bad.length === 0 && v3.dataSame, `${v3.bad.length} notes differ; data.json same ${v3.dataSame}`);
  return out;
}
