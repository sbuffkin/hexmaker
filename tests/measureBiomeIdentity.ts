/**
 * Measure a region's biome identity among made neighbours (owner 2026-10-12:
 * "new regions mesh with their neighbours at the seams, but the region must
 * still clearly be its own biome"). Not a test file itself.
 *
 * - ring: a region of biome X with all six neighbours (biome N) made first,
 *   e.g. Alpine among Temperate forest. Its type shares, the identity
 *   distance (mixDistance: half the summed share differences against its
 *   biome's Mix, 0 = exactly the Mix, 1 = nothing in common), the same
 *   region with no neighbour context (neighbour influence 0), and its seam
 *   continuity (edge hexes whose land/water class carries on).
 * - owner: the owner's demo world, every region made, then 4, 2 remade as Alpine.
 * - worlds: every parity world and the owner's: seam continuity and the
 *   mean identity distance of the regions made after a neighbour.
 *
 *   npx tsx --tsconfig ./tsconfig.test.json --import ./tests/register.mjs tests/measureBiomeIdentity.ts
 */
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { BIOME_PRESETS } from "../src/overworld/biomePresets";
import { profileFromFields, type BiomeProfile } from "../src/overworld/biomes";
import type { BiomeNoteFields } from "../src/overworld/biomeNote";
import { regionCells, neighbourRegions, type RegionLayout } from "../src/overworld/layout";
import { interiorAgreement, mixDistance, seamContinuity, seamStats } from "../src/overworld/regionGen";
import { paletteTypeOf, planRegion, regionOrder, worldSeed } from "../src/overworld/regionWorld";
import { SCENARIOS, scenarioBiomes, scenarioProfiles } from "./biomeParityFixtures";
import { OWNER_BIOMES, OWNER_LAYOUT, OWNER_WORLD_ID, ownerProfiles, ownerTypeOf } from "./regionMeshFixtures";
import type { BiomeTuning } from "../src/overworld/biomeTuning";

const typeOf = paletteTypeOf(DEFAULT_TERRAIN_PALETTE);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Every shipped biome (the new ones too), with `tuning` merged over its own. */
export function allProfiles(tuning?: BiomeTuning): Map<string, BiomeProfile> {
	const out = new Map<string, BiomeProfile>();
	for (const p of BIOME_PRESETS) {
		if (!p.mix.length) continue;
		const { kind: _k, ...f } = p;
		const fields = f as BiomeNoteFields;
		const prof = profileFromFields(tuning ? { ...fields, tuning: { ...(fields.tuning ?? {}), ...tuning } } : fields, DEFAULT_TERRAIN_PALETTE);
		if (prof.types.size) out.set(p.id, prof);
	}
	return out;
}
const blendOf = (id: string) => BIOME_PRESETS.find((p) => p.id === id)?.blend;

export const RING_LAYOUT: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };

/** Region (2, 2) of biome `centre`, its six neighbours of biome `around` made first. */
export function ringCase(centre: string, around: string, opts: { tuning?: BiomeTuning; seed?: number } = {}) {
	const layout = RING_LAYOUT;
	const ring = neighbourRegions(layout, 2, 2);
	const biomes = new Map<string, string>([["2_2", centre], ...ring.map(([x, y]) => [`${x}_${y}`, around] as [string, string])]);
	const ws = opts.seed ?? worldSeed("identity-ring");
	const plain = allProfiles();
	const pinned = new Map<string, string>();
	for (const [px, py] of regionOrder(ring, layout.orientation, layout.parentStagger)) {
		const plan = planRegion({ layout, parent: [px, py], biomes, profiles: plain, pinned, typeOf, worldSeed: ws, seed: ws, ...blendArg(around) });
		for (const [k, t] of plan.cells) pinned.set(k, t);
	}
	const profiles = allProfiles(opts.tuning);
	const plan = planRegion({ layout, parent: [2, 2], biomes, profiles, pinned, typeOf, worldSeed: ws, seed: ws, ...blendArg(centre) });
	return { cells: plan.cells, pinned, profile: profiles.get(centre)!, layout };
}
const blendArg = (id: string) => (blendOf(id) ? { blend: blendOf(id)! } : {});

/** Type → share of a region's typed cells. */
export function typeShares(cells: ReadonlyMap<string, string>, tOf = typeOf): Map<string, number> {
	const n = new Map<string, number>();
	let all = 0;
	for (const t of cells.values()) {
		const ty = tOf(t);
		if (!ty) continue;
		n.set(ty, (n.get(ty) ?? 0) + 1);
		all++;
	}
	return new Map([...n].map(([k, v]) => [k, v / all]));
}

