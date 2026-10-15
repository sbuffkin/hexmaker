/**
 * Unreleased builds kept a `tableRangesPrompt` setting (the roll-ranges
 * question). It became a silent upgrade (DJ-Q6), so the key is dropped.
 */
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "unreleased-drop-table-ranges-prompt",
  from: "unreleased",
  to: "1.6",
  phase: "settings",
  change: "An unused setting from test builds is removed.",
  recordedBy: "every load",
};

/** Drop the key in place. True when it was there. */
export function migrate(data: Record<string, unknown>): boolean {
  const had = "tableRangesPrompt" in data;
  delete data["tableRangesPrompt"];
  return had;
}
