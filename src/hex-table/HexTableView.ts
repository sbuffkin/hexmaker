import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "../constants";
import { getAllSectionData } from "../sections";
import { getTerrainFromFile } from "../frontmatter";
import { normalizeFolder, makeTableTemplate } from "../utils";
import { TerrainFilterModal } from "./TerrainFilterModal";
import { HexCellModal } from "./HexCellModal";
import { MultiLinkNavModal } from "./MultiLinkNavModal";
import { HexTerrainPickerModal } from "./HexTerrainPickerModal";
import { LinkPickerModal } from "./LinkPickerModal";

// Column definitions in template order
const COLUMNS: { key: string; label: string; isLink: boolean }[] = [
  { key: "description", label: "Description", isLink: false },
  { key: "landmark", label: "Landmark", isLink: false },
  { key: "towns", label: "Towns", isLink: true },
  { key: "dungeons", label: "Dungeons", isLink: true },
  { key: "features", label: "Features", isLink: true },
  { key: "quests", label: "Quests", isLink: true },
  { key: "factions", label: "Factions", isLink: true },
  { key: "encounters table", label: "Enc. Table", isLink: true },
  { key: "hidden", label: "Hidden", isLink: false },
  { key: "secret", label: "Secret", isLink: false },
  { key: "weather", label: "Weather", isLink: false },
  { key: "hooks & rumors", label: "Hooks & Rumors", isLink: false },
];

const TRUNCATE_LEN = 120;
const HEX_PATTERN = /^(?:.*\/)?(-?\d+)_(-?\d+)\.md$/;

// ── Main view ───────────────────────────────────────────────────────────────

export class HexTableView extends ItemView {
  private scrollEl: HTMLElement | null = null;
  private updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private loadGeneration = 0;

  // Sort state
  private sortPrimary: "x" | "y" = "x";
  private sortAsc = true;
  private sortPrimaryBtn: HTMLButtonElement | null = null;
  private sortDirBtn: HTMLButtonElement | null = null;

  // Filter state
  private filterXMin: number | null = null;
  private filterXMax: number | null = null;
  private filterYMin: number | null = null;
  private filterYMax: number | null = null;
  private filterTerrains = new Set<string>();
  private filterExcludeTerrains = new Set<string>();
  private filterHasTown = false;
  private filterHasDungeon = false;
  private filterHasFeature = false;
  private filterHasQuest = false;
  private filterHasFaction = false;
  private regionFilter = "all";
  private regionSelectEl: HTMLSelectElement | null = null;