const fmtShares = (s: Map<string, number>) => [...s].sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${Math.round(v * 100)}`).join(", ");

if (process.argv[1]?.endsWith("measureBiomeIdentity.ts")) {
	console.log("## Ring: biome X with all six neighbours (biome N) made first; 8x8 regions");
	console.log("centre | around | identity no ctx | identity with ctx | continuity | shares with ctx");
	const RINGS: [string, string][] = [
		["alpine", "temperate-forest"], ["alpine", "taiga"], ["alpine", "deep-forest"], ["alpine", "grassland"],
		["caverns", "temperate-forest"], ["underdark", "grassland"], ["fungal-forest", "temperate-forest"],
		["underground-lake", "grassland"], ["mines", "taiga"], ["magma-caves", "temperate-forest"],
		["volcanic", "jungle"], ["desert", "temperate-forest"], ["tundra", "taiga"], ["coast", "open-sea"],
	];
	for (const [c, a] of RINGS) {
		const w = ringCase(c, a);
		const solo = ringCase(c, a, { tuning: { "neighbour-influence": 0, "context-depth": 0 } });
		const sc = seamContinuity(w.layout, [2, 2], w.cells, w.pinned, typeOf);
		console.log(`${c} | ${a} | ${mixDistance(solo.cells, w.profile, typeOf).toFixed(2)} | ${mixDistance(w.cells, w.profile, typeOf).toFixed(2)} | ${sc.matched}/${sc.edge} | ${fmtShares(typeShares(w.cells))}`);
		if (process.argv.includes("--solo")) console.log(`  no ctx: ${fmtShares(typeShares(solo.cells))}`);
	}

	// The owner's demo world, every region made, then 4, 2 remade as Alpine.
	console.log("\n## Owner demo world: 4, 2 remade as Alpine with every other region made");
	const ws = worldSeed(OWNER_WORLD_ID);
	const plain = ownerProfiles();
	const order = regionOrder([...OWNER_BIOMES.keys()].map((k) => k.split("_").map(Number) as [number, number]), OWNER_LAYOUT.orientation, OWNER_LAYOUT.parentStagger);
	const made = new Map<string, string>();
	for (const [px, py] of order) {
		const plan = planRegion({ layout: OWNER_LAYOUT, parent: [px, py], biomes: OWNER_BIOMES, profiles: plain, pinned: new Map(made), typeOf: ownerTypeOf, worldSeed: ws, seed: ws });
		for (const [k, t] of plan.cells) made.set(k, t);
	}
	const own = new Set(regionCells(OWNER_LAYOUT, 4, 2).map(([x, y]) => `${x}_${y}`));
	const pinned = new Map([...made].filter(([k]) => !own.has(k)));
	const biomes = new Map(OWNER_BIOMES);
	biomes.set("4_2", "alpine");
	const alp = allProfiles();
	const plan = planRegion({ layout: OWNER_LAYOUT, parent: [4, 2], biomes, profiles: alp, pinned, typeOf: ownerTypeOf, worldSeed: ws, seed: ws });
	const sc = seamContinuity(OWNER_LAYOUT, [4, 2], plan.cells, pinned, ownerTypeOf);
	console.log(`identity ${mixDistance(plan.cells, alp.get("alpine")!, ownerTypeOf).toFixed(2)}, continuity ${sc.matched}/${sc.edge}, shares: ${fmtShares(typeShares(plan.cells, ownerTypeOf))}`);

	console.log("\n## Worlds: seam continuity, mean identity of regions made after a neighbour");
	console.log("world | continuity | seam type agreement | interior agreement | mean identity (with neighbours) | mean identity (first regions)");
	const worlds = [
		...SCENARIOS.map((s) => {
			const profiles = scenarioProfiles(s);
			return { name: s.name, layout: s.layout, tOf: paletteTypeOf(s.palette), biomes: scenarioBiomes(s, [...profiles.keys()].sort()), profiles, ws: worldSeed(`parity-${s.name}`), seed: (px: number, py: number, w: number) => w ^ (px * 131 + py * 17), extra: { ...(s.blend ? { blend: s.blend } : {}), ...(s.warp !== undefined ? { warp: s.warp } : {}) } };
		}),
		{ name: "owner-demo", layout: OWNER_LAYOUT, tOf: ownerTypeOf, biomes: OWNER_BIOMES, profiles: ownerProfiles(), ws: worldSeed(OWNER_WORLD_ID), seed: (_x: number, _y: number, w: number) => w, extra: {} },
	];
	for (const w of worlds) {
		const pin = new Map<string, string>();
		let edge = 0, matched = 0, dN = 0, nN = 0, dF = 0, nF = 0;
		const hexes = [...w.biomes.keys()].map((k) => k.split("_").map(Number) as [number, number]);
		for (const [px, py] of regionOrder(hexes, w.layout.orientation, w.layout.parentStagger)) {
			const p = planRegion({ layout: w.layout, parent: [px, py], biomes: w.biomes, profiles: w.profiles, pinned: pin, typeOf: w.tOf, worldSeed: w.ws, seed: w.seed(px, py, w.ws), ...w.extra });
			const c = seamContinuity(w.layout, [px, py], p.cells, pin, w.tOf);
			const prof = w.profiles.get(w.biomes.get(`${px}_${py}`)!);
			const d = prof ? mixDistance(p.cells, prof, w.tOf) : 0;
			if (c.edge) { dN += d; nN++; } else { dF += d; nF++; }
			edge += c.edge; matched += c.matched;
			for (const [k, t] of p.cells) pin.set(k, t);
		}
		const st = seamStats(w.layout, pin, w.tOf), pairs = st.reduce((s, x) => s + x.pairs, 0);
		console.log(`${w.name} | ${pct(matched / edge)} (${matched}/${edge}) | ${pct(st.reduce((s, x) => s + x.typeAgreement * x.pairs, 0) / pairs)} | ${pct(interiorAgreement(w.layout, pin, w.tOf))} | ${(dN / Math.max(1, nN)).toFixed(3)} | ${(dF / Math.max(1, nF)).toFixed(3)}`);
	}
}
