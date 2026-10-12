/**
 * Measure neighbour-conditioned generation (owner 2026-10-12, "super-region"):
 * for each biome-tuning parity scenario and the owner's demo world, every
 * region made after a neighbour, before (neighbour influence 0: the old
 * generation) and with the tuning given. Prints seam continuity (edge hexes
 * whose land/water class matches across the seam), seam type agreement,
 * interior type agreement (the baseline a seam should match), the share of
 * cells whose type the region's own biome has (so context doesn't wash the
 * biome out), and ms per region.
 *
 *   npx tsx --tsconfig ./tsconfig.test.json --import ./tests/register.mjs tests/measureRegionMesh.ts [influence] [depth]
 */
import { SCENARIOS, scenarioBiomes, scenarioProfiles } from "./biomeParityFixtures";
import { OWNER_BIOMES, OWNER_LAYOUT, OWNER_WORLD_ID, ownerProfiles } from "./regionMeshFixtures";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { interiorAgreement, seamContinuity, seamStats } from "../src/overworld/regionGen";
import { paletteTypeOf, planRegion, regionOrder, worldSeed } from "../src/overworld/regionWorld";
import type { BiomeProfile } from "../src/overworld/biomes";
import type { RegionLayout } from "../src/overworld/layout";
import type { TerrainColor } from "../src/types";
import type { BiomeTuning } from "../src/overworld/biomeTuning";

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
const nums = argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const after: BiomeTuning = { ...(nums[0] !== undefined ? { "neighbour-influence": nums[0] } : {}), ...(nums[1] !== undefined ? { "context-depth": nums[1] } : {}) };

interface World { name: string; layout: RegionLayout; palette: TerrainColor[]; biomes: Map<string, string>; seed: (px: number, py: number) => number; ws: number; profiles: (t: BiomeTuning) => Map<string, BiomeProfile>; blend?: "narrow" | "normal" | "wide"; warp?: number }

const tunedCopy = (m: Map<string, BiomeProfile>, t: BiomeTuning) => new Map([...m].map(([k, p]) => [k, { ...p, tuning: { ...(p.tuning ?? {}), ...t } }]));

const worlds: World[] = SCENARIOS.map((s) => {
	const base = scenarioProfiles(s);
	const ws = worldSeed(`parity-${s.name}`);
	return { name: s.name, layout: s.layout, palette: s.palette, biomes: scenarioBiomes(s, [...base.keys()].sort()), ws, seed: (px, py) => ws ^ (px * 131 + py * 17), profiles: (t) => tunedCopy(scenarioProfiles(s), t), ...(s.blend ? { blend: s.blend } : {}), ...(s.warp !== undefined ? { warp: s.warp } : {}) };
});
const ows = worldSeed(OWNER_WORLD_ID);
worlds.push({ name: "owner-demo", layout: OWNER_LAYOUT, palette: DEFAULT_TERRAIN_PALETTE, biomes: OWNER_BIOMES, ws: ows, seed: () => ows, profiles: (t) => ownerProfiles(t) });

function run(w: World, tuning: BiomeTuning) {
	const profiles = w.profiles(tuning);
	const typeOf = paletteTypeOf(w.palette);
	const pinned = new Map<string, string>();
	const hexes = [...w.biomes.keys()].map((k) => k.split("_").map(Number) as [number, number]);
	let edge = 0, matched = 0, ms = 0, n = 0, inBiome = 0, cellsN = 0;
	for (const [px, py] of regionOrder(hexes, w.layout.orientation, w.layout.parentStagger)) {
		const t0 = performance.now();
		const plan = planRegion({ layout: w.layout, parent: [px, py], biomes: w.biomes, profiles, pinned, typeOf, worldSeed: w.ws, seed: w.seed(px, py), ...(w.blend ? { blend: w.blend } : {}), ...(w.warp !== undefined ? { warp: w.warp } : {}) });
		ms += performance.now() - t0;
		n++;
		const c = seamContinuity(w.layout, [px, py], plan.cells, pinned, typeOf);
		edge += c.edge;
		matched += c.matched;
		const own = profiles.get(w.biomes.get(`${px}_${py}`)!);
		for (const t of plan.cells.values()) {
			cellsN++;
			if (own?.types.has(typeOf(t) ?? "")) inBiome++;
		}
		for (const [k, t] of plan.cells) pinned.set(k, t);
	}
	const seams = seamStats(w.layout, pinned, typeOf);
	const pairs = seams.reduce((s, x) => s + x.pairs, 0);
	return {
		continuity: matched / Math.max(1, edge),
		seamType: seams.reduce((s, x) => s + x.typeAgreement * x.pairs, 0) / Math.max(1, pairs),
		interior: interiorAgreement(w.layout, pinned, typeOf),
		inBiome: inBiome / Math.max(1, cellsN),
		ms: ms / n,
	};
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(`after = ${JSON.stringify(after)} (defaults when empty)`);
console.log("world | land/water continuity before → after | seam type agreement before → after | interior before → after | own-biome types before → after | ms/region before → after");
for (const w of worlds) {
	const b = run(w, { "neighbour-influence": 0 });
	const a = run(w, after);
	console.log(`${w.name} | ${pct(b.continuity)} → ${pct(a.continuity)} | ${pct(b.seamType)} → ${pct(a.seamType)} | ${pct(b.interior)} → ${pct(a.interior)} | ${pct(b.inBiome)} → ${pct(a.inBiome)} | ${b.ms.toFixed(2)} → ${a.ms.toFixed(2)}`);
}
