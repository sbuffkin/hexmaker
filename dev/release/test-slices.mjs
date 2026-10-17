#!/usr/bin/env node
/**
 * npm run test:slices — the contract suite under each feature-switch set
 * (plan "every major feature a slice", S0.2). The full suite runs once with
 * every slice on (npm test); this runs the tests that say what each slice
 * adds and what the core looks like without it:
 *
 *   - each flagged slice off on its own (with the slices that require it);
 *   - HEXMAKER_SLICES=released (the release build's set);
 *   - HEXMAKER_SLICES=none (foundation only).
 *
 * Options:
 *   --only <name>[,<name>…]  run only these sets ("off:space", "released", "none")
 *   --check-release          after each set's tests, npm run check:release for the
 *                            same set (CI's slices matrix: one set per job)
 *   --list                   print the sets and the contract files, then exit
 *
 * The contract suite (CONTRACT below): module*, releaseSlices, readmeCommands,
 * workModeCoverage, placement*, the settings tab tests, and each slice's own
 * tests/slice-<id>.test.ts. Exit 0 when every set passes.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { flaggedSlices, offClosure } from "./slices.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The contract suite: tests that must hold with any set of slices built. */
export const CONTRACT = [
	/^module.*\.test\.ts$/,
	/^releaseSlices\.test\.ts$/,
	/^readmeCommands\.test\.ts$/,
	/^workModeCoverage\.test\.ts$/,
	/^placement.*\.test\.ts$/,
	/^disclosure\.test\.ts$/,
	/^uiControls\.test\.ts$/,
	/^slice-.*\.test\.ts$/,
];

export function contractFiles() {
	return readdirSync(join(ROOT, "tests")).filter((f) => CONTRACT.some((re) => re.test(f))).sort();
}

/** Each set the suite runs under: a name and the env it sets. */
export function sliceRuns() {
	return [
		...flaggedSlices().map((id) => ({ name: `off:${id}`, env: { HEXMAKER_SLICES: "all", HEXMAKER_SLICES_OFF: offClosure([id]).join(",") }, check: ["--off", id] })),
		{ name: "released", env: { HEXMAKER_SLICES: "released" }, check: ["--slices", "released"] },
		{ name: "none", env: { HEXMAKER_SLICES: "none" }, check: ["--slices", "none"] },
	];
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("test-slices.mjs")) {
	const args = process.argv.slice(2);
	const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : undefined;
	const runs = sliceRuns().filter((r) => !only || only.includes(r.name));
	const unknown = (only ?? []).filter((n) => !sliceRuns().some((r) => r.name === n));
	if (unknown.length) {
		console.error(`test:slices: no set ${unknown.join(", ")} (have: ${sliceRuns().map((r) => r.name).join(", ")})`);
		process.exit(2);
	}
	const files = contractFiles().map((f) => `tests/${f}`);
	if (args.includes("--list")) {
		for (const r of runs) console.log(`${r.name}\t${Object.entries(r.env).map(([k, v]) => `${k}=${v}`).join(" ")}`);
		console.log(files.join("\n"));
		process.exit(0);
	}
	const tsx = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
	const results = [];
	for (const r of runs) {
		console.log(`\n── ${r.name} (${Object.entries(r.env).map(([k, v]) => `${k}=${v}`).join(" ")}) ──`);
		// Clear the caller's switch so each set is exactly what it says.
		const env = { ...process.env, HEXMAKER_SLICES: "", HEXMAKER_SLICES_ON: "", HEXMAKER_SLICES_OFF: "", ...r.env };
		const res = spawnSync(process.execPath, [tsx, "--tsconfig", "./tsconfig.test.json", "--import", "./tests/register.mjs", "--test", "--test-reporter=dot", ...files], { cwd: ROOT, env, stdio: "inherit" });
		results.push({ name: r.name, ok: res.status === 0 });
		if (args.includes("--check-release")) {
			const chk = spawnSync(process.execPath, [join(ROOT, "dev", "release", "check-release.mjs"), ...r.check], { cwd: ROOT, env: { ...process.env, HEXMAKER_SLICES: "", HEXMAKER_SLICES_ON: "", HEXMAKER_SLICES_OFF: "" }, stdio: "inherit" });
			results.push({ name: `${r.name} check:release`, ok: chk.status === 0 });
		}
	}
	console.log("");
	for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
	const failed = results.filter((r) => !r.ok).length;
	console.log(failed ? `\ntest:slices FAILED (${failed} of ${results.length})` : `\ntest:slices PASSED (${results.length} sets)`);
	process.exit(failed ? 1 : 0);
}
