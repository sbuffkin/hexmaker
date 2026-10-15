/**
 * Table upkeep commands (issue #45):
 * - "Check tables" writes a report note (`_table-check.md` in the tables
 *   folder) listing tables whose ranges, weights or columns couldn't be read.
 * - "Add roll ranges to tables" upgrades older tables to `| dN | Result |
 *   Weight |`, after writing a gzipped full-text backup. It only runs from
 *   the user's click in TableRangesModal, and once, silently, on the first
 *   load after updating (src/migrations/v1.5-table-roll-ranges.ts; no
 *   prompt: DJ-Q6).
 *
 * Never adds to or alters `_` notes (other than the report it owns).
 */

import { Notice, TFile, type App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { parseRandomTableWithReport, type TableIssue } from "./randomTable";
import { tableNotes, type TableScope } from "./tableNotePaths";
import { backupDirFor, migrateTables, type MigrationResult, type MigrationSurvey, surveyTableMigration } from "../migrations/v1.5-table-roll-ranges";

export type { TableScope };
export { migrateTables, surveyTableMigration, tableNotes, type MigrationResult, type MigrationSurvey };

export const TABLE_CHECK_NOTE = "_table-check.md";

export function tableScope(plugin: HexmakerPlugin): TableScope {
  return {
    tablesFolder: normalizeFolder(plugin.settings.tablesFolder ?? ""),
    workflowsFolder: normalizeFolder(plugin.settings.workflowsFolder ?? ""),
  };
}

export interface TableCheck {
  path: string;
  issues: TableIssue[];
}

/** Every table note's issues (tables with none are left out). */
export async function checkTables(app: App, scope: TableScope): Promise<{ checked: number; problems: TableCheck[] }> {
  const problems: TableCheck[] = [];
  let checked = 0;
  for (const file of tableNotes(app, scope)) {
    const report = parseRandomTableWithReport(await app.vault.read(file));
    if (!report.block?.recognized) continue;
    checked++;
    if (report.issues.length) problems.push({ path: file.path, issues: report.issues });
  }
  return { checked, problems };
}

const link = (path: string) => {
  const stem = path.replace(/\.md$/i, "");
  return `[[${stem}|${stem.slice(stem.lastIndexOf("/") + 1)}]]`;
};

/** The report note's text. */
export function formatTableReport(
  when: Date,
  check: { checked: number; problems: TableCheck[] },
  migration?: MigrationResult,
): string {
  const stamp = `${when.toISOString().slice(0, 10)} ${when.toTimeString().slice(0, 5)}`;
  const lines = [
    "# Table check",
    "",
    `Written by Hexmap World Creator on ${stamp}. This note is replaced each time the check runs, so notes made here will be lost.`,
    "",
  ];
  if (migration) {
    lines.push("## Roll ranges added", "");
    if (migration.error) lines.push(`- ${migration.error}`);
    lines.push(`- Changed: ${migration.changed.length} table${migration.changed.length === 1 ? "" : "s"}.`);
    if (migration.backup) lines.push(`- Backup of the originals: \`${migration.backup}\``);
    lines.push(`- Already had ranges: ${migration.unchanged}.`);
    if (migration.skipped.length) {
      lines.push(`- Left as they were (${migration.skipped.length}):`);
      for (const s of migration.skipped) lines.push(`  - ${link(s.path)}: ${s.reason}`);
    }
    lines.push("");
  }
  lines.push("## Tables to look at", "");
  lines.push(
    check.problems.length
      ? `Checked ${check.checked} table${check.checked === 1 ? "" : "s"}; ${check.problems.length} ha${check.problems.length === 1 ? "s" : "ve"} something to look at.`
      : `Checked ${check.checked} table${check.checked === 1 ? "" : "s"}; nothing to look at.`,
    "",
  );
  for (const p of check.problems) {
    lines.push(`### ${link(p.path)}`, "");
    for (const i of p.issues) lines.push(`- ${i.message}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Write (or replace) the report note in the tables folder. Returns its path. */
export async function writeTableReport(app: App, scope: TableScope, text: string): Promise<string> {
  const path = scope.tablesFolder ? `${scope.tablesFolder}/${TABLE_CHECK_NOTE}` : TABLE_CHECK_NOTE;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) await app.vault.modify(existing, text);
  else {
    if (scope.tablesFolder && !app.vault.getAbstractFileByPath(scope.tablesFolder)) await app.vault.createFolder(scope.tablesFolder);
    await app.vault.create(path, text);
  }
  return path;
}

/** "Check tables" command. */
export async function runTableCheck(plugin: HexmakerPlugin): Promise<void> {
  const scope = tableScope(plugin);
  const check = await checkTables(plugin.app, scope);
  const path = await writeTableReport(plugin.app, scope, formatTableReport(new Date(), check));
  new Notice(
    check.problems.length
      ? `${check.problems.length} of ${check.checked} tables have something to look at. See ${path}.`
      : `Checked ${check.checked} tables: nothing to look at.`,
  );
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile && check.problems.length) await plugin.app.workspace.getLeaf("tab").openFile(file);
}

/** Run the migration (from the modal's button), then report. */
async function runMigration(plugin: HexmakerPlugin): Promise<void> {
  const scope = tableScope(plugin);
  const notice = new Notice("Adding roll ranges to tables…", 0);
  try {
    const result = await migrateTables(plugin.app, scope, backupDirFor(plugin));
    const check = await checkTables(plugin.app, scope);
    const path = await writeTableReport(plugin.app, scope, formatTableReport(new Date(), check, result));
    if (!result.error && !plugin.settings.tableRangesUpgraded) {
      plugin.settings.tableRangesUpgraded = true;
      await plugin.saveSettings();
    }
    new Notice(
      result.error ??
        `Added roll ranges to ${result.changed.length} table${result.changed.length === 1 ? "" : "s"}` +
          (result.skipped.length ? `; ${result.skipped.length} left as they were` : "") +
          `. See ${path}.`,
    );
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await plugin.app.workspace.getLeaf("tab").openFile(file);
  } finally {
    notice.hide();
  }
}

/** Shows what would change, then adds roll ranges on the click (the "Add roll ranges to tables" command). */
export class TableRangesModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private survey: MigrationSurvey,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Add roll ranges to tables?");
    const { contentEl } = this;
    const n = this.survey.changes.size;
    contentEl.createEl("p", {
      text:
        `Tables can now show each row's roll range for their die (for example "1–6"), so they can be rolled by hand from the note itself. ` +
        `${n} table${n === 1 ? "" : "s"} would get a roll column. Weights, results, other columns and text around the tables stay as they are.`,
    });
    if (this.survey.skipped.length) {
      contentEl.createEl("p", {
        cls: "duckmage-map-origin-desc",
        text: `${this.survey.skipped.length} table${this.survey.skipped.length === 1 ? "" : "s"} would be left as they are (no die, too many rows for the die, or something that can't be read). They're listed in the report afterwards.`,
      });
    }
    this.footer({
      primary: { text: "Add ranges (a backup is made first)", disabled: n === 0, onClick: () => {
        this.close();
        void runMigration(this.plugin);
      } },
      cancel: () => this.close(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** "Add roll ranges to tables" command: shows what would change, then asks. */
export async function openTableRangesModal(plugin: HexmakerPlugin): Promise<void> {
  const survey = await surveyTableMigration(plugin.app, tableScope(plugin));
  if (!survey.changes.size) {
    new Notice(
      survey.skipped.length
        ? `No table needs roll ranges; ${survey.skipped.length} can't take them yet. Run "Check tables" for details.`
        : "Every table already has roll ranges.",
    );
    return;
  }
  new TableRangesModal(plugin.app, plugin, survey).open();
}
