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

/**
 * The define flags for a build: every slice with a flag is on when it's
 * released (or `full`), unless named in `off` ("space,worldmaps").
 * Returns the flags, the set of slices off, and a channel name.
 */
export function sliceFlags({ full = false, off = "" } = {}) {
	const slices = readSlices();
	const offSet = new Set(String(off ?? "").split(",").map((s) => s.trim()).filter(Boolean));
	for (const id of offSet) {
		if (!slices[id]) throw new Error(`release-slices.json has no slice "${id}" (have: ${Object.keys(slices).join(", ")})`);
		if (!slices[id].define) throw new Error(`slice "${id}" is always built (it has no define)`);
	}
	const flags = {};
	const offIds = new Set();
	for (const [id, s] of Object.entries(slices)) {
		if (!s.define) continue;
		const on = !offSet.has(id) && (full || s.released);
		flags[s.define] = on;
		if (!on) offIds.add(id);
	}
	const channel = offSet.size ? `${full ? "full" : "release"} without ${[...offSet].join(", ")}` : full ? "full" : "release";
	return { flags, off: offIds, channel };
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
