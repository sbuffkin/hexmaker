/**
 * 1.0.26 → 1.0.27: data.json called maps "regions". The keys `regions` and
 * `defaultRegion` become `maps` and `defaultMap`. Runs on the raw data
 * before the defaults are applied, so the moved value wins over the
 * default. A key already in the new name is kept and the old one dropped.
 */
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.0.26-settings-regions-to-maps",
  from: "1.0.26",
  to: "1.0.27",
  phase: "settings",
  change: "Settings that called maps \"regions\" use the word maps.",
  recordedBy: "every load (the old keys are gone after the first save)",
};

/** Rename the keys in place. True when data.json had an old key. */
export function migrate(data: Record<string, unknown>): boolean {
  let changed = false;
  if (data["regions"] !== undefined && data["maps"] === undefined) {
    data["maps"] = data["regions"];
  }
  if ("regions" in data) changed = true;
  delete data["regions"];
  if (data["defaultRegion"] !== undefined && data["defaultMap"] === undefined) {
    data["defaultMap"] = data["defaultRegion"];
  }
  if ("defaultRegion" in data) changed = true;
  delete data["defaultRegion"];
  return changed;
}
