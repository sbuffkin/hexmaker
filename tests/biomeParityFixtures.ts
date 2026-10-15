/**
 * Region generation snapshots for the biome tuning parity test (not a test
 * file itself). Each scenario makes every region of a small overworld in
 * generation order (each pins the ones before it) and digests the cells.
 * The digests in tests/fixtures/biomeTuningParity.json were taken BEFORE
 * any tuning was wired in: with no tuning set, generation must give exactly
 * these regions. Regenerate (only for a deliberate generation change) with
 * `npx tsx --tsconfig ./tsconfig.test.json --import ./tests/register.mjs tests/biomeParityFixtures.ts --write`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { BIOME_PRESETS } from "../src/overworld/biomePresets";
import { BIOMES, profileFromFields, type BiomeProfile } from "../src/overworld/biomes";
import type { BiomeNoteFields } from "../src/overworld/biomeNote";
import type { RegionLayout } from "../src/overworld/layout";
import { paletteTypeOf, planRegion, regionOrder, worldSeed } from "../src/overworld/regionWorld";
import type { TerrainColor } from "../src/types";
import { profilesFor } from "./overworldFixtures";

export interface ParityScenario {
	name: string;
	layout: RegionLayout;
	palette: TerrainColor[];
	blend?: "narrow" | "normal" | "wide";
	warp?: number;
	/** "notes": profiles from the shipped biome notes; "models": from the shipped generators. */
	profiles: "notes" | "models";
	cols: number;
	rows: number;
}

export const SCENARIOS: ParityScenario[] = [
	{ name: "flat-rect-notes", layout: { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" }, palette: DEFAULT_TERRAIN_PALETTE, profiles: "notes", cols: 6, rows: 5 },
	{ name: "pointy-rect-wide", layout: { footprint: "rect", size: 6, orientation: "pointy", parentStagger: "even", childStagger: "even" }, palette: DEFAULT_TERRAIN_PALETTE, blend: "wide", warp: 0, profiles: "notes", cols: 5, rows: 4 },
	{ name: "limited-narrow", layout: { footprint: "rect", size: 7, orientation: "flat", parentStagger: "odd", childStagger: "odd" }, palette: LIMITED_TERRAIN_PALETTE, blend: "narrow", profiles: "notes", cols: 5, rows: 4 },
	{ name: "flower-models", layout: { footprint: "hex", size: 3, orientation: "flat", parentStagger: "odd", childStagger: "odd" }, palette: DEFAULT_TERRAIN_PALETTE, profiles: "models", cols: 4, rows: 4 },
];

/**
 * The shipped biomes the snapshots were taken with (before the 2026-10-12
 * additions): the old BIOMES table's and Coast. Pinned, so adding a shipped
 * biome doesn't move every scenario's layout.
 */
const SNAPSHOT_BIOMES = new Set([...BIOMES.map((b) => b.id), "coast"]);

/** Every snapshot-era shipped biome with a mix, as its note says it. */
export function presetFields(): BiomeNoteFields[] {
	return BIOME_PRESETS.filter((p) => p.mix.length && SNAPSHOT_BIOMES.has(p.id)).map(({ kind: _k, ...f }) => f as BiomeNoteFields);
}

/** Profiles for a scenario; `edit` may change a biome's fields first (tuning). */
export function scenarioProfiles(s: ParityScenario, edit?: (f: BiomeNoteFields) => BiomeNoteFields): Map<string, BiomeProfile> {
	if (s.profiles === "models") return profilesFor(s.palette);
	const out = new Map<string, BiomeProfile>();
	for (const f of presetFields()) {
		const p = profileFromFields(edit ? edit(f) : f, s.palette);
		if (p.types.size) out.set(f.id, p);
	}
	return out;
}

/** The overworld: biomes laid out in a fixed pattern over cols × rows hexes. */
export function scenarioBiomes(s: ParityScenario, ids: string[]): Map<string, string> {
	const out = new Map<string, string>();
	let i = 0;
	for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) out.set(`${x}_${y}`, ids[(i++ * 7 + y * 3) % ids.length]);
	return out;
}

const fnv = (text: string) => {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
	return h.toString(16).padStart(8, "0");
};

export function digest(cells: ReadonlyMap<string, string>): string {
	return fnv([...cells].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, t]) => `${k}=${t}`).join(";"));
}

/** Every region of a scenario: parent key → its cells. */
export function runScenario(s: ParityScenario, profiles = scenarioProfiles(s)): Map<string, Map<string, string>> {
	const ids = [...profiles.keys()].sort();
	const biomes = scenarioBiomes(s, ids);
	const ws = worldSeed(`parity-${s.name}`);
	const pinned = new Map<string, string>();
	const out = new Map<string, Map<string, string>>();
	const hexes = [...biomes.keys()].map((k) => k.split("_").map(Number) as [number, number]);
	for (const [px, py] of regionOrder(hexes, s.layout.orientation, s.layout.parentStagger)) {
		const plan = planRegion({
			layout: s.layout,
			parent: [px, py],
			biomes,
			profiles,
			pinned,
			typeOf: paletteTypeOf(s.palette),
			worldSeed: ws,
			seed: ws ^ (px * 131 + py * 17),
			...(s.blend ? { blend: s.blend } : {}),
			...(s.warp !== undefined ? { warp: s.warp } : {}),
		});
		out.set(`${px}_${py}`, plan.cells);
		for (const [k, t] of plan.cells) pinned.set(k, t);
	}
	return out;
}

/** Scenario → region → digest. */
export function snapshot(): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	for (const s of SCENARIOS) {
		const regions = runScenario(s);
		out[s.name] = Object.fromEntries([...regions].map(([k, cells]) => [k, digest(cells)]));
	}
	return out;
}

export const PARITY_FILE = join(__dirname, "fixtures", "biomeTuningParity.json");

if (process.argv.includes("--write")) {
	writeFileSync(PARITY_FILE, JSON.stringify(snapshot(), null, "\t") + "\n");
	console.log(`wrote ${PARITY_FILE}`);
}
