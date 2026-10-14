import { effectiveTerrainType } from "../terrainTypes";
import { App, Notice, TFile } from "obsidian";
import { canDo } from "../modeGate";
import { lockedHint, workModeOf, type ModeAction } from "../workMode";
import { newMapItemTitle } from "../maps/submaps";
import { ModeMenu, type ModeMenuOptions } from "./modeMenu";
import { addGodOffer } from "./godOffer";
import { copyHexLink } from "./copyHexLink";
import { HexmakerModal } from "../HexmakerModal";
import { Fold } from "../ui/disclosure";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  getIconUrl,
  normalizeFolder,
  createIconEl,
  iconLabel,
} from "../utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  setTerrainInFile,
  setIconOverrideInFile,
  setGmIconsInFile,
  getGmIconsFromFile,
  getHexMapsFromFile,
  getHexNameFromFile,
} from "../frontmatter";
import { cleanHexName } from "../maps/hexNames";
import {
  addLinkToSection,
  removeLinkFromSection,
  getLinksInSection,
  getAllSectionData,
  setSectionContent,
  addBacklinkToFile,
  joinSectionText,
} from "../sections";
import { LINK_SECTIONS, ROLLED_TEXT_SECTIONS, TEXT_SECTIONS } from "../types";
import type { LinkSection, HexEditorOptions, TerrainColor } from "../types";
import { RandomTableModal, type RollHexTarget } from "../random-tables/RandomTableModal";
import { WorkflowWizardModal } from "../random-tables/WorkflowWizardModal";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import { isRolledSection } from "../regionTables";
import { TABLE_KINDS, choiceKey, initialChoice, rememberChoice, rememberedChoice, tableChoices, type TableChoiceItem, type TableKind } from "../tableChoice";
import { TableChoice } from "../random-tables/TableChoice";
import { groupTableFiles } from "../random-tables/tablePickerGroups";
import { HexExportModal } from "./HexExportModal";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { resolveHex, type Side } from "../worldgen/world";
import { neighbourSpec } from "../worldgen/neighbours";
import { worldMaps } from "../modules/runtime";
import { flowerPetals, neighbourButton, PETAL_SIZE } from "../maps/mapNav";
import type { MapData } from "../types";
import { RegionNavigateModal } from "./RegionNavigateModal";
import { linkDisplayName } from "../encounterLinks";
import { AUTOSAVE_MS, DebouncedSave, SAVE_STATUS_TEXT, SAVE_STATUS_TITLE, SaveTracker, type SaveState } from "./saveStatus";
import { openNoteFocused } from "../openNote";
import { contentFolder } from "../notePickers";
import { linkNoteTemplatePathFor } from "../noteTemplates";
import { terrainStartsCollapsed } from "./terrainSection";
import { addPickerFilter, filterText } from "../ui/pickers";
import { withRepairHint } from "../ui/repairHint";
import { addToPlayLog } from "../play/playLogWriter";
import { PLAY_LOG_TARGET, rollDefaultSection } from "../play/playLog";
import { PlayLogModal } from "../play/PlayLogModal";
import { linkSectionIcon, showOnMapOffer } from "../play/linkIcons";

/** Typing pause after which a text section autosaves. */
const TEXT_AUTOSAVE_MS = AUTOSAVE_MS;
/** Unique ids for label for= ↔ textarea pairs. */
let textFieldSeq = 0;

/** Which side of the map an off-map hex lies past (east/west first at corners). */
function offMapSide(map: MapData, x: number, y: number): Side {
  const { x: ox, y: oy } = map.gridOffset;
  if (x < ox) return "west";
  if (x >= ox + map.gridSize.cols) return "east";
  return y < oy ? "north" : "south";
}

