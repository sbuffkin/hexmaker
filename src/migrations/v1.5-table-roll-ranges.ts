/**
 * 1.5.x → 1.6: random tables show each row's roll range for their die
 * (`| d20 | Result | Weight |`), so they can be rolled by hand from the note
 * itself. Once, silently, on the first load after updating (owner decision
 * DJ-Q6: no prompt, no nag), every older table that can take ranges gets
 * them. The originals are backed up first; if the backup fails nothing
 * changes and it runs again next start.
 *
 * Only the roll table's own lines change: a die column is added (or its
 * header renamed to the die) and blank range cells are filled from the
 * weights. Weights, results, extra columns, aliases and all text around the
 * table stay as typed; ranges typed by hand are kept. An old
 * obsidian://duckmage-roll link is replaced by the roller block. Running it
 * twice changes nothing. The "Add roll ranges to tables" command runs the
 * same step on demand (tableMaintenance.ts).
 */
import { TFile, type App } from "obsidian";
import { writeJsonBackup } from "../backup";
import { noticeUpgrade } from "../ui/notify";
import { normalizeFolder } from "../utils";
import { processTableNote } from "../random-tables/TableStore";
import { tableNotes, type TableScope } from "../random-tables/tableNotePaths";
import {
  hasLegacyRollerLink,
  parseRandomTableWithReport,
  withRollerBlock,
  writeRollTable,
  type TableIssueCode,
} from "../random-tables/randomTable";

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

import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-table-roll-ranges",
  from: "1.5.x",
  to: "1.6",
  phase: "tables",
  change: "Random tables got a roll column showing each row's range on the die; weights and text stay as they were.",
  recordedBy: "tableRangesUpgraded",
};

export interface MigrationSurvey {
  /** Notes that would change: path → [original, upgraded]. */
  changes: Map<string, [string, string]>;
  /** Tables left alone, with why. */
  skipped: { path: string; reason: string }[];
  /** Tables already in the new format. */
  unchanged: number;
  /** Notes in the folder with no roll table. */
  notTables: number;
}

export async function surveyTableMigration(app: App, scope: TableScope): Promise<MigrationSurvey> {
  const survey: MigrationSurvey = { changes: new Map(), skipped: [], unchanged: 0, notTables: 0 };
  for (const file of tableNotes(app, scope)) {
    const content = await app.vault.read(file);
    const plan = planTableMigration(content);
    if (plan.action === "change") survey.changes.set(file.path, [content, plan.content]);
    else if (plan.action === "none") survey.unchanged++;
    else if (plan.reason === "no roll table") survey.notTables++;
    else survey.skipped.push({ path: file.path, reason: plan.reason });
  }
  return survey;
}

export interface MigrationResult extends MigrationSurvey {
  /** Paths actually rewritten. */
  changed: string[];
  /** Where the originals were saved. */
  backup?: string;
  /** Set when nothing was written because the backup failed. */
  error?: string;
}

/**
 * Add roll ranges to every table that can take them. The full text of every
 * note about to change is backed up first; if the backup can't be written,
 * nothing is changed. Safe to run twice.
 */
export async function migrateTables(app: App, scope: TableScope, backupDir: string): Promise<MigrationResult> {
  const survey = await surveyTableMigration(app, scope);
  const result: MigrationResult = { ...survey, changed: [] };
  if (!survey.changes.size) return result;
  const notes: Record<string, string> = {};
  for (const [path, [original]] of survey.changes) notes[path] = original;
  try {
    const json = JSON.stringify({ kind: "table-ranges", savedAt: new Date().toISOString(), notes });
    result.backup = await writeJsonBackup(app.vault.adapter, backupDir, "tables", json);
  } catch (e) {
    console.error("Hexmap World Creator: couldn't back up tables; nothing was changed", e);
    result.error = `Couldn't save a backup (${String(e)}), so no table was changed.`;
    return result;
  }
  for (const [path, [original, upgraded]] of survey.changes) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    let wrote = false;
    await processTableNote(app, file, (cur) => {
      // Edited since the survey: plan again from what's there now.
      const next = cur === original ? upgraded : (() => {
        const p = planTableMigration(cur);
        return p.action === "change" ? p.content : cur;
      })();
      wrote = next !== cur;
      return next;
    });
    if (wrote) result.changed.push(path);
  }
  return result;
}

export function backupDirFor(host: { manifest: { dir?: string } }): string {
  return `${host.manifest.dir}/backups/table-ranges-${new Date().toISOString().slice(0, 10)}`;
}

/** The one-time upgrade's notice: how many tables, and where the originals are (fresh-eyes 2026-10-13 F2). */
export function tableRangesNoticeText(n: number, backup: string | undefined): string {
  const what = `added roll ranges to ${n} table${n === 1 ? "" : "s"}.`;
  return backup ? `${what} The originals are backed up in ${backup}.` : what;
}

/** What the one-time upgrade needs from the plugin (tests pass a fake). */
export interface TableRangesHost {
  app: App;
  manifest: { dir?: string };
  settings: { tablesFolder?: string; workflowsFolder?: string; tableRangesUpgraded?: boolean };
  saveSettings(): Promise<void>;
}

/**
 * First load after updating: add roll ranges to older tables, silently and
 * once (owner decision DJ-Q6: no prompt, no nag). The originals are backed
 * up first; if the backup fails nothing changes and it runs again next
 * start. When nothing needs ranges no note is written, only the record.
 * One short notice afterwards, and only when a table changed.
 */
export async function upgradeTableRangesOnce(host: TableRangesHost): Promise<MigrationResult | null> {
  if (host.settings.tableRangesUpgraded) return null;
  const scope: TableScope = {
    tablesFolder: normalizeFolder(host.settings.tablesFolder ?? ""),
    workflowsFolder: normalizeFolder(host.settings.workflowsFolder ?? ""),
  };
  const result = await migrateTables(host.app, scope, backupDirFor(host));
  if (result.error) {
    console.warn("Hexmap World Creator: roll ranges not added; will try again next start.", result.error);
    return result;
  }
  host.settings.tableRangesUpgraded = true;
  await host.saveSettings();
  const n = result.changed.length;
  if (n) {
    noticeUpgrade(tableRangesNoticeText(n, result.backup), {
      ids: [info.id],
      backups: result.backup ? [result.backup] : [],
      check: result.skipped.length
        ? [`${result.skipped.length} table${result.skipped.length === 1 ? " was" : "s were"} left without roll ranges (no die, too many rows, or something that can't be read). "Check tables" in debug mode lists them.`]
        : [],
    });
  }
  return result;
}
