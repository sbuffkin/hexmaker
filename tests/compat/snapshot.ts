/**
 * Write this version's compatibility examples (generator, save, map) to
 * tests/fixtures/compat/<manifest version>/. Run by `npm run version` on
 * every bump, or by hand with `npm run compat:snapshot`.
 *
 * Never overwrites an existing version's set: those files are the record of
 * what that version wrote, and tests/compat.test.ts checks the current code
 * still reads them. Pass --force only to regenerate the set for an
 * unreleased version.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { exampleFiles } from "./examples";

const root = process.cwd();
const version = (JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as { version: string }).version;
const dir = path.join(root, "tests", "fixtures", "compat", version);
const force = process.argv.includes("--force");

if (existsSync(dir) && !force) {
  console.log(`Compat examples for ${version} already exist; leaving them as they are.`);
} else {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(exampleFiles(version))) writeFileSync(path.join(dir, name), text);
  console.log(`Wrote compat examples for ${version} to ${path.relative(root, dir)}.`);
}
