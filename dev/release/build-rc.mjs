#!/usr/bin/env node
/**
 * A release candidate build, for the owner to try before anything lands
 * (plan-release-slicing §6): `node dev/release/build-rc.mjs --out <folder>
 * --version 2.0.0-rc.1 [--slices <spec>]`.
 *
 * Writes main.js (the released set unless --slices says otherwise),
 * manifest.json with that version, styles.css and the release README into
 * the folder. Nothing in the repo changes: the manifest's version is only
 * bumped for a release.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const out = arg("--out");
const version = arg("--version");
if (!out || !version) {
	console.error("usage: build-rc.mjs --out <folder> --version <x.y.z-rc.n> [--slices <spec>]");
	process.exit(2);
}
const dir = resolve(out);
mkdirSync(dir, { recursive: true });
execFileSync(process.execPath, ["esbuild.config.mjs", "production"], {
	cwd: ROOT,
	stdio: "inherit",
	env: { ...process.env, HEXMAKER_OUTFILE: join(dir, "main.js"), HEXMAKER_VERSION: version, ...(arg("--slices") ? { HEXMAKER_SLICES: arg("--slices") } : {}) },
});
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
writeFileSync(join(dir, "manifest.json"), `${JSON.stringify({ ...manifest, version }, null, "\t")}\n`);
copyFileSync(join(ROOT, "styles.css"), join(dir, "styles.css"));
renameSync(join(dir, "dist", "README.md"), join(dir, "README.md"));
console.log(`${dir}: main.js, manifest.json (${version}), styles.css, README.md`);
