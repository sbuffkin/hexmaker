/**
 * "Add roll ranges to tables" (issue #45): upgrade a table note to the
 * `| dN | Result | Weight |` format so it can be rolled by hand from raw text.
 *
 * Only the roll table's own lines change: a die column is added (or its
 * header renamed to the die) and blank range cells are filled from the
 * weights. Weights, results, extra columns, aliases and all text around the
 * table stay as typed; ranges typed by hand are kept. An old
 * obsidian://duckmage-roll link is replaced by the roller block. Running it
 * twice changes nothing.
 *
 * Pure: no Obsidian imports.
 */

import {
  hasLegacyRollerLink,
  parseRandomTableWithReport,
  withRollerBlock,
  writeRollTable,
  type TableIssueCode,
} from "./randomTable";

export type MigrationPlan =
  | { action: "change"; content: string }
  | { action: "none" }
  | { action: "skip"; reason: string };

/** Issues that mean the plugin may be misreading the table: leave it for a human. */
const BLOCKING: TableIssueCode[] = [
  "weight-unreadable",
  "range-unreadable",
  "range-out-of-die",
  "range-overlap",
  "die-mismatch",
  "result-column-guessed",
];

export function planTableMigration(content: string): MigrationPlan {
  const { table, issues, block } = parseRandomTableWithReport(content);
  if (!block || !block.recognized) return { action: "skip", reason: "no roll table" };
  if (table.dice <= 0) return { action: "skip", reason: "no die (dice: in the frontmatter)" };
  const blocking = issues.filter((i) => BLOCKING.includes(i.code));
  if (blocking.length) {
    return { action: "skip", reason: `can't be read cleanly: ${blocking.map((i) => i.message).join(" ")}` };
  }
  if (issues.some((i) => i.code === "too-many-rows")) {
    const live = table.entries.filter((e) => e.weight > 0).length;
    return { action: "skip", reason: `${live} rows don't fit on a d${table.dice}` };
  }
  let next = writeRollTable(content, {
    dice: table.dice,
    rows: table.entries.map((entry, source) => ({ entry, source })),
    ranges: "keep",
  });
  if (hasLegacyRollerLink(next)) next = withRollerBlock(next);
  return next === content ? { action: "none" } : { action: "change", content: next };
}

/** Whether a vault path is a table note the migration and checks look at. */
export function isTableNotePath(path: string, tablesFolder: string, workflowsFolder: string): boolean {
  if (!path.endsWith(".md")) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.startsWith("_")) return false;
  const tf = tablesFolder ? tablesFolder + "/" : "";
  if (tf && !path.startsWith(tf)) return false;
  const wf = workflowsFolder ? workflowsFolder + "/" : "";
  if (wf && path.startsWith(wf)) return false;
  return true;
}
