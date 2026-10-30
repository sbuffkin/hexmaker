/**
 * Release slices (P6): builds main.js with each slice off (and all of
 * them off) and checks the bundle holds none of what the off slices' modules
 * own (dev/release/check-release.mjs, `npm run check:release`). Slow: one
 * esbuild run per build.
 */

import { describe, it } from "node:test";
import expect from "expect";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("npm run check:release", () => {
	it("every slice-off build leaves no trace of its slice", () => {
		const r = spawnSync(process.execPath, [path.join("dev", "release", "check-release.mjs")], { cwd: process.cwd(), encoding: "utf8" });
		const out = `${r.stdout}\n${r.stderr}`;
		expect({ status: r.status, failed: out.split("\n").filter((l) => /^FAIL|^\s{6}\[/.test(l)) }).toEqual({ status: 0, failed: [] });
		expect(out).toMatch(/check:release PASSED/);
	});
});
