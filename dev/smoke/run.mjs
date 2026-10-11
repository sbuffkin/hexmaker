#!/usr/bin/env node
/**
 * Smoke-test vault matrix (plan-work-modes §3; owner decision WM5: run it
 * LOCALLY before merging into feat/region-notes and before any live-vault
 * deploy; CI keeps the Obsidian-free tests).
 *
 *   node dev/smoke/run.mjs [--jobs 4] [--only fresh,v155] [--build <dir>] [--no-build] [--keep] [--list]
 *
 * Windows node (Obsidian is a Windows app). From WSL use `npm run smoke`,
 * which hands over to node.exe (dev/smoke/cli.mjs).
 *
 * 1. Builds the plugin through WSL (or takes --build <dir>, or the repo's
 *    current main.js with --no-build) and snapshots main.js / manifest.json /
 *    styles.css into a temp folder, so a running `npm run dev` can't change
 *    the plugin mid-suite.
 * 2. Per vault setup (setups.mjs): builds the fixture, `sandbox.mjs create`
 *    (own vault + Electron profile), optionally a prep launch that builds
 *    maps through the plugin API, then a check launch running C1–C8, then a
 *    restart launch for C5. At most --jobs sandboxes at once (max 4).
 * 3. Stops every sandbox it started and checks no other Obsidian was
 *    touched (main-process count and pids before == after).
 * 4. Writes dev/smoke/last-run.json, and dev/smoke/last-pass.json when
 *    every setup passed: { commit, dirty, buildHash, setups, results }.
 *
 * Never touches the main vault: fixtures are generated or copied into the
 * sandbox's own run folder; the open vault is checked before any script runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  common, createSandbox, launchSandbox, stopSandbox, connectPage, obsidianProcesses, pluginErrors, shot, sleep,
} from "./lib/obsidian.mjs";
import { snapshot, diff, legacyTruth, verifyMigration, verifyBackups, noteTextHashes, verifyPaletteUpgrade } from "./lib/disk.mjs";
import * as P from "./lib/page.mjs";
import { canon, jsonDiff, oneTimeOnly } from "./lib/compare.mjs";
import { SETUPS } from "./setups.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const val = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (flag("help") || flag("h")) {
  console.log("usage: node dev/smoke/run.mjs [--jobs 4] [--only a,b] [--build <dir>] [--no-build] [--keep] [--list]");
  process.exit(0);
}
if (flag("list")) {
  for (const s of SETUPS) console.log(`${s.id.padEnd(16)} ${s.title}`);
  process.exit(0);
}
if (process.platform !== "win32") {
  console.error("dev/smoke/run.mjs drives Windows Obsidian: run it with Windows node, or `npm run smoke` from WSL.");
  process.exit(2);
}
const jobs = Math.max(1, Math.min(4, Number(val("jobs", "4")) || 4));
const only = val("only", null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
if (only) {
  const unknown = only.filter((o) => !SETUPS.some((s) => s.id === o));
  if (unknown.length) { console.error(`unknown setup(s): ${unknown.join(", ")} (see --list)`); process.exit(2); }
}
const keep = flag("keep");

const log = (...a) => console.log(`[smoke ${new Date().toISOString().slice(11, 19)}]`, ...a);
const git = (...a) => { try { return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim(); } catch { return null; } };
const toWsl = (p) => path.resolve(p).replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, "/");

// ── 1. build + snapshot ───────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const work = path.join(os.tmpdir(), "hexmaker-smoke", stamp);
fs.mkdirSync(work, { recursive: true });
let source = val("build", null);
if (!source) {
  source = ROOT;
  if (!flag("no-build")) {
    log("building (npm run build through WSL)…");
    execFileSync("wsl.exe", ["-e", "bash", "-lc", `cd '${toWsl(ROOT)}' && npm run build`], { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  }
}
const buildDir = path.join(work, "build");
fs.mkdirSync(buildDir);
const hash = crypto.createHash("sha256");
for (const f of PLUGIN_FILES) {
  const s = path.join(source, f);
  if (!fs.existsSync(s)) { if (f === "styles.css") continue; console.error(`${f} missing in ${source}`); process.exit(2); }
  const buf = fs.readFileSync(s);
  hash.update(f).update(buf);
  fs.writeFileSync(path.join(buildDir, f), buf);
}
const buildHash = hash.digest("hex").slice(0, 16);
const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, "manifest.json"), "utf8"));
const pluginId = manifest.id;
const mainJs = fs.readFileSync(path.join(buildDir, "main.js"), "utf8");
const expectedCommands = [...new Set([...mainJs.matchAll(/addCommand\(\{\s*id:\s*"([^"]+)"/g)].map((m) => `${pluginId}:${m[1]}`))];
log(`build ${buildHash} (${manifest.version}) from ${source}; ${expectedCommands.length} commands`);

// ── 2. the matrix ─────────────────────────────────────────────────────────
const selected = SETUPS.filter((s) => !only || only.includes(s.id)).sort((a, b) => Number(!!b.slow) - Number(!!a.slow));
const started = []; // { runDir, profile }
const procsBefore = obsidianProcesses();
// sandbox.mjs points runs/LATEST at each run it makes; put the owner's back afterwards.
const latestFile = (await common()).LATEST_FILE;
const latestBefore = fs.existsSync(latestFile) ? fs.readFileSync(latestFile, "utf8") : null;

/** Read-only commands run in C7 (open views; change nothing on disk). */
const READ_ONLY = ["open-hex-map", "open-hex-table", "open-random-tables"];
const ERROR_NOTICE = /couldn't|could not|error|failed|unreadable|can't read/i;

