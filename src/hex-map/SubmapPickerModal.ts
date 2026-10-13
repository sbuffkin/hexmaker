import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { getIconUrl, createIconEl } from "../utils";

/**
 * Pick an existing map to link (a hex's location, or the submap-link
 * tool's map). New maps are made in the New map form (`onNewSubmap`);
 * the old inline create form was dropped (UI worksheet 2026-10-11).
 */
export class SubmapPickerModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private current: string | undefined,
    private onLink: (mapName: string) => void,
    private onUnlink: (() => void) | undefined,
    /** When set (single-hex use), "New location…" opens the new-submap
     *  setup modal (size, generator, preview). */
    private onNewSubmap?: () => void,
    /** Title, and maps not to offer (already linked to the hex, the map itself). */
    private opts: { title?: string; exclude?: string[] } = {},
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");
    this.modalEl.addClass("duckmage-submap-picker-modal");
    this.makeDraggable();

    contentEl.createEl("h2", { text: this.opts.title ?? "Link submap" });

    // ── Current submap indicator ──────────────────────────────────────────
    if (this.current) {
      const curRow = contentEl.createDiv({ cls: "duckmage-submap-current-row" });
      curRow.createSpan({ text: "Current: ", cls: "duckmage-submap-current-label" });
      curRow.createSpan({ text: this.plugin.mapLabel(this.current), cls: "duckmage-submap-current-value" });
    }

    // ── Link existing map ─────────────────────────────────────────────────
    const exclude = new Set(this.opts.exclude ?? []);
    const maps = this.plugin.settings.maps.filter((m) => !exclude.has(m.name));
    let selectedMap = this.current ?? maps[0]?.name ?? "";

    if (maps.length > 0) {
      contentEl.createEl("h4", { text: "Link existing map" });

      const filterInput = contentEl.createEl("input", {
        type: "search",
        cls: "duckmage-rt-search",
        attr: { placeholder: "Filter maps…" },
      });

      const listEl = contentEl.createDiv({ cls: "duckmage-rt-list duckmage-picker-list" });

      const renderMapList = (query: string) => {
        listEl.empty();
        const q = query.trim().toLowerCase();
        const matches = maps.filter((m) => !q || m.name.toLowerCase().includes(q) || this.plugin.mapLabel(m.name).toLowerCase().includes(q));
        if (matches.length === 0) {
          listEl.createDiv({ cls: "duckmage-empty-state", text: "No maps match." });
          return;
        }
        for (const m of matches) {
          const item = listEl.createDiv({
            cls: "duckmage-rt-list-item duckmage-map-list-item-row" + (m.name === selectedMap ? " is-active" : ""),
          });
          const terrainEntry = m.terrainType
            ? this.plugin.getMapPalette(m.name).find((t) => t.name === m.terrainType)
            : undefined;
          const swatch = item.createSpan({ cls: "duckmage-map-terrain-swatch" });
          if (terrainEntry?.color) {
            swatch.style.backgroundColor = terrainEntry.color;
            swatch.addClass("duckmage-map-terrain-swatch--set");
          }
          if (terrainEntry?.icon) {
            createIconEl(
              swatch,
              getIconUrl(this.plugin, terrainEntry.icon),
              terrainEntry.name,
              terrainEntry.iconColor,
              "duckmage-map-terrain-swatch-icon",
            );
          }
          item.createSpan({ text: this.plugin.mapLabel(m.name) });
          item.addEventListener("click", () => {
            selectedMap = m.name;
            listEl.querySelectorAll<HTMLElement>(".duckmage-rt-list-item").forEach((el) =>
              el.removeClass("is-active"),
            );
            item.addClass("is-active");
          });
        }
      };

      renderMapList("");
      filterInput.addEventListener("input", () => renderMapList(filterInput.value));
    }

    if (this.onNewSubmap) {
      const newRow = contentEl.createDiv({ cls: "duckmage-submap-new-row" });
      const newBtn = newRow.createEl("button", { text: "New location…", cls: maps.length ? "" : "mod-cta" });
      newRow.createSpan({ cls: "setting-item-description", text: "Choose size, palette and a generator, then go straight in." });
      newBtn.addEventListener("click", () => { this.close(); this.onNewSubmap?.(); });
    }
    this.renderButtons(contentEl, maps.length > 0, () => selectedMap);
  }

  /** Bottom button row: Remove link / Link existing / Cancel. */
  private renderButtons(contentEl: HTMLElement, hasMaps: boolean, selected: () => string): void {
    // Primary first; Remove link is plain (it removes a link, it destroys nothing: audit B4).
    const unlink = hasMaps && this.current ? this.onUnlink : undefined;
    this.footer({
      primary: hasMaps ? { text: "Link", onClick: () => { this.close(); this.onLink(selected()); } } : undefined,
      secondary: [unlink && { text: "Remove link", onClick: () => { this.close(); unlink(); } }],
      cancel: () => this.close(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
