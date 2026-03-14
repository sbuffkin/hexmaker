import { App, Modal, Notice, TFile } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { getIconUrl, normalizeFolder, makeTableTemplate } from "./utils";
import {
  getTerrainFromFile,
  setTerrainInFile,
  setIconOverrideInFile,
} from "./frontmatter";
import {
  addLinkToSection,
  removeLinkFromSection,
  getLinksInSection,
  getAllSectionData,
  setSectionContent,
  addBacklinkToFile,
} from "./sections";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import { TEXT_SECTIONS } from "./types";
import type { LinkSection } from "./types";
import { RandomTableModal } from "./RandomTableModal";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_RANDOM_TABLES } from "./constants";

export class HexEditorModal extends Modal {
  private hexExists = false;
  private allText = new Map<string, string>();
  private allLinks = new Map<string, string[]>();
  private directTerrain: string | null = null;
  private directIcon: string | null = null;

  constructor(
    app: App,
    private plugin: DuckmagePlugin,
    private x: number,
    private y: number,
    private onChanged: (
      terrainOverrides?: Map<string, string | null>,
      iconOverrides?: Map<string, string | null>,
    ) => void,
  ) {
    super(app);
  }

  async loadData(): Promise<void> {
    // Reset all fields so stale data from a previous hex never bleeds through
    this.allText = new Map();
    this.allLinks = new Map();
    this.directTerrain = null;
    this.directIcon = null;

    const path = this.plugin.hexPath(this.x, this.y);
    this.hexExists =
      this.app.vault.getAbstractFileByPath(path) instanceof TFile;
    if (!this.hexExists) return;

    ({ text: this.allText, links: this.allLinks } = await getAllSectionData(
      this.app,
      path,
    ));
    const rawContent = await this.app.vault.read(
      this.app.vault.getAbstractFileByPath(path) as TFile,
    );
    const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const tm = fmMatch[1].match(/^\s*terrain:\s*(.+)$/m);
      if (tm) this.directTerrain = tm[1].trim();
      const im = fmMatch[1].match(/^\s*icon:\s*(.+)$/m);
      if (im) this.directIcon = im[1].trim();
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");

    const { hexExists, allText, allLinks, directTerrain, directIcon } = this;
    const path = this.plugin.hexPath(this.x, this.y);
    const titleRow = contentEl.createDiv({ cls: "duckmage-editor-title-row" });
    const titleLeft = titleRow.createDiv({ cls: "duckmage-editor-title-left" });
    titleLeft.createEl("h2", { text: `Hex ${this.x}, ${this.y}` });
    const centerBtn = titleLeft.createEl("button", {
      text: "⌖",
      cls: "duckmage-editor-center-btn",
      title: "Center map on this hex",
    });
    centerBtn.addEventListener("click", () => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
      if (leaves.length > 0) (leaves[0].view as any).centerOnHex?.(this.x, this.y);
    });

    if (hexExists) {
      const file = this.app.vault.getAbstractFileByPath(path) as TFile;
      const openLink = titleLeft.createEl("a", {
        text: "Open note",
        cls: "duckmage-editor-open-link",
      });
      openLink.addEventListener("click", () => {
        this.app.workspace.getLeaf("tab").openFile(file);
        this.close();
      });
    }
    this.renderNeighborWidget(titleRow, this.x, this.y);

    const s = this.plugin.settings;

    const { body: terrainBody, header: terrainHeader } = this.makeCollapsible(
      contentEl,
      "Terrain",
      s.hexEditorTerrainCollapsed ?? false,
    );
    // Show current terrain as a small swatch + name in the header
    const paletteEntry = directTerrain
      ? (this.plugin.settings.terrainPalette ?? []).find(p => p.name === directTerrain)
      : undefined;
    if (paletteEntry) {
      const preview = terrainHeader.createSpan({ cls: "duckmage-terrain-header-preview" });
      const swatch = preview.createSpan({ cls: "duckmage-terrain-header-swatch" });
      swatch.style.backgroundColor = paletteEntry.color;
      if (paletteEntry.icon) {
        const img = swatch.createEl("img");
        img.src = getIconUrl(this.plugin, paletteEntry.icon);
      }
      preview.createSpan({ text: paletteEntry.name, cls: "duckmage-terrain-header-name" });
    }
    this.renderTerrainSection(terrainBody, path, directTerrain, directIcon);

