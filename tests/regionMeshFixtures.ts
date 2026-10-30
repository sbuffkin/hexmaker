/**
 * The owner's demo world of 2026-10-12 (runs/20261012-120016-demo-world),
 * rebuilt without Obsidian, for the neighbour-conditioned generation tests
 * (not a test file itself). The overworld's biomes are its Biome column;
 * the 19 regions of the first build are made centre-out, then the four the
 * owner added that session in the order they were made: 2,-1, 3,-1, 4,-1,
 * then 4,0, the coast that didn't continue its northern neighbour's coastline.
 * Every region uses the world seed, as createRegion does with no stored seed.
 *
 * Print the owner's region before and after (land #, coast c, water ~):
 * `npx tsx --tsconfig ./tsconfig.test.json --import ./tests/register.mjs tests/regionMeshFixtures.ts --print`.
 */
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { WATER_TYPES, type BiomeProfile } from "../src/overworld/biomes";
import { regionCells, type RegionLayout } from "../src/overworld/layout";
import { paletteTypeOf, planRegion, regionOrder, worldSeed } from "../src/overworld/regionWorld";
import { seamContinuity } from "../src/overworld/regionGen";
import { presetFields } from "./biomeParityFixtures";
import { profileFromFields } from "../src/overworld/biomes";
import type { BiomeTuning } from "../src/overworld/biomeTuning";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const OWNER_LAYOUT: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
export const OWNER_WORLD_ID = "wmv5funzxl88i";

/** The demo overworld's Biome column. */
export const OWNER_BIOMES = new Map<string, string>([
	["2_-1", "archipelago"], ["3_-1", "archipelago"], ["4_-1", "coast"],
	["1_0", "open-sea"], ["2_0", "archipelago"], ["3_0", "open-sea"], ["4_0", "coast"],
	["0_1", "open-sea"], ["1_1", "valley"], ["2_1", "taiga"], ["3_1", "taiga"], ["4_1", "coastal-fjord"],
	["0_2", "swamp"], ["1_2", "river-delta"], ["2_2", "alpine"], ["3_2", "karst"], ["4_2", "grassland"],
	["0_3", "archipelago"], ["1_3", "jungle"], ["2_3", "coastal-fjord"], ["3_3", "jungle"], ["4_3", "jungle"],
	["2_4", "open-sea"],
]);

/** The regions the owner added in the session, in order (the last is the one reported). */
export const OWNER_ADDED: [number, number][] = [[2, -1], [3, -1], [4, -1], [4, 0]];

export const ownerTypeOf = paletteTypeOf(DEFAULT_TERRAIN_PALETTE);

/** The shipped biomes' profiles, every one with `tuning` (if given). */
export function ownerProfiles(tuning?: BiomeTuning): Map<string, BiomeProfile> {
	const out = new Map<string, BiomeProfile>();
	for (const f of presetFields()) {
		const p = profileFromFields(tuning ? { ...f, tuning } : f, DEFAULT_TERRAIN_PALETTE);
		if (p.types.size) out.set(f.id, p);
	}
	return out;
}

export interface OwnerRun {
	/** Every generated cell (shared-grid key → terrain). */
	cells: Map<string, string>;
	/** Each region's own cells, by parent key. */
	regions: Map<string, Map<string, string>>;
	/** Cells painted before each region was made (its pinned context). */
	before: Map<string, Map<string, string>>;
	/** Milliseconds per region, by parent key. */
	ms: Map<string, number>;
}

/**
 * The demo world: the first build, then the owner's additions. `tuning`
 * applies to the regions the owner added (`addedOnly`, default) or to every region.
 */
export function ownerRun(tuning?: BiomeTuning, opts: { addedOnly?: boolean; layout?: RegionLayout } = {}): OwnerRun {
	const layout = opts.layout ?? OWNER_LAYOUT;
	const plain = ownerProfiles(opts.addedOnly === false ? tuning : undefined);
	const tuned = ownerProfiles(tuning);
	const ws = worldSeed(OWNER_WORLD_ID);
	const added = new Set(OWNER_ADDED.map(([x, y]) => `${x}_${y}`));
	const first = [...OWNER_BIOMES.keys()].filter((k) => !added.has(k)).map((k) => k.split("_").map(Number) as [number, number]);
	const order = [...regionOrder(first, layout.orientation, layout.parentStagger), ...OWNER_ADDED];
	const cells = new Map<string, string>();
	const regions = new Map<string, Map<string, string>>();
	const before = new Map<string, Map<string, string>>();
	const ms = new Map<string, number>();
	for (const [px, py] of order) {
		const key = `${px}_${py}`;
		// Only the regions already made exist (the overworld's biomes are all set from the start).
		const pinned = new Map<string, string>();
		for (const [k, t] of cells) pinned.set(k, t);
		const t0 = performance.now();
		const plan = planRegion({
			layout,
			parent: [px, py],
			biomes: OWNER_BIOMES,
			profiles: added.has(key) ? tuned : plain,
			pinned,
			typeOf: ownerTypeOf,
			worldSeed: ws,
			seed: ws,
		});
		ms.set(key, performance.now() - t0);
		before.set(key, pinned);
		regions.set(key, plan.cells);
		for (const [k, t] of plan.cells) cells.set(k, t);
	}
	return { cells, regions, before, ms };
}