  // Filter UI elements (created once in onOpen)
  private filterXMinInput: HTMLInputElement | null = null;
  private filterXMaxInput: HTMLInputElement | null = null;
  private filterYMinInput: HTMLInputElement | null = null;
  private filterYMaxInput: HTMLInputElement | null = null;
  private terrainFilterBtn: HTMLButtonElement | null = null;
  private townCb: HTMLInputElement | null = null;
  private dungeonCb: HTMLInputElement | null = null;
  private featureCb: HTMLInputElement | null = null;
  private questCb: HTMLInputElement | null = null;
  private factionCb: HTMLInputElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: HexmakerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_HEX_TABLE;
  }
  getDisplayText(): string {
    return this.regionFilter && this.regionFilter !== "all"
      ? `Hex table — ${this.regionFilter}`
      : "Hex table";
  }

  onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("duckmage-hex-table-container");

    // ── Toolbar ──────────────────────────────────────────────────────────
    const toolbar = contentEl.createDiv({ cls: "duckmage-hex-table-toolbar" });

    const refreshBtn = toolbar.createEl("button", {
      text: "Refresh",
      cls: "duckmage-filter-btn",
    });
    refreshBtn.addEventListener("click", () => void this.loadTable());

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // X range filter
    toolbar.createSpan({ text: "X:", cls: "duckmage-filter-label" });
    this.filterXMinInput = toolbar.createEl("input", {
      cls: "duckmage-filter-range-input",
    });
    this.filterXMinInput.type = "number";
    this.filterXMinInput.placeholder = "Min";
    this.filterXMinInput.addEventListener("input", () => {
      const v = this.filterXMinInput!.value;
      this.filterXMin = v !== "" ? Number(v) : null;
      this.applyFilters();
    });
    toolbar.createSpan({ text: "–", cls: "duckmage-filter-label" });
    this.filterXMaxInput = toolbar.createEl("input", {
      cls: "duckmage-filter-range-input",
    });
    this.filterXMaxInput.type = "number";
    this.filterXMaxInput.placeholder = "Max";
    this.filterXMaxInput.addEventListener("input", () => {
      const v = this.filterXMaxInput!.value;
      this.filterXMax = v !== "" ? Number(v) : null;
      this.applyFilters();
    });

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // Y range filter
    toolbar.createSpan({ text: "Y:", cls: "duckmage-filter-label" });
    this.filterYMinInput = toolbar.createEl("input", {
      cls: "duckmage-filter-range-input",
    });
    this.filterYMinInput.type = "number";
    this.filterYMinInput.placeholder = "Min";
    this.filterYMinInput.addEventListener("input", () => {
      const v = this.filterYMinInput!.value;
      this.filterYMin = v !== "" ? Number(v) : null;
      this.applyFilters();
    });
    toolbar.createSpan({ text: "–", cls: "duckmage-filter-label" });
    this.filterYMaxInput = toolbar.createEl("input", {
      cls: "duckmage-filter-range-input",
    });
    this.filterYMaxInput.type = "number";
    this.filterYMaxInput.placeholder = "Max";
    this.filterYMaxInput.addEventListener("input", () => {
      const v = this.filterYMaxInput!.value;
      this.filterYMax = v !== "" ? Number(v) : null;
      this.applyFilters();
    });

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // Terrain multi-select filter
    this.terrainFilterBtn = toolbar.createEl("button", {
      text: "Terrain: all",
      cls: "duckmage-filter-btn",
    });
    this.terrainFilterBtn.addEventListener("click", () => {
      const palette = this.regionFilter !== "all"
        ? this.plugin.getRegionPalette(this.regionFilter)
        : this.plugin.getAllTerrains();
      new TerrainFilterModal(
        this.app,
        palette,
        new Set(this.filterTerrains),
        new Set(this.filterExcludeTerrains),
        (selected, excluded) => {
          this.filterTerrains = selected;
          this.filterExcludeTerrains = excluded;
          this.updateTerrainBtnLabel();
          this.applyFilters();
        },
      ).open();
      // Note: onChange fires live as checkboxes are toggled inside the modal
    });

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // Has Town checkbox
    const townLabel = toolbar.createEl("label", {
      cls: "duckmage-filter-check-label",
    });
    this.townCb = townLabel.createEl("input");
    this.townCb.type = "checkbox";
    townLabel.appendText("Town");
    this.townCb.addEventListener("change", () => {
      this.filterHasTown = this.townCb!.checked;
      this.applyFilters();
    });

    // Has Dungeon checkbox
    const dungeonLabel = toolbar.createEl("label", {
      cls: "duckmage-filter-check-label",
    });
    this.dungeonCb = dungeonLabel.createEl("input");
    this.dungeonCb.type = "checkbox";
    dungeonLabel.appendText("Dungeon");
    this.dungeonCb.addEventListener("change", () => {
      this.filterHasDungeon = this.dungeonCb!.checked;
      this.applyFilters();
    });

    // Has Feature checkbox
    const featureLabel = toolbar.createEl("label", {
      cls: "duckmage-filter-check-label",
    });
    this.featureCb = featureLabel.createEl("input");
    this.featureCb.type = "checkbox";
    featureLabel.appendText("Feature");
    this.featureCb.addEventListener("change", () => {
      this.filterHasFeature = this.featureCb!.checked;
      this.applyFilters();
    });

    // Has Quest checkbox
    const questLabel = toolbar.createEl("label", {
      cls: "duckmage-filter-check-label",
    });
    this.questCb = questLabel.createEl("input");
    this.questCb.type = "checkbox";
    questLabel.appendText("Quest");
    this.questCb.addEventListener("change", () => {
      this.filterHasQuest = this.questCb!.checked;
      this.applyFilters();
    });

    // Has Faction checkbox
    const factionLabel = toolbar.createEl("label", {
      cls: "duckmage-filter-check-label",
    });
    this.factionCb = factionLabel.createEl("input");
    this.factionCb.type = "checkbox";
    factionLabel.appendText("Faction");
    this.factionCb.addEventListener("change", () => {
      this.filterHasFaction = this.factionCb!.checked;
      this.applyFilters();
    });

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // Region filter
    const regionSelect = toolbar.createEl("select", {
      cls: "duckmage-hex-table-region-select",
    });
    this.regionSelectEl = regionSelect;
    regionSelect.createEl("option", { value: "all", text: "All regions" });
    for (const r of this.plugin.settings.regions) {
      regionSelect.createEl("option", { value: r.name, text: r.name });
    }
    // Default to active map view's region
    interface WithActiveRegionName { activeRegionName: string; }
    const mapLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
    if (mapLeaves.length > 0) {
      const mapView = mapLeaves[0].view as unknown as WithActiveRegionName;
      this.regionFilter = mapView.activeRegionName;
    }
    regionSelect.value = this.regionFilter;
    regionSelect.addEventListener("change", () => {
      this.regionFilter = regionSelect.value;
      interface WithUpdateHeader { updateHeader?(): void; }
      (this.leaf as unknown as WithUpdateHeader).updateHeader?.();
      void this.loadTable();
    });

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // Sort controls
    this.sortPrimaryBtn = toolbar.createEl("button", {
      text: "Sort: X→y",
      cls: "duckmage-filter-btn",
    });
    this.sortPrimaryBtn.title =
      "Toggle sort priority between X-first and y-first";
    this.sortPrimaryBtn.addEventListener("click", () => {
      this.sortPrimary = this.sortPrimary === "x" ? "y" : "x";
      this.sortPrimaryBtn!.setText(
        this.sortPrimary === "x" ? "Sort: X→Y" : "Sort: Y→X",
      );
      void this.loadTable();
    });

    this.sortDirBtn = toolbar.createEl("button", {
      text: "↑ asc",
      cls: "duckmage-filter-btn",
    });
    this.sortDirBtn.title = "Toggle sort direction";
    this.sortDirBtn.addEventListener("click", () => {
      this.sortAsc = !this.sortAsc;
      this.sortDirBtn!.setText(this.sortAsc ? "↑ Asc" : "↓ Desc");
      void this.loadTable();
    });

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // Clear all filters
    const clearBtn = toolbar.createEl("button", {
      text: "Clear filters",
      cls: "duckmage-filter-btn",
    });
    clearBtn.addEventListener("click", () => this.clearFilters());

    // ── Scroll area ───────────────────────────────────────────────────────
    this.scrollEl = contentEl.createDiv({ cls: "duckmage-hex-table-scroll" });
    this.scrollEl.createSpan({
      text: "Loading…",
      cls: "duckmage-hex-table-empty",
    });

    // ── Vault event listeners ─────────────────────────────────────────────
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        const folder = normalizeFolder(this.plugin.settings.hexFolder);
        if (folder && !file.path.startsWith(folder + "/")) return;
        if (!HEX_PATTERN.test(file.path)) return;

        const existing = this.updateTimers.get(file.path);
        if (existing) clearTimeout(existing);
        this.updateTimers.set(
          file.path,
          setTimeout(() => {
            this.updateTimers.delete(file.path);
            void this.updateRow(file.path);
          }, 300),
        );
      }),
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile)) return;
        const folder = normalizeFolder(this.plugin.settings.hexFolder);
        if (folder && !file.path.startsWith(folder + "/")) return;
        if (!HEX_PATTERN.test(file.path)) return;
        void this.loadTable();
      }),
    );

    void this.loadTable();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    for (const timer of this.updateTimers.values()) clearTimeout(timer);
    this.updateTimers.clear();
    this.contentEl.empty();
    return Promise.resolve();
  }

  async loadTable(): Promise<void> {
    if (!this.scrollEl) return;
    const gen = ++this.loadGeneration;

    this.scrollEl.empty();
    this.scrollEl.createSpan({
      text: "Loading…",
      cls: "duckmage-hex-table-empty",
    });

    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    let files: { path: string; x: number; y: number; region: string }[] = [];

    try {
      this.app.vault
        .getMarkdownFiles()
        .filter((f) => (hexFolder ? f.path.startsWith(hexFolder + "/") : true))
        .forEach((f) => {
          const m = HEX_PATTERN.exec(f.name);
          if (!m) return;
          const relative = hexFolder
            ? f.path.slice(hexFolder.length + 1)
            : f.path;
          const parts = relative.split("/");
          if (parts.length < 2) return; // not in a region subfolder
          files.push({ path: f.path, x: Number(m[1]), y: Number(m[2]), region: parts[0] });
        });
    } catch {
      this.scrollEl.empty();
      this.scrollEl.createSpan({
        text: "Could not read hex folder.",
        cls: "duckmage-hex-table-empty",
      });
      return;
    }

    // Apply region filter
    if (this.regionFilter !== "all") {
      const prefix = hexFolder
        ? `${hexFolder}/${this.regionFilter}/`
        : `${this.regionFilter}/`;
      files = files.filter((f) => f.path.startsWith(prefix));
    }

    files.sort((a, b) => {
      const p = this.sortPrimary === "x" ? "x" : "y";
      const s = this.sortPrimary === "x" ? "y" : "x";
      const diff = a[p] !== b[p] ? a[p] - b[p] : a[s] - b[s];
      return this.sortAsc ? diff : -diff;
    });

    if (files.length === 0) {
      this.scrollEl.empty();
      this.scrollEl.createSpan({
        text: "No hex notes found.",
        cls: "duckmage-hex-table-empty",
      });
      return;
    }

    // Update X/Y input placeholders with actual data bounds (single pass)
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const f of files) {
      if (f.x < xMin) xMin = f.x;
      if (f.x > xMax) xMax = f.x;
      if (f.y < yMin) yMin = f.y;
      if (f.y > yMax) yMax = f.y;
    }
    if (this.filterXMinInput) this.filterXMinInput.placeholder = String(xMin);
    if (this.filterXMaxInput) this.filterXMaxInput.placeholder = String(xMax);
    if (this.filterYMinInput) this.filterYMinInput.placeholder = String(yMin);
    if (this.filterYMaxInput) this.filterYMaxInput.placeholder = String(yMax);

    // ── Phase 1: skeleton render (sync — coords + terrain from metadata cache) ──
    const table = document.createElement("table");
    table.className = "duckmage-hex-table";

    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Hex" });
    headerRow.createEl("th", { text: "Terrain" });
    for (const col of COLUMNS) {
      headerRow.createEl("th", { text: col.label });
    }

    const tbody = table.createEl("tbody");
    const rows: HTMLTableRowElement[] = [];
    for (const { path, x, y, region } of files) {
      const tr = tbody.createEl("tr");
      tr.dataset.hexPath = path;
      this.fillRow(tr, path, x, y, region, new Map(), new Map());
      rows.push(tr);
    }

    this.scrollEl.empty();
    this.scrollEl.appendChild(table);
    this.addColumnResizers(table);
    this.applyFilters();

    // ── Phase 2: fill section data in batches, above-the-fold first ──────────
    const FIRST_BATCH = 20;
    const REST_BATCH = 50;

    const fillBatch = async (start: number, size: number): Promise<boolean> => {
      if (gen !== this.loadGeneration) return false;
      const slice = files.slice(start, start + size);
      if (slice.length === 0) return true;
      const sectionData = await Promise.all(
        slice.map((f) => getAllSectionData(this.app, f.path)),
      );
      if (gen !== this.loadGeneration) return false;
      for (let j = 0; j < slice.length; j++) {
        const { path, x, y, region } = slice[j];
        const { text, links } = sectionData[j];
        this.fillRow(rows[start + j], path, x, y, region, text, links);
      }
      this.applyFilters();
      return true;
    };

    // First batch is above-the-fold; await it so the view feels responsive fast
    await fillBatch(0, FIRST_BATCH);

    // Remaining batches load in the background
    for (let i = FIRST_BATCH; i < files.length; i += REST_BATCH) {
      const ok = await fillBatch(i, REST_BATCH);
      if (!ok) break;
      // Yield to the browser between batches to keep the UI responsive
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  // ── Filter helpers ────────────────────────────────────────────────────────

  /** Update filter sets when a terrain is renamed, so stale names don't persist. */
  renameTerrainInFilters(oldName: string, newName: string): void {
    if (this.filterTerrains.has(oldName)) {
      this.filterTerrains.delete(oldName);
      this.filterTerrains.add(newName);
    }
    if (this.filterExcludeTerrains.has(oldName)) {
      this.filterExcludeTerrains.delete(oldName);
      this.filterExcludeTerrains.add(newName);
    }
    this.updateTerrainBtnLabel();
  }

  private updateTerrainBtnLabel(): void {
    if (!this.terrainFilterBtn) return;
    const inc = this.filterTerrains.size;
    const exc = this.filterExcludeTerrains.size;
    const parts: string[] = [];
    if (inc > 0) parts.push(`${inc} shown`);
    if (exc > 0) parts.push(`${exc} hidden`);
    this.terrainFilterBtn.setText(
      parts.length ? `Terrain: ${parts.join(", ")}` : "Terrain: All",
    );
    this.terrainFilterBtn.toggleClass(
      "duckmage-filter-active",
      inc > 0 || exc > 0,
    );
  }

  private clearFilters(): void {
    this.filterXMin = null;
    this.filterXMax = null;
    this.filterYMin = null;
    this.filterYMax = null;
    this.filterTerrains = new Set();
    this.filterExcludeTerrains = new Set();
    this.filterHasTown = false;
    this.filterHasDungeon = false;
    this.filterHasFeature = false;
    this.filterHasQuest = false;
    this.filterHasFaction = false;

    if (this.filterXMinInput) this.filterXMinInput.value = "";
    if (this.filterXMaxInput) this.filterXMaxInput.value = "";
    if (this.filterYMinInput) this.filterYMinInput.value = "";
    if (this.filterYMaxInput) this.filterYMaxInput.value = "";
    if (this.townCb) this.townCb.checked = false;
    if (this.dungeonCb) this.dungeonCb.checked = false;
    if (this.featureCb) this.featureCb.checked = false;
    if (this.questCb) this.questCb.checked = false;
    if (this.factionCb) this.factionCb.checked = false;
    this.updateTerrainBtnLabel();
    this.applyFilters();
  }

  private applyFilters(): void {
    if (!this.scrollEl) return;
    const tbody = this.scrollEl.querySelector("tbody");
    if (!tbody) return;

    for (const tr of Array.from(tbody.rows)) {
      const x = Number(tr.dataset.hexX);
      const y = Number(tr.dataset.hexY);
      const terrain = tr.dataset.terrain ?? "";
      const hasTown = tr.dataset.hasTown === "1";
      const hasDungeon = tr.dataset.hasDungeon === "1";
      const hasFeature = tr.dataset.hasFeature === "1";
      const hasQuest = tr.dataset.hasQuest === "1";
      const hasFaction = tr.dataset.hasFaction === "1";

      let show = true;
      if (this.filterXMin !== null && x < this.filterXMin) show = false;
      if (this.filterXMax !== null && x > this.filterXMax) show = false;
      if (this.filterYMin !== null && y < this.filterYMin) show = false;
      if (this.filterYMax !== null && y > this.filterYMax) show = false;
      if (this.filterTerrains.size > 0 && !this.filterTerrains.has(terrain))
        show = false;
      if (
        this.filterExcludeTerrains.size > 0 &&
        this.filterExcludeTerrains.has(terrain)
      )
        show = false;
      if (this.filterHasTown && !hasTown) show = false;
      if (this.filterHasDungeon && !hasDungeon) show = false;
      if (this.filterHasFeature && !hasFeature) show = false;
      if (this.filterHasQuest && !hasQuest) show = false;
      if (this.filterHasFaction && !hasFaction) show = false;

      tr.classList.toggle("duckmage-row-hidden", !show);
    }
  }

  // ── Row rendering ─────────────────────────────────────────────────────────

  private fillRow(
    tr: HTMLTableRowElement,
    path: string,
    x: number,
    y: number,
    region: string,
    text: Map<string, string>,
    links: Map<string, string[]>,
  ): void {
    tr.empty();

    const palette = this.plugin.getRegionPalette(region);
    const paletteMap = new Map(palette.map((p) => [p.name, p]));
    const terrainName = getTerrainFromFile(this.app, path);

    const hasTown = (links.get("towns") ?? []).length > 0;
    const hasDungeon = (links.get("dungeons") ?? []).length > 0;
    const hasFeature = (links.get("features") ?? []).length > 0;
    const hasQuest = (links.get("quests") ?? []).length > 0;
    const hasFaction = (links.get("factions") ?? []).length > 0;

    // Store filter-relevant data on the row
    tr.dataset.hexX = String(x);
    tr.dataset.hexY = String(y);
    tr.dataset.terrain = terrainName ?? "";
    tr.dataset.hasTown = hasTown ? "1" : "0";
    tr.dataset.hasDungeon = hasDungeon ? "1" : "0";
    tr.dataset.hasFeature = hasFeature ? "1" : "0";
    tr.dataset.hasQuest = hasQuest ? "1" : "0";
    tr.dataset.hasFaction = hasFaction ? "1" : "0";
    tr.dataset.region = region;

    // Coords cell — click to open note
    const coordsTd = tr.createEl("td");

    const jumpBtn = coordsTd.createEl("button", {
      text: "◎",
      cls: "duckmage-hex-table-jump-btn",
    });
    const coordsSpan = coordsTd.createSpan({
      text: `${x},${y}`,
      cls: "duckmage-hex-table-coords",
    });
    coordsSpan.addEventListener("click", () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf().openFile(file);
      }
    });
    jumpBtn.title = "Center map on this hex";
    jumpBtn.addEventListener("click", (e) => {
      void (async () => {
        e.stopPropagation();
        interface WithCenterOnHex { centerOnHex(x: number, y: number): void; }
        const existingLeaves =
          this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
        if (existingLeaves.length > 0) {
          void this.app.workspace.revealLeaf(existingLeaves[0]);
          (existingLeaves[0].view as unknown as WithCenterOnHex).centerOnHex(x, y);
        } else {
          const leaf = this.app.workspace.getLeaf("tab");
          await leaf.setViewState({ type: VIEW_TYPE_HEX_MAP });
          // Wait one frame for the view to render before centering
          setTimeout(() => (leaf.view as unknown as WithCenterOnHex).centerOnHex(x, y), 100);
        }
      })();
    });

    // Terrain cell
    const terrainTd = tr.createEl("td", {
      cls: "duckmage-hex-table-cell-clickable",
    });
    const renderTerrainCell = () => {
      terrainTd.empty();
      const current = getTerrainFromFile(this.app, path);
      const entry = current ? paletteMap.get(current) : undefined;
      if (entry) {
        const swatch = terrainTd.createSpan({
          cls: "duckmage-hex-table-swatch",
        });
        swatch.style.backgroundColor = entry.color;
        terrainTd.appendText(entry.name);
      } else {
        terrainTd.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
      }
    };
    renderTerrainCell();
    terrainTd.addEventListener("click", () => {
      const current = getTerrainFromFile(this.app, path);
      new HexTerrainPickerModal(this.app, this.plugin, this.plugin.getRegionPalette(region), path, current, () => {
        renderTerrainCell();
      }).open();
    });

    // Section cells
    for (const col of COLUMNS) {
      const td = tr.createEl("td");
      if (col.isLink) {
        const linkList = links.get(col.key) ?? [];
        if (linkList.length > 0) {
          const full = linkList.join(", ");
          td.dataset.fullContent = full;
          const display = col.key === "encounters table"
            ? linkList.map(l => l.split("/").pop() ?? l).join(", ")
            : full;
          td.setText(display);
        } else {
          td.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
        }
        // Towns, Dungeons, and Encounters Table: existing items open the file/roll; empty cell opens picker
        if (
          col.key === "towns" ||
          col.key === "dungeons" ||
          col.key === "encounters table"
        ) {
          const sourceFolder =
            col.key === "towns"
              ? this.plugin.settings.townsFolder
              : col.key === "dungeons"
                ? this.plugin.settings.dungeonsFolder
                : this.plugin.settings.tablesFolder;
          const section =
            col.key === "towns"
              ? "Towns"
              : col.key === "dungeons"
                ? "Dungeons"
                : "Encounters Table";
          td.addClass("duckmage-hex-table-cell-clickable");
          td.addEventListener("auxclick", (e: MouseEvent) => {
            void (async () => {
              if (e.button !== 1) return;
              if (col.key !== "encounters table" || linkList.length !== 1) return;
              e.preventDefault();
              const file = this.app.metadataCache.getFirstLinkpathDest(linkList[0], path);
              if (!(file instanceof TFile)) return;
              interface WithOpenTable { openTable(path: string): Promise<void>; }
              const leaf = this.app.workspace.getLeaf("tab");
              await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES, active: true });
              void this.app.workspace.revealLeaf(leaf);
              await (leaf.view as unknown as WithOpenTable).openTable(file.path);
            })();
          });
          td.addEventListener("click", () => {
            void (async () => {
            if (linkList.length === 0) {
              new LinkPickerModal(
                this.app,
                this.plugin,
                path,
                section,
                sourceFolder,
                () => void this.updateRow(path),
                col.key === "encounters table"
                  ? makeTableTemplate(this.plugin.settings.defaultTableDice)
                  : "",
              ).open();
            } else if (linkList.length === 1) {
              if (col.key === "encounters table") {
                const file = this.app.metadataCache.getFirstLinkpathDest(
                  linkList[0],
                  path,
                );
                if (file instanceof TFile) {
                  interface WithOpenTable { openTable(path: string): Promise<void>; }
                  const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
                  const leaf = leaves.length > 0 ? leaves[0] : this.app.workspace.getLeaf("tab");
                  await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES, active: true });
                  void this.app.workspace.revealLeaf(leaf);
                  await (leaf.view as unknown as WithOpenTable).openTable(file.path);
                }
              } else {
                const file = this.app.metadataCache.getFirstLinkpathDest(
                  linkList[0],
                  path,
                );
                if (file instanceof TFile)
                  void this.app.workspace.getLeaf().openFile(file);
              }
            } else {
              // Multiple: show a nav list
              new MultiLinkNavModal(
                this.app,
                `${x},${y} — ${section}`,
                linkList,
                path,
              ).open();
            }
            })();
          });
        } else if (linkList.length > 0) {
          td.addClass("duckmage-hex-table-cell-clickable");
          td.addEventListener("click", () => {
            const current = td.dataset.fullContent ?? "";
            new HexCellModal(
              this.app,
              `${x},${y} — ${col.label}`,
              current,
              true,
            ).open();
          });
        }
      } else {
        const content = text.get(col.key) ?? "";
        td.dataset.fullContent = content;
        if (content) {
          const display =
            content.length > TRUNCATE_LEN
              ? content.slice(0, TRUNCATE_LEN) + "…"
              : content;
          td.setText(display);
        } else {
          td.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
        }
        td.addClass("duckmage-hex-table-cell-clickable");
        td.addEventListener("click", () => {
          const current = td.dataset.fullContent ?? "";
          new HexCellModal(
            this.app,
            `${x},${y} — ${col.label}`,
            current,
            false,
            path,
            col.key,
            this.plugin,
            (saved) => {
              td.dataset.fullContent = saved;
              td.empty();
              if (saved) {
                const newDisplay =
                  saved.length > TRUNCATE_LEN
                    ? saved.slice(0, TRUNCATE_LEN) + "…"
                    : saved;
                td.setText(newDisplay);
              } else {
                td.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
              }
            },
            async () => {
              if (!this.app.vault.getAbstractFileByPath(path)) {
                await this.plugin.createHexNote(x, y, region);
              }
            },
          ).open();
        });
      }
    }
  }

  // ── Column resizing ───────────────────────────────────────────────────────

  private addColumnResizers(table: HTMLTableElement): void {
    const ths = Array.from(
      table.querySelectorAll<HTMLTableCellElement>("thead th"),
    );

    // Default widths (px): Hex, Terrain, then one per COLUMN entry
    const defaultWidths = [
      60, 110, 220, 160, 150, 150, 150, 140, 160, 160, 160, 140,
    ];

    // <col> elements + explicit table width is the only reliable way to drive
    // table-layout:fixed column widths across browsers.
    const colgroup = document.createElement("colgroup");
    const cols: HTMLTableColElement[] = [];
    let totalWidth = 0;
    for (let i = 0; i < ths.length; i++) {
      const w = defaultWidths[i] ?? 160;
      const col = document.createElement("col");
      col.style.width = `${w}px`;
      colgroup.appendChild(col);
      cols.push(col);
      totalWidth += w;
    }
    table.insertBefore(colgroup, table.firstChild);
    table.style.width = `${totalWidth}px`;

    for (let i = 0; i < ths.length; i++) {
      const col = cols[i];

      const handle = ths[i].createDiv({ cls: "duckmage-col-resizer" });
      handle.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = parseInt(col.style.width, 10);
        const startTW = parseInt(table.style.width, 10);
        document.body.setCssProps({ cursor: "col-resize" });

        const onMove = (me: MouseEvent) => {
          const newW = Math.max(20, startW + me.clientX - startX);
          col.style.width = `${newW}px`;
          table.style.width = `${startTW + (newW - startW)}px`;
        };
        const onUp = () => {
          document.body.setCssProps({ cursor: "" });
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }
  }

  private async updateRow(path: string): Promise<void> {
    if (!this.scrollEl) return;
    const tr = this.scrollEl.querySelector<HTMLTableRowElement>(
      `tr[data-hex-path="${CSS.escape(path)}"]`,
    );
    if (!tr) return;

    const m = HEX_PATTERN.exec(path);
    if (!m) return;
    const x = Number(m[1]);
    const y = Number(m[2]);

    const { text, links } = await getAllSectionData(this.app, path);
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const relative = hexFolder ? path.slice(hexFolder.length + 1) : path;
    const rowRegion = relative.split("/")[0];
    this.fillRow(tr, path, x, y, rowRegion, text, links);
    this.applyFilters();
  }
}
