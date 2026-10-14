import { Notice, type App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { Fold } from "../ui/disclosure";
import { addPickerFilter, emptyState, filterText } from "../ui/pickers";
import { exportedMessage, resolveExportFolder } from "../export/exportFolder";
import { notesByKind, type PackKind } from "./packKinds";
import { packFileName } from "./packIO";
import { exportPackToVault, madeWith } from "./packVault";

let nextId = 0;

/**
 * "Export content pack…": pick notes by kind (all or none per kind, or
 * one by one) and write them, as they are and in their folders, to a
 * .zip in the export folder with a pack.md listing them. Another vault
 * brings them in with "Import content pack…".
 */
export class PackExportModal extends HexmakerModal {
  protected surfaceId = "PackExport";

  constructor(app: App, private plugin: HexmakerPlugin, private kinds: PackKind[]) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Export a content pack");
    this.contentEl.addClass("duckmage-pack-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    this.resetDisclosure();
    el.createEl("p", {
      cls: "duckmage-export-tab-hint",
      text: "Your notes in one .zip, to bring into another vault with \"Import content pack\". Notes go in as they are, in their folders, with a pack.md that lists them.",
    });

    const byKind = notesByKind(this.app.vault.getMarkdownFiles().map((f) => f.path), this.kinds);
    const kinds = this.kinds.filter((k) => byKind.get(k.id)?.length);

    const form = el.createDiv({ cls: "duckmage-export-tab-options" });
    const nameRow = form.createDiv({ cls: "duckmage-export-tab-row" });
    const nameId = `duckmage-pack-field-${nextId++}`;
    nameRow.createEl("label", { text: "Pack name", cls: "duckmage-export-tab-label", attr: { for: nameId } });
    const nameInput = nameRow.createEl("input", { type: "text", cls: "duckmage-export-tab-text", attr: { id: nameId, placeholder: "My content pack" } });
    nameInput.value = "My content pack";
    this.place("PackExport.name", nameRow);

    const descRow = form.createDiv({ cls: "duckmage-export-tab-row duckmage-pack-desc-row" });
    const descId = `duckmage-pack-field-${nextId++}`;
    descRow.createEl("label", { text: "Description", cls: "duckmage-export-tab-label", attr: { for: descId } });
    const descInput = descRow.createEl("textarea", { cls: "duckmage-pack-desc", attr: { id: descId, rows: "2", placeholder: "What's in it, what it's for (optional)" } });
    this.place("PackExport.description", descRow);

    // What to include: one fold per kind, a tick for the whole kind in its header.
    const picked = new Map<string, Set<string>>(kinds.map((k) => [k.id, new Set(byKind.get(k.id))]));
    const group = form.createDiv({ cls: "duckmage-export-group duckmage-pack-kinds" });
    const head = group.createDiv({ cls: "duckmage-pack-kinds-head" });
    head.createDiv({ cls: "duckmage-export-group-title", text: "What to include" });
    const allBtn = head.createEl("button", { text: "All", cls: "duckmage-pack-small-btn" });
    const noneBtn = head.createEl("button", { text: "None", cls: "duckmage-pack-small-btn" });
    this.place("PackExport.selectAll", allBtn);
    this.place("PackExport.selectAll", noneBtn);
    if (!kinds.length) emptyState(group, "No tables, notes or templates to pack yet.");

    const refreshers: (() => void)[] = [];
    const writes = el.createDiv({ cls: "duckmage-export-tab-preview" });
    let footerBtn: HTMLButtonElement | undefined;
    const total = () => [...picked.values()].reduce((n, s) => n + s.size, 0);
    const refreshAll = () => {
      for (const r of refreshers) r();
      const n = total();
      writes.setText(`Writes: ${resolveExportFolder(this.plugin)}/${packFileName(nameInput.value)} · ${n} note${n === 1 ? "" : "s"}`);
      if (footerBtn) footerBtn.disabled = n === 0;
    };

    for (const kind of kinds) {
      const files = byKind.get(kind.id)!;
      const set = picked.get(kind.id)!;
      const fold = new Fold(group, { title: kind.label, open: false, store: this.app, surface: "PackExport", key: kind.id, cls: "duckmage-pack-kind" });
      const kindCb = createEl("input", { type: "checkbox", cls: "duckmage-export-tab-checkbox", attr: { "aria-label": `Include all ${kind.label.toLowerCase()}` } });
      fold.summary.insertBefore(kindCb, fold.titleEl);
      const count = fold.summary.createSpan({ cls: "duckmage-pack-count" });
      fold.body.createDiv({ cls: "duckmage-pack-from", text: `From ${kind.folder}` });
      const list = fold.body.createDiv({ cls: "duckmage-pack-items" });
      const itemCbs: HTMLInputElement[] = [];
      for (const path of files) {
        const rel = path.slice(kind.folder.length + 1);
        const label = list.createEl("label", { cls: "duckmage-pack-item" });
        filterText(label, rel);
        const cb = label.createEl("input", { type: "checkbox", cls: "duckmage-export-tab-checkbox" });
        cb.checked = true;
        label.appendText(rel.replace(/\.md$/i, ""));
        cb.addEventListener("change", () => {
          if (cb.checked) set.add(path);
          else set.delete(path);
          refreshAll();
        });
        itemCbs.push(cb);
      }
      addPickerFilter(list, { things: "notes", count: files.length });
      kindCb.addEventListener("change", () => {
        const on = kindCb.checked;
        files.forEach((p, i) => {
          itemCbs[i].checked = on;
          if (on) set.add(p);
          else set.delete(p);
        });
        refreshAll();
      });
      refreshers.push(() => {
        kindCb.checked = set.size === files.length;
        kindCb.indeterminate = set.size > 0 && set.size < files.length;
        count.setText(`${set.size} of ${files.length}`);
        itemCbs.forEach((cb, i) => { cb.checked = set.has(files[i]); });
      });
    }
    const setAll = (on: boolean) => {
      // The item handlers hold their kind's set: refill it in place.
      for (const k of kinds) {
        const s = picked.get(k.id)!;
        s.clear();
        if (on) for (const p of byKind.get(k.id)!) s.add(p);
      }
      refreshAll();
    };
    allBtn.addEventListener("click", () => setAll(true));
    noneBtn.addEventListener("click", () => setAll(false));
    nameInput.addEventListener("input", refreshAll);

    const footer = this.footer({
      primary: {
        text: "Export pack",
        cls: "duckmage-pack-export-btn",
        onClick: () => {
          const name = nameInput.value.trim() || "My content pack";
          const input = {
            name,
            description: descInput.value,
            madeWith: madeWith(this.plugin),
            when: new Date(),
            picked: kinds.map((k) => ({ kind: k, files: byKind.get(k.id)!.filter((p) => picked.get(k.id)!.has(p)) })),
          };
          this.close();
          void exportPackToVault(this.plugin, input)
            .then(({ path, replaced }) => new Notice(exportedMessage(path, replaced)))
            .catch((e) => new Notice(`Couldn't export the pack: ${e instanceof Error ? e.message : String(e)}`));
        },
      },
      cancel: () => this.close(),
    });
    footerBtn = footer.primary;
    this.place("PackExport.export", footer.el);
    refreshAll();
  }
}
