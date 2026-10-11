/**
 * Which generator-page engine controls hold a non-default value, so the
 * Advanced dropdown and its "Engine tuning" sub-section can say so in
 * their headers ("Engine tuning · 2 set"). Defaults are the engine's own
 * (packages/hex-wfc DEFAULT_SETTINGS). Pure: tests use it directly.
 */
import { cleanupStrengths, DEFAULT_SETTINGS, type GeneratorSettings } from "../../packages/hex-wfc/src";

type Settings = Required<GeneratorSettings>;

/** Per GenPage control id: is its value off the default? */
const CHECKS: Record<string, (s: Settings) => boolean> = {
  "GenPage.clumping": (s) => s.neighbourInfluence !== DEFAULT_SETTINGS.neighbourInfluence,
  "GenPage.edgeSmoothing": (s) => cleanupStrengths(s).edges !== cleanupStrengths(DEFAULT_SETTINGS).edges,
  "GenPage.removeSmallPatches": (s) => cleanupStrengths(s).speckSize !== cleanupStrengths(DEFAULT_SETTINGS).speckSize,
  "GenPage.keepRare": (s) => s.keepRare !== DEFAULT_SETTINGS.keepRare,
  "GenPage.edgeStrength": (s) => s.edgeStrength !== DEFAULT_SETTINGS.edgeStrength,
  "GenPage.directionalBias": (s) => s.directionalBias !== DEFAULT_SETTINGS.directionalBias,
  "GenPage.scatter": (s) => s.scatter !== DEFAULT_SETTINGS.scatter,
  "GenPage.spacing": (s) => s.spacing !== DEFAULT_SETTINGS.spacing,
  "GenPage.randomness": (s) => s.randomness !== DEFAULT_SETTINGS.randomness,
  "GenPage.near": (s) => Object.keys(s.near ?? {}).length > 0,
  "GenPage.mixStrength": (s) => s.frequencyFeedback !== DEFAULT_SETTINGS.frequencyFeedback,
};

/** The control ids this knows (for tests). */
export const ENGINE_TUNING_IDS: readonly string[] = Object.keys(CHECKS);

/** Is control `id` off its default in `settings`? False for an id it doesn't know. */
export function engineTuningIsSet(id: string, settings: Settings): boolean {
  return CHECKS[id]?.(settings) ?? false;
}
