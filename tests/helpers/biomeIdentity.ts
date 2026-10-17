/**
 * Biome identity among made neighbours: the cases and measures shared by
 * tests/biomeIdentity.test.ts and the measurement script
 * dev/measureBiomeIdentity.ts (owner 2026-10-12: "new regions mesh with
 * their neighbours at the seams, but the region must still clearly be its
 * own biome").
 */

import { DEFAULT_TERRAIN_PALETTE } from "../../src/constants";
import { BIOME_PRESETS } from "../../src/overworld/biomePresets";
import { profileFromFields, type BiomeProfile } from "../../src/overworld/biomes";
import type { BiomeNoteFields } from "../../src/overworld/biomeNote";
import { regionCells, neighbourRegions, type RegionLayout } from "../../src/overworld/layout";
import { interiorAgreement, mixDistance, seamContinuity, seamStats } from "../../src/overworld/regionGen";
import { paletteTypeOf, planRegion, regionOrder, worldSeed } from "../../src/overworld/regionWorld";
import { SCENARIOS, scenarioBiomes, scenarioProfiles } from "../biomeParityFixtures";
import { OWNER_BIOMES, OWNER_LAYOUT, OWNER_WORLD_ID, ownerProfiles, ownerTypeOf } from "../regionMeshFixtures";
import type { BiomeTuning } from "../../src/overworld/biomeTuning";

export const typeOf = paletteTypeOf(DEFAULT_TERRAIN_PALETTE);
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

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
