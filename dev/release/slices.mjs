/**
 * Release slices (release-slices.json, plan-release-slicing): which
 * slices a build compiles in, as esbuild `define` flags, and the slice
 * markers in bundled Markdown (help.md). Shared by esbuild.config.mjs and
 * dev/release/check-release.mjs. Pure node.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** release-slices.json. */
export function readSlices() {
	return JSON.parse(readFileSync(join(ROOT, "release-slices.json"), "utf8")).slices;
}

/** The slices with a flag (every slice but foundation), in release-slices.json order. */
export function flaggedSlices(slices = readSlices()) {
	return Object.entries(slices).filter(([, s]) => s.define).map(([id]) => id);
}

/** The slices marked released. */
export function releasedSlices(slices = readSlices()) {
	return flaggedSlices(slices).filter((id) => slices[id].released);
}

/**
 * A map mark's hash (FNV-1a, 32 bits): what a build keeps of the map-note keys
 * of slices built off, so it can tell such a map without naming the slice's
 * keys in main.js. src/maps/offSliceMaps.ts computes the same.
 */
export function markHash(key) {
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/** Split an id list ("a, b" or "a,b"); blanks dropped. */
const ids = (v) => String(v ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

/**
 * The slices a build compiles in: the one switch esbuild, the tests,
 * smoke and check:release all read (the "Feature switches" section of
 * CLAUDE.md and ARCHITECTURE.md).
 *
 *   spec  HEXMAKER_SLICES or --slices: `released` | `all` | `none` | a list.
 *         A list is read left to right: `released` / `all` / `none` set the
 *         whole set, a bare id adds one (a list that starts with a bare id
 *         starts from none, so `space,worldmaps` is exactly those), `+id`
 *         adds and `-id` removes (a list that starts with `+`/`-` starts
 *         from `base`).
 *   on    HEXMAKER_SLICES_ON: ids added on top.
 *   off   HEXMAKER_SLICES_OFF: ids removed last (off wins).
 *   base  the set when there's no spec: `released` (production) or `all` (dev, tests).
 *
 * foundation is always built; an unknown id is an error, and so is a
 * slice built on while a slice it `requires` is off (both are named; no
 * silent cascade: turn the dependent off too).
 *
 * Returns the on and off sets (flagged ids, in release-slices.json order),
 * the define flags, `__HEXMAKER_SLICES__`'s value and the channel name:
 * `release` (the released set), `full` (all), else `custom +x -y` (what
 * differs from the release set).
 *
 * @param {{ spec?: string, on?: string, off?: string, base?: string, slices?: Record<string, any> }} [opts]
 * @returns {{ on: Set<string>, off: Set<string>, flags: Record<string, boolean>, channel: string, slices: string[], offMapMarks: number[] }}
 */
export function resolveSlices({ spec = undefined, on = undefined, off = undefined, base = "released", slices = readSlices() } = {}) {
	const flagged = flaggedSlices(slices);
	const named = { released: releasedSlices(slices), all: flagged, none: [] };
	const check = (id, from) => {
		if (!slices[id]) throw new Error(`release-slices.json has no slice "${id}" (in ${from}; have: ${Object.keys(slices).join(", ")})`);
		if (!slices[id].define) throw new Error(`slice "${id}" is always built (it has no define), so ${from} can't name it`);
	};
	if (!named[base]) throw new Error(`unknown base slice set "${base}" (released, all or none)`);
	const tokens = ids(spec);
	let set = new Set(tokens.length && !/^[+-]/.test(tokens[0]) && !named[tokens[0]] ? [] : named[base]);
	for (const t of tokens) {
		if (named[t]) set = new Set(named[t]);
		else if (t.startsWith("-")) { check(t.slice(1), "the slice spec"); set.delete(t.slice(1)); }
		else { const id = t.replace(/^\+/, ""); check(id, "the slice spec"); set.add(id); }
	}
	for (const id of ids(on)) { check(id, "HEXMAKER_SLICES_ON"); set.add(id); }
	for (const id of ids(off)) { check(id, "HEXMAKER_SLICES_OFF"); set.delete(id); }
	const onIds = flagged.filter((id) => set.has(id));
	const offIds = flagged.filter((id) => !set.has(id));
	const conflicts = [];
	for (const id of onIds) {
		for (const need of slices[id].requires ?? []) {
			if (slices[need] && !slices[need].define) continue;
			if (!set.has(need)) conflicts.push(`slice "${id}" is on but needs "${need}", which is off`);
		}
	}
	if (conflicts.length) {
		const fix = [...new Set(conflicts.map((c) => /^slice "([^"]+)"/.exec(c)[1]))];
		throw new Error(`${conflicts.join("; ")}. Turn ${fix.join(", ")} off too (HEXMAKER_SLICES_OFF=${[...ids(off), ...fix].join(",")}) or turn what ${fix.length > 1 ? "they need" : "it needs"} on.`);
	}
	const flags = Object.fromEntries(flagged.map((id) => [slices[id].define, set.has(id)]));
	const released = new Set(named.released);
	const plus = onIds.filter((id) => !released.has(id));
	const minus = named.released.filter((id) => !set.has(id));
	const channel = !plus.length && !minus.length ? "release" : !offIds.length ? "full" : `custom ${[...plus.map((i) => `+${i}`), ...minus.map((i) => `-${i}`)].join(" ")}`;
	const offMapMarks = offIds.flatMap((id) => slices[id].mapMarks ?? []).map(markHash);
	return { on: new Set(onIds), off: new Set(offIds), flags, channel, slices: onIds, offMapMarks };
}

/**
 * The slices built off when `ids` are: those and every slice that
 * requires one of them, transitively (check:release's off builds).
 */
/**
 * @param {Iterable<string>} offIds
 * @param {Record<string, any>} [slices]
 * @returns {string[]}
 */
export function offClosure(offIds, slices = readSlices()) {
	const out = new Set(offIds);
	for (let grew = true; grew; ) {
		grew = false;
		for (const [id, s] of Object.entries(slices)) {
			if (!out.has(id) && (s.requires ?? []).some((r) => out.has(r))) { out.add(id); grew = true; }
		}
	}
	return flaggedSlices(slices).filter((id) => out.has(id));
}

/** The slice spec a build's command line gives: `--slices=<spec>` / `--slices <spec>`, `--full` (= all); else undefined. */
/** @param {string[]} argv @returns {string | undefined} */
export function sliceSpecArg(argv) {
	const i = argv.findIndex((a) => a === "--slices" || a.startsWith("--slices="));
	if (i >= 0) return argv[i].includes("=") ? argv[i].slice("--slices=".length) : argv[i + 1];
	return argv.includes("--full") ? "all" : undefined;
}

/**
 * resolveSlices from a process: the spec from the command line, else
 * HEXMAKER_SLICES; HEXMAKER_SLICES_ON / _OFF on top.
 */
/**
 * @param {Record<string, string | undefined>} [env]
 * @param {string[]} [argv]
 * @param {string} [base]
 */
export function slicesFromEnv(env = process.env, argv = [], base = "released") {
	return resolveSlices({ spec: sliceSpecArg(argv) ?? env.HEXMAKER_SLICES, on: env.HEXMAKER_SLICES_ON, off: env.HEXMAKER_SLICES_OFF, base });
}

/**
 * The define flags for a build (older form, kept for callers): the release
 * set, or every slice with `full`, minus the `off` ids.
 */
export function sliceFlags({ full = false, off = "" } = {}) {
	return resolveSlices({ spec: full ? "all" : "released", off });
}

/** Every esbuild define a build of `resolved` (resolveSlices) needs: the slice flags and __HEXMAKER_SLICES__. */
/** @param {{ flags: Record<string, boolean>, slices: string[] }} resolved @returns {Record<string, string>} */
export function sliceDefines(resolved) {
	return {
		...Object.fromEntries(Object.entries(resolved.flags).map(([k, v]) => [k, JSON.stringify(v)])),
		__HEXMAKER_SLICES__: JSON.stringify(JSON.stringify(resolved.slices)),
		__OFF_SLICE_MAP_MARKS__: JSON.stringify(resolved.offMapMarks ?? []),
	};
}

/** The module ids (src/modules/<id>) of the given slices. */
export function sliceModules(sliceIds) {
	const slices = readSlices();
	return [...sliceIds].flatMap((id) => slices[id]?.modules ?? []);
}

/**
 * Markdown with the blocks of slices built off removed. A block is
 * `<!-- slice:<id> -->…<!-- /slice -->` (inline or over lines; HTML
 * comments, so they don't show when the Markdown is rendered).
 */
export function stripSliceMarkers(text, off) {
	return text.replace(/<!-- slice:([a-z-]+) -->([\s\S]*?)<!-- \/slice -->/g, (_m, id, body) => (off.has(id) ? "" : body));
}

/**
 * The README a build ships (release candidate artifact): README.md with
 * the blocks of slices built off removed and the markers dropped, and the
 * blank lines a removed paragraph leaves folded to one.
 */
export function releaseReadme(text, off) {
	return stripSliceMarkers(text, off).replace(/(\r?\n)(?:[ \t]*\r?\n){2,}/g, "$1$1");
}

/** Where a build writes its release README: README.md in a `dist` folder beside main.js. */
export function releaseReadmePath(outFile) {
	return join(dirname(outFile), "dist", "README.md");
}

/**
 * The text of slice `id`'s blocks in `text` (README.md): each non-blank
 * line of each block, trimmed, of at least `min` characters, leaving out
 * any that also shows outside the slice's blocks (shared wording). A
 * release README with the slice off must contain none of them.
 */
export function sliceBlockText(text, id, min = 16) {
	const without = stripSliceMarkers(text, new Set([id]));
	const out = new Set();
	for (const m of text.matchAll(/<!-- slice:([a-z-]+) -->([\s\S]*?)<!-- \/slice -->/g)) {
		if (m[1] !== id) continue;
		for (const raw of m[2].split(/\r?\n/)) {
			const line = raw.trim();
			if (line.length >= min && !without.includes(line)) out.add(line);
		}
	}
	return [...out];
}
