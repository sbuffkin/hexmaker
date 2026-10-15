/**
 * Measure how often each biome's terrain types survive in a region (#50
 * min patches): for every shipped biome, 200 seeds of an 8×8 region ringed
 * by the same biome and by grassland, the share of regions with no cell of
 * each type. Run: npx tsx --tsconfig ./tsconfig.test.json --import ./tests/register.mjs dev/measure-patches.ts
 */
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { BIOME_PRESETS } from "../src/overworld/biomePresets";
import { noteBiomeProfiles, setBiomeSource } from "../src/overworld/biomes";
import { BlendField, REGION_WARP } from "../src/overworld/blendField";
import { generateRegion } from "../src/overworld/regionGen";
import type { RegionLayout } from "../src/overworld/layout";
import { hexDistance } from "../packages/hex-wfc/src/grid";

const strip = !!(globalThis as { process?: { argv: string[] } }).process?.argv.includes("--no-min");
setBiomeSource(strip ? BIOME_PRESETS.map((b) => ({ ...b, mix: b.mix.map((r) => ({ type: r.type, weight: r.weight })) })) : BIOME_PRESETS);
const palette = DEFAULT_TERRAIN_PALETTE;
const profiles = noteBiomeProfiles(palette);
const typeOfMap = new Map(palette.map((t) => [t.name, t.type]));
const typeOf = (n: string) => typeOfMap.get(n);
const l: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
const ringed = (centre: string, around: string) => {
	const m = new Map<string, string>();
	for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) m.set(`${x}_${y}`, hexDistance([x, y], [2, 2], "flat", "odd") === 0 ? centre : around);
	return m;
};
for (const b of BIOME_PRESETS) {
	const p = profiles.get(b.id);
	if (!p) continue;
	for (const around of [b.id, "grassland"]) {
		const missing = new Map<string, number>();
		for (let seed = 1; seed <= 200; seed++) {
			const field = new BlendField(l, ringed(b.id, around), "normal", { warp: REGION_WARP, seed });
			const out = generateRegion({ layout: l, parent: [2, 2], field, profiles, typeOf, seed });
			const types = new Set([...out.values()].map(typeOf));
			for (const t of p.types.keys()) if (!types.has(t)) missing.set(t, (missing.get(t) ?? 0) + 1);
		}
		const row = [...p.types].map(([t, s]) => `${t} ${Math.round(s * 100)}%: ${Math.round(((missing.get(t) ?? 0) / 200) * 100)}%`).join(", ");
		console.log(`${b.id} (ringed by ${around}) missing → ${row}`);
	}
}
