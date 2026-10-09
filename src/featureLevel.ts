/**
 * Feature level: Simple or Advanced. Simple is everything needed to run a
 * hexcrawl (paint maps, write hex notes, roll on tables, export); Advanced
 * adds the power tools below. Simple users can turn on any one of them from
 * the screen where it would appear (see renderAdvancedHint), so they ramp up
 * at their own pace; turning on all of them is the same as Advanced.
 *
 * Hiding a feature never touches its data: generators, workflows, palettes
 * and linked regions all stay on disk and come back when it's turned on.
 * Space (src/mapKinds.ts) is a separate switch and brings all its content,
 * generators included, at either level.
 */

export type FeatureLevel = "simple" | "advanced";

export type AdvancedFeature = "generators" | "workflows" | "palettes" | "regions";

export interface AdvancedFeatureInfo {
  id: AdvancedFeature;
  label: string;
  /** One line on what it adds, for hints, settings and the wizard. */
  pitch: string;
}

export const ADVANCED_FEATURES: AdvancedFeatureInfo[] = [
  {
    id: "generators",
    label: "Terrain generators",
    pitch: "Generate terrain for you: learned from maps you've painted, or from biome presets, blended between biomes.",
  },
  {
    id: "workflows",
    label: "Workflows",
    pitch: "Chain several table rolls into one filled-in note (a settlement, an NPC, a dungeon room).",
  },
  {
    id: "palettes",
    label: "Custom palettes",
    pitch: "Design your own palettes: terrains, colours, icons, path types and submap defaults.",
  },
  {
    id: "regions",
    label: "Neighbouring regions",
    pitch: "Join maps edge to edge into one big world and walk from one into the next.",
  },
];

export const ALL_ADVANCED_FEATURES: AdvancedFeature[] = ADVANCED_FEATURES.map((f) => f.id);

export interface FeatureSettings {
  featureLevel?: FeatureLevel;
  /** Advanced features turned on one by one while in Simple. */
  advancedFeatures?: string[];
}

export const isAdvanced = (s: FeatureSettings): boolean => s.featureLevel !== "simple";

/** Is this Advanced feature on: Advanced level, or turned on by itself. */
export function hasFeature(s: FeatureSettings, f: AdvancedFeature): boolean {
  return isAdvanced(s) || (s.advancedFeatures ?? []).includes(f);
}

/**
 * Turn one feature on (in place). Once every feature is on, the level
 * becomes Advanced, so features added later come on too.
 */
export function enableFeature(s: FeatureSettings, f: AdvancedFeature): void {
  const on = new Set(s.advancedFeatures ?? []);
  on.add(f);
  s.advancedFeatures = [...on];
  if (ALL_ADVANCED_FEATURES.every((x) => on.has(x))) s.featureLevel = "advanced";
}

/**
 * The level for settings as loaded. A saved level always wins. Without one,
 * an install that already has data (any saved settings: an update from a
 * version before feature levels) gets Advanced so nothing it used
 * disappears; a fresh install starts Simple until the setup wizard asks.
 */
export function resolveFeatureLevel(raw: Record<string, unknown> | null | undefined): FeatureLevel {
  const saved = raw?.["featureLevel"];
  if (saved === "simple" || saved === "advanced") return saved;
  return raw && Object.keys(raw).length > 0 ? "advanced" : "simple";
}

/** Settings for the one-time "ready for more?" check-in. */
export interface NudgeSettings extends FeatureSettings {
  /** When the plugin first ran (ISO date). */
  installedAt?: string;
  /** Last time the check-in was shown (ISO date). */
  advancedNudgeAt?: string;
  /** "Don't ask again". */
  advancedNudgeOff?: boolean;
}

/** Days after install, or maps made, before the check-in; and days between asks. */
export const NUDGE = { afterDays: 14, afterMaps: 2, againDays: 14 };

const days = (from: string | undefined, now: Date): number =>
  from ? (now.getTime() - new Date(from).getTime()) / 86_400_000 : 0;

/**
 * Time to ask a Simple user whether they want Advanced: they've been at it a
 * while (two weeks, or a couple of maps made) and weren't asked recently.
 */
export function shouldNudge(s: NudgeSettings, mapCount: number, now = new Date()): boolean {
  if (isAdvanced(s) || s.advancedNudgeOff) return false;
  if (s.advancedNudgeAt && days(s.advancedNudgeAt, now) < NUDGE.againDays) return false;
  return mapCount >= NUDGE.afterMaps || days(s.installedAt, now) >= NUDGE.afterDays;
}

/** The setup wizard's "How much do you want to start with?" choices. */
export const FEATURE_LEVEL_CHOICES: { id: FeatureLevel; label: string; description: string }[] = [
  {
    id: "simple",
    label: "Simple",
    description: "Paint maps, write hex notes, roll on encounter tables: everything you need to run a hexcrawl. You can turn on more later from any screen.",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Also generates terrain for you (learned from your own maps, or from presets), chains tables into workflows, lets you design your own palettes, and joins maps into one big world.",
  },
];
