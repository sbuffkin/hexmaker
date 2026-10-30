/**
 * The hex flower notes (plan-hex-flower): every note in the hex flowers
 * folder (default `<world folder>/hex flowers`) with the flower marker,
 * read into a Flower and kept live from hand edits. What a note says that
 * can't be read is reported once per edit (a notice) and left as written.
 * Writes go through updateFlowerNote, which patches only the flower's
 * tables and keys.
 */

import { Notice, TFile, type TAbstractFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { NoteFolderStore } from "../stores/NoteFolderStore";
import { normalizeFolder } from "../utils";
import type { Flower } from "./flower";
import { buildFlowerNote, isFlowerNote, parseFlowerNote, updateFlowerNote } from "./flowerNote";

export const HEX_FLOWER_STORE = "hex-flowers";

export interface FlowerEntry {
  path: string;
  flower: Flower;
  problems: string[];
}

/** The folder for hex flower notes: the setting, else `<world folder>/hex flowers`. */
export function hexFlowersFolder(settings: { worldFolder?: string; hexFlowersFolder?: string }): string {
  const configured = normalizeFolder(settings.hexFlowersFolder ?? "");
  if (configured) return configured;
  const world = normalizeFolder(settings.worldFolder ?? "");
  return world ? `${world}/hex flowers` : "hex flowers";
}

/** A name safe for a note file. */
export function flowerFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Hex flower";
}

export class FlowerStore extends NoteFolderStore<FlowerEntry> {
  readonly id = HEX_FLOWER_STORE;
  protected readonly logLabel = "hex flowers";
  protected readonly backupFolder = "hex-flowers";
  protected readonly backupLabel = "hex flowers";

  /**
   * @param report  says what a note has that can't be read (a notice)
   * @param setup   run once, when the store starts (the module registers its code block there)
   */
  constructor(
    plugin: HexmakerPlugin,
    private report: (msg: string) => void = (m) => new Notice(m, 8000),
    private setup?: () => void,
  ) {
    super(plugin);
  }

  folder(): string {
    return hexFlowersFolder(this.plugin.settings);
  }

  async init(): Promise<void> {
    this.setup?.();
    this.setup = undefined;
    await this.enqueue(async () => {
      for (const f of this.files()) await this.load(f);
      this.ready = true;
      this.publish();
    });
  }

  // ── API ────────────────────────────────────────────────────────────────

  /** Every flower, by name. */
  list(): FlowerEntry[] {
    return [...this.entries.values()].sort((a, b) => a.flower.name.localeCompare(b.flower.name));
  }

  /** A flower by name, link target or path (any case; ".md" optional). */
  get(ref: string): FlowerEntry | undefined {
    const t = ref.trim().replace(/\.md$/i, "").toLowerCase();
    if (!t) return undefined;
    for (const e of this.entries.values()) {
      const p = e.path.replace(/\.md$/i, "").toLowerCase();
      if (p === t || e.flower.name.toLowerCase() === t || p.endsWith(`/${t}`)) return e;
    }
    return undefined;
  }

  /** A name no flower has yet ("Wilds", "Wilds 2"…). */
  freeName(base: string): string {
    const clean = flowerFileName(base);
    const taken = (n: string) => !!this.get(n) || !!this.plugin.app.vault.getAbstractFileByPath(`${this.folder()}/${n}.md`);
    if (!taken(clean)) return clean;
    for (let i = 2; ; i++) if (!taken(`${clean} ${i}`)) return `${clean} ${i}`;
  }

  /** Write a new flower note; returns its path. */
  async create(flower: Flower): Promise<string> {
    const name = this.freeName(flower.name);
    const path = `${this.folder()}/${name}.md`;
    await this.enqueue(async () => {
      await this.ensureFolder(this.folder());
      const text = buildFlowerNote({ ...flower, name });
      const file = await this.plugin.app.vault.create(path, text);
      await this.load(file, text);
      this.publish();
    });
    return path;
  }

  /** Write a flower's tables and keys into its note (prose and other columns kept). */
  async save(path: string, flower: Flower): Promise<void> {
    await this.enqueue(async () => {
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return;
      let written = "";
      await this.plugin.app.vault.process(file, (content) => (written = updateFlowerNote(content, flower)));
      await this.load(file, written);
      this.publish();
    });
  }

  // ── reading ────────────────────────────────────────────────────────────

  protected isNoteFile(f: TAbstractFile): f is TFile {
    const folder = this.folder();
    return f instanceof TFile && f.extension === "md" && !f.name.startsWith("_") && f.path.startsWith(`${folder}/`);
  }

  onRename(f: TAbstractFile, oldPath: string): void {
    if (this.entries.has(oldPath)) {
      this.entries.delete(oldPath);
      this.lastContent.delete(oldPath);
      this.publish();
    }
    this.onModify(f);
  }

  protected async load(f: TFile, known?: string): Promise<boolean> {
    const content = known ?? await this.plugin.app.vault.cachedRead(f);
    if (this.lastContent.get(f.path) === content) return false;
    this.lastContent.set(f.path, content);
    const read = isFlowerNote(content) ? parseFlowerNote(content, f.basename) : null;
    if (!read) return this.entries.delete(f.path);
    this.entries.set(f.path, { path: f.path, flower: read.flower, problems: read.problems });
    // Once per edit: the same problems after the same text aren't said again.
    const said = read.problems.join("\n");
    if (said && this.reported.get(f.path) !== said) {
      this.report(`Hex flower ${f.basename}: ${read.problems[0]}${read.problems.length > 1 ? ` (+${read.problems.length - 1} more)` : ""}`);
    }
    this.reported.set(f.path, said);
    return true;
  }
}
