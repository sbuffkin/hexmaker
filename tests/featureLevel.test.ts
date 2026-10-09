import { describe, it } from "node:test";
import expect from "expect";
import {
  ALL_ADVANCED_FEATURES,
  enableFeature,
  hasFeature,
  isAdvanced,
  NUDGE,
  resolveFeatureLevel,
  shouldNudge,
  type FeatureSettings,
} from "../src/featureLevel";

describe("feature level", () => {
  it("keeps a saved level", () => {
    expect(resolveFeatureLevel({ featureLevel: "simple", maps: [] })).toBe("simple");
    expect(resolveFeatureLevel({ featureLevel: "advanced" })).toBe("advanced");
  });

  it("gives an update from before feature levels Advanced, so nothing disappears", () => {
    expect(resolveFeatureLevel({ maps: [{ name: "the-coast" }], setupComplete: true })).toBe("advanced");
    expect(resolveFeatureLevel({ hexOrientation: "flat" })).toBe("advanced");
  });

  it("starts a fresh install Simple", () => {
    expect(resolveFeatureLevel(null)).toBe("simple");
    expect(resolveFeatureLevel({})).toBe("simple");
  });

  it("turns features on one at a time, and all of them means Advanced", () => {
    const s: FeatureSettings = { featureLevel: "simple", advancedFeatures: [] };
    expect(hasFeature(s, "workflows")).toBe(false);
    enableFeature(s, "workflows");
    expect(hasFeature(s, "workflows")).toBe(true);
    expect(hasFeature(s, "generators")).toBe(false);
    expect(isAdvanced(s)).toBe(false);
    for (const f of ALL_ADVANCED_FEATURES) enableFeature(s, f);
    expect(isAdvanced(s)).toBe(true);
  });

  it("has everything on in Advanced", () => {
    for (const f of ALL_ADVANCED_FEATURES) expect(hasFeature({ featureLevel: "advanced" }, f)).toBe(true);
  });
});

describe("the ready-for-more check-in", () => {
  const now = new Date("2026-11-01");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const simple = { featureLevel: "simple" as const, installedAt: daysAgo(1) };

  it("waits until a couple of maps or a couple of weeks", () => {
    expect(shouldNudge(simple, 1, now)).toBe(false);
    expect(shouldNudge(simple, NUDGE.afterMaps, now)).toBe(true);
    expect(shouldNudge({ ...simple, installedAt: daysAgo(NUDGE.afterDays) }, 1, now)).toBe(true);
  });

  it("doesn't ask again soon, ever after Don't ask again, or in Advanced", () => {
    expect(shouldNudge({ ...simple, advancedNudgeAt: daysAgo(3) }, 5, now)).toBe(false);
    expect(shouldNudge({ ...simple, advancedNudgeAt: daysAgo(NUDGE.againDays + 1) }, 5, now)).toBe(true);
    expect(shouldNudge({ ...simple, advancedNudgeOff: true }, 5, now)).toBe(false);
    expect(shouldNudge({ featureLevel: "advanced" }, 5, now)).toBe(false);
  });
});
