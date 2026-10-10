/** Shared fixtures for the overworld tests (not a test file itself). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_GENERATORS, parseBuiltin } from "../src/worldgen/builtinGenerators";
import type { HexWfcModel } from "../packages/hex-wfc/src";
import { biomeProfiles } from "../src/overworld/biomes";
import type { TerrainColor } from "../src/types";
import { inferTerrainType } from "../src/terrainTypes";

/** The shipped generators, read from disk (.md imports are stubbed in tests). */
export const MODELS = new Map<string, HexWfcModel | undefined>(
	BUILTIN_GENERATORS.map((d) => [d.slug, parseBuiltin(readFileSync(join(__dirname, "../src/worldgen/builtin", `${d.slug}.md`), "utf8"), d.slug)]),
);

export const profilesFor = (palette: TerrainColor[]) => biomeProfiles(MODELS, palette);

export const typeLookup = (palette: TerrainColor[]) => {
	const m = new Map(palette.map((t) => [t.name, t.type ?? inferTerrainType(t.name, t.category, "world")]));
	return (name: string) => m.get(name);
};
