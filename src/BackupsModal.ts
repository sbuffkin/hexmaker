/**
 * Owner MG2: backups stay in the plugin's folder (hidden from Obsidian's
 * file list), with two commands to reach them:
 *
 * - "Open backups folder" opens it in the system's file manager.
 * - "Restore from upgrade backup…" lists the backups that hold notes' full
 *   text (newest first), shows what one would put back (changed notes put
 *   back, missing ones made again, unchanged ones left), and restores on a
 *   click. The notes' versions from just before are backed up first
 *   (`restore-<date>/before-restore`), so a restore can itself be undone by
 *   restoring that backup; nothing changes when that backup can't be saved.
 */
import { Notice, TFile, type App } from "obsidian";
import { HexmakerModal } from "./HexmakerModal";
import { listNoteBackups, planRestore, writeJsonBackup, type BackupAdapter, type BackupReadAdapter, type NoteBackup, type RestoreStatus } from "./backup";

/** What the commands need from the plugin. */
export interface BackupsHost {
  app: App;
  backupsFolder(): string;
}

type Adapter = BackupAdapter & BackupReadAdapter;

/** "Open backups folder": the plugin's backups folder in the system's file manager. */
export async function openBackupsFolder(host: BackupsHost): Promise<void> {
  const folder = host.backupsFolder();
  const adapter = host.app.vault.adapter as unknown as Adapter & { getFullPath?(p: string): string };
  if (!(await adapter.exists(folder))) {
    new Notice("There are no backups yet: they're made when an upgrade or a bulk change rewrites notes.");
    return;
  }
  // Obsidian's own "open in default app" (not in the public typings).
  const app = host.app as unknown as { openWithDefaultApp?(path: string): unknown; showInFolder?(path: string): unknown };
  try {
    if (typeof app.openWithDefaultApp === "function") {
      await app.openWithDefaultApp(folder);
      return;
    }
    if (typeof app.showInFolder === "function") {
      await app.showInFolder(folder);
      return;
    }
  } catch (e) {
    console.error("Hexmap World Creator: couldn't open the backups folder", e);
  }
  const where = adapter.getFullPath ? adapter.getFullPath(folder) : folder;
  new Notice(`The backups are in ${where}`, 15000);
}

/** Each note's current text, or null when it's gone. */
async function currentTexts(app: App, paths: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const p of paths) {
    const f = app.vault.getAbstractFileByPath(p);
    out.set(p, f instanceof TFile ? await app.vault.read(f) : null);
  }
  return out;
}

/**
 * Put a backup's notes back: changed notes get the backup's text, missing
 * ones are made again, unchanged ones are left. The current versions are
 * backed up first (`<backups>/restore-<date>/before-restore.json.gz`); if
 * that fails nothing changes (throws). Returns what was put back and the
 * undo backup's path.
 */
export async function restoreBackup(app: App, backupsFolder: string, backup: NoteBackup, when = new Date()): Promise<{ restored: string[]; undo?: string }> {
  const now = await currentTexts(app, Object.keys(backup.notes));
  const plan = planRestore(backup.notes, (p) => now.get(p) ?? null).filter((s) => s.status !== "same");
  if (!plan.length) return { restored: [] };
  const before: Record<string, string> = {};
  for (const s of plan) if (s.status === "changed") before[s.path] = now.get(s.path) ?? "";
  const created = plan.filter((s) => s.status === "missing").map((s) => s.path);
  const json = JSON.stringify({ kind: "before-restore", restoredFrom: backup.path, savedAt: when.toISOString(), notes: before, created });
  const undo = await writeJsonBackup(app.vault.adapter, `${backupsFolder}/restore-${when.toISOString().slice(0, 10)}`, "before-restore", json);
  const restored: string[] = [];
  for (const s of plan) {
    const text = backup.notes[s.path];
    const f = app.vault.getAbstractFileByPath(s.path);
    if (f instanceof TFile) {
      await app.vault.process(f, () => text);
    } else {
      const dir = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/")) : "";
      if (dir && !app.vault.getAbstractFileByPath(dir)) {
        try { await app.vault.createFolder(dir); } catch { /* made meanwhile */ }
      }
      await app.vault.create(s.path, text);
    }
    restored.push(s.path);
  }
  return { restored, undo };
}