/** data.json, read again if it is caught mid-write (empty or half written). */
async function readJson(file) {
  for (let i = 0; ; i++) {
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (i >= 20) throw e; await sleep(250); }
  }
}

async function runSetup(setup) {
  const why = setup.unavailable?.();
  if (why) {
    log(`${setup.id}: SKIPPED (${why})`);
    return { id: setup.id, title: setup.title, ok: true, skipped: why, seconds: 0, runDir: null, checks: [] };
  }
  const t0 = Date.now();
  const checks = [];
  const rec = (check, ok, detail = "", extra = {}) => {
    checks.push({ check, ok: !!ok, detail: String(detail).slice(0, 4000), ...extra });
    if (!ok) log(`${setup.id}: FAIL ${check}: ${String(detail).slice(0, 300)}`);
  };
  const dir = path.join(work, setup.id);
  fs.mkdirSync(dir, { recursive: true });
  let runDir = null, vault = null, sess = null;
  const ev = (fn, ...args) => sess.page.evaluate(fn, ...args);
  const stop = async () => {
    if (sess) { await sess.close().catch(() => {}); sess = null; }
    if (runDir) {
      const r = await stopSandbox(runDir);
      if (!r.ok) rec("stop", false, JSON.stringify(r));
      return r;
    }
  };
  const launch = async () => {
    await launchSandbox(runDir);
    sess = await connectPage(runDir);
    // Expose the page helpers to setup extras (one object, re-sent per launch).
    await sess.page.evaluate(`window.__smokePage = { ${Object.entries(P).map(([k, f]) => `${k}: ${f.toString()}`).join(",\n")} };`);
  };
  try {
    log(`${setup.id}: building fixture`);
    const fx = await setup.build(dir);
    const created = await createSandbox({ pluginDir: buildDir, seed: fx.seed, pluginData: fx.pluginData, name: `smoke-${setup.id}` });
    runDir = created.runDir;
    vault = created.vault;
    started.push({ runDir, profile: path.join(runDir, "profile") });
    log(`${setup.id}: sandbox ${runDir}`);

    // ── prep launch (recipe) ──
    if (setup.recipe) {
      await launch();
      const r = await ev(P.waitReady, pluginId, 120_000);
      if (!r.ready) throw new Error(`prep: plugin not ready ${JSON.stringify(r)}`);
      const info = await ev(setup.recipe, pluginId);
      await ev(P.settle, pluginId, 2500, 120_000);
      const errs = pluginErrors(sess.log, pluginId);
      rec("prep", errs.length === 0, errs.length ? errs.map((e) => e.text).join(" || ") : JSON.stringify(info).slice(0, 600));
      await stop();
      if (setup.postPrep) setup.postPrep(vault, info, pluginId);
    }

    // ── inputs, before the check launch ──
    const dataFile = path.join(vault, ".obsidian", "plugins", pluginId, "data.json");
    const dataIn = await readJson(dataFile);
    const truth = setup.migration ? legacyTruth(vault, dataIn) : null;
    const snap0 = snapshot(vault, pluginId);

    // ── check launch ──
    await launch();
    const ready = await ev(P.waitReady, pluginId, setup.expect.readyMs ?? 120_000);
    rec("C1-ready", ready.ready, `stores ready in ${ready.ms} ms`, { ms: ready.ms });
    if (!ready.ready) throw new Error("plugin never became ready");
    await ev(P.settle, pluginId, 3000, setup.expect.readyMs ?? 120_000);
    let state = await ev(P.state, pluginId);
    const wizardAtLoad = state.wizardOpen;

    // C2: settings resolved and saved; nothing in data.json lost.
    {
      const disk = await readJson(dataFile);
      const probs = [];
      if (!disk) probs.push("no data.json written");
      else {
        if (disk.featureLevel === undefined) probs.push("featureLevel not saved");
        if (setup.expect.level && state.featureLevel !== setup.expect.level) probs.push(`level ${state.featureLevel}, expected ${setup.expect.level}`);
        if (setup.expect.level && disk.featureLevel !== setup.expect.level) probs.push(`saved level ${disk.featureLevel}, expected ${setup.expect.level}`);
        const renamed = { regions: "maps", defaultRegion: "defaultMap" };
        const lost = Object.keys(dataIn ?? {}).filter((k) => !(k in disk) && !(renamed[k] && renamed[k] in disk));
        if (lost.length) probs.push(`keys lost from data.json: ${lost.join(", ")}`);
        const inMaps = new Set((dataIn?.maps ?? dataIn?.regions ?? []).map((m) => m.name));
        const outMaps = new Set((disk.maps ?? []).map((m) => m.name));
        const goneMaps = [...inMaps].filter((m) => !outMaps.has(m));
        if (goneMaps.length) probs.push(`maps lost from data.json: ${goneMaps.join(", ")}`);
      }
      rec("C2-settings", probs.length === 0, probs.join("; ") || `level ${state.featureLevel}, ${state.maps.length} maps, palettes ${state.palettes.length}, kinds ${state.mapKinds}`);
    }

    // C3: every map opens and renders.
    const opens = [];
    let firstOpen = null;
    {
      const budget = setup.expect.openMs ?? 20_000;
      const probs = [];
      for (const m of state.maps) {
        const r = await ev(P.openMap, pluginId, m.name, budget + 5000);
        firstOpen ??= r;
        opens.push({ map: m.name, ...r });
        if (r.active !== m.name) probs.push(`${m.name}: view shows ${r.active}`);
        // Deleted by hand (SM-DEL): the view shows the missing empty state.
        else if (m.missing) { if (!r.missingState) probs.push(`${m.name}: missing, but no missing-map state shown`); }
        else if (m.broken) probs.push(`${m.name}: map note unreadable`);
        else if (r.hexes === 0 && r.canvas === 0) probs.push(`${m.name}: nothing rendered`);
        else if (!m.overworld && r.hexes !== r.expected) probs.push(`${m.name}: ${r.hexes} hexes, expected ${r.expected}`);
        if (r.ms > budget) probs.push(`${m.name}: ${r.ms} ms > ${budget} ms`);
      }
      const slow = opens.slice().sort((a, b) => b.ms - a.ms)[0];
      rec("C3-maps-open", probs.length === 0 && opens.length > 0, probs.join("; ") || `${opens.length} maps opened; slowest ${slow?.map} ${slow?.ms} ms`, { opens: opens.map((o) => [o.map, o.ms, o.hexes]) });
    }
    await ev(P.settle, pluginId, 2500, 60_000);

    // C4: untouched data unchanged on disk (migration rewrites checked separately).
    const snap1 = snapshot(vault, pluginId);
    {
      const d = diff(snap0, snap1);
      const pluginRel = `.obsidian/plugins/${pluginId}/`;
      const migrated = new Set(truth ? Object.entries(truth.notes).filter(([, t]) => t.dataKeys.length).map(([p]) => p) : []);
      // Palette notes in an older format are upgraded on load (new columns,
      // the Path types table): allowed when every terrain row is unchanged.
      const upgraded = [], paletteProbs = [];
      for (const p of d.changed) {
        if (snap0[p]?.text === undefined) continue;
        const probs = verifyPaletteUpgrade(snap0[p].text, fs.readFileSync(path.join(vault, p), "utf8"));
        if (probs.length) paletteProbs.push(`${p}: ${probs.slice(0, 4).join(", ")}`); else upgraded.push(p);
      }
      if (upgraded.length || paletteProbs.length) rec("M-palettes", paletteProbs.length === 0, paletteProbs.join("; ") || `${upgraded.length} palette notes upgraded, every terrain row kept: ${upgraded.join(", ")}`);
      const allowed = (p) => p === `${pluginRel}data.json` || migrated.has(p) || upgraded.includes(p);
      const changed = d.changed.filter((p) => !allowed(p));
      // A backup rewritten with the same bytes loses nothing; other bytes would ("changed").
      const touched = d.touched.filter((p) => !allowed(p) && !p.startsWith(`${pluginRel}backups/`));
      const removed = d.removed.filter((p) => !allowed(p));
      const ok = changed.length === 0 && removed.length === 0 && touched.length === 0;
      rec("C4-untouched", ok,
        ok ? `${Object.keys(snap0).length} files unchanged; ${d.added.length} new (${d.added.slice(0, 6).join(", ")}${d.added.length > 6 ? ", …" : ""}); ${migrated.size} migrated notes checked below`
          : `changed: ${changed.slice(0, 15).join(", ")}${changed.length > 15 ? ` (+${changed.length - 15})` : ""}; rewritten same bytes: ${touched.slice(0, 15).join(", ")}${touched.length > 15 ? ` (+${touched.length - 15})` : ""}; removed: ${removed.slice(0, 15).join(", ")}`,
        { added: d.added.length, changed: changed.length, touched: touched.length, removed: removed.length });
    }

    // Migration: map notes written, data moved exactly, backups, paths.
    if (truth) {
      const store = await ev(P.dumpStore, pluginId);
      const vm = verifyMigration(vault, truth, store);
      rec("M-data", vm.problems.length === 0, vm.problems.length ? vm.problems.slice(0, 12).join("; ") : `${vm.hexesChecked} hexes match, ${vm.cleaned} notes cleaned, ${vm.bodiesIdentical}/${vm.notesChecked} bodies identical`);
      const hexFolder = (dataIn.hexFolder ?? "").replace(/^\/+|\/+$/g, "");
      const noteProbs = [];
      for (const m of Object.keys(truth.maps)) {
        const np = path.join(vault, hexFolder, m, `_${m}.md`);
        if (!fs.existsSync(np)) { noteProbs.push(`${m}: no map note`); continue; }
        const head = fs.readFileSync(np, "utf8").slice(0, 400);
        if (!/hexmaker-map:\s*\d+/.test(head)) noteProbs.push(`${m}: map note has no hexmaker-map format`);
      }
      rec("M-map-notes", noteProbs.length === 0, noteProbs.join("; ") || `${Object.keys(truth.maps).length} map notes written`);
      const cleanedCount = Object.values(truth.notes).filter((t) => t.dataKeys.length).length;
      const b = verifyBackups(vault, pluginId, noteTextHashes(truth));
      rec("M-backups", b.mismatches === 0 && b.notes >= cleanedCount && b.backupDirs > 0, `${b.notes} notes backed up (needed ${cleanedCount}), ${b.mismatches} mismatches, ${b.mapJson} map backups`);
      const ps = await ev(P.pathState, pluginId);
      const pathProbs = [];
      let chains = 0, paths = 0;
      for (const m of dataIn.maps ?? []) {
        if (!(m.pathChains ?? []).some((c) => (c.hexes ?? []).length > 1)) continue;
        chains += m.pathChains.length;
        const s = ps[m.name];
        if (!s || s.paths === 0) pathProbs.push(`${m.name}: no paths after migration`);
        else if (typeof s.resolved !== "number" || s.resolved === 0) pathProbs.push(`${m.name}: paths don't resolve (${s.resolved})`);
        paths += s?.paths ?? 0;
      }
      rec("M-paths", pathProbs.length === 0, pathProbs.join("; ") || `${chains} legacy chains → ${paths} paths, all resolve`);
    }

    // C7: registered commands; read-only ones run cleanly.
    {
      state = await ev(P.state, pluginId);
      const missing = expectedCommands.filter((c) => !state.commands.includes(c));
      const errBefore = pluginErrors(sess.log, pluginId).length;
      const ran = [];
      for (const c of READ_ONLY) {
        const id = `${pluginId}:${c}`;
        if (!state.commands.includes(id)) continue;
        ran.push(`${c}: ${await ev(P.runCommand, id)}`);
        await ev(P.closeModals);
      }
      await sleep(500);
      const errs = pluginErrors(sess.log, pluginId).slice(errBefore);
      rec("C7-commands", missing.length === 0 && errs.length === 0, `${state.commands.length}/${expectedCommands.length} registered${missing.length ? `; missing ${missing.join(", ")}` : ""}; ran ${ran.join(", ")}${errs.length ? `; errors: ${errs.map((e) => e.text).join(" || ")}` : ""}`);
    }

    // Setup-specific checks.
    if (setup.extra) {
      const ctx = { pluginId, state, ev, log: sess.log, readyMs: ready.ms, firstOpen, wizardAtLoad, runDir, vault, snap0 };
      for (const c of await setup.extra(ctx)) rec(c.check, c.ok, c.detail);
      state = await ev(P.state, pluginId);
    }

    // C6 + C8 on the smallest plain map.
    const plain = state.maps.filter((m) => !m.overworld && m.cols * m.rows > 0).sort((a, b) => a.cols * a.rows - b.cols * b.rows);
    const target = plain.find((m) => m.hexes > 0) ?? plain[0];
    if (!target) rec("C6-paint", false, "no plain map to paint on");
    else {
      const r = await ev(P.paintRoundTrip, pluginId, target.name);
      rec("C6-paint", r.ok, `${target.name}: ${[...(r.steps ?? []), ...(r.problems ?? []), r.skipped ?? "", r.error ?? ""].filter(Boolean).join("; ")}${r.noteUnchanged === false ? "; map note text differs after undo (data same)" : ""}`);
      if (!setup.skipModeLocks) {
        const l = await ev(P.modeLocks, pluginId, target.name);
        rec("C8-mode-locks", l.ok, `${target.name}: ${[...l.steps, ...l.problems].join("; ")}`, { gaps: l.gaps });
        for (const g of l.gaps ?? []) checks.push({ check: "C8-gap", ok: true, gap: true, detail: g });
      }
    }

    // C1: no plugin errors, no error notices, over the whole check launch.
    {
      const errs = pluginErrors(sess.log, pluginId);
      const others = sess.log.filter((e) => e.level !== "warning" && !errs.includes(e));
      const ns = (await ev(P.notices)).filter((n) => ERROR_NOTICE.test(n));
      rec("C1-no-errors", errs.length === 0 && ns.length === 0,
        `${errs.length} plugin errors${errs.length ? ": " + errs.slice(0, 5).map((e) => e.text.split("\n")[0]).join(" || ") : ""}; error notices: ${ns.join(" | ") || "none"}; other console errors (not the plugin's): ${others.length}`,
        { pluginErrors: errs.slice(0, 20), otherErrors: others.slice(0, 10).map((e) => e.text.slice(0, 300)) });
    }

    // ── C5: restart rewrites nothing ──
    const storeBefore = canon(await ev(P.dumpStore, pluginId));
    const levelBefore = state.featureLevel;
    await ev(P.settle, pluginId, 3000, 60_000);
    await stop();
    const snapA = snapshot(vault, pluginId);
    const dataA = await readJson(dataFile);
    await launch();
    const r2 = await ev(P.waitReady, pluginId, setup.expect.readyMs ?? 120_000);
    await ev(P.settle, pluginId, 4000, 90_000);
    const storeAfter = canon(await ev(P.dumpStore, pluginId));
    const state2 = await ev(P.state, pluginId);
    const errs2 = pluginErrors(sess.log, pluginId);
    await stop();
    const snapB = snapshot(vault, pluginId);
    const dataB = await readJson(dataFile);
    {
      const d = diff(snapA, snapB);
      const probs = [];
      if (!r2.ready) probs.push("not ready after restart");
      const dataRel = `.obsidian/plugins/${pluginId}/data.json`;
      const dataOneTime = d.changed.includes(dataRel) && oneTimeOnly(dataA, dataB);
      const changed = dataOneTime ? d.changed.filter((p) => p !== dataRel) : d.changed;
      if (changed.length) probs.push(`changed: ${changed.slice(0, 12).join(", ")}`);
      if (changed.includes(dataRel)) probs.push(`data.json: ${jsonDiff(dataA, dataB).join("; ")}`);
      if (dataOneTime) checks.push({ check: "C5-one-time", ok: true, detail: `data.json one-time settings written on restart: ${jsonDiff(dataA, dataB).join("; ")}` });
      if (d.touched.length) probs.push(`rewritten same bytes: ${d.touched.slice(0, 12).join(", ")}`);
      if (d.added.length) probs.push(`new: ${d.added.slice(0, 12).join(", ")}`);
      if (d.removed.length) probs.push(`removed: ${d.removed.slice(0, 12).join(", ")}`);
      if (storeAfter !== storeBefore) probs.push(`map data differs after restart: ${jsonDiff(JSON.parse(storeBefore), JSON.parse(storeAfter)).join("; ")}`);
      if (state2.featureLevel !== levelBefore) probs.push(`level ${levelBefore} → ${state2.featureLevel}`);
      if (errs2.length) probs.push(`plugin errors: ${errs2.slice(0, 3).map((e) => e.text.split("\n")[0]).join(" || ")}`);
      rec("C5-restart", probs.length === 0, probs.join("; ") || `0 files rewritten, map data and level the same (ready ${r2.ms} ms)`);
    }
  } catch (e) {
    rec("crash", false, e.stack ?? String(e));
    if (sess) await shot(sess.page, runDir, `${setup.id}-crash`);
  } finally {
    try { await stop(); } catch (e) { rec("stop", false, String(e)); }
  }
  const ok = checks.every((c) => c.ok);
  log(`${setup.id}: ${ok ? "PASS" : "FAIL"} in ${Math.round((Date.now() - t0) / 1000)} s`);
  return { id: setup.id, title: setup.title, ok, seconds: Math.round((Date.now() - t0) / 1000), runDir, checks };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const t0 = Date.now();
log(`${selected.length} setups, ${jobs} at a time: ${selected.map((s) => s.id).join(", ")}`);
let results;
const onSignal = async () => {
  log("interrupted: stopping sandboxes");
  for (const s of started) await stopSandbox(s.runDir).catch(() => {});
  process.exit(130);
};
process.on("SIGINT", onSignal);
try {
  results = await pool(selected, jobs, runSetup);
} finally {
  // Belt and braces: every run stopped (stop is idempotent).
  for (const s of started) await stopSandbox(s.runDir).catch(() => {});
}

if (latestBefore !== null) fs.writeFileSync(latestFile, latestBefore);

// ── 3. other Obsidian processes untouched ────────────────────────────────
await sleep(1000);
const procsAfter = obsidianProcesses();
const mineProfiles = started.map((s) => s.profile.toLowerCase());
const isMine = (p) => mineProfiles.some((m) => p.cmd.toLowerCase().includes(m));
const otherBefore = procsBefore.filter((p) => p.main && !isMine(p));
const otherAfter = procsAfter.filter((p) => p.main && !isMine(p));
const leftMine = procsAfter.filter(isMine);
const vanished = otherBefore.filter((p) => !procsAfter.some((q) => q.pid === p.pid));
const safety = {
  otherObsidianBefore: otherBefore.length,
  otherObsidianAfter: otherAfter.length,
  otherPidsBefore: otherBefore.map((p) => p.pid),
  otherPidsAfter: otherAfter.map((p) => p.pid),
  vanished: vanished.map((p) => p.pid),
  sandboxProcessesLeft: leftMine.length,
  ok: otherBefore.length === otherAfter.length && vanished.length === 0 && leftMine.length === 0,
};

// ── 4. record ────────────────────────────────────────────────────────────
const allOk = results.every((r) => r.ok) && safety.ok;
const record = {
  ok: allOk,
  ts: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  dirty: (git("status", "--porcelain", "--untracked-files=no") ?? "") !== "",
  buildHash,
  buildSource: path.resolve(source),
  version: manifest.version,
  seconds: Math.round((Date.now() - t0) / 1000),
  jobs,
  setups: results.map((r) => r.id),
  safety,
  results: Object.fromEntries(results.map((r) => [r.id, { ok: r.ok, ...(r.skipped ? { skipped: r.skipped } : {}), title: r.title, seconds: r.seconds, runDir: r.ok && !keep ? null : r.runDir, checks: r.checks }])),
};
fs.writeFileSync(path.join(HERE, "last-run.json"), JSON.stringify(record, null, 2));
if (allOk) fs.writeFileSync(path.join(HERE, "last-pass.json"), JSON.stringify(record, null, 2));

// Passed runs are deleted (the real-data copy is ~150 MB); failed ones stay for a look.
if (!keep) {
  for (const r of results) if (r.ok && r.runDir) fs.rmSync(r.runDir, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("\n── smoke matrix ─────────────────────────────────────────────");
for (const r of results) {
  const fails = r.checks.filter((c) => !c.ok);
  const gaps = r.checks.filter((c) => c.gap);
  if (r.skipped) { console.log(`SKIP  ${r.id.padEnd(15)}         ${r.skipped}`); continue; }
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(15)} ${String(r.seconds).padStart(4)} s  ${r.checks.length} checks${gaps.length ? `, ${gaps.length} known gap(s)` : ""}`);
  for (const f of fails) console.log(`      ✗ ${f.check}: ${f.detail.split("\n")[0].slice(0, 400)}`);
}
console.log(`other Obsidian: ${safety.otherObsidianBefore} before, ${safety.otherObsidianAfter} after${safety.vanished.length ? `; VANISHED ${safety.vanished}` : ""}; sandbox processes left: ${safety.sandboxProcessesLeft}`);
const skipped = results.filter((r) => r.skipped).length;
console.log(`${allOk ? "SMOKE PASSED" : "SMOKE FAILED"}${skipped ? ` (${skipped} setup(s) SKIPPED)` : ""} (${record.seconds} s, build ${buildHash}, commit ${record.commit?.slice(0, 7)}${record.dirty ? " +dirty" : ""}) → ${path.join(HERE, allOk ? "last-pass.json" : "last-run.json")}`);
process.exit(allOk ? 0 : 1);
