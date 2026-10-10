/**
 * Table upkeep commands (issue #45):
 * - "Check tables" writes a report note (`_table-check.md` in the tables
 *   folder) listing tables whose ranges, weights or columns couldn't be read.
 * - "Add roll ranges to tables" upgrades older tables to `| dN | Result |
 *   Weight |`, after writing a gzipped full-text backup. It only runs from
 *   the user's click in TableRangesModal; on first load after updating, the
 *   modal is offered once (see maybePromptTableRanges).
 *
 * Never adds to or alters `_` notes (other than the report it owns).
 */

import { Notice, TFile, type App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { writeJsonBackup } from "../backup";
import { parseRandomTableWithReport, type TableIssue } from "./randomTable";
import { isTableNotePath, planTableMigration } from "./tableMigration";
import { processTableNote } from "./TableStore";

export const TABLE_CHECK_NOTE = "_table-check.md";

export interface TableScope {
  tablesFolder: string;
  workflowsFolder: string;
}

export function tableScope(plugin: HexmakerPlugin): TableScope {
  return {
    tablesFolder: normalizeFolder(plugin.settings.tablesFolder ?? ""),
    workflowsFolder: normalizeFolder(plugin.settings.workflowsFolder ?? ""),
  };
}

/** Table notes in the tables folder ("_" notes and workflows excluded), by path. */
export function tableNotes(app: App, scope: TableScope): TFile[] {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => isTableNotePath(f.path, scope.tablesFolder, scope.workflowsFolder))
    .sort((a, b) => a.path.localeCompare(b.path));
}

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

function backupDirFor(plugin: HexmakerPlugin): string {
  return `${plugin.manifest.dir}/backups/table-ranges-${new Date().toISOString().slice(0, 10)}`;
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
    if (!result.error) {
      plugin.settings.tableRangesPrompt = "done";
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

/** Asks before adding roll ranges; never runs without the click. */
export class TableRangesModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private survey: MigrationSurvey,
    private fromPrompt: boolean,
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
    const row = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    const go = row.createEl("button", { text: "Add ranges (a backup is made first)", cls: "mod-cta" });
    go.disabled = n === 0;
    go.addEventListener("click", () => {
      this.close();
      void runMigration(this.plugin);
    });
    row.createEl("button", { text: "Not now" }).addEventListener("click", () => this.close());
    if (this.fromPrompt) {
      row.createEl("button", { text: "Don't ask again" }).addEventListener("click", () => {
        this.plugin.settings.tableRangesPrompt = "never";
        void this.plugin.saveSettings();
        this.close();
      });
    }
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
  new TableRangesModal(plugin.app, plugin, survey, false).open();
}

/**
 * First load after updating: offer the upgrade once, if any table would
 * change. "Not now" asks again next time; "Don't ask again" stops it.
 */
export async function maybePromptTableRanges(plugin: HexmakerPlugin): Promise<void> {
  if (plugin.settings.tableRangesPrompt) return;
  const survey = await surveyTableMigration(plugin.app, tableScope(plugin));
  if (!survey.changes.size) {
    plugin.settings.tableRangesPrompt = "done";
    await plugin.saveSettings();
    return;
  }
  new TableRangesModal(plugin.app, plugin, survey, true).open();
}
