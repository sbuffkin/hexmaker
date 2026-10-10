#!/usr/bin/env node
/**
 * Overworld demo world for playtesting (OW7), in a THROWAWAY sandbox vault.
 *
 *   # build first (from WSL): npm run build
 *   node dev/demo-world.mjs [--seed 7] [--bench] [--no-launch-check]
 *
 * 1. `sandbox.mjs create` a new run from this worktree's built plugin, with
 *    dev/demo-seed (the `.hexmaker-sandbox` marker + "Start here.md").
 * 2. `sandbox.mjs launch` (separate Obsidian profile, its own CDP port).
 * 3. Connects, checks the open vault IS the run's vault and holds the marker,
 *    then calls plugin.devTools.buildDemoWorld() (and buildBenchWorld() with
 *    --bench: 100 regions × 64 hexes, with layer timings).
 * 4. Writes demo.json and a screenshot into the run folder, prints the run
 *    folder, and LEAVES OBSIDIAN RUNNING for the owner. Stop it with
 *    `node <sandbox.mjs> stop --run <runDir>`.
 *
 * Never touches the main vault: sandbox.mjs refuses to create runs inside a
 * vault, and this script refuses unless the open vault is the run's vault
 * and has the marker file.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SB_DIR = process.env.UX_SANDBOX_DIR ?? "C:/Users/markr/work/tools/skills-share/ux-testing/fresh-eyes-tester/scripts";
const SB = path.join(SB_DIR, "sandbox.mjs");
const MARKER = ".hexmaker-sandbox";
const PLUGIN_ID = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).id;

const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const val = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const seed = Number(val("seed", "7"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error("ERROR: " + m); process.exit(1); };

if (!fs.existsSync(path.join(ROOT, "main.js"))) die("main.js missing: build first (npm run build).");
const common = await import(pathToFileURL(path.join(SB_DIR, "lib", "common.mjs")).href);

// 1. create
const created = JSON.parse(execFileSync(process.execPath, [SB, "create", "--plugin-dir", ROOT, "--seed", path.join(HERE, "demo-seed"), "--name", flag("bench") ? "demo-bench" : "demo-world"], { encoding: "utf8" }));
const runDir = created.runDir;
if (!fs.existsSync(path.join(created.vault, MARKER))) die(`marker ${MARKER} missing in ${created.vault}`);
// 2. launch
execFileSync(process.execPath, [SB, "launch", "--run", runDir, "--width", "1500", "--height", "950"], { stdio: "inherit" });

const run = common.readRun(runDir);
const { browser, page } = await common.connect(run);
try {
  // 3. safety: the open vault is the sandbox vault, with the marker
  const base = await common.assertSandboxVault(page, run);
  if (!base || !common.samePath(base, run.vault)) die(`open vault ${base} is not the sandbox vault ${run.vault}`);
  if (!fs.existsSync(path.join(base, MARKER))) die("open vault has no sandbox marker");

  // wait for the plugin's dev tools (palettes + map store load first)
  const t0 = Date.now();
  while (!(await page.evaluate((id) => !!window.app.plugins.plugins[id]?.devTools, PLUGIN_ID))) {
    if (Date.now() - t0 > 30000) die("plugin devTools never appeared (is the marker in the vault root?)");
    await sleep(500);
  }
  const report = { runDir, vault: run.vault, seed };
  report.demo = await page.evaluate((id, s) => window.app.plugins.plugins[id].devTools.buildDemoWorld({ seed: s }), PLUGIN_ID, seed);
  if (flag("bench")) report.bench = await page.evaluate((id) => window.app.plugins.plugins[id].devTools.buildBenchWorld({ side: 10 }), PLUGIN_ID);

  // open the map view on the overworld and time the region layer
  const showAndTime = async (name) => {
    await page.evaluate(async (id, n) => {
      const p = window.app.plugins.plugins[id];
      document.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
      await p.showMap(n);
    }, PLUGIN_ID, name);
    await sleep(2500);
    // second draw: bitmaps cached (only the composite)
    const first = await page.evaluate((id) => window.app.plugins.plugins[id].devTools.overworldStats(), PLUGIN_ID);
    // Two redraws: the first may still follow the restored zoom; the second is the cached one.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view?.redraw?.());
      await sleep(1500);
    }
    const cached = await page.evaluate((id) => window.app.plugins.plugins[id].devTools.overworldStats(), PLUGIN_ID);
    return { first, cached };
  };
  if (report.bench) {
    report.benchLayer = await showAndTime(report.bench.name);
    await page.screenshot({ path: path.join(runDir, "shots", "bench-overworld.png") });
  }
  report.demoLayer = await showAndTime(report.demo.overworld);
  await page.screenshot({ path: path.join(runDir, "shots", "demo-overworld.png") });
  fs.writeFileSync(path.join(runDir, "demo.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nDemo ready. Run folder: ${runDir}`);
  console.log(`Obsidian is left running. Stop it with: node "${SB}" stop --run "${runDir}"`);
} finally {
  browser.disconnect();
}
