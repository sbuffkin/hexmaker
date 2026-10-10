import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "../constants";
import type { TerrainColor } from "../types";
import { getAllSectionData } from "../sections";
import { displayedEncounterLinks } from "../encounterLinks";
import { getTerrainFromFile, getHexNameFromFile } from "../frontmatter";
import { normalizeFolder, makeTableTemplate } from "../utils";
import { TerrainFilterModal } from "./TerrainFilterModal";
import { HexCellModal } from "./HexCellModal";
import { MultiLinkNavModal } from "./MultiLinkNavModal";
import { HexTerrainPickerModal } from "./HexTerrainPickerModal";
import { LinkPickerModal } from "./LinkPickerModal";
import {
  compareTerrainTypes,
  matchesTerrainFilter,
  resolveTerrainType,
  terrainTypeLabel,
} from "./terrainTypeFilter";

type SortMode = "x" | "y" | "type";
const SORT_LABELS: Record<SortMode, string> = {
  x: "Sort: xy",
  y: "Sort: yx",
  type: "Sort: type",
};
const NEXT_SORT: Record<SortMode, SortMode> = { x: "y", y: "type", type: "x" };

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
  // Memoised name→entry palette maps, keyed by region. fillRow runs once per
  // hex per load (skeleton + fill batch) so rebuilding this Map inline cost
  // O(rows × palette) Map insertions; memoising makes it O(palette) per region.
  // Cleared at the start of every loadTable so palette edits take effect.
  private paletteMapCache = new Map<string, Map<string, TerrainColor>>();

  // Sort state
  private sortPrimary: SortMode = "x";
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
  private filterTypes = new Set<string>();
  private filterExcludeTypes = new Set<string>();
  private filterHasTown = false;
  private filterHasDungeon = false;
  private filterHasFeature = false;
  private filterHasQuest = false;
  private filterHasFaction = false;
  private mapFilter = "all";
  private mapSelectEl: HTMLSelectElement | null = null;

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
    return this.mapFilter && this.mapFilter !== "all"
      ? `Hex table — ${this.mapFilter}`
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
      const palette =
        this.mapFilter !== "all"
          ? this.plugin.getMapPalette(this.mapFilter)
          : this.plugin.getAllTerrains();
      new TerrainFilterModal(
        this.app,
        palette,
        {
          terrains: new Set(this.filterTerrains),
          excludeTerrains: new Set(this.filterExcludeTerrains),
          types: new Set(this.filterTypes),
          excludeTypes: new Set(this.filterExcludeTypes),
        },
        (sets) => {
          this.filterTerrains = sets.terrains;
          this.filterExcludeTerrains = sets.excludeTerrains;
          this.filterTypes = sets.types;
          this.filterExcludeTypes = sets.excludeTypes;
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
    this.mapSelectEl = regionSelect;
    regionSelect.createEl("option", { value: "all", text: "All maps" });
    for (const r of this.plugin.settings.maps) {
      regionSelect.createEl("option", { value: r.name, text: r.name });
    }
    // Default to active map view's map
    interface WithActiveMapName {
      activeMapName: string;
    }
    const mapLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
    if (mapLeaves.length > 0) {
      const mapView = mapLeaves[0].view as unknown as WithActiveMapName;
      this.mapFilter = mapView.activeMapName;
    }
    regionSelect.value = this.mapFilter;
    regionSelect.addEventListener("change", () => {
      this.mapFilter = regionSelect.value;
      interface WithUpdateHeader {
        updateHeader?(): void;
      }
      (this.leaf as unknown as WithUpdateHeader).updateHeader?.();
      void this.loadTable();
    });

    toolbar.createDiv({ cls: "duckmage-filter-separator" });

    // Sort controls
    this.sortPrimaryBtn = toolbar.createEl("button", {
      text: SORT_LABELS[this.sortPrimary],
      cls: "duckmage-filter-btn",
    });
    this.sortPrimaryBtn.title =
      "Cycle sort order: X first, y first, terrain type";
    this.sortPrimaryBtn.addEventListener("click", () => {
      this.sortPrimary = NEXT_SORT[this.sortPrimary];
      this.sortPrimaryBtn!.setText(SORT_LABELS[this.sortPrimary]);
      void this.loadTable();
    });

    this.sortDirBtn = toolbar.createEl("button", {
      text: "↑ asc",
      cls: "duckmage-filter-btn",
    });
    this.sortDirBtn.title = "Toggle sort direction";
    this.sortDirBtn.addEventListener("click", () => {
      this.sortAsc = !this.sortAsc;
      this.sortDirBtn!.setText(this.sortAsc ? "↑ asc" : "↓ desc");
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
        if (existing) window.clearTimeout(existing);
        this.updateTimers.set(
          file.path,
          window.setTimeout(() => {
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

    // Hex notes are created on use and can be trashed (e.g. when the map
    // shrinks), so drop rows whose note is gone instead of leaving dead rows.
    const dropRow = (path: string) => {
      const pending = this.updateTimers.get(path);
      if (pending) {
        window.clearTimeout(pending);
        this.updateTimers.delete(path);
      }
      this.scrollEl
        ?.querySelector(`tr[data-hex-path="${CSS.escape(path)}"]`)
        ?.remove();
    };
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          dropRow(file.path);
          return;
        }
        // A map folder removed: its rows are all gone
        const folder = normalizeFolder(this.plugin.settings.hexFolder);
        if (!folder || file.path.startsWith(folder + "/")) void this.loadTable();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (!HEX_PATTERN.test(oldPath) && !HEX_PATTERN.test(file.path)) return;
        void this.loadTable();
      }),
    );

    // Map data (terrain, region, …) changes in the map store, not in hex
    // notes: reload once painting settles.
    let storeTimer: number | undefined;
    const offStore = this.plugin.mapStore.onChange(() => {
      window.clearTimeout(storeTimer);
      storeTimer = window.setTimeout(() => void this.loadTable(), 500);
    });
    this.register(() => {
      offStore();
      window.clearTimeout(storeTimer);
    });

    void this.loadTable();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    for (const timer of this.updateTimers.values()) window.clearTimeout(timer);
    this.updateTimers.clear();
    this.contentEl.empty();
    return Promise.resolve();
  }

  async loadTable(): Promise<void> {
    if (!this.scrollEl) return;
    const gen = ++this.loadGeneration;
    this.paletteMapCache.clear();

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
          files.push({
            path: f.path,
            x: Number(m[1]),
            y: Number(m[2]),
            region: parts[0],
          });
        });
    } catch {
      this.scrollEl.empty();
      this.scrollEl.createSpan({
        text: "Could not read hex folder.",
        cls: "duckmage-hex-table-empty",
      });
      return;
    }

    // Hexes with map data (terrain, region, …) but no note yet — notes are
    // created on use, so the map note is the other half of the list.
    const seen = new Set(files.map((f) => f.path));
    for (const m of this.plugin.settings.maps) {
      for (const key of this.plugin.mapStore.all(m.name).keys()) {
        const [x, y] = key.split("_").map(Number);
        const path = this.plugin.hexPath(x, y, m.name);
        if (!seen.has(path)) files.push({ path, x, y, region: m.name });
      }
    }

    // Apply region filter
    if (this.mapFilter !== "all") {
      const prefix = hexFolder
        ? `${hexFolder}/${this.mapFilter}/`
        : `${this.mapFilter}/`;
      files = files.filter((f) => f.path.startsWith(prefix));
    }

    // Type sort: by terrain type (vocabulary order, untyped last), then x, y
    const typeOf = new Map<string, string>();
    if (this.sortPrimary === "type") {
      for (const f of files) {
        typeOf.set(f.path, this.resolveHexTerrain(f.path, f.region).type);
      }
    }
    files.sort((a, b) => {
      let diff = 0;
      if (this.sortPrimary === "type") {
        diff = compareTerrainTypes(typeOf.get(a.path)!, typeOf.get(b.path)!);
      }
      if (diff === 0) {
        const p = this.sortPrimary === "y" ? "y" : "x";
        const s = this.sortPrimary === "y" ? "x" : "y";
        diff = a[p] !== b[p] ? a[p] - b[p] : a[s] - b[s];
      }
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
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
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
    const table = createEl("table", { cls: "duckmage-hex-table" });

    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Hex" });
    headerRow.createEl("th", { text: "Terrain" });
    headerRow.createEl("th", { text: "Type" });
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
      const batchRows: HTMLTableRowElement[] = [];
      for (let j = 0; j < slice.length; j++) {
        const { path, x, y, region } = slice[j];
        const { text, links } = sectionData[j];
        this.fillRow(rows[start + j], path, x, y, region, text, links);
        batchRows.push(rows[start + j]);
      }
      // Only the rows we just filled gained data — re-filter just those.
      this.applyFilters(batchRows);
      return true;
    };

    // First batch is above-the-fold; await it so the view feels responsive fast
    await fillBatch(0, FIRST_BATCH);

    // Remaining batches load in the background
    for (let i = FIRST_BATCH; i < files.length; i += REST_BATCH) {
      const ok = await fillBatch(i, REST_BATCH);
      if (!ok) break;
      // Yield to the browser between batches to keep the UI responsive
      await new Promise<void>((r) => window.setTimeout(r, 0));
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
    const inc = this.filterTerrains.size + this.filterTypes.size;
    const exc = this.filterExcludeTerrains.size + this.filterExcludeTypes.size;
    const parts: string[] = [];
    if (inc > 0) parts.push(`${inc} shown`);
    if (exc > 0) parts.push(`${exc} hidden`);
    this.terrainFilterBtn.setText(
      parts.length ? `Terrain: ${parts.join(", ")}` : "Terrain: all",
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
    this.filterTypes = new Set();
    this.filterExcludeTypes = new Set();
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

  /**
   * Re-evaluate row visibility against the current filters. Each row's
   * visibility depends only on its own dataset, so a `rows` subset can be
   * passed to filter just newly-filled rows — `loadTable` does this after each
   * fill batch so Phase 2 stays O(rows) total instead of O(rows × batches).
   * Called with no argument (all rows) when the filter state itself changes.
   */
  private applyFilters(rows?: Iterable<HTMLTableRowElement>): void {
    if (!this.scrollEl) return;
    const tbody = this.scrollEl.querySelector("tbody");
    if (!tbody) return;

    const terrainFilter = {
      terrains: this.filterTerrains,
      excludeTerrains: this.filterExcludeTerrains,
      types: this.filterTypes,
      excludeTypes: this.filterExcludeTypes,
    };
    for (const tr of rows ?? Array.from(tbody.rows)) {
      const x = Number(tr.dataset.hexX);
      const y = Number(tr.dataset.hexY);
      const terrainRow = {
        terrain: tr.dataset.terrain ?? "",
        effectiveTerrain: tr.dataset.effectiveTerrain ?? "",
        type: tr.dataset.terrainType ?? "",
      };
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
      if (!matchesTerrainFilter(terrainRow, terrainFilter)) show = false;
      if (this.filterHasTown && !hasTown) show = false;
      if (this.filterHasDungeon && !hasDungeon) show = false;
      if (this.filterHasFeature && !hasFeature) show = false;
      if (this.filterHasQuest && !hasQuest) show = false;
      if (this.filterHasFaction && !hasFaction) show = false;

      tr.classList.toggle("duckmage-row-hidden", !show);
    }
  }

  // ── Row rendering ─────────────────────────────────────────────────────────

  /**
   * Name→entry palette map for a region, memoised for the current load.
   * First-wins on duplicate names — matches HexMapView's `.find()` behaviour.
   */
  private getPaletteMap(region: string): Map<string, TerrainColor> {
    let m = this.paletteMapCache.get(region);
    if (!m) {
      m = new Map<string, TerrainColor>();
      for (const p of this.plugin.getMapPalette(region)) {
        if (!m.has(p.name)) m.set(p.name, p);
      }
      this.paletteMapCache.set(region, m);
    }
    return m;
  }

  /**
   * A hex's own terrain, the terrain the map displays (own, else the map's
   * base terrain) and that terrain's type ("" when the palette entry has none).
   */
  private resolveHexTerrain(
    path: string,
    region: string,
  ): { terrain: string; effective: string; isBase: boolean; type: string } {
    const terrain = getTerrainFromFile(this.app, path) ?? "";
    const base = terrain ? "" : (this.plugin.getMap(region)?.baseTerrain ?? "");
    const effective = terrain || base;
    return {
      terrain,
      effective,
      isBase: !terrain && !!base,
      type: resolveTerrainType(effective, this.getPaletteMap(region)),
    };
  }

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

    const paletteMap = this.getPaletteMap(region);

    const hasTown = (links.get("towns") ?? []).length > 0;
    const hasDungeon = (links.get("dungeons") ?? []).length > 0;
    const hasFeature = (links.get("features") ?? []).length > 0;
    const hasQuest = (links.get("quests") ?? []).length > 0;
    const hasFaction = (links.get("factions") ?? []).length > 0;

    // Store filter-relevant data on the row
    tr.dataset.hexX = String(x);
    tr.dataset.hexY = String(y);
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
      text: `${x}, ${y}`,
      cls: "duckmage-hex-table-coords",
    });
    const hexName = getHexNameFromFile(path);
    if (hexName) coordsTd.createSpan({ text: hexName, cls: "duckmage-hex-table-name" });
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
        interface WithCenterOnHex {
          centerOnHex(x: number, y: number): void;
        }
        const existingLeaves =
          this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
        if (existingLeaves.length > 0) {
          void this.app.workspace.revealLeaf(existingLeaves[0]);
          (existingLeaves[0].view as unknown as WithCenterOnHex).centerOnHex(
            x,
            y,
          );
        } else {
          const leaf = this.app.workspace.getLeaf("tab");
          await leaf.setViewState({ type: VIEW_TYPE_HEX_MAP });
          // Wait one frame for the view to render before centering
          window.setTimeout(
            () => (leaf.view as unknown as WithCenterOnHex).centerOnHex(x, y),
            100,
          );
        }
      })();
    });

    // Terrain cell
    const terrainTd = tr.createEl("td", {
      cls: "duckmage-hex-table-cell-clickable",
    });
    const typeTd = tr.createEl("td");
    // Renders terrain + type and refreshes the row's filter data, so a pick
    // shows at once (the vault modify event re-renders the row again later).
    const renderTerrainCell = () => {
      terrainTd.empty();
      typeTd.empty();
      const hex = this.resolveHexTerrain(path, region);
      tr.dataset.terrain = hex.terrain;
      tr.dataset.effectiveTerrain = hex.effective;
      tr.dataset.terrainType = hex.type;

      const entry = hex.effective ? paletteMap.get(hex.effective) : undefined;
      if (entry) {
        const swatch = terrainTd.createSpan({
          cls: "duckmage-hex-table-swatch",
        });
        swatch.setCssProps({ "--duckmage-swatch-color": entry.color });
        if (hex.isBase) {
          terrainTd.createSpan({
            text: entry.name,
            cls: "duckmage-hex-table-base-terrain",
            attr: { title: "Map base terrain (no terrain set on this hex)" },
          });
        } else {
          terrainTd.appendText(entry.name);
        }
      } else {
        terrainTd.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
      }

      const typeLabel = terrainTypeLabel(hex.type);
      if (typeLabel) {
        typeTd.setText(typeLabel);
        typeTd.toggleClass("duckmage-hex-table-base-terrain", hex.isBase);
      } else {
        typeTd.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
      }
    };
    renderTerrainCell();
    terrainTd.addEventListener("click", () => {
      const current = getTerrainFromFile(this.app, path);
      new HexTerrainPickerModal(
        this.app,
        this.plugin,
        this.plugin.getMapPalette(region),
        path,
        current,
        () => {
          renderTerrainCell();
          this.applyFilters([tr]);
        },
      ).open();
    });

    // Section cells
    for (const col of COLUMNS) {
      const td = tr.createEl("td");
      if (col.isLink) {
        // Encounter tables: same rule as the hex editor, so a hex without a
        // note shows its terrain's table in both (displayedEncounterLinks).
        const linkList =
          col.key === "encounters table"
            ? displayedEncounterLinks(
                this.app.vault.getAbstractFileByPath(path) instanceof TFile,
                links.get(col.key) ?? [],
                this.plugin.terrainEncounterLinkFor(region, x, y, path),
              )
            : (links.get(col.key) ?? []);
        if (linkList.length > 0) {
          const full = linkList.join(", ");
          td.dataset.fullContent = full;
          const display =
            col.key === "encounters table"
              ? linkList.map((l) => l.split("/").pop() ?? l).join(", ")
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
              if (col.key !== "encounters table" || linkList.length !== 1)
                return;
              e.preventDefault();
              const file = this.app.metadataCache.getFirstLinkpathDest(
                linkList[0],
                path,
              );
              if (!(file instanceof TFile)) return;
              interface WithOpenTable {
                openTable(path: string): void;
              }
              const leaf = this.app.workspace.getLeaf("tab");
              await leaf.setViewState({
                type: VIEW_TYPE_RANDOM_TABLES,
                active: true,
              });
              void this.app.workspace.revealLeaf(leaf);
              (leaf.view as unknown as WithOpenTable).openTable(file.path);
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
                    interface WithOpenTable {
                      openTable(path: string): void;
                    }
                    const leaves = this.app.workspace.getLeavesOfType(
                      VIEW_TYPE_RANDOM_TABLES,
                    );
                    const leaf =
                      leaves.length > 0
                        ? leaves[0]
                        : this.app.workspace.getLeaf("tab");
                    await leaf.setViewState({
                      type: VIEW_TYPE_RANDOM_TABLES,
                      active: true,
                    });
                    void this.app.workspace.revealLeaf(leaf);
                    (leaf.view as unknown as WithOpenTable).openTable(
                      file.path,
                    );
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
                  `${x}, ${y} — ${section}`,
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
              `${x}, ${y} — ${col.label}`,
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
            `${x}, ${y} — ${col.label}`,
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

    // Default widths (px): Hex, Terrain, Type, then one per COLUMN entry
    const defaultWidths = [
      60, 110, 100, 220, 160, 150, 150, 150, 140, 160, 160, 160, 140,
    ];

    // <col> elements + explicit table width is the only reliable way to drive
    // table-layout:fixed column widths across browsers.
    const colgroup = createEl("colgroup");
    const cols: HTMLTableColElement[] = [];
    let totalWidth = 0;
    for (let i = 0; i < ths.length; i++) {
      const w = defaultWidths[i] ?? 160;
      const col = colgroup.createEl("col");
      col.style.width = `${w}px`;
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
        activeDocument.body.setCssProps({ cursor: "col-resize" });

        const onMove = (me: MouseEvent) => {
          const newW = Math.max(20, startW + me.clientX - startX);
          col.style.width = `${newW}px`;
          table.style.width = `${startTW + (newW - startW)}px`;
        };
        const onUp = () => {
          activeDocument.body.setCssProps({ cursor: "" });
          activeDocument.removeEventListener("mousemove", onMove);
          activeDocument.removeEventListener("mouseup", onUp);
        };
        activeDocument.addEventListener("mousemove", onMove);
        activeDocument.addEventListener("mouseup", onUp);
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
