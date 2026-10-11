#!/usr/bin/env node
/**
 * `npm run premerge`: everything that must pass before merging into
 * feat/region-notes or deploying a build into the live vault (owner
 * decision WM5). Runs, in order, stopping at the first failure:
 *   build, lint, unit tests, integration tests, the smoke vault matrix
 *   (on the build just made: --no-build).
 * Extra arguments go to the smoke suite (e.g. --only fresh,v155 --jobs 2).
 * Run it where npm works for this repo (WSL; see CLAUDE.md).
 */
import { spawnSync } from "node:child_process";

const smokeArgs = process.argv.slice(2);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  ["build", npm, ["run", "build"]],
  ["lint", npm, ["run", "lint"]],
  ["unit tests", npm, ["test"]],
  ["integration tests", npm, ["run", "test:integration"]],
  ["smoke vault matrix", process.execPath, ["dev/smoke/cli.mjs", "--no-build", ...smokeArgs]],
];

const banner = (lines) => {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  console.log("\n" + "#".repeat(w));
  for (const l of lines) console.log(`# ${l.padEnd(w - 4)} #`);
  console.log("#".repeat(w) + "\n");
};

const t0 = Date.now();
for (const [name, cmd, args] of steps) {
  console.log(`\n=== premerge: ${name} ===`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    banner([`PREMERGE FAILED at: ${name} (exit ${r.status ?? r.signal ?? r.error?.message})`, "Do NOT merge into feat/region-notes or deploy to the live vault."]);
    process.exit(1);
  }
}
banner([`PREMERGE PASSED in ${Math.round((Date.now() - t0) / 1000)} s`, "Stamp: dev/smoke/last-pass.json"]);