export class HexEditorModal extends HexmakerModal {
  /** Placement surface (src/ui/placement.ts): the editor's Advanced dropdown. */
  protected surfaceId = "HexEditor";
  private hexExists = false;
  private allText = new Map<string, string>();
  private allLinks = new Map<string, string[]>();
  /** Section key → its heading as written in the note (see getAllSectionData). */
  private allHeadings = new Map<string, string>();
  private directTerrain: string | null = null;
  private directIcon: string | null = null;
  private directGmIcon: string | null = null;
  /** Full GM-icon list (multi-icon model). Mirrors `directGmIcon` for old
   *  read sites; `directGmIcon` is the first entry of this list. */
  private directGmIcons: string[] = [];
  private dataPreloaded = false;
  /** Stops keepInViewport's observer (set on first open). */
  private stopKeepInViewport: (() => void) | null = null;
  /** The autosave status, in ONE place: beside the box being edited (it
   *  starts beside the Name box). Round 4: a title-row cue alone was missed;
   *  round 7: a title-row copy next to this one read as redundant. */
  private notesStatusEl: HTMLElement | null = null;
  private saves = new SaveTracker(
    (state) => this.renderSaveStatus(state),
    (fn, ms) => window.setTimeout(fn, ms),
    (id) => window.clearTimeout(id),
  );
  /** Redraws each table-choice section (by kind) from the current links. */
  private choiceRefreshers = new Map<string, () => void>();
  /** Text sections with typed-but-unsaved changes: flush on close/navigate. */
  private pendingTextSaves = new Set<() => void>();
  /** Text boxes by section key: append a rolled result and save (P2). */
  private textBoxes = new Map<string, (addition: string) => void>();

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private x: number,
    private y: number,
    private mapName: string,
    private onChanged: (
      terrainOverrides?: Map<string, string | null>,
      iconOverrides?: Map<string, string | null>,
      gmIconsOverrides?: Map<string, string[]>,
    ) => void,
    private options: HexEditorOptions = {},
  ) {
    super(app);
  }

  async loadData(): Promise<void> {
    // Reset all fields so stale data from a previous hex never bleeds through
    this.hexExists = false;
    this.allText = new Map();
    this.allLinks = new Map();
    this.allHeadings = new Map();
    this.directTerrain = null;
    this.directIcon = null;
    this.directGmIcon = null;
    this.directGmIcons = [];

    const path = this.plugin.hexPath(this.x, this.y, this.mapName);
    // Hand edits in the note's Map data callout go to the map first (phase
    // 2), so the editor shows them; the callout then shows what the map has.
    if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) await this.plugin.syncHexMapData(this.mapName, this.x, this.y);
    // Terrain, icon and GM icons live in the map note (the map store), not in
    // the hex note — and a hex can have them before its note exists. Reading
    // only hex frontmatter left the current terrain never highlighted (E1).
    this.directTerrain = getTerrainFromFile(this.app, path);
    this.directIcon = getIconOverrideFromFile(this.app, path);
    this.directGmIcons = getGmIconsFromFile(this.app, path);
    this.directGmIcon = this.directGmIcons[0] ?? null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    this.hexExists = true;

    // Single read — reused for both frontmatter and section parsing
    const rawContent = await this.app.vault.read(file);

    // Fallback for notes the store doesn't serve yet (startup, or a note
    // written moments ago that isn't indexed): read the raw frontmatter.
    const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const tm = fmMatch[1].match(/^\s*terrain:\s*(.+)$/m);
      if (tm && this.directTerrain === null) this.directTerrain = tm[1].trim();
      const im = fmMatch[1].match(/^\s*icon:\s*(.+)$/m);
      if (im && this.directIcon === null) this.directIcon = im[1].trim();
      const gm = fmMatch[1].match(/^\s*gm-icon:\s*(.+)$/m);
      if (gm && this.directGmIcon === null) this.directGmIcon = gm[1].trim();
    }

    ({ text: this.allText, links: this.allLinks, headings: this.allHeadings } = await getAllSectionData(
      this.app,
      path,
      rawContent,
    ));
  }

  onOpen() {
    const { contentEl } = this;
    // Re-render on navigation: save what was typed into the previous hex.
    this.flushTextSaves();
    this.textBoxes.clear();
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");

    const path = this.plugin.hexPath(this.x, this.y, this.mapName);

    // ── Static header — rendered immediately, no data needed ─────────────
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
      interface WithCenterOnHex {
        centerOnHex?(x: number, y: number): void;
      }
      if (leaves.length > 0)
        (leaves[0].view as unknown as WithCenterOnHex).centerOnHex?.(
          this.x,
          this.y,
        );
    });

    // "Open note" can be determined synchronously from the vault index
    const fileNow = this.app.vault.getAbstractFileByPath(path);
    if (fileNow instanceof TFile) {
      const openLink = titleLeft.createEl("a", {
        text: "Open note",
        cls: "duckmage-editor-open-link",
      });
      openLink.addEventListener("click", () => {
        void openNoteFocused(this.app, fileNow);
        this.close();
      });
      const exportLink = titleLeft.createEl("a", {
        text: "Export",
        cls: "duckmage-editor-open-link",
      });
      exportLink.title = "Export this hex as PDF or Markdown";
      exportLink.addEventListener("click", () => {
        new HexExportModal(this.app, this.plugin, fileNow).open();
      });
    }
    // Run a workflow for this hex (PA2): its result can be added to a
    // section here.
    const wfLink = titleLeft.createEl("a", {
      text: "Run workflow",
      cls: "duckmage-editor-open-link",
      attr: { title: "Roll a workflow and add the result to this hex" },
    });
    wfLink.addEventListener("click", () => this.pickWorkflow());
    // What happened here, to the dated play log (SF3).
    const logLink = titleLeft.createEl("a", {
      text: "Add to log",
      cls: "duckmage-editor-open-link",
      attr: { title: "Write what happened here in today's play log" },
    });
    logLink.addEventListener("click", () => {
      new PlayLogModal(this.app, `${this.plugin.mapLabel(this.mapName)} ${this.x}, ${this.y}`, (text) =>
        addToPlayLog(this.plugin, this.mapName, this.x, this.y, text),
      ).open();
    });
    this.renderNeighborWidget(titleRow, this.x, this.y);
    this.renderNameField(contentEl, path);
    this.renderMapsStrip(contentEl);

    this.makeDraggable();
    // The body renders after an async read, so the modal opens short and
    // then grows: keep its bottom on screen (it ran off the window, and a
    // click on the hidden half closed the editor — fresh-eyes round 3).
    this.stopKeepInViewport ??= this.keepInViewport();

    // ── Body — populated after the single async read ──────────────────────
    const bodyEl = contentEl.createDiv({ cls: "duckmage-editor-body" });

    if (this.dataPreloaded) {
      // Data was fetched before onOpen was called (navigation); render immediately
      // so there is no intermediate "Loading…" frame visible to the user.
      this.renderBody(bodyEl, path);
    } else {
      bodyEl.createSpan({ text: "Loading…", cls: "duckmage-editor-loading" });
      void this.loadData().then(() => {
        bodyEl.empty();
        this.renderBody(bodyEl, path);
      });
    }
  }

  private renderBody(bodyEl: HTMLElement, path: string): void {
    const { hexExists, allText, allLinks, directTerrain, directIcon } = this;
    const s = this.plugin.settings;

    // A hex that already has a terrain opens with Terrain collapsed to a
    // one-line summary (round 5: the 50-swatch grid reopened expanded on
    // every hex; round 6: expanding it once must not stick).
    let syncChangeHint = (): void => {};
    const { body: terrainBody, header: terrainHeader } = this.makeCollapsible(
      bodyEl,
      "Terrain",
      "hexEditorTerrainCollapsed",
      terrainStartsCollapsed(directTerrain !== null, s.hexEditorTerrainCollapsed ?? false),
      () => syncChangeHint(),
    );
    const headerPreview = terrainHeader.createSpan({
      cls: "duckmage-terrain-header-preview",
    });
    this.renderTerrainHeader(headerPreview, directTerrain, directIcon);
    const changeHint = terrainHeader.createSpan({ cls: "duckmage-terrain-change-hint", text: "▸ change" });
    const terrainOpen = () => (terrainBody.parentElement as HTMLDetailsElement | null)?.open ?? true;
    syncChangeHint = () => changeHint.toggle(!terrainOpen() && canDo(this.mapName, "paint-terrain"));
    syncChangeHint();
    const refreshHeader = () => this.renderTerrainHeader(headerPreview, this.directTerrain, this.directIcon);
    // Terrain and icons are map data: the map's work mode may lock them
    // (one line instead of the pickers). Notes are never locked (WM2).
    if (canDo(this.mapName, "paint-terrain")) this.renderTerrainSection(terrainBody, path, directTerrain, refreshHeader);
    else this.renderModeLocked(terrainBody, "paint-terrain");

    bodyEl.createEl("hr", { cls: "duckmage-editor-divider" });

    const { body: notesBody } = this.makeCollapsible(
      bodyEl,
      "Notes",
      "hexEditorNotesCollapsed",
    );
    for (const { key, label } of TEXT_SECTIONS) {
      if (!this.options.gmLayerActive && (key === "hidden" || key === "secret")) continue;
      this.renderTextSection(
        notesBody,
        path,
        key,
        label,
        allText.get(key) ?? "",
      );
    }
    // New maps start with the GM layer off, which hides Hidden and Secret;
    // say so rather than leave a GM wondering where they went.
    if (!this.options.gmLayerActive && this.options.onEnableGmLayer) {
      const hint = notesBody.createDiv({ cls: "duckmage-editor-gm-hint" });
      hint.createSpan({ text: "Hidden and Secret notes show while the GM layer is on. " });
      const show = hint.createEl("a", { text: "Show them", href: "#" });
      show.addEventListener("click", (e) => {
        e.preventDefault();
        this.options.onEnableGmLayer?.();
        this.options.gmLayerActive = true;
        this.onOpen();
      });
    }
    // Weather and Hooks & Rumors (E2): rolled from the region's tables,
    // folded away unless the hex already has some.
    const rolled = new Fold(notesBody, {
      title: ROLLED_TEXT_SECTIONS.map((s) => s.label).join(" · "),
      open: ROLLED_TEXT_SECTIONS.some(({ key }) => !!(allText.get(key) ?? "").trim()),
      cls: "duckmage-editor-rolled-sections",
    });
    for (const { key, label } of ROLLED_TEXT_SECTIONS) {
      this.renderTextSection(rolled.body, path, key, label, allText.get(key) ?? "");
    }
    // Sections in this note the editor has no field for (the user's own, or
    // an older template's): shown and editable under their own headings, so
    // nothing in the note is out of sight here.
    const known = new Set<string>([
      ...TEXT_SECTIONS.map((s) => s.key as string),
      ...ROLLED_TEXT_SECTIONS.map((s) => s.key as string),
      ...LINK_SECTIONS.map((s) => s.toLowerCase()),
    ]);
    const others = [...this.allHeadings].filter(([key]) => !known.has(key));
    if (others.length) {
      const more = new Fold(notesBody, {
        title: `More in this note (${others.length})`,
        open: others.some(([key]) => !!(allText.get(key) ?? "").trim()),
        cls: "duckmage-editor-other-sections",
      });
      for (const [key, heading] of others) this.renderTextSection(more.body, path, heading, heading.replace(/[:：]+$/, ""), allText.get(key) ?? "");
    }

    bodyEl.createEl("hr", { cls: "duckmage-editor-divider" });

    // The group of link fields. Not called "Features": that's one of the
    // fields, and a group heading with a field's name read as that field's
    // label (E5). The settings flag keeps its old name.
    const { body: featuresBody } = this.makeCollapsible(
      bodyEl,
      "Linked notes",
      "hexEditorFeaturesCollapsed",
    );
    featuresBody.addClass("duckmage-editor-link-group");
    this.renderEncountersSection(featuresBody, path);
    this.renderDropdownSection(
      featuresBody,
      path,
      "Towns",
      hexExists,
      contentFolder(s, "townsFolder"),
      allLinks.get("towns") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Dungeons",
      hexExists,
      contentFolder(s, "dungeonsFolder"),
      allLinks.get("dungeons") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Quests",
      hexExists,
      contentFolder(s, "questsFolder"),
      allLinks.get("quests") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Factions",
      hexExists,
      contentFolder(s, "factionsFolder"),
      allLinks.get("factions") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Features",
      hexExists,
      contentFolder(s, "featuresFolder"),
      allLinks.get("features") ?? [],
    );

    // Icon pickers last: they are long grids, and above Notes they pushed
    // Description below the fold (fresh-eyes round 3).
    bodyEl.createEl("hr", { cls: "duckmage-editor-divider" });
    const { body: iconsBody } = this.makeCollapsible(
      bodyEl,
      "Icons",
      "hexEditorIconsCollapsed",
    );
    if (canDo(this.mapName, "paint-icon")) this.renderIconSections(iconsBody, path, directIcon, this.directGmIcons, refreshHeader);
    else this.renderModeLocked(iconsBody, "paint-icon");
  }

  /** Menus here: debug mode, and the God offer on God-only items. */
  private modeMenuOptions(): ModeMenuOptions {
    return { store: this.app, onGod: () => { this.plugin.setMapWorkMode(this.mapName, "god"); this.onOpen(); } };
  }

  /** One line where a section the work mode locks would be. */
  private renderModeLocked(container: HTMLElement, action: ModeAction): void {
    const line = container.createDiv({ cls: "duckmage-editor-mode-locked", text: lockedHint(action) });
    // A God-only section offers the switch right here (godOffer.ts).
    addGodOffer(line, this.plugin, this.mapName, lockedHint(action), () => this.onOpen());
  }

  onClose() {
    this.flushTextSaves();
    // Terrain, region or name may have changed here: refresh the note's Map data.
    void this.plugin.refreshHexMapData(this.mapName, this.x, this.y);
    this.saves.dispose();
    this.notesStatusEl = null;
    this.stopKeepInViewport?.();
    this.stopKeepInViewport = null;
    this.options.onModalClose?.();
    this.contentEl.empty();
  }

  /**
   * The hex's name (N1), top of the editor. Stored in the map note (no
   * hex note needed); a hex with a note also gets it as an alias (X4).
   * Saves when the box loses focus or Enter is pressed, and on close.
   */
  private renderNameField(container: HTMLElement, path: string): void {
    const row = container.createDiv({ cls: "duckmage-editor-name-row" });
    const id = `duckmage-hex-name-${textFieldSeq++}`;
    row.createEl("label", { text: "Name", attr: { for: id } });
    const input = row.createEl("input", {
      type: "text",
      cls: "duckmage-editor-name-input",
      attr: { id, placeholder: "Name this hex (optional)", spellcheck: "false" },
    });
    input.value = getHexNameFromFile(path) ?? "";
    // The single autosave status starts here, beside the first box; text
    // sections move it beside whichever box has focus.
    this.notesStatusEl = row.createDiv({
      cls: "duckmage-editor-notes-status",
      attr: { "aria-live": "polite" },
    });
    this.renderSaveStatus(this.saves.current);
    input.addEventListener("focus", () => {
      const status = this.notesStatusEl;
      if (status && status.parentElement !== row) row.appendChild(status);
    });
    const { x, y, mapName } = this;
    let saved = cleanHexName(input.value);
    // Saves a moment after typing stops, like the text boxes (round 7: the
    // name only saved on blur, so "Saving shortly…" sat there).
    const debounce = new DebouncedSave(
      () => save(),
      TEXT_AUTOSAVE_MS,
      (fn, ms) => window.setTimeout(fn, ms),
      (id) => window.clearTimeout(id),
    );
    const save = () => {
      debounce.cancel();
      this.pendingTextSaves.delete(save);
      const name = cleanHexName(input.value);
      if (name === saved) {
        this.saves.settle();
        return;
      }
      saved = name;
      void this.saves.track(this.plugin.undoableEdit(mapName, () => this.plugin.setHexName(mapName, x, y, name)).then(() => this.onChanged()));
    };
    input.addEventListener("input", () => {
      debounce.schedule();
      this.pendingTextSaves.add(save);
      this.saves.markPending();
    });
    input.addEventListener("change", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
    });
  }

  private flushTextSaves(): void {
    for (const save of [...this.pendingTextSaves]) save();
    this.pendingTextSaves.clear();
  }

  private renderSaveStatus(state: SaveState): void {
    const el = this.notesStatusEl;
    if (!el) return;
    el.setText(SAVE_STATUS_TEXT[state]);
    el.title = SAVE_STATUS_TITLE;
    el.dataset["state"] = state;
  }

  private isOnMap(nx: number, ny: number): boolean {
    const region = this.plugin.getOrCreateMap(this.mapName);
    const { gridOffset, gridSize } = region;
    return (
      nx >= gridOffset.x &&
      nx < gridOffset.x + gridSize.cols &&
      ny >= gridOffset.y &&
      ny < gridOffset.y + gridSize.rows
    );
  }

  private renderNeighborWidget(
    container: HTMLElement,
    x: number,
    y: number,
  ): void {
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const stagger =
      this.plugin.getMap(this.mapName)?.staggerOffset
      ?? this.plugin.settings.staggerOffset
      ?? "odd";
    // notShifted = the hex sits on the non-staggered (un-shifted) row/col.
    const notShifted = (n: number) =>
      stagger === "odd" ? n % 2 === 0 : n % 2 !== 0;
    // First-wins on duplicate-named palette entries — matches HexMapView's
    // .find() behaviour so the neighbor preview agrees with the main grid.
    const paletteMap = new Map<string, TerrainColor>();
    for (const p of this.plugin.getMapPalette(this.mapName)) {
      if (!paletteMap.has(p.name)) paletteMap.set(p.name, p);
    }
    const widget = container.createDiv({ cls: "duckmage-neighbor-widget" });

    type NeighborDef = { l: number; t: number; nx: number; ny: number };
    const defs: NeighborDef[] = isFlat
      ? [
          { l: 22, t: 2, nx: x, ny: y - 1 }, // N
          { l: 42, t: 13, nx: x + 1, ny: notShifted(x) ? y - 1 : y }, // NE
          { l: 42, t: 32, nx: x + 1, ny: notShifted(x) ? y : y + 1 }, // SE
          { l: 22, t: 40, nx: x, ny: y + 1 }, // S
          { l: 2, t: 32, nx: x - 1, ny: notShifted(x) ? y : y + 1 }, // SW
          { l: 2, t: 13, nx: x - 1, ny: notShifted(x) ? y - 1 : y }, // NW
        ]
      : [
          { l: 10, t: 1, nx: notShifted(y) ? x - 1 : x, ny: y - 1 }, // NW
          { l: 34, t: 1, nx: notShifted(y) ? x : x + 1, ny: y - 1 }, // NE
          { l: 0, t: 18, nx: x - 1, ny: y }, // W
          { l: 44, t: 18, nx: x + 1, ny: y }, // E
          { l: 10, t: 35, nx: notShifted(y) ? x - 1 : x, ny: y + 1 }, // SW
          { l: 34, t: 35, nx: notShifted(y) ? x : x + 1, ny: y + 1 }, // SE
        ];

    // World maps' walking (regions of an overworld, new land next door);
    // undefined in a build without it.
    const wm = worldMaps();
    // Tiles were laid out at 16px; drawn at the toolbar flower's 22px (user test
    // 2026-10-12: too small to hit), so every offset scales with them.
    const S = PETAL_SIZE / 16;
    widget.setCssProps({
      "--duckmage-nb-w": `${Math.ceil(Math.max(...defs.map((d) => d.l)) * S + PETAL_SIZE)}px`,
      "--duckmage-nb-h": `${Math.ceil(Math.max(...defs.map((d) => d.t)) * S + PETAL_SIZE)}px`,
    });
    for (const { l, t, nx, ny } of defs) {
      const onMap = this.isOnMap(nx, ny);
      const tile = widget.createDiv({
        cls: `duckmage-neighbor-tile${onMap ? "" : " duckmage-neighbor-tile-offmap"}`,
      });
      tile.setCssProps({ left: `${(l * S).toFixed(1)}px`, top: `${(t * S).toFixed(1)}px` });

      if (onMap) {
        tile.title = `Hex ${nx}, ${ny}`;
        const nPath = this.plugin.hexPath(nx, ny, this.mapName);
        const terrain = getTerrainFromFile(this.app, nPath);
        const entry = terrain ? paletteMap.get(terrain) : undefined;
        if (entry) tile.setCssProps({ "--duckmage-bg": entry.color });
        tile.addEventListener("click", () => {
          this.x = nx;
          this.y = ny;
          this.options.onNavigate?.(nx, ny);
          void this.loadData().then(() => {
            this.dataPreloaded = true;
            this.onOpen();
            this.dataPreloaded = false;
          });
        });
      } else {
        // Past the edge: a neighbouring region's hex, if one sits there.
        const here = this.plugin.getMap(this.mapName);
        const across = here ? resolveHex(this.plugin.settings.maps, here, nx, ny) : null;
        if (across && across.map.name !== this.mapName) {
          const target = { map: across.map.name, x: across.x, y: across.y };
          tile.addClass("duckmage-neighbor-tile-region");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          tile.title = `${target.map}: hex ${target.x}, ${target.y}`;
          const t = getTerrainFromFile(this.app, this.plugin.hexPath(target.x, target.y, target.map));
          const color = t ? this.plugin.getMapPalette(target.map).find((p) => p.name === t)?.color : undefined;
          if (color) tile.setCssProps({ "--duckmage-bg": color });
          tile.addEventListener("click", () => {
            new RegionNavigateModal(this.app, this.plugin, target, () => {
              this.close();
              this.options.onCrossToRegion?.(target.map, target.x, target.y);
            }).open();
          });
        } else if (here && wm?.regionHome(this.plugin, this.mapName)) {
          // A region of an overworld: past the edge is the overworld hex
          // next door, with no region yet. Same walk as the map toolbar's
          // region flower (pick or roll its biome; Build and God only).
          const home = wm.regionHome(this.plugin, this.mapName)!;
          const [px, py] = wm.parentOf(home.layout, nx, ny);
          const bearing = flowerPetals(home.layout.orientation, home.layout.parentStagger, home.px, home.py)
            .find((p) => p.hex[0] === px && p.hex[1] === py)?.bearing ?? offMapSide(here, nx, ny);
          const lock = wm.walkLock(this.plugin, this.mapName, home.overworld.name);
          const b = neighbourButton(bearing, undefined, { canMake: true, canAdd: !lock, lockedHint: lock ?? "" });
          tile.addClass("duckmage-neighbor-tile-new");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          if (b.action.kind === "locked") tile.addClass("is-locked");
          tile.title = b.title;
          if (b.action.kind === "new") {
            tile.addEventListener("click", () => {
              // Edit region's new-region mode: preview, mix, reroll, then Create and go.
              const host = {
                app: this.app,
                plugin: this.plugin,
                enter: (name: string) => this.options.onCrossToRegion?.(name, nx, ny),
                changed: () => this.plugin.refreshHexMap(),
                openLocations: () => undefined,
              };
              new wm.EditRegionModal(host, home.overworld.name, px, py, {
                walk: { from: this.mapName, bearing },
                onCreated: (name) => {
                  this.close();
                  this.options.onCrossToRegion?.(name, nx, ny);
                },
              }).open();
            });
          }
        } else if (here && wm && neighbourSpec(this.plugin, this.mapName, offMapSide(here, nx, ny)).ok) {
          // Nothing there yet: walk into new land (pick or roll its biome).
          const side = offMapSide(here, nx, ny);
          tile.addClass("duckmage-neighbor-tile-new");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          tile.title = `New land to the ${side}…`;
          tile.addEventListener("click", () => {
            new wm.WalkRegionModal(this.app, this.plugin, this.mapName, side, () => {
              const now = this.plugin.getMap(this.mapName);
              const arrived = now ? resolveHex(this.plugin.settings.maps, now, nx, ny) : null;
              if (!arrived || arrived.map.name === this.mapName) return;
              this.close();
              this.options.onCrossToRegion?.(arrived.map.name, arrived.x, arrived.y);
            }).open();
          });
        } else {
          tile.title = "Off map";
        }
      }
    }

    // Centre dot: this hex. A click copies a link to it that a note can
    // use: it opens the map centred on this hex (src/hexLink.ts). Entering
    // the hex's region or locations is the Maps strip's job.
    const centre = widget.createEl("button", {
      cls: "duckmage-neighbor-centre duckmage-neighbor-centre--linked duckmage-neighbor-centre--copy",
      attr: { title: "Copy link to this hex (opens the map centred here)", "aria-label": "Copy link to this hex" },
    });
    // Flower centre at 16px scale: flat-top (30,30), pointy-top (30,26); the dot is 16×16.
    centre.setCssProps({ left: `${(30 * S - 8).toFixed(1)}px`, top: `${((isFlat ? 30 : 26) * S - 8).toFixed(1)}px` });
    const own = getTerrainFromFile(this.app, this.plugin.hexPath(x, y, this.mapName));
    const ownColor = own ? paletteMap.get(own)?.color : undefined;
    if (ownColor) centre.setCssProps({ "--duckmage-bg": ownColor });
    centre.addEventListener("click", () => this.copyHexLink());
  }

  /** "Copy link to this hex": a Markdown link that opens the map centred on it (src/hexLink.ts). */
  private copyHexLink(): void {
    copyHexLink(this.plugin, this.mapName, this.x, this.y);
  }

  /**
   * "Maps" strip: the hex's region chip first (accent outline), then a
   * chip per location (scrolls sideways), then "+" (new map, link existing,
   * manage locations). Hidden when the hex has no maps and the host can't
   * make any.
   */
  private renderMapsStrip(container: HTMLElement): void {
    const { regionMap, locations } = getHexMapsFromFile(this.app, this.plugin.hexPath(this.x, this.y, this.mapName));
    const locs = locations.filter((l) => l !== regionMap);
    if (!regionMap && !locs.length && !this.options.onNewChildMap) return;
    const strip = container.createDiv({ cls: "duckmage-maps-strip" });
    strip.createSpan({ cls: "duckmage-maps-strip-label", text: "Maps" });
    const chips = strip.createDiv({ cls: "duckmage-maps-strip-chips" });
    const chip = (name: string, kind: "region" | "location") => {
      const exists = !!this.plugin.getMap(name);
      const label = this.plugin.mapLabel(name);
      const c = chips.createEl("button", {
        cls: `duckmage-maps-chip duckmage-maps-chip--${kind}${exists ? "" : " is-missing"}`,
        text: label,
        attr: { title: exists ? `${kind === "region" ? "Region" : "Location"}: ${label}` : `No map named ${name}` },
      });
      c.disabled = !exists;
      c.addEventListener("click", () => {
        this.close();
        this.options.onSwitchMap?.(name);
      });
    };
    if (regionMap) chip(regionMap, "region");
    for (const l of locs) chip(l, "location");
    if (!regionMap && !locs.length) chips.createSpan({ cls: "duckmage-maps-strip-empty", text: "None yet" });
    if (!this.options.onNewChildMap) return;
    const add = strip.createEl("button", { cls: "duckmage-maps-chip-add", text: "+", attr: { "aria-label": "Add a map to this hex", title: "New map from this hex, link one, or manage locations" } });
    add.addEventListener("click", (e) => {
      const { x, y } = this;
      const menu = new ModeMenu(workModeOf(this.plugin.getMap(this.mapName)), this.modeMenuOptions());
      menu.add("editor.new-map", newMapItemTitle({ regionMap, locations: locs }), "plus", () => { this.close(); this.options.onNewChildMap?.(x, y); });
      if (this.options.onLinkExistingMap) {
        menu.add("editor.link-map", "Link existing map…", "link", () => { this.close(); this.options.onLinkExistingMap?.(x, y); });
      }
      if (locs.length && this.options.onManageLocations) {
        menu.add("editor.manage-locations", `Manage locations (${locs.length})…`, "list", () => { this.close(); this.options.onManageLocations?.(x, y); });
      }
      menu.showAtMouseEvent(e);
    });
  }

  /** Terrain header summary: swatch + current terrain name ("(base)" when
   *  the hex only shows the map's base terrain). Re-rendered on each pick. */
  private renderTerrainHeader(
    preview: HTMLElement,
    terrain: string | null,
    icon: string | null,
  ): void {
    preview.empty();
    const palette = this.plugin.getMapPalette(this.mapName);
    const base = this.plugin.getMap(this.mapName)?.baseTerrain;
    const name = terrain ?? base ?? null;
    const entry = name ? palette.find((p) => p.name === name) : undefined;
    const iconToShow = icon ?? entry?.icon;
    if (!entry && !iconToShow) {
      preview.createSpan({ text: "none", cls: "duckmage-terrain-header-name" });
      return;
    }
    const swatch = preview.createSpan({ cls: "duckmage-terrain-header-swatch" });
    if (entry) swatch.setCssProps({ "--duckmage-bg": entry.color });
    if (iconToShow) {
      const img = swatch.createEl("img");
      img.src = getIconUrl(this.plugin, iconToShow);
    }
    if (entry) {
      preview.createSpan({
        text: terrain === null ? `${entry.name} (base)` : entry.name,
        cls: "duckmage-terrain-header-name",
      });
    }
  }

  /**
   * One of the editor's main groups (Terrain, Notes, Linked notes, Icons):
   * the shared Fold (owner call O8), its open/closed state remembered in
   * the given settings flag (so collapsing Terrain once keeps it collapsed
   * on every hex, E5). The same flags are exposed in the settings tab.
   */
  private makeCollapsible(
    container: HTMLElement,
    label: string,
    flag:
      | "hexEditorTerrainCollapsed"
      | "hexEditorNotesCollapsed"
      | "hexEditorFeaturesCollapsed"
      | "hexEditorIconsCollapsed",
    startCollapsedOverride?: boolean,
    onToggle?: (open: boolean) => void,
  ): { body: HTMLElement; header: HTMLElement } {
    const startCollapsed = startCollapsedOverride ?? this.plugin.settings[flag] ?? false;
    // No device store: the settings flag is the remembered state.
    const fold = new Fold(container, {
      title: label,
      open: !startCollapsed,
      cls: "duckmage-editor-group",
      summaryCls: "duckmage-editor-group-header",
      bodyCls: "duckmage-editor-group-body",
      onToggle: (open) => {
        this.plugin.settings[flag] = !open;
        // Expanding Terrain is NOT remembered: on hexes with a terrain it opens
        // collapsed again (round 6; see terrainStartsCollapsed).
        void this.plugin.saveSettings();
        onToggle?.(open);
      },
    });
    return { body: fold.body, header: fold.summary };
  }

  private renderTerrainSection(
    container: HTMLElement,
    path: string,
    currentTerrain: string | null,
    onTerrainChange: () => void,
  ): void {
    const palette = this.plugin.getMapPalette(this.mapName);

    const section = container.createDiv({ cls: "duckmage-editor-section" });

    // Long palettes get the shared picker filter (added below the tiles);
    // the grid grows with the modal instead of scrolling in its own small
    // box (round 5: only the first two rows of a 50-terrain palette were
    // practically reachable).
    const grid = section.createDiv({ cls: "duckmage-terrain-picker duckmage-terrain-picker-grow" });

    // Picking a terrain keeps the editor open (E1): the map repaints via
    // onChanged, and the selection/header update in place here.
    let selectedTerrain = currentTerrain;
    const applyTerrain = async (terrain: string | null): Promise<void> => {
      if (terrain !== null) await this.ensureHexNote();
      if (!(await this.plugin.undoableEdit(this.mapName, () => setTerrainInFile(this.app, path, terrain)))) return;
      // The terrain's encounters table follows the terrain: show the swap.
      void this.plugin
        .syncHexEncounterTableLink(path, terrain)
        .then(() => this.reloadEncounterLinks(path));
      selectedTerrain = terrain;
      this.directTerrain = terrain;
      grid.querySelectorAll<HTMLElement>(".duckmage-terrain-option[data-terrain]").forEach((el) =>
        el.toggleClass("is-selected", el.dataset["terrain"] === terrain),
      );
      clearBtn.toggle(terrain !== null);
      onTerrainChange();
      this.onChanged(new Map([[path, terrain]]));
    };

    // Clear terrain — always first in the grid (hidden while there's none)
    const clearBtn = grid.createDiv({
      cls: "duckmage-terrain-option duckmage-terrain-option-clear",
      attr: { title: "Clear this hex's terrain" },
    });
    clearBtn.createDiv({
      cls: "duckmage-terrain-preview duckmage-terrain-preview-clear",
    });
    clearBtn.createSpan({
      text: "Clear",
      cls: "duckmage-terrain-option-name",
    });
    clearBtn.toggle(currentTerrain !== null);
    clearBtn.addEventListener("click", () => void this.saves.track(applyTerrain(null)));

    for (const entry of palette) {
      const btn = grid.createDiv({
        cls: `duckmage-terrain-option${entry.name === currentTerrain ? " is-selected" : ""}`,
        attr: { title: entry.name, "data-terrain": entry.name },
      });

      const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
      preview.setCssProps({ "--duckmage-bg": entry.color });

      if (entry.icon) {
        createIconEl(
          preview,
          getIconUrl(this.plugin, entry.icon),
          entry.name,
          entry.iconColor,
          "duckmage-terrain-preview-icon",
        );
      }

      btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });
      filterText(btn, entry.name, entry.type, entry.category);

      btn.addEventListener("click", () => {
        if (entry.name === selectedTerrain) return;
        void this.saves.track(applyTerrain(entry.name));
      });
    }

    const filter = addPickerFilter(grid, {
      things: "terrains",
      count: palette.length,
      cls: "duckmage-terrain-filter",
      // "Clear" only alongside the full list (and only when there's a terrain).
      onFilter: () => clearBtn.toggle(!filter.input?.value.trim() && selectedTerrain !== null),
    });
  }

  /** Icon override + (GM layer) game master icon pickers. */
  private renderIconSections(
    container: HTMLElement,
    path: string,
    currentIcon: string | null,
    currentGmIcons: string[],
    onIconChange: () => void,
  ): void {
    const section = container.createDiv({ cls: "duckmage-editor-section" });
    // Keep terrain in the overrides map so renderGrid doesn't lose it during
    // the brief window when Obsidian clears the metadata cache on file modify.
    const terrainOverrides = (): Map<string, string | null> | undefined =>
      this.directTerrain ? new Map([[path, this.directTerrain]]) : undefined;

    // Icon override palette
    const hidden = new Set(this.plugin.settings.hiddenIcons ?? []);
    const visibleIcons = this.plugin.availableIcons.filter((i) => !hidden.has(i));

    section.createEl("p", { text: "Icon override", cls: "duckmage-icon-inline-label" });
    this.renderIconGrid(
      section,
      visibleIcons,
      currentIcon,
      "— terrain default —",
      async (picked) => {
        await this.ensureHexNote();
        if (!(await this.plugin.undoableEdit(this.mapName, () => setIconOverrideInFile(this.app, path, picked)))) return;
        this.directIcon = picked;
        onIconChange(); // header shows the icon override
        this.onChanged(terrainOverrides(), new Map([[path, picked]]));
      },
    );

    // GM icon palette — only when GM layer is active. Multi-add model:
    // left-click an icon to add one, right-click to remove one. Tile shows
    // a "+N" badge when N>0. Special "— clear all —" tile wipes the list.
    if (this.options.gmLayerActive) {
      section.createEl("p", { text: "Game master icons", cls: "duckmage-icon-inline-label" });
      this.renderGmIconCountGrid(section, visibleIcons, currentGmIcons, path);
    }
  }

  /**
   * Multi-add GM icon picker. Local state is a copy of `initialCounts`
   * (the count of each icon name on this hex). Left-click increments,
   * right-click decrements (clamped at 0). Each change writes the full
   * list to frontmatter via `setGmIconsInFile`, which preserves order
   * — the user sees their additions in the order they made them on the
   * map render.
   */
  private renderGmIconCountGrid(
    container: HTMLElement,
    icons: string[],
    initialList: string[],
    path: string,
  ): void {
    // Working copy of the list (with duplicates) the user is editing.
    const list: string[] = [...initialList];
    const grid = container.createDiv({ cls: "duckmage-icon-picker duckmage-icon-picker-inline" });
    this.chainWheelToModal(grid);

    const countOf = (icon: string): number => list.filter((i) => i === icon).length;

    const persist = async (): Promise<void> => {
      await this.ensureHexNote();
      if (!(await this.plugin.undoableEdit(this.mapName, () => setGmIconsInFile(this.app, path, list)))) return;
      // Pass the new list directly via the overrides arg so the view
      // can update the hex's data-gm-icons attribute immediately
      // without round-tripping through the metadata cache (which lags
      // file writes by a tick — that race meant rapid multi-add
      // clicks could silently lose icons in the on-map render).
      this.onChanged(undefined, undefined, new Map([[path, [...list]]]));
    };

    const makeTile = (icon: string | null): HTMLElement => {
      const label = icon
        ? iconLabel(icon)
        : "— clear all —";
      const tile = grid.createDiv({ cls: "duckmage-icon-option" });
      tile.dataset["icon"] = icon ?? "";
      const preview = tile.createDiv({
        cls: `duckmage-icon-preview${!icon ? " duckmage-icon-preview-clear" : ""}`,
      });
      if (icon) {
        const img = preview.createEl("img", { cls: "duckmage-icon-preview-img" });
        img.src = getIconUrl(this.plugin, icon);
        img.alt = label;
      }
      tile.createSpan({ text: label, cls: "duckmage-icon-option-name" });

      // Count badge — created lazily on first non-zero count.
      const refreshBadge = (): void => {
        const c = icon ? countOf(icon) : 0;
        let badge = tile.querySelector<HTMLElement>(".duckmage-icon-count-badge");
        if (c > 0) {
          if (!badge) {
            badge = tile.createDiv({ cls: "duckmage-icon-count-badge" });
          }
          badge.setText(c > 1 ? `×${c}` : "✓");
          tile.addClass("is-selected");
        } else {
          badge?.remove();
          tile.removeClass("is-selected");
        }
      };
      refreshBadge();

      // Left-click: add (or clear-all for the special null tile).
      tile.addEventListener("click", () => {
        void (async () => {
          if (icon === null) {
            list.length = 0;
          } else {
            list.push(icon);
          }
          // Refresh ALL tiles' badges since clear-all resets every count.
          grid.querySelectorAll<HTMLElement>(".duckmage-icon-option").forEach((t) => {
            const ic = t.dataset["icon"] || null;
            const c = ic ? countOf(ic) : 0;
            let b = t.querySelector<HTMLElement>(".duckmage-icon-count-badge");
            if (c > 0) {
              if (!b) b = t.createDiv({ cls: "duckmage-icon-count-badge" });
              b.setText(c > 1 ? `×${c}` : "✓");
              t.addClass("is-selected");
            } else {
              b?.remove();
              t.removeClass("is-selected");
            }
          });
          await this.saves.track(persist());
        })();
      });

      // Right-click: remove one. No-op on the clear-all tile.
      tile.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (icon === null) return;
        const idx = list.lastIndexOf(icon);
        if (idx === -1) return;
        list.splice(idx, 1);
        refreshBadge();
        void this.saves.track(persist());
      });

      return tile;
    };

    makeTile(null);
    for (const icon of icons) makeTile(icon);
    this.addIconFilter(grid, this.plugin.vaultIconsSet);
  }

  private renderIconGrid(
    container: HTMLElement,
    icons: string[],
    current: string | null,
    noneLabel: string,
    onPick: (icon: string | null) => Promise<void>,
  ): void {
    let selected = current;
    const grid = container.createDiv({ cls: "duckmage-icon-picker duckmage-icon-picker-inline" });
    this.chainWheelToModal(grid);

    const makeTile = (icon: string | null) => {
      const label = icon
        ? iconLabel(icon)
        : noneLabel;
      const tile = grid.createDiv({
        cls: `duckmage-icon-option${selected === icon ? " is-selected" : ""}`,
      });
      const preview = tile.createDiv({
        cls: `duckmage-icon-preview${!icon ? " duckmage-icon-preview-clear" : ""}`,
      });
      if (icon) {
        const img = preview.createEl("img", { cls: "duckmage-icon-preview-img" });
        img.src = getIconUrl(this.plugin, icon);
        img.alt = label;
      }
      tile.createSpan({ text: label, cls: "duckmage-icon-option-name" });
      tile.addEventListener("click", () => {
        void (async () => {
          selected = icon;
          grid.querySelectorAll(".duckmage-icon-option").forEach((el) =>
            el.toggleClass("is-selected", (el as HTMLElement).dataset["icon"] === (icon ?? "")),
          );
          await this.saves.track(onPick(icon));
        })();
      });
      tile.dataset["icon"] = icon ?? "";
      return tile;
    };

    makeTile(null);
    for (const icon of icons) makeTile(icon);
    this.addIconFilter(grid, this.plugin.vaultIconsSet);
  }

  private getFilesForDropdown(folder: string): TFile[] {
    const normalized = normalizeFolder(folder);
    const all = this.app.vault.getMarkdownFiles();
    const scoped = normalized
      ? all.filter((f) => f.path.startsWith(normalized + "/"))
      : all;
    const filtered = scoped.filter((f) => this.plugin.isLinkableNote(f));
    return filtered.sort((a, b) => a.basename.localeCompare(b.basename));
  }

  private renderDropdownSection(
    container: HTMLElement,
    path: string,
    section: LinkSection,
    hexExists: boolean,
    sourceFolder: string,
    initialLinks: string[],
  ): (links: string[]) => void {
    // Each link field is its own boxed card, and its input names what it
    // links, so a field can't be read as belonging to the label above or
    // below it (a tester linked a dungeon as a Quest, E5).
    const sectionEl = container.createDiv({
      cls: "duckmage-editor-link-section duckmage-editor-link-card",
    });
    // Display words follow the map type (G4b: Settlements on a space map);
    // the note keeps its heading.
    const words = this.plugin.sectionWordsFor(this.mapName)(section);
    sectionEl.createEl("h4", {
      text: words.label,
      cls: "duckmage-link-section-title",
    });

    // ── Combo box ──────────────────────────────────────────────────────────
    const comboWrap = sectionEl.createDiv({ cls: "duckmage-link-combo" });
    const input = comboWrap.createEl("input", {
      type: "text",
      cls: "duckmage-link-combo-input",
      attr: { "aria-label": `Link ${words.label.toLowerCase()}` },
    });
    input.placeholder = `Search or create ${words.noun}…`;

    const arrowBtn = comboWrap.createEl("button", {
      text: "▾",
      cls: "duckmage-link-combo-arrow",
      title: "Show all",
    });
    const dropdown = comboWrap.createDiv({
      cls: "duckmage-link-combo-dropdown",
    });
    dropdown.hide();

    // ── Link list ──────────────────────────────────────────────────────────
    const linksEl = sectionEl.createDiv({ cls: "duckmage-link-list" });

    let currentLinks = hexExists ? [...initialLinks] : [];

    const onRemove = (link: string) => {
      currentLinks = currentLinks.filter((l) => l !== link);
      refresh();
      void this.saves.track(
        (async () => {
          // A noteless hex shows its terrain's table (which the new note
          // gets): make the note so removing it sticks.
          await this.ensureHexNote();
          await removeLinkFromSection(this.app, path, section, link);
          this.onChanged();
        })(),
      );
    };

    // "Show on map" (SF4): the section's icon as the hex's icon, in one click.
    const showEl = sectionEl.createDiv({ cls: "duckmage-link-show-on-map-row" });
    const renderShowOnMap = () => {
      showEl.empty();
      const offer = showOnMapOffer({
        icon: linkSectionIcon(this.plugin.settings, section),
        linkCount: currentLinks.length,
        hexIcon: this.directIcon,
        available: (i) => this.plugin.availableIcons.includes(i),
      });
      if (!offer || !canDo(this.mapName, "show-place-icon")) return;
      const btn = showEl.createEl("button", {
        cls: "duckmage-link-show-on-map",
        attr: { title: `Use the ${words.noun} icon as this hex's icon (change it in settings → Map look)` },
      });
      btn.createEl("img", { attr: { src: getIconUrl(this.plugin, offer), alt: "" } });
      btn.createSpan({ text: "Show on map" });
      btn.addEventListener("click", () => {
        btn.disabled = true;
        void this.showIconOnMap(path, offer).then(() => renderShowOnMap());
      });
    };

    const refresh = () => {
      linksEl.empty();
      this.renderLinkList(linksEl, currentLinks, path, onRemove);
      renderShowOnMap();
    };

    refresh();

    // ── Dropdown logic ─────────────────────────────────────────────────────
    let isOpen = false;

    const getFiltered = (query: string): TFile[] => {
      const files = this.getFilesForDropdown(sourceFolder);
      if (!query) return files;
      const q = query.toLowerCase();
      return files.filter((f) => f.basename.toLowerCase().includes(q));
    };

    const populateDropdown = (query: string) => {
      dropdown.empty();
      const trimmed = query.trim();
      const files = getFiltered(trimmed);

      if (files.length === 0 && !trimmed) {
        dropdown.createDiv({
          cls: "duckmage-link-combo-empty",
          text: "No files in folder",
        });
      }

      for (const file of files) {
        const item = dropdown.createDiv({ cls: "duckmage-link-combo-item" });
        item.textContent = file.basename;
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void selectFile(file);
        });
      }

      const exactMatch = files.some(
        (f) => f.basename.toLowerCase() === trimmed.toLowerCase(),
      );
      if (trimmed && !exactMatch) {
        const createItem = dropdown.createDiv({
          cls: "duckmage-link-combo-item duckmage-link-combo-create",
        });
        createItem.textContent = `+ Create "${trimmed}"`;
        createItem.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void createAndLink(trimmed);
        });
      }
      // Where new notes here come from, to edit (SX1: templates are yours).
      const template = linkNoteTemplatePathFor(this.plugin.settings, section);
      if (template) {
        const edit = dropdown.createDiv({ cls: "duckmage-link-combo-item duckmage-link-combo-template" });
        edit.textContent = `Edit the ${words.noun} template…`;
        edit.title = `New ${words.noun} notes start from ${template}`;
        edit.addEventListener("mousedown", (e) => {
          e.preventDefault();
          closeDropdown();
          void this.plugin.openNoteTemplate(template);
          this.close();
        });
      }
    };

    let anchor: { reposition: () => void; detach: () => void } | null = null;

    const openDropdown = () => {
      isOpen = true;
      populateDropdown(input.value);
      dropdown.show();
      // Anchor AFTER show so offsetHeight is measurable for above/below flip.
      anchor?.detach();
      anchor = this.anchorDropdown(comboWrap, dropdown);
    };

    const closeDropdown = () => {
      isOpen = false;
      dropdown.hide();
      anchor?.detach();
      anchor = null;
    };

    // Tracked so the title row shows "Saving…" → "✓ Saved".
    const selectFile = (file: TFile) => this.saves.track(selectFileNow(file));
    const createAndLink = (name: string) => this.saves.track(createAndLinkNow(name));

    const selectFileNow = async (file: TFile) => {
      closeDropdown();
      input.value = "";
      const hexFile = await this.ensureHexNote();
      if (!hexFile) {
        new Notice("Could not create hex note.");
        return;
      }
      const linkPath = this.app.metadataCache.fileToLinktext(file, path);
      currentLinks = [...currentLinks, linkPath];
      refresh();
      await addLinkToSection(this.app, path, section, `[[${linkPath}]]`);
      void addBacklinkToFile(this.app, file.path, path, this.plugin.hexLinkAlias(path));
      this.onChanged();
    };

    const createAndLinkNow = async (name: string) => {
      closeDropdown();
      input.value = "";
      const folder = normalizeFolder(sourceFolder);
      const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
      let file = this.app.vault.getAbstractFileByPath(newPath);
      if (!(file instanceof TFile)) {
        try {
          if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
          }
          // Each link section's notes start from its template (PA3, F17), tables from a table.
          // Places made here say where they are (a Location line, R3).
          file = await this.app.vault.create(newPath, await this.plugin.newLinkedNoteContent(section, name, path));
        } catch (err) {
          new Notice(`Could not create ${newPath}: ${String(err)}`);
          return;
        }
      }
      if (!(file instanceof TFile)) return;
      const hexFile = await this.ensureHexNote();
      if (!hexFile) {
        new Notice("Could not create hex note.");
        return;
      }
      const linkPath = this.app.metadataCache.fileToLinktext(file, path);
      currentLinks = [...currentLinks, linkPath];
      refresh();
      await addLinkToSection(this.app, path, section, `[[${linkPath}]]`);
      void addBacklinkToFile(this.app, file.path, path, this.plugin.hexLinkAlias(path));
      this.onChanged();
    };

    input.addEventListener("focus", () => openDropdown());
    input.addEventListener("blur", () =>
      window.setTimeout(() => closeDropdown(), 150),
    );
    input.addEventListener("input", () => {
      if (!isOpen) openDropdown();
      else {
        populateDropdown(input.value);
        anchor?.reposition();
      }
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDropdown();
        input.blur();
        return;
      }
      if (e.key === "Enter") {
        const trimmed = input.value.trim();
        if (!trimmed) return;
        const files = getFiltered(trimmed);
        const exact = files.find(
          (f) => f.basename.toLowerCase() === trimmed.toLowerCase(),
        );
        if (exact) void selectFile(exact);
        else if (files.length === 1) void selectFile(files[0]);
        else void createAndLink(trimmed);
      }
    });

    arrowBtn.addEventListener("mousedown", (e) => e.preventDefault());
    arrowBtn.addEventListener("click", () => {
      if (isOpen) closeDropdown();
      else {
        input.focus();
        openDropdown();
      }
    });

    return (links: string[]) => {
      currentLinks = [...links];
      refresh();
    };
  }

  /** "Show on map" (SF4): make `icon` this hex's icon (allowed wherever linking is). */
  private async showIconOnMap(path: string, icon: string): Promise<void> {
    if (!(await setIconOverrideInFile(this.app, path, icon, "show-place-icon"))) return;
    this.directIcon = icon;
    this.onChanged(undefined, new Map([[path, icon]]));
  }

  /**
   * Encounters: one section that lists the tables this hex can roll on
   * (hex > area > terrain) and switches between them (SF2).
   */
  private renderEncountersSection(container: HTMLElement, path: string): void {
    const encCard = container.createDiv({ cls: "duckmage-editor-link-section duckmage-editor-link-card duckmage-editor-encounters" });
    encCard.createEl("h4", { text: this.plugin.sectionWordsFor(this.mapName)("Encounters Table").label, cls: "duckmage-link-section-title" });
    this.renderTableChoice(encCard, path, "encounters");
  }

  /** Re-read the Encounters section after a terrain change (its terrain table follows the terrain). */
  private async reloadEncounterLinks(path: string): Promise<void> {
    await this.reloadKindLinks(path, TABLE_KINDS.encounters);
    this.choiceRefreshers.get("encounters")?.();
  }

  /** Re-read a kind's links from the hex note into allLinks. */
  private async reloadKindLinks(path: string, kind: TableKind): Promise<void> {
    this.hexExists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
    const links = this.hexExists ? await getLinksInSection(this.app, path, kind.hexSection) : [];
    this.allLinks.set(kind.hexSection.toLowerCase(), links);
  }

  /** The tables that apply to this hex for a kind, most specific first (tableChoice.ts). */
  private tableChoiceItems(path: string, kind: TableKind): TableChoiceItem[] {
    const tables = normalizeFolder(this.plugin.settings.tablesFolder ?? "");
    const inTables = (p: string) => (tables ? `${tables}/${p}` : p);
    const links = this.hexExists ? this.allLinks.get(kind.hexSection.toLowerCase()) ?? [] : [];
    const terrain = getTerrainFromFile(this.app, path);
    return tableChoices({
      noteExists: this.hexExists,
      noteLinks: links.map((link) => ({ link, path: this.app.metadataCache.getFirstLinkpathDest(link, path)?.path ?? null })),
      area: kind.areaTables ? this.plugin.areaEncounterTableFor(this.mapName, this.x, this.y)?.path : null,
      terrain: kind.terrainTables && terrain ? this.plugin.terrainEncounterTable(terrain)?.path : null,
      map: kind.mapField ? this.plugin.getMap(this.mapName)?.[kind.mapField]?.trim() || null : null,
      fallback: kind.starterFile ? inTables(kind.starterFile) : null,
      folders: { area: inTables("regions"), terrain: inTables("terrain") },
      exists: (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile,
    });
  }

  /**
   * A section's tables (SF2): the ones that apply to this hex as radio
   * buttons, most specific first, Roll, and "change…" to pick any table
   * (linked to this hex, so it's note text: allowed in Play). Switching is
   * remembered for this session and writes nothing.
   */
  private renderTableChoice(host: HTMLElement, path: string, kindId: TableKind["id"]): void {
    const kind = TABLE_KINDS[kindId];
    const key = choiceKey(this.mapName, this.x, this.y, kind.id);
    const first = this.tableChoiceItems(path, kind);
    const refresh = () => {
      const items = this.tableChoiceItems(path, kind);
      choice.setItems(items, initialChoice(items, rememberedChoice(key)));
    };
    const choice = new TableChoice(host, {
      app: this.app,
      plugin: this.plugin,
      noun: kind.noun,
      items: first,
      start: initialChoice(first, rememberedChoice(key)),
      onChoose: (item) => rememberChoice(key, item.path),
      onRoll: (item) => new RandomTableModal(this.app, this.plugin, undefined, item.path, this.rollTarget(kind.rollInto)).open(),
      onOpen: (item) => this.openTableInView(item.path),
      onChange: () =>
        this.pickTableFor(path, kind, (picked) => {
          rememberChoice(key, picked);
          refresh();
        }),
      onRemove: (item) => {
        if (!item.link) return;
        const link = item.link;
        void this.saves.track(
          (async () => {
            // A noteless hex shows the tables its note will get: make the
            // note so removing one sticks.
            await this.ensureHexNote();
            await removeLinkFromSection(this.app, path, kind.hexSection, link);
            await this.reloadKindLinks(path, kind);
            refresh();
            this.onChanged();
          })(),
        );
      },
    });
    this.choiceRefreshers.set(kind.id, refresh);
  }

  /**
   * "change…": any table in the tables folder, the user's own first (F2:
   * 124 terrain tables were listed before the user's), or a new one. A
   * table already listed for this hex is just chosen; another is linked
   * into the hex's section for the kind.
   */
  private pickTableFor(path: string, kind: TableKind, chosen: (tablePath: string) => void): void {
    const use = (file: TFile) =>
      void this.saves.track(
        (async () => {
          if (!this.tableChoiceItems(path, kind).some((it) => it.path === file.path)) {
            const note = await this.ensureHexNote();
            if (!note) throw new Error("Could not create the hex note");
            await addLinkToSection(this.app, path, kind.hexSection, `[[${this.app.metadataCache.fileToLinktext(file, path)}]]`);
            if (kind.id === "encounters") void addBacklinkToFile(this.app, file.path, path, this.plugin.hexLinkAlias(path));
            await this.reloadKindLinks(path, kind);
            this.onChanged();
          }
          chosen(file.path);
        })(),
      );
    const folder = contentFolder(this.plugin.settings, "tablesFolder");
    const create = (name: string) =>
      void (async () => {
        const dir = normalizeFolder(folder);
        const newPath = dir ? `${dir}/${name}.md` : `${name}.md`;
        let file = this.app.vault.getAbstractFileByPath(newPath);
        try {
          if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
          if (!(file instanceof TFile)) file = await this.app.vault.create(newPath, await this.plugin.newLinkedNoteContent("Encounters Table", name));
        } catch (err) {
          new Notice(`Could not create ${newPath}: ${String(err)}`);
          return;
        }
        if (file instanceof TFile) use(file);
      })();
    const picker = new FileLinkSuggestModal(this.app, this.plugin, use, folder, ["md"], "link", {
      order: (files) => {
        const shown = kind.id === "encounters"
          ? this.plugin.filterTableFiles(files, "encounter-filter", this.plugin.settings.encounterTableExcludedFolders)
          : files;
        const { own, mapMade } = groupTableFiles(this.app, shown);
        return [...own, ...mapMade];
      },
      onCreate: create,
      createNoun: "table",
    });
    picker.setPlaceholder(`Pick a ${kind.noun} table for this hex…`);
    picker.open();
  }

  /** Show a table in the random tables view. */
  private openTableInView(tablePath: string): void {
    void (async () => {
      interface WithOpenTable {
        openTable?(path: string): void;
      }
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
      if (leaves.length > 0) {
        void this.app.workspace.revealLeaf(leaves[0]);
        (leaves[0].view as unknown as WithOpenTable).openTable?.(tablePath);
      } else {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
        (leaf.view as unknown as WithOpenTable).openTable?.(tablePath);
      }
      this.close();
    })();
  }

  private renderLinkList(
    container: HTMLElement,
    links: string[],
    sourcePath: string,
    onRemove?: (link: string) => void,
  ): void {
    if (links.length === 0) {
      container.createSpan({ text: "None", cls: "duckmage-link-empty" });
    } else {
      for (const link of links) {
        const item = container.createDiv({ cls: "duckmage-link-item" });
        // The note's name, with the full link on hover (round 6 U2).
        const label = item.createSpan({
          text: linkDisplayName(link),
          cls: "duckmage-link-item-label",
          attr: { title: `[[${link}]]` },
        });
        const file = this.app.metadataCache.getFirstLinkpathDest(
          link,
          sourcePath,
        );
        // A link to a note that isn't there: say how to make missing tables.
        if (!(file instanceof TFile)) label.setAttr("title", withRepairHint(`[[${link}]]: no such note.`));
        if (file instanceof TFile) {
          label.addClass("duckmage-link-item-clickable");
          label.addEventListener("click", () => {
            void openNoteFocused(this.app, file);
            this.close();
          });
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
      cls: `duckmage-editor-text-section duckmage-editor-text-section-${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    });
    const labelRow = sectionEl.createDiv({
      cls: "duckmage-text-section-label-row",
    });
    // label for= → clicking the label focuses the box.
    const labelEl = labelRow.createEl("label", {
      text: label,
      cls: "duckmage-text-section-label",
      attr: { for: `duckmage-hex-text-${section}-${++textFieldSeq}` },
    });

    // 📖 button: terrain description table (description section) or section-specific table
    const tablesFolder = normalizeFolder(
      this.plugin.settings.tablesFolder ?? "",
    );
    let previewTablePath: string | null = null;
    let previewTitle = "";

    if (section === "description") {
      const terrain = getTerrainFromFile(this.app, path);
      if (terrain) {
        const p = tablesFolder
          ? `${tablesFolder}/terrain/description/${terrain}.md`
          : `terrain/description/${terrain}.md`;
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

    const textarea = sectionEl.createEl("textarea", {
      cls: "duckmage-text-section-textarea",
      attr: { id: labelEl.htmlFor },
    });

    if (previewTablePath) {
      const btnGroup = labelRow.createDiv({
        cls: "duckmage-text-section-btn-group",
      });
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
          this.rollTarget(section),
        ).open();
      });
    } else if (isRolledSection(section)) {
      // One table section per kind (SF2): its tables, Roll and change….
      const host = sectionEl.createDiv({ cls: "duckmage-editor-rolled-choice" });
      textarea.before(host);
      this.renderTableChoice(host, path, section);
    }
    textarea.rows = 3;
    textarea.placeholder = `${label}…`;
    textarea.value = initialContent;

    // Autosave: a moment after typing stops, on blur, and on close or
    // navigation (flushTextSaves). The hex is captured now, so a save that
    // lands after navigating still goes to this hex. Unchanged text isn't
    // written (just focusing a box no longer creates the hex note).
    const hx = this.x;
    const hy = this.y;
    let lastSaved = initialContent;
    let timer: number | null = null;
    const save = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      this.pendingTextSaves.delete(save);
      const value = textarea.value;
      if (value === lastSaved) {
        this.saves.settle();
        return;
      }
      lastSaved = value;
      void this.saves.track(
        (async () => {
          const file = await this.ensureHexNote(hx, hy);
          if (!file) throw new Error(`Could not create the note for hex ${hx}, ${hy}`);
          await setSectionContent(this.app, path, section, value);
        })(),
      );
    };
    textarea.addEventListener("input", () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(save, TEXT_AUTOSAVE_MS);
      this.pendingTextSaves.add(save);
      this.saves.markPending();
    });
    textarea.addEventListener("blur", save);
    // "Add to this hex" from a roll lands in this box (and saves), so the
    // box and the note can't disagree.
    this.textBoxes.set(section, (addition) => {
      textarea.value = joinSectionText(textarea.value, addition);
      save();
      this.onChanged();
    });
    // Keep the autosave status beside the box being typed in.
    textarea.addEventListener("focus", () => {
      const status = this.notesStatusEl;
      if (status && status.parentElement !== labelRow) labelEl.after(status);
    });
  }

  /** "Run workflow" (PA2): pick a workflow note, then run it for this hex. */
  private pickWorkflow(): void {
    // Workflows only: a blank setting is the workflows folder's usual place, never the world folder.
    const picker = new FileLinkSuggestModal(
      this.app,
      this.plugin,
      (file) => new WorkflowWizardModal(this.app, this.plugin, file, this.rollTarget("description")).open(),
      contentFolder(this.plugin.settings, "workflowsFolder"),
      ["md"],
    );
    picker.setPlaceholder("Pick a workflow to run…");
    picker.open();
  }

  /**
   * "Add to this hex" for a roll made here (P2): the play log, then every
   * text section. `defaultSection` is picked first, except in Play, where
   * the play log is (SF3: what happened goes to the log, not Description).
   */
  private rollTarget(defaultSection: string): RollHexTarget {
    const hx = this.x;
    const hy = this.y;
    // The hex's terrain and its type: When context for the roll (hexRoll.ts).
    const terrain = getTerrainFromFile(this.app, this.plugin.hexPath(hx, hy, this.mapName)) ?? undefined;
    const entry = terrain ? this.plugin.getMapPalette(this.mapName).find((t) => t.name === terrain) : undefined;
    const type = entry ? effectiveTerrainType(entry) : undefined;
    return {
      label: `hex ${hx}, ${hy}`,
      context: { ...(terrain ? { terrain } : {}), ...(type ? { type } : {}) },
      sections: [{ key: PLAY_LOG_TARGET, label: "Play log" }, ...TEXT_SECTIONS, ...ROLLED_TEXT_SECTIONS],
      defaultSection: rollDefaultSection(workModeOf(this.plugin.getMap(this.mapName)), defaultSection),
      add: async (key, text) => {
        if (key === PLAY_LOG_TARGET) { await addToPlayLog(this.plugin, this.mapName, hx, hy, text); return; }
        // Still on this hex with the box showing: add through the box.
        const box = hx === this.x && hy === this.y ? this.textBoxes.get(key) : undefined;
        if (box) { box(text); return; }
        await this.plugin.appendToHexSection(hx, hy, this.mapName, key, text);
        if (hx === this.x && hy === this.y) this.allText.set(key, joinSectionText(this.allText.get(key) ?? "", text));
        this.onChanged();
      },
    };
  }

  private async ensureHexNote(x = this.x, y = this.y): Promise<TFile | null> {
    const path = this.plugin.hexPath(x, y, this.mapName);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    // (x, y), not this.x/this.y: a save that lands after navigating to a
    // neighbour must create the note of the hex it was typed into.
    return this.plugin.createHexNote(x, y, this.mapName);
  }
}