/**
 * The owner's own case, from the demo vault: region 4, 0 (Coast) remade
 * with its four made neighbours' real cells pinned (4,-1 the coast whose
 * land is on the right, 3,-1, 3,0 and 4,1), as createRegion pins them.
 * `owner` is what the vault holds for 4, 0 (made before this change).
 */
export function ownerCase(tuning?: BiomeTuning): { cells: Map<string, string>; pinned: Map<string, string>; owner: Map<string, string>; ms: number } {
	const raw = JSON.parse(readFileSync(join(__dirname, "fixtures", "ownerDemoRegions.json"), "utf8")) as Record<string, Record<string, string>>;
	const pinned = new Map<string, string>();
	for (const m of ["demo-bricks-4--1", "demo-bricks-3--1", "demo-bricks-3-0", "demo-bricks-4-1"]) for (const [k, t] of Object.entries(raw[m])) pinned.set(k, t);
	const ws = worldSeed(OWNER_WORLD_ID);
	const profiles = ownerProfiles(tuning);
	const t0 = performance.now();
	const plan = planRegion({ layout: OWNER_LAYOUT, parent: [4, 0], biomes: OWNER_BIOMES, profiles, pinned, typeOf: ownerTypeOf, worldSeed: ws, seed: ws });
	return { cells: plan.cells, pinned, owner: new Map(Object.entries(raw["demo-bricks-4-0"])), ms: performance.now() - t0 };
}

/** Land/water class of a terrain ("land", "water", or undefined when it has no type). */
export function landClass(terrain: string | undefined): "land" | "water" | undefined {
	const ty = terrain ? ownerTypeOf(terrain) : undefined;
	if (!ty) return undefined;
	return WATER_TYPES.includes(ty) ? "water" : "land";
}

/** The region of (px, py) and the rows around it as text: # land, c coast, ~ water, blank nothing. */
export function asciiRegion(run: OwnerRun, px: number, py: number, margin = 3, layout = OWNER_LAYOUT): string {
	const own = regionCells(layout, px, py);
	const xs = own.map((c) => c[0]), ys = own.map((c) => c[1]);
	const x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin;
	const y0 = Math.min(...ys) - margin, y1 = Math.max(...ys) + margin;
	const mine = new Set(own.map(([x, y]) => `${x}_${y}`));
	const lines: string[] = [];
	for (let y = y0; y <= y1; y++) {
		let row = "";
		for (let x = x0; x <= x1; x++) {
			const k = `${x}_${y}`;
			const t = run.cells.get(k);
			const ty = t ? ownerTypeOf(t) : undefined;
			let ch = !t ? " " : ty === "coast" ? "c" : landClass(t) === "water" ? "~" : "#";
			if (!mine.has(k) && ch !== " ") ch = ch === "#" ? "+" : ch === "c" ? "." : "-";
			row += ch;
		}
		lines.push(row);
	}
	return lines.join("\n");
}

/** Seam continuity of the owner's added regions. */
export function ownerContinuity(run: OwnerRun): Map<string, ReturnType<typeof seamContinuity>> {
	const out = new Map<string, ReturnType<typeof seamContinuity>>();
	for (const [px, py] of OWNER_ADDED) {
		const key = `${px}_${py}`;
		out.set(key, seamContinuity(OWNER_LAYOUT, [px, py], run.regions.get(key)!, run.before.get(key)!, ownerTypeOf));
	}
	return out;
}

if (process.argv.includes("--print")) {
	for (const [label, tuning] of [["owner case, before (neighbour influence 0)", { "neighbour-influence": 0 }], ["owner case, after (defaults)", undefined]] as const) {
		const c = ownerCase(tuning);
		const all = new Map([...c.pinned, ...c.cells]);
		console.log(`
== ${label}: same as the vault: ${[...c.owner].every(([k, t]) => c.cells.get(k) === t)} ==`);
		console.log(asciiRegion({ cells: all, regions: new Map(), before: new Map(), ms: new Map() }, 4, 0));
		const sc = seamContinuity(OWNER_LAYOUT, [4, 0], c.cells, c.pinned, ownerTypeOf);
		console.log(`4_0: ${sc.matched}/${sc.edge} edge hexes match (${Math.round(sc.share * 100)}%), ${c.ms.toFixed(1)} ms`);
	}
	for (const [label, tuning] of [["before (neighbour influence 0)", { "neighbour-influence": 0 }], ["after (defaults)", undefined]] as const) {
		const run = ownerRun(tuning);
		console.log(`\n== ${label}: region 4, 0 (own cells #/c/~, neighbours +/./-) ==`);
		console.log(asciiRegion(run, 4, 0));
		for (const [k, c] of ownerContinuity(run)) console.log(`${k}: ${c.matched}/${c.edge} edge hexes match (${Math.round(c.share * 100)}%), ${Math.round(run.ms.get(k)!)} ms`);
	}
}
