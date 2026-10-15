#!/usr/bin/env node
/**
 * npm run check:release — proves a slice built off leaves no trace in
 * main.js (plan-release-slicing §5.5, plan-code-modules P6).
 *
 * For each build checked (by default: every slice with a flag off on its
 * own, then all of them off; or `--off space` / `--off space,worldmaps`):
 *   1. build main.js into a temp folder with those slices off
 *      (esbuild.config.mjs production, HEXMAKER_SLICES_OFF);
 *   2. for each module of an off slice, look for what it owns
 *      (src/modules/<id>/index.ts `owns`): its command ids, its settings
 *      keys (as keys, not inside a placement id like "Settings.x"), its
 *      map-note keys and its own strings. Any hit fails, naming the slice
 *      and the text;
 *   3. the bundled help has no slice markers left;
 *   4. the release README the build wrote (dist/README.md beside main.js,
 *      README.md with the off slices' marked blocks removed) has no marker
 *      left, none of the off modules' own strings, and none of the text of
 *      the off slices' blocks in README.md.
 * A full build is checked too: it must contain every owned string, so the
 * deny-list can't pass by accident (a renamed string would), and its
 * README every slice's block text.
 *
 * Exit 0 when every build passes. Run from the repo root (uses node_modules).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSlices, releaseReadmePath, sliceBlockText } from "./slices.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const offArg = args.includes("--off") ? args[args.indexOf("--off") + 1] : undefined;

const slices = readSlices();
const flagged = Object.entries(slices).filter(([, s]) => s.define).map(([id]) => id);

/** What each module owns, read from the source (tsx, every slice on). */
function readOwns() {
	const tsx = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
	const out = execFileSync(tsx, ["--tsconfig", "./tsconfig.test.json", "--import", "./tests/register.mjs", "dev/release/owns.ts"], { cwd: ROOT, encoding: "utf8" });
	return JSON.parse(out);
}

/** Build main.js (and the release README beside it) into `dir`; returns both. */
function build(off, full, dir) {
	const outfile = join(dir, "main.js");
	execFileSync(process.execPath, ["esbuild.config.mjs", "production", ...(full ? ["--full"] : [])], {
		cwd: ROOT,
		env: { ...process.env, HEXMAKER_SLICES_OFF: off.join(","), HEXMAKER_OUTFILE: outfile },
		stdio: ["ignore", "inherit", "inherit"],
	});
	return { js: readFileSync(outfile, "utf8"), readme: readFileSync(releaseReadmePath(outfile), "utf8") };
}

/** README.md as written, with its slice markers. */
const README = readFileSync(join(ROOT, "README.md"), "utf8");
/** Each flagged slice's README block text (lines only its blocks hold). */
const readmeText = (id) => sliceBlockText(README, id);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A string as written, or as esbuild writes it in main.js (non-ASCII as a \u escape). */
const inBundle = (s) => {
	const js = s.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
	return js === s ? escape(s) : `${escape(s)}|${escape(js)}`;
};

/** Every place a module's owned text would show in a bundle. */
function needles(mod) {
	const o = mod.owns;
	return [
		...o.commands.map((c) => ({ what: `command ${c}`, re: new RegExp(`["'\`]${escape(c)}["'\`]`) })),
		// A settings key read or written (settings.x / "x"), not a placement id ("Settings.x").
		...o.settingsKeys.map((k) => ({ what: `settings key ${k}`, re: new RegExp(`(?<!"Settings\\.)\\b${escape(k)}\\b`) })),
		...o.mapNoteKeys.map((k) => ({ what: `map-note key ${k}`, re: new RegExp(`["'\`]${escape(k)}["'\`]`) })),
		...(o.strings ?? []).map((s) => ({ what: `string "${s}"`, re: new RegExp(inBundle(s)) })),
	];
}

const mods = readOwns();
const ofSlice = (id) => mods.filter((m) => m.slice === id);
for (const m of mods) {
	if (!slices[m.slice]) throw new Error(`module ${m.id}: slice "${m.slice}" isn't in release-slices.json`);
	if (!slices[m.slice].modules.includes(m.id)) throw new Error(`release-slices.json: slice "${m.slice}" doesn't list module ${m.id}`);
}

const runs = offArg ? [offArg.split(",").filter(Boolean)] : [...flagged.map((id) => [id]), ...(flagged.length > 1 ? [flagged] : [])];
const tmp = mkdtempSync(join(tmpdir(), "hexmaker-release-"));
let failed = 0;
const report = (ok, line) => {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
};

try {
	// The full build has every owned string (else the deny-list proves nothing).
	const { js: full, readme: fullReadme } = build([], true, tmp);
	for (const id of flagged) {
		for (const m of ofSlice(id)) {
			const missing = needles(m).filter((n) => !n.re.test(full)).map((n) => n.what);
			report(missing.length === 0, `full build holds ${m.id}'s ${needles(m).length} owned names${missing.length ? `; missing: ${missing.join(", ")}` : ""}`);
		}
		// README: the slice has marked text, and the full build's README keeps it (markers dropped).
		const text = readmeText(id);
		const lost = text.filter((t) => !fullReadme.includes(t));
		report(text.length > 0 && lost.length === 0 && !/<!-- \/?slice/.test(fullReadme),
			`full build's README holds ${id}'s ${text.length} marked lines${text.length ? "" : " (README.md marks none)"}${lost.length ? `; missing: ${lost.slice(0, 3).join(" | ")}` : ""}`);
	}
	for (const off of runs) {
		const { js, readme } = build(off, false, tmp);
		const label = `release build without ${off.join(" + ")} (${(js.length / 1024).toFixed(0)} KB)`;
		const hits = [];
		for (const id of off) {
			for (const m of ofSlice(id)) {
				for (const n of needles(m)) {
					const at = js.search(n.re);
					if (at >= 0) hits.push(`[${id}/${m.id}] ${n.what}: …${js.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ")}…`);
				}
			}
		}
		if (/<!-- slice:/.test(js)) hits.push("a slice marker is left in the bundled Markdown");
		report(hits.length === 0, label + (hits.length ? `\n      ${hits.join("\n      ")}` : ": no trace of the slices built off"));
		// The release README of the same build.
		const readmeHits = [];
		if (/<!-- \/?slice/.test(readme)) readmeHits.push("a slice marker is left in the README");
		for (const id of off) {
			for (const m of ofSlice(id)) {
				for (const str of m.owns.strings ?? []) if (readme.includes(str)) readmeHits.push(`[${id}/${m.id}] string "${str}"`);
			}
			for (const t of readmeText(id)) if (readme.includes(t)) readmeHits.push(`[${id}] README text: ${t.slice(0, 100)}`);
		}
		report(readmeHits.length === 0, `release README without ${off.join(" + ")}` + (readmeHits.length ? `\n      ${readmeHits.join("\n      ")}` : ": none of their text"));
	}
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `\ncheck:release FAILED (${failed})` : "\ncheck:release PASSED");
process.exit(failed ? 1 : 0);
