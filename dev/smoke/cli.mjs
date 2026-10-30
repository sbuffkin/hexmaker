#!/usr/bin/env node
/**
 * `npm run smoke` entry. On Windows and native Linux (the Flathub
 * Obsidian, run headless by sandbox.mjs) this just runs run.mjs; under
 * WSL it hands over to node.exe with the same arguments and passes its
 * exit code back, since WSL can't drive Linux Obsidian there.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, "run.mjs");
const args = process.argv.slice(2);

const isWsl = process.platform === "linux" && /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"));
if (process.platform === "win32" || (process.platform === "linux" && !isWsl)) {
  process.argv = [process.argv[0], RUN, ...args];
  await import(pathToFileURL(RUN).href);
} else if (isWsl) {
  const winRun = execFileSync("wslpath", ["-w", RUN], { encoding: "utf8" }).trim();
  const r = spawnSync("node.exe", [winRun, ...args], { stdio: "inherit" });
  if (r.error) {
    console.error(`Couldn't start Windows node (node.exe) from WSL: ${r.error.message}. Install Node on Windows, or run: node dev/smoke/run.mjs from a Windows shell.`);
    process.exit(2);
  }
  process.exit(r.status ?? 1);
} else {
  console.error("The smoke suite needs Obsidian on Windows or Linux.");
  process.exit(2);
}
