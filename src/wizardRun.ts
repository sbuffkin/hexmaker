/**
 * The setup wizard's generator run: the grid it previews on, the options a
 * run reads and the key that says whether a preview still matches the
 * choices (the generator list is the `wizardgen` slice's; Next also reads
 * these for a Blank map's grid).
 */

import type HexmakerPlugin from "./HexmakerPlugin";
import type { TerrainColor } from "./types";
import { generationKey, optionsWithTuning, type GenerateOutcome, type TerrainGeneratorKind } from "./worldgen/registry";

/** The wizard choices a run reads. */
export interface WizardRunChoices {
	mapCols: number;
	mapRows: number;
	hexOrientation: "flat" | "pointy";
	paletteName: string;
	generatorOptions: Record<string, string>;
	seed: number;
}

export function wizardGrid(plugin: HexmakerPlugin, ctx: WizardRunChoices) {
	return {
		cols: ctx.mapCols,
		rows: ctx.mapRows,
		offset: { x: 0, y: 0 },
		stagger: plugin.settings.staggerOffset ?? "odd",
	};
}

export function resolvedOptions(kind: TerrainGeneratorKind, ctx: WizardRunChoices): Record<string, string> {
	return optionsWithTuning(kind, ctx.generatorOptions);
}

/** generationKey of the wizard's current choices (see WizardContext.preview). */
export function wizardRunKey(plugin: HexmakerPlugin, ctx: WizardRunChoices, kind: TerrainGeneratorKind): string {
	const grid = wizardGrid(plugin, ctx);
	return generationKey({
		generatorId: kind.id,
		options: resolvedOptions(kind, ctx),
		seed: ctx.seed,
		cols: grid.cols,
		rows: grid.rows,
		orientation: ctx.hexOrientation,
		stagger: grid.stagger,
		palette: ctx.paletteName,
	});
}

/**
 * Run the chosen generator for the wizard's map. Generators read the hex
 * orientation from settings, which the wizard only saves on Next, so the
 * picked orientation is applied for the (synchronous) run.
 */
export function runGenerator(
	plugin: HexmakerPlugin,
	ctx: WizardRunChoices,
	kind: TerrainGeneratorKind,
	terrains: TerrainColor[],
): GenerateOutcome {
	const saved = plugin.settings.hexOrientation;
	plugin.settings.hexOrientation = ctx.hexOrientation;
	try {
		return kind.generate({
			terrains, grid: wizardGrid(plugin, ctx), seed: ctx.seed, options: resolvedOptions(kind, ctx),
			pathTypes: plugin.getPathTypes(ctx.paletteName),
		});
	} finally {
		plugin.settings.hexOrientation = saved;
	}
}