/** "2026-10-14 09:05" in local time, from an ISO time. */
export function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_TEXT: Record<RestoreStatus, string> = {
  changed: "put back",
  missing: "made again (it's gone now)",
  same: "same as now, left alone",
};

/** "Restore from upgrade backup…": pick a backup, see what it would put back, restore. */
export class RestoreBackupModal extends HexmakerModal {
  private backups: NoteBackup[] = [];

  constructor(app: App, private host: BackupsHost) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Restore from upgrade backup");
    this.contentEl.addClass("duckmage-restore-backup");
    this.contentEl.createEl("p", { text: "Reading the backups…" });
    void listNoteBackups(this.app.vault.adapter as unknown as BackupReadAdapter, this.host.backupsFolder()).then((list) => {
      this.backups = list;
      this.showList();
    });
  }

  private showList(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (!this.backups.length) {
      contentEl.createEl("p", { text: "There are no backups of notes yet. They're made when an upgrade or a bulk change rewrites notes." });
      this.footer({ cancel: { text: "Close", onClick: () => this.close() } });
      return;
    }
    contentEl.createEl("p", { text: "Pick a backup to see which notes it would put back. Nothing changes until you restore it." });
    const list = contentEl.createDiv({ cls: "duckmage-restore-backup-list" });
    for (const b of this.backups) {
      const n = Object.keys(b.notes).length;
      const row = list.createEl("button", { cls: "duckmage-restore-backup-row" });
      row.createSpan({ cls: "duckmage-restore-backup-name", text: `${b.folder}/${b.name}` });
      row.createSpan({ cls: "duckmage-map-origin-desc", text: `${n} note${n === 1 ? "" : "s"}${b.savedAt ? `, saved ${localTime(b.savedAt)}` : ""}` });
      row.addEventListener("click", () => void this.showBackup(b));
    }
    contentEl.createEl("p", { cls: "duckmage-map-origin-desc", text: "Other files in the backups folder (a map's data, path reports) aren't notes to put back; Open backups folder shows them." });
    this.footer({
      secondary: [{ text: "Open backups folder", onClick: () => void openBackupsFolder(this.host) }],
      cancel: { text: "Close", onClick: () => this.close() },
    });
  }

  private async showBackup(b: NoteBackup): Promise<void> {
    const now = await currentTexts(this.app, Object.keys(b.notes));
    const plan = planRestore(b.notes, (p) => now.get(p) ?? null);
    const todo = plan.filter((s) => s.status !== "same").length;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: `${b.folder}/${b.name}` , cls: "duckmage-restore-backup-name" });
    contentEl.createEl("p", {
      text: todo
        ? `Restore puts ${todo} note${todo === 1 ? "" : "s"} back as ${todo === 1 ? "it was" : "they were"} when this backup was made. Their versions from now are backed up first, so you can undo it by restoring that backup.`
        : "Every note in this backup is the same as now: there is nothing to put back.",
    });
    const ul = contentEl.createEl("ul", { cls: "duckmage-restore-backup-notes" });
    for (const s of plan) {
      const li = ul.createEl("li");
      li.createSpan({ text: s.path });
      li.createSpan({ cls: "duckmage-map-origin-desc", text: ` (${STATUS_TEXT[s.status]})` });
    }
    this.footer({
      primary: { text: todo ? `Restore ${todo} note${todo === 1 ? "" : "s"}` : "Restore", disabled: !todo, onClick: () => void this.restore(b) },
      secondary: [{ text: "Back", onClick: () => this.showList() }],
      cancel: () => this.close(),
    });
  }

  private async restore(b: NoteBackup): Promise<void> {
    try {
      const r = await restoreBackup(this.app, this.host.backupsFolder(), b);
      this.close();
      new Notice(
        r.restored.length
          ? `Put back ${r.restored.length} note${r.restored.length === 1 ? "" : "s"} from ${b.name}. Their versions from just before are backed up in ${r.undo}: restore that backup to undo.`
          : "Nothing to put back: every note is the same as in the backup.",
        12000,
      );
    } catch (e) {
      console.error("Hexmap World Creator: restore failed", e);
      new Notice(`Couldn't save a backup of the notes as they are now, so nothing was restored (${String(e)}).`, 12000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
