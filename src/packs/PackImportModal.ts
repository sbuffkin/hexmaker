import { Notice, type App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { Fold } from "../ui/disclosure";
import { addPickerFilter, emptyState, filterText } from "../ui/pickers";
import type { PackKind } from "./packKinds";
import { readZip } from "./zip";
import {
  CONFLICT_LABELS,
  loadPack,
  planImport,
  resolveSteps,
  type ConflictChoice,
  type ImportPlan,
  type LoadedPack,
  type PackFile,
  type PlanItem,
} from "./packPlan";
import { runImport, type ImportReport } from "./packIO";
import { vaultWriteHost, zipsInVault } from "./packVault";

/** Most files a picked folder may hold (a wrong pick, like a whole vault, stops here). */
const MAX_FOLDER_FILES = 5000;

const CHOICES: ConflictChoice[] = ["both", "skip", "replace"];

/**
 * "Import content pack…": pick a .zip (or a folder) made by "Export
 * content pack", see what goes where in this vault's folders, choose per
 * note what happens to one that's already here (Skip, Keep both as
 * "Name 2", or Replace after a backup), then import. Never deletes.
 */
export class PackImportModal extends HexmakerModal {
  protected surfaceId = "PackImport";
  private pack: LoadedPack | null = null;
  private plan: ImportPlan | null = null;
  private source = "";
  private allChoice: ConflictChoice = "both";
  private choices = new Map<string, ConflictChoice>();

  constructor(app: App, private plugin: HexmakerPlugin, private kinds: PackKind[]) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Import a content pack");
    this.contentEl.addClass("duckmage-pack-modal");
    this.renderSource();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private clear(): HTMLElement {
    this.contentEl.empty();
    this.resetDisclosure();
    return this.contentEl;
  }

  // ── 1. Pick the pack ──────────────────────────────────────────────────────

  private renderSource(error?: string): void {
    const el = this.clear();
    el.createEl("p", {
      cls: "duckmage-export-tab-hint",
      text: "Bring in notes from a content pack (a .zip exported from another vault): tables, workflows, templates, towns and more, each into this vault's folder for it. You see everything before it's added.",
    });
    if (error) el.createDiv({ cls: "duckmage-pack-error", text: error });
    const row = el.createDiv({ cls: "duckmage-export-tab-actions" });
    const zipBtn = row.createEl("button", { text: "Choose a .zip…" });
    const zipInput = createEl("input", { type: "file", attr: { accept: ".zip,application/zip" } });
    zipBtn.addEventListener("click", () => zipInput.click());
    zipInput.addEventListener("change", () => {
      const f = zipInput.files?.[0];
      if (f) void this.load(f.name, async () => readZip(new Uint8Array(await f.arrayBuffer())));
    });
    this.place("PackImport.pickZip", zipBtn);

    const dirBtn = row.createEl("button", { text: "Choose a folder…" });
    const dirInput = createEl("input", { type: "file", attr: { webkitdirectory: "", multiple: "" } });
    dirBtn.addEventListener("click", () => dirInput.click());
    dirInput.addEventListener("change", () => {
      const list = Array.from(dirInput.files ?? []);
      if (!list.length) return;
      const top = (list[0].webkitRelativePath || list[0].name).split("/")[0];
      void this.load(top, async () => {
        if (list.length > MAX_FOLDER_FILES) throw new Error(`that folder has ${list.length} files; a pack has its notes and a pack.md`);
        return Promise.all(list.map(async (f): Promise<PackFile> => ({ path: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      });
    });
    this.place("PackImport.pickFolder", dirBtn);

    const zips = zipsInVault(this.app);
    if (zips.length) {
      const box = el.createDiv({ cls: "duckmage-export-group duckmage-pack-vault-zips" });
      box.createDiv({ cls: "duckmage-export-group-title", text: "Packs in this vault" });
      const list = box.createDiv({ cls: "duckmage-pack-items" });
      for (const z of zips) {
        const btn = list.createEl("button", { cls: "duckmage-pack-zip", text: z.path });
        filterText(btn, z.path);
        btn.addEventListener("click", () => void this.load(z.name, async () => readZip(new Uint8Array(await this.app.vault.readBinary(z)))));
      }
      addPickerFilter(list, { things: "packs", count: zips.length });
      this.place("PackImport.vaultZips", box);
    }
    this.footer({ cancel: () => this.close() });
  }

  private async load(name: string, files: () => Promise<PackFile[]>): Promise<void> {
    try {
      const fallback = name.replace(/\.zip$/i, "");
      const pack = loadPack(await files(), this.kinds, fallback);
      const host = vaultWriteHost(this.plugin);
      this.pack = pack;
      this.source = name;
      this.choices.clear();
      this.plan = await planImport(pack, this.kinds, async (p) => (host.exists(p) ? host.read(p).catch(() => null) : null));
      this.renderPreview();
    } catch (e) {
      this.renderSource(`Couldn't read ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 2. Preview ────────────────────────────────────────────────────────────

  private choiceOf(item: PlanItem): ConflictChoice {
    return this.choices.get(item.packPath) ?? this.allChoice;
  }

  private renderPreview(): void {
    const pack = this.pack!, plan = this.plan!;
    const el = this.clear();
    const m = pack.manifest;
    el.createEl("h3", { cls: "duckmage-pack-name", text: m.name });
    if (m.description) el.createEl("p", { cls: "duckmage-pack-description", text: m.description });
    const meta = [m.madeWith && `Made with ${m.madeWith}`, m.date && `on ${m.date}`, `from ${this.source}`].filter(Boolean).join(" ");
    el.createDiv({ cls: "duckmage-export-tab-row-hint", text: meta });
    if (pack.inferred) el.createDiv({ cls: "duckmage-export-tab-row-hint", text: "It has no pack.md, so its folders were read by name." });

    const conflicts = plan.items.filter((i) => i.status === "conflict");
    if (conflicts.length) {
      const row = el.createDiv({ cls: "duckmage-export-tab-row" });
      row.createEl("label", { cls: "duckmage-export-tab-label", text: `${conflicts.length} note${conflicts.length === 1 ? " is" : "s are"} already here, different:` });
      const sel = this.choiceSelect(row, this.allChoice);
      sel.addEventListener("change", () => {
        this.allChoice = sel.value as ConflictChoice;
        this.choices.clear();
        this.renderPreview();
      });
      this.place("PackImport.conflictAll", row);
    }

    const list = el.createDiv({ cls: "duckmage-pack-kinds" });
    if (!plan.items.length) emptyState(list, "Nothing in this pack fits this vault's folders.");
    for (const kind of this.kinds) {
      const items = plan.items.filter((i) => i.kindId === kind.id);
      if (!items.length) continue;
      const fresh = items.filter((i) => i.status === "new").length;
      const here = items.length - fresh;
      const fold = new Fold(list, { title: kind.label, open: false, store: this.app, surface: "PackImport", key: kind.id, cls: "duckmage-pack-kind" });
      fold.summary.createSpan({ cls: "duckmage-pack-count", text: `${fresh} new${here ? ` · ${here} already here` : ""}` });
      fold.body.createDiv({ cls: "duckmage-pack-from", text: `Into ${kind.folder}` });
      const rows = fold.body.createDiv({ cls: "duckmage-pack-items" });
      for (const item of items) {
        const r = rows.createDiv({ cls: "duckmage-pack-item" });
        const rel = item.target.slice(kind.folder.length + 1).replace(/\.md$/i, "");
        filterText(r, rel);
        r.createSpan({ cls: "duckmage-pack-item-name", text: rel });
        if (item.status === "new") r.createSpan({ cls: "duckmage-pack-tag", text: "new" });
        else if (item.status === "same") r.createSpan({ cls: "duckmage-pack-tag", text: "same, left as is" });
        else {
          const sel = this.choiceSelect(r, this.choiceOf(item));
          sel.setAttr("aria-label", `${rel}: already here`);
          sel.addEventListener("change", () => {
            this.choices.set(item.packPath, sel.value as ConflictChoice);
            this.refreshImportButton();
          });
        }
      }
      addPickerFilter(rows, { things: "notes", count: items.length });
    }

    const notIn = [...plan.skipped.map((s) => `${s.path}: ${s.reason}`), ...plan.missing.map((p) => `${p}: listed in pack.md but not in the pack`)];
    if (notIn.length) {
      const fold = new Fold(el, { title: `Not imported (${notIn.length})`, open: false, store: this.app, surface: "PackImport", key: "skipped", cls: "duckmage-pack-kind" });
      const ul = fold.body.createEl("ul", { cls: "duckmage-pack-report" });
      for (const line of notIn) ul.createEl("li", { text: line });
    }

    const footer = this.footer({
      primary: { text: "Import", cls: "duckmage-pack-import-btn", onClick: () => void this.runImport() },
      secondary: [{ text: "Back", onClick: () => this.renderSource() }],
      cancel: () => this.close(),
    });
    this.importBtn = footer.primary;
    this.place("PackImport.import", footer.el);
    this.refreshImportButton();
  }

  private importBtn?: HTMLButtonElement;

  private steps() {
    const host = vaultWriteHost(this.plugin);
    return resolveSteps(this.plan!.items, (i) => this.choiceOf(i), (p) => host.exists(p));
  }

  private refreshImportButton(): void {
    if (!this.importBtn) return;
    const n = this.steps().filter((s) => s.action !== "skip").length;
    this.importBtn.setText(n ? `Import ${n} note${n === 1 ? "" : "s"}` : "Nothing to import");
    this.importBtn.disabled = n === 0;
  }

  private choiceSelect(parent: HTMLElement, value: ConflictChoice): HTMLSelectElement {
    const sel = parent.createEl("select", { cls: "dropdown duckmage-pack-choice" });
    for (const c of CHOICES) sel.createEl("option", { value: c, text: CONFLICT_LABELS[c] });
    sel.value = value;
    sel.setAttr("title", "Keep both: the pack's note is added as \"Name 2\". Replace: yours is backed up first.");
    return sel;
  }

  // ── 3. Import and report ──────────────────────────────────────────────────

  private async runImport(): Promise<void> {
    if (this.importBtn) this.importBtn.disabled = true;
    const report = await runImport(vaultWriteHost(this.plugin), this.steps(), this.pack!.manifest.name);
    report.skipped.push(...this.plan!.skipped);
    this.renderReport(report);
  }

  private renderReport(r: ImportReport): void {
    const el = this.clear();
    const added = r.created.length + r.keptBoth.length;
    const summary = `Imported "${this.pack!.manifest.name}": ${added} added, ${r.replaced.length} replaced, ${r.skipped.length} left out${r.failed.length ? `, ${r.failed.length} failed` : ""}.`;
    new Notice(summary);
    el.createEl("p", { cls: "duckmage-wizard-text", text: summary });
    if (r.backup) el.createDiv({ cls: "duckmage-export-tab-row-hint", text: `The notes it replaced were saved first to ${r.backup}.` });
    const section = (title: string, lines: string[], open = false) => {
      if (!lines.length) return;
      const fold = new Fold(el, { title: `${title} (${lines.length})`, open, cls: "duckmage-pack-kind" });
      const ul = fold.body.createEl("ul", { cls: "duckmage-pack-report" });
      for (const line of lines) ul.createEl("li", { text: line });
    };
    section("Failed", r.failed.map((f) => `${f.path}: ${f.reason}`), true);
    section("Added", r.created);
    section("Kept both", r.keptBoth.map((k) => `${k.path} (yours stays at ${k.target})`));
    section("Replaced", r.replaced);
    section("Left out", r.skipped.map((s) => `${s.path}: ${s.reason}`));
    this.footer({ cancel: { text: "Done", onClick: () => this.close() } });
  }
}
