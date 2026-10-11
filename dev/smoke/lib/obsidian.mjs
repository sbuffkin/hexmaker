/**
 * Sandboxed Obsidian for the smoke suite: wraps the fresh-eyes tester's
 * sandbox.mjs (create / launch / stop) and its CDP helpers.
 *
 * SAFETY: every sandbox lives in its own run folder with its own Electron
 * profile; `stop` kills only processes whose command line holds that
 * profile path. Before anything runs in a page, the open vault is checked
 * to be the run's own vault.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TOOLS_DIR = process.env.UX_TOOLS_DIR
  ?? process.env.UX_SANDBOX_DIR
  ?? "C:/Users/markr/work/tools/skills-share/ux-testing/fresh-eyes-tester/scripts";
export const SANDBOX = path.join(TOOLS_DIR, "sandbox.mjs");

let commonMod = null;
export async function common() {
  if (!commonMod) commonMod = await import(pathToFileURL(path.join(TOOLS_DIR, "lib", "common.mjs")).href);
  return commonMod;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run sandbox.mjs; resolves its stdout (the last JSON object it printed) or rejects with its stderr. */
function sandbox(args, { timeout = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [SANDBOX, ...args], { encoding: "utf8", timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`sandbox ${args[0]} failed: ${(stderr || err.message).trim().slice(-2000)}`)); return; }
      const i = stdout.lastIndexOf("\n{");
      const json = stdout.slice(i >= 0 ? i + 1 : stdout.indexOf("{"));
      try { resolve(JSON.parse(json)); } catch { resolve({ raw: stdout }); }
    });
  });
}

export async function createSandbox({ pluginDir, seed, pluginData, name }) {
  const args = ["create", "--plugin-dir", pluginDir, "--name", name];
  if (seed) args.push("--seed", seed);
  if (pluginData) args.push("--plugin-data", pluginData);
  return sandbox(args);
}

export const launchSandbox = (runDir) => sandbox(["launch", "--run", runDir, "--width", "1400", "--height", "900"], { timeout: 240_000 });
export const stopSandbox = (runDir) => sandbox(["stop", "--run", runDir], { timeout: 60_000 });

/**
 * Every Obsidian.exe process: { pid, main, cmd }. `main` = the browser
 * (top) process; helpers carry `--type=`. Counting main processes is
 * stable; helper processes come and go on their own.
 */
export function obsidianProcesses() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='Obsidian.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; cmd = $_.CommandLine } } | ConvertTo-Json -Compress";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" }).trim();
  if (!out) return [];
  const list = [].concat(JSON.parse(out));
  return list.map((p) => ({ pid: p.pid, cmd: p.cmd ?? "", main: !/--type=/.test(p.cmd ?? "") }));
}

/**
 * A connected sandbox page with console capture. A fresh CDP session's
 * Runtime.enable replays the messages logged before it attached, so errors
 * thrown while the plugin loaded (before we connected) are caught too.
 */
export async function connectPage(runDir) {
  const c = await common();
  const run = c.readRun(runDir);
  const { browser, page } = await c.connect(run);
  const base = await c.assertSandboxVault(page, run);
  if (!base || !c.samePath(base, run.vault)) {
    browser.disconnect();
    throw new Error(`SAFETY: open vault ${base} is not the sandbox vault ${run.vault}`);
  }
  const log = [];
  const session = await page.createCDPSession();
  session.on("Runtime.consoleAPICalled", (e) => {
    if (e.type !== "error" && e.type !== "warning" && e.type !== "assert") return;
    const text = e.args.map((a) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" ");
    const frames = (e.stackTrace?.callFrames ?? []).map((f) => f.url).join(" ");
    log.push({ level: e.type === "warning" ? "warning" : "error", text: text.slice(0, 2000), where: frames.slice(0, 500), ts: e.timestamp });
  });
  session.on("Runtime.exceptionThrown", (e) => {
    const d = e.exceptionDetails;
    const text = d.exception?.description ?? d.text ?? "exception";
    const frames = (d.stackTrace?.callFrames ?? []).map((f) => f.url).join(" ") + " " + (d.url ?? "");
    log.push({ level: "pageerror", text: String(text).slice(0, 2000), where: frames.slice(0, 500), ts: d.timestamp });
  });
  await session.send("Runtime.enable");
  page.setDefaultTimeout(600_000);
  return {
    run, browser, page, log,
    async close() {
      try { await session.detach(); } catch { /* gone */ }
      browser.disconnect();
    },
  };
}

/** Errors that belong to this plugin (its code, its id or its name in the text or stack). */
export function pluginErrors(log, pluginId) {
  const mine = new RegExp(`plugin:${pluginId}|hexmaker|hexmap world creator|duckmage`, "i");
  return log.filter((e) => e.level !== "warning" && (mine.test(e.text) || mine.test(e.where)));
}

/** Screenshot to the run's shots folder; never throws. */
export async function shot(page, runDir, name) {
  try {
    const file = path.join(runDir, "shots", `${name}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    return file;
  } catch { return null; }
}