    contentEl.createEl("hr", { cls: "duckmage-editor-divider" });

    const { body: notesBody } = this.makeCollapsible(
      contentEl,
      "Notes",
      s.hexEditorNotesCollapsed ?? false,
    );
    for (const { key, label } of TEXT_SECTIONS) {
      this.renderTextSection(
        notesBody,
        path,
        key,
        label,
        allText.get(key) ?? "",
      );
    }

    contentEl.createEl("hr", { cls: "duckmage-editor-divider" });

    const { body: featuresBody } = this.makeCollapsible(
      contentEl,
      "World features",
      s.hexEditorFeaturesCollapsed ?? false,
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Encounters Table",
      hexExists,
      s.tablesFolder,
      allLinks.get("encounters table") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Towns",
      hexExists,
      s.townsFolder,
      allLinks.get("towns") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Dungeons",
      hexExists,
      s.dungeonsFolder,
      allLinks.get("dungeons") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Quests",
      hexExists,
      s.questsFolder,
      allLinks.get("quests") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Factions",
      hexExists,
      s.factionsFolder,
      allLinks.get("factions") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Features",
      hexExists,
      s.featuresFolder,
      allLinks.get("features") ?? [],
    );

    this.makeDraggable();
  }

  onClose() {
    this.contentEl.empty();
  }

  private dragInitialized = false;

  private makeDraggable(): void {
    if (this.dragInitialized) return;
    this.dragInitialized = true;

    const modal = this.modalEl;
    modal.addClass("duckmage-editor-modal-drag");
    modal.style.position = "absolute";
    modal.style.left = "50%";
    modal.style.top = "50%";
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.margin = "0";

    modal.addEventListener("mousedown", (e: MouseEvent) => {
      // Only drag from the native modal header — the strip above .modal-content.
      // This area never scrolls so the drag zone is always accessible.
      const modalContent = modal.querySelector<HTMLElement>(".modal-content");
      if (modalContent && e.clientY >= modalContent.getBoundingClientRect().top) return;
      if ((e.target as HTMLElement).closest("button, a")) return;

      e.preventDefault();
      const r = modal.getBoundingClientRect();
      modal.style.transform = "none";
      modal.style.left = `${r.left}px`;
      modal.style.top = `${r.top}px`;
      const sx = e.clientX, sy = e.clientY;
      const ox = r.left, oy = r.top;
      const onMove = (ev: MouseEvent) => {
        modal.style.left = `${ox + ev.clientX - sx}px`;
        modal.style.top  = `${oy + ev.clientY - sy}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  private isOnMap(nx: number, ny: number): boolean {
    const { gridOffset, gridSize } = this.plugin.settings;
    return (
      nx >= gridOffset.x &&
      nx < gridOffset.x + gridSize.cols &&
      ny >= gridOffset.y &&
      ny < gridOffset.y + gridSize.rows
    );
  }

  private renderNeighborWidget(container: HTMLElement, x: number, y: number): void {
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const widget = container.createDiv({ cls: "duckmage-neighbor-widget" });

    type NeighborDef = { l: number; t: number; nx: number; ny: number };
    const defs: NeighborDef[] = isFlat
      ? [
          { l: 22, t: 2,  nx: x,     ny: y - 1 },                              // N
          { l: 42, t: 13, nx: x + 1, ny: x % 2 === 0 ? y - 1 : y },            // NE
          { l: 42, t: 32, nx: x + 1, ny: x % 2 === 0 ? y : y + 1 },            // SE
          { l: 22, t: 40, nx: x,     ny: y + 1 },                              // S
          { l: 2,  t: 32, nx: x - 1, ny: x % 2 === 0 ? y : y + 1 },            // SW
          { l: 2,  t: 13, nx: x - 1, ny: x % 2 === 0 ? y - 1 : y },            // NW
        ]
      : [
          { l: 10, t: 1,  nx: y % 2 === 0 ? x - 1 : x,     ny: y - 1 },        // NW
          { l: 34, t: 1,  nx: y % 2 === 0 ? x : x + 1,     ny: y - 1 },        // NE
          { l: 0,  t: 18, nx: x - 1, ny: y },                                   // W
          { l: 44, t: 18, nx: x + 1, ny: y },                                   // E
          { l: 10, t: 35, nx: y % 2 === 0 ? x - 1 : x,     ny: y + 1 },        // SW
          { l: 34, t: 35, nx: y % 2 === 0 ? x : x + 1,     ny: y + 1 },        // SE
        ];

    for (const { l, t, nx, ny } of defs) {
      const onMap = this.isOnMap(nx, ny);
      const tile = widget.createDiv({
        cls: `duckmage-neighbor-tile${onMap ? "" : " duckmage-neighbor-tile-offmap"}`,
      });
      tile.style.left = `${l}px`;
      tile.style.top = `${t}px`;

      if (onMap) {
        tile.title = `Hex ${nx}, ${ny}`;
        const nPath = this.plugin.hexPath(nx, ny);
        const terrain = getTerrainFromFile(this.app, nPath);
        const entry = terrain
          ? this.plugin.settings.terrainPalette.find(p => p.name === terrain)
          : undefined;
        if (entry) tile.style.backgroundColor = entry.color;
        tile.addEventListener("click", () => {
          this.x = nx;
          this.y = ny;
          this.loadData().then(() => this.onOpen());
        });
      } else {
        tile.title = "Off map";
      }
    }
  }

  private makeCollapsible(
    container: HTMLElement,
    label: string,
    startCollapsed: boolean,
  ): { body: HTMLElement; header: HTMLElement } {
    const wrapper = container.createDiv({ cls: "duckmage-editor-collapsible" });
    const header = wrapper.createDiv({
      cls: "duckmage-editor-collapsible-header",
    });
    const arrow = header.createSpan({
      cls: "duckmage-editor-collapsible-arrow",
      text: startCollapsed ? "▶" : "▼",
    });
    header.createEl("h3", {
      text: label,
      cls: "duckmage-editor-collapsible-title",
    });
    const body = wrapper.createDiv({ cls: "duckmage-editor-collapsible-body" });
    if (startCollapsed) body.style.display = "none";
    header.addEventListener("click", () => {
      const collapsed = body.style.display === "none";
      body.style.display = collapsed ? "" : "none";
      arrow.textContent = collapsed ? "▼" : "▶";
    });
    return { body, header };
  }

  private renderTerrainSection(
    container: HTMLElement,
    path: string,
    currentTerrain: string | null,
    currentIcon: string | null,
  ): void {
    const palette = this.plugin.settings.terrainPalette;

    const section = container.createDiv({ cls: "duckmage-editor-section" });

    const grid = section.createDiv({ cls: "duckmage-terrain-picker" });

    // Clear terrain — always first in the grid
    if (currentTerrain) {
      const clearBtn = grid.createDiv({ cls: "duckmage-terrain-option duckmage-terrain-option-clear" });
      clearBtn.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-clear" });
      clearBtn.createSpan({ text: "Clear", cls: "duckmage-terrain-option-name" });
      clearBtn.addEventListener("click", async () => {
        await setTerrainInFile(this.app, path, null);
        void this.plugin.syncHexEncounterTableLink(path, null);
        this.onChanged(new Map([[path, null]]));
        this.close();
      });
    }

    for (const entry of palette) {
      const btn = grid.createDiv({
        cls: `duckmage-terrain-option${entry.name === currentTerrain ? " is-selected" : ""}`,
      });

      const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
      preview.style.backgroundColor = entry.color;

      if (entry.icon) {
        const img = preview.createEl("img", {
          cls: "duckmage-terrain-preview-icon",
        });
        img.src = getIconUrl(this.plugin, entry.icon);
        img.alt = entry.name;
      }

      btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });

      btn.addEventListener("click", async () => {
        await this.ensureHexNote();
        await setTerrainInFile(this.app, path, entry.name);
        void this.plugin.syncHexEncounterTableLink(path, entry.name);
        this.onChanged(new Map([[path, entry.name]]));
        this.close();
      });
    }

    // Icon override row
    const iconRow = section.createDiv({ cls: "duckmage-icon-override-row" });
    iconRow.createSpan({
      text: "Icon override",
      cls: "duckmage-icon-override-label",
    });
    const iconSelect = iconRow.createEl("select", {
      cls: "duckmage-icon-override-select",
    });
    iconSelect.createEl("option", {
      value: "",
      text: "— use terrain default —",
    });
    for (const icon of this.plugin.availableIcons) {
      const label = icon
        .replace(/^bw-/, "")
        .replace(/\.png$/, "")
        .replace(/-/g, " ");
      iconSelect.createEl("option", { value: icon, text: label });
    }
    // Use directly-read icon value (not the stale metadata cache)
    iconSelect.value = currentIcon ?? "";
    // Keep terrain in the overrides map so renderGrid doesn't lose it during
    // the brief window when Obsidian clears the metadata cache on file modify.
    const terrainOverrides: Map<string, string | null> | undefined =
      currentTerrain ? new Map([[path, currentTerrain]]) : undefined;

    iconSelect.addEventListener("change", async () => {
      await this.ensureHexNote();
      await setIconOverrideInFile(this.app, path, iconSelect.value || null);
      this.onChanged(terrainOverrides, new Map([[path, iconSelect.value || null]]));
    });
    const clearIconBtn = iconRow.createEl("button", {
      text: "Clear",
      cls: "duckmage-clear-btn",
      title: "Remove icon override",
    });
    clearIconBtn.style.visibility = currentIcon ? "visible" : "hidden";
    clearIconBtn.addEventListener("click", async () => {
      await this.ensureHexNote();
      await setIconOverrideInFile(this.app, path, null);
      this.onChanged(terrainOverrides, new Map([[path, null]]));
      iconSelect.value = "";
      clearIconBtn.style.visibility = "hidden";
    });
    // Show/hide clear button as icon selection changes
    iconSelect.addEventListener("change", () => {
      clearIconBtn.style.visibility = iconSelect.value ? "visible" : "hidden";
    });
  }

  private getFilesForDropdown(folder: string, filterType?: "roll-filter" | "encounter-filter"): TFile[] {
    const normalized = normalizeFolder(folder);
    const all = this.app.vault.getMarkdownFiles();
    const scoped = normalized
      ? all.filter((f) => f.path.startsWith(normalized + "/"))
      : all;
    let filtered = scoped.filter((f) => !f.basename.startsWith("_"));
    if (filterType) {
      const excluded = filterType === "encounter-filter"
        ? this.plugin.settings.encounterTableExcludedFolders
        : this.plugin.settings.rollTableExcludedFolders;
      filtered = this.plugin.filterTableFiles(filtered, filterType, excluded);
    }
    return filtered.sort((a, b) => a.basename.localeCompare(b.basename));
  }

  private renderDropdownSection(
    container: HTMLElement,
    path: string,
    section: LinkSection,
    hexExists: boolean,
    sourceFolder: string,
    initialLinks: string[],
  ): void {
    const sectionEl = container.createDiv({
      cls: "duckmage-editor-link-section",
    });
    const header = sectionEl.createDiv({ cls: "duckmage-link-section-header" });
    header.createEl("h4", { text: section });

    const select = header.createEl("select", { cls: "duckmage-link-select" });
    select.createEl("option", { value: "", text: "— add —" });
    const filterType = section === "Encounters Table" ? "encounter-filter" as const : undefined;
    for (const file of this.getFilesForDropdown(sourceFolder, filterType)) {
      select.createEl("option", { value: file.path, text: file.basename });
    }

    const linksEl = sectionEl.createDiv({ cls: "duckmage-link-list" });

    // For Encounters Table: clicking a linked item opens the table view for rolling
    const onItemClick =
      section === "Encounters Table"
        ? async (_link: string, file: TFile) => {
            const leaves = this.app.workspace.getLeavesOfType(
              VIEW_TYPE_RANDOM_TABLES,
            );
            if (leaves.length > 0) {
              this.app.workspace.revealLeaf(leaves[0]);
              (leaves[0].view as any).openTable?.(file.path);
            } else {
              const leaf = this.app.workspace.getLeaf("tab");
              await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
              (leaf.view as any).openTable?.(file.path);
            }
            this.close();
          }
        : undefined;

    const onRemove = async (link: string) => {
      await removeLinkFromSection(this.app, path, section, link);
      this.onChanged();
      await refresh();
    };

    const onRollClick =
      section === "Encounters Table"
        ? (file: TFile) =>
            new RandomTableModal(
              this.app,
              this.plugin,
              undefined,
              file.path,
            ).open()
        : undefined;

    const refresh = async () => {
      linksEl.empty();
      this.renderLinkList(
        linksEl,
        await getLinksInSection(this.app, path, section),
        path,
        onRemove,
        onItemClick,
        onRollClick,
      );
    };

    if (hexExists) {
      this.renderLinkList(
        linksEl,
        initialLinks,
        path,
        onRemove,
        onItemClick,
        onRollClick,
      );
    } else {
      linksEl.createSpan({ text: "None", cls: "duckmage-link-empty" });
    }

    select.addEventListener("change", async () => {
      const selectedPath = select.value;
      select.value = "";
      if (!selectedPath) return;
      const file = this.app.vault.getAbstractFileByPath(selectedPath);
      if (!(file instanceof TFile)) return;
      const hexFile = await this.ensureHexNote();
      if (!hexFile) {
        new Notice("Could not create hex note.");
        return;
      }
      const linkText = `[[${this.app.metadataCache.fileToLinktext(file, path)}]]`;
      await addLinkToSection(this.app, path, section, linkText);
      await addBacklinkToFile(this.app, file.path, path);
      this.onChanged();
      await refresh();
    });

    // Create-new row
    const createRow = sectionEl.createDiv({
      cls: "duckmage-editor-create-row",
    });
    const createInput = createRow.createEl("input", {
      type: "text",
      cls: "duckmage-editor-create-input",
    });
    createInput.placeholder = `New ${section.slice(0, -1).toLowerCase()}…`;
    const createBtn = createRow.createEl("button", {
      text: "Create",
      cls: "duckmage-editor-create-btn",
    });

    const createAndLink = async () => {
      const name = createInput.value.trim();
      if (!name) return;
      const folder = normalizeFolder(sourceFolder);
      const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
      let file = this.app.vault.getAbstractFileByPath(newPath);
      if (!(file instanceof TFile)) {
        try {
          if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
          }
          file = await this.app.vault.create(
            newPath,
            section === "Encounters Table"
              ? makeTableTemplate(this.plugin.settings.defaultTableDice)
              : "",
          );
        } catch (err) {
          new Notice(`Could not create ${newPath}: ${err}`);
          return;
        }
      }
      const hexFile = await this.ensureHexNote();
      if (!hexFile) {
        new Notice("Could not create hex note.");
        return;
      }
      const linkText = `[[${this.app.metadataCache.fileToLinktext(file as TFile, path)}]]`;
      await addLinkToSection(this.app, path, section, linkText);
      await addBacklinkToFile(this.app, (file as TFile).path, path);
      this.onChanged();
      createInput.value = "";
      await refresh();
    };

    createBtn.addEventListener("click", createAndLink);
    createInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") createAndLink();
    });
  }

  private renderLinkSection(
    container: HTMLElement,
    path: string,
    section: LinkSection,
    hexExists: boolean,
    initialLinks: string[],
  ): void {
    const sectionEl = container.createDiv({
      cls: "duckmage-editor-link-section",
    });
    const header = sectionEl.createDiv({ cls: "duckmage-link-section-header" });
    header.createEl("h4", { text: section });
    const addBtn = header.createEl("button", {
      text: "+ Add",
      cls: "duckmage-add-btn",
    });
    const linksEl = sectionEl.createDiv({ cls: "duckmage-link-list" });

    if (hexExists) {
      this.renderLinkList(linksEl, initialLinks, path);
    } else {
      linksEl.createSpan({ text: "—", cls: "duckmage-link-empty" });
    }

    addBtn.addEventListener("click", () => {
      new FileLinkSuggestModal(this.app, this.plugin, async (file) => {
        const hexFile = await this.ensureHexNote();
        if (!hexFile) {
          new Notice("Could not create hex note.");
          return;
        }
        const linkText = `[[${this.app.metadataCache.fileToLinktext(file, path)}]]`;
        await addLinkToSection(this.app, path, section, linkText);
        this.onChanged();
        const links = await getLinksInSection(this.app, path, section);
        linksEl.empty();
        this.renderLinkList(linksEl, links, path);
      }).open();
    });
  }

  private renderLinkList(
    container: HTMLElement,
    links: string[],
    sourcePath: string,
    onRemove?: (link: string) => void,
    onItemClick?: (link: string, file: TFile) => void,
    onRollClick?: (file: TFile) => void,
  ): void {
    if (links.length === 0) {
      container.createSpan({ text: "None", cls: "duckmage-link-empty" });
    } else {
      for (const link of links) {
        const item = container.createDiv({ cls: "duckmage-link-item" });
        const label = item.createSpan({
          text: `[[${link}]]`,
          cls: "duckmage-link-item-label",
        });
        const file = this.app.metadataCache.getFirstLinkpathDest(
          link,
          sourcePath,
        );
        if (file instanceof TFile) {
          label.addClass("duckmage-link-item-clickable");
          label.addEventListener("click", () => {
            if (onItemClick) {
              void onItemClick(link, file);
            } else {
              this.app.workspace.getLeaf("tab").openFile(file);
              this.close();
            }
          });
          if (onRollClick) {
            const rollBtn = item.createEl("button", {
              text: "🎲",
              cls: "duckmage-link-roll-btn",
            });
            rollBtn.title = "Roll on this table";
            rollBtn.addEventListener("click", () => onRollClick(file));
          }
        }
        if (onRemove) {
          const removeBtn = item.createEl("button", {
            text: "×",
            cls: "duckmage-link-remove-btn",
          });
          removeBtn.addEventListener("click", () => onRemove(link));
        }
      }
    }
  }

  private renderTextSection(
    container: HTMLElement,
    path: string,
    section: string,
    label: string,
    initialContent: string,
  ): void {
    const sectionEl = container.createDiv({
      cls: "duckmage-editor-text-section",
    });
    const labelRow = sectionEl.createDiv({
      cls: "duckmage-text-section-label-row",
    });
    labelRow.createEl("label", {
      text: label,
      cls: "duckmage-text-section-label",
    });

    // Button group on the right — keeps 📖 and 🎲 clustered together
    const btnGroup = labelRow.createDiv({
      cls: "duckmage-text-section-btn-group",
    });

    // 📖 button: terrain description table (description section) or generic section table
    const tablesFolder = this.plugin.settings.tablesFolder
      ? this.plugin.settings.tablesFolder.replace(/^\/+|\/+$/g, "")
      : "";
    let previewTablePath: string | null = null;
    let previewTitle = "";

    if (section === "description") {
      const terrain = getTerrainFromFile(this.app, path);
      if (terrain) {
        const p = tablesFolder
          ? `${tablesFolder}/terrain/${terrain} - description.md`
          : `terrain/${terrain} - description.md`;
        if (this.app.vault.getAbstractFileByPath(p)) {
          previewTablePath = p;
          previewTitle = `Roll on ${terrain} description table`;
        }
      }
    } else if (
      section === "landmark" ||
      section === "hidden" ||
      section === "secret"
    ) {
      const p = tablesFolder
        ? `${tablesFolder}/${section}.md`
        : `${section}.md`;
      if (this.app.vault.getAbstractFileByPath(p)) {
        previewTablePath = p;
        previewTitle = `Roll on ${section} table`;
      }
    }

    if (previewTablePath) {
      const previewBtn = btnGroup.createEl("button", {
        text: "📖",
        cls: "duckmage-section-desc-table-btn",
      });
      previewBtn.title = previewTitle;
      const capturedPath = previewTablePath;
      previewBtn.addEventListener("click", () => {
        new RandomTableModal(
          this.app,
          this.plugin,
          undefined,
          capturedPath,
        ).open();
      });
    }

    const rollBtn = btnGroup.createEl("button", {
      text: "🎲",
      cls: "duckmage-section-roll-btn",
    });
    rollBtn.title = "Roll on a table and append result";
    const textarea = sectionEl.createEl("textarea", {
      cls: "duckmage-text-section-textarea",
    });
    rollBtn.addEventListener("click", () => {
      new RandomTableModal(this.app, this.plugin, (result) => {
        if (textarea.value && !textarea.value.endsWith("\n"))
          textarea.value += "\n";
        textarea.value += result;
      }).open();
    });
    textarea.rows = 3;
    textarea.placeholder = `${label}…`;
    textarea.value = initialContent;

    textarea.addEventListener("blur", async () => {
      const file = await this.ensureHexNote();
      if (!file) return;
      await setSectionContent(this.app, path, section, textarea.value);
      this.onChanged();
    });
  }

  private async ensureHexNote(): Promise<TFile | null> {
    const path = this.plugin.hexPath(this.x, this.y);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    return this.plugin.createHexNote(this.x, this.y);
  }
}
