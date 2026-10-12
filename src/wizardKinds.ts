/**
 * The setup wizard's first-map choices, the pure part: which map scale
 * ("What are you mapping?") and which generators it offers (Blank first).
 * No Obsidian imports, so tests can reach it.
 */

import type { TerrainColor } from "./types";
import { kindOfTerrains, type MapKind } from "./mapKinds";
import { BLANK_ID, firstMapGenerator, kindsForPalette, visibleKinds, type TerrainGeneratorKind } from "./worldgen/registry";
import { scaleGenerators, scaleOrFirst, scalesFor, type MapScaleDef } from "./mapScales";

/** The wizard state these read. */
interface WizardContext {
	mapKinds: MapKind[];
	scaleId?: string;
	generatorId?: string;
}

/** The wizard's map scale: the picked one while its map type is on, else the first. */
export function wizardScale(ctx: Pick<WizardContext, "mapKinds" | "scaleId">): MapScaleDef | undefined {
	return scaleOrFirst(scalesFor(ctx.mapKinds), ctx.scaleId);
}

/** A scale's list starts on its first real generator (Blank when it has none). */
export function scaleStarter(fitting: readonly { id: string }[]): string {
	return fitting.find((k) => k.id !== BLANK_ID)?.id ?? BLANK_ID;
}

/**
 * Generators to offer for the wizard's scale and palette, and the one to
 * select: the scale's list (Blank first) that fits the palette, starting on
 * its first real generator.
 */
export function wizardKinds(
	kinds: TerrainGeneratorKind[],
	ctx: Pick<WizardContext, "mapKinds" | "scaleId" | "generatorId">,
	terrains: TerrainColor[],
): { fitting: TerrainGeneratorKind[]; selected: string } {
	const scale = wizardScale(ctx);
	const pool = scale ? scaleGenerators(scale, kinds) : kinds;
	const fitting = kindsForPalette(visibleKinds(pool, { mapKinds: ctx.mapKinds }, new Set([kindOfTerrains(terrains)]), ctx.generatorId), terrains);
	const starter = scale
		? scaleStarter(fitting)
		: firstMapGenerator(fitting, ctx.mapKinds);
	const selected = ctx.generatorId && fitting.some((k) => k.id === ctx.generatorId)
		? ctx.generatorId
		: starter;
	return { fitting, selected };
}
