/**
 * What the upgrades did during this start-up, for the upgrade note (owner
 * MG1). Every `noticeUpgrade` adds an entry (ui/notify.ts); a step that
 * knows more passes its migration id, backups and anything for the user to
 * check. The plugin takes the entries once the start-up upgrades are done
 * and writes them into the "Hexmaker upgrade <date>" note.
 *
 * Pure: no Obsidian imports.
 */

export interface UpgradeEntry {
  /** What happened, as the notice says it. */
  text: string;
  /** The migrations that did it (src/migrations ids), when it's one or more. */
  ids?: string[];
  /** Where the originals were saved (files or folders under the plugin's backups folder). */
  backups?: string[];
  /** Things the user may want to look at. */
  check?: string[];
}

let entries: UpgradeEntry[] = [];

/** Add what an upgrade did. */
export function reportUpgrade(e: UpgradeEntry): void {
  entries.push(e);
}

/** Everything reported since the last take, in order (and start afresh). */
export function takeUpgradeReport(): UpgradeEntry[] {
  const out = entries;
  entries = [];
  return out;
}

/** Whether anything was reported (tests). */
export function upgradeReportSize(): number {
  return entries.length;
}
