import { effectiveTerrainType } from "../terrainTypes";
import { App, Notice, TFile } from "obsidian";
import { canDo } from "../modeGate";
import { lockedHint, workModeOf, type ModeAction } from "../workMode";
import { addGodOffer } from "./godOffer";
import { HexmakerModal } from "../HexmakerModal";
import { Fold } from "../ui/disclosure";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  normalizeFolder,
} from "../utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  getGmIconsFromFile,
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
import type { LinkSection, HexEditorOptions } from "../types";
import { RandomTableModal, type RollHexTarget } from "../random-tables/RandomTableModal";
import { WorkflowWizardModal } from "../random-tables/WorkflowWizardModal";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import { isRolledSection } from "../regionTables";
import { TABLE_KINDS, choiceKey, initialChoice, rememberChoice, rememberedChoice, tableChoices, type TableChoiceItem, type TableKind } from "../tableChoice";
import { TableChoice } from "../random-tables/TableChoice";
import { groupTableFiles } from "../random-tables/tablePickerGroups";
import { HexExportModal } from "./HexExportModal";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { AUTOSAVE_MS, DebouncedSave, SAVE_STATUS_TEXT, SAVE_STATUS_TITLE, SaveTracker, type SaveState } from "./saveStatus";
import { openNoteFocused } from "../openNote";
import { contentFolder } from "../notePickers";
import { terrainStartsCollapsed } from "./terrainSection";
import { addToPlayLog } from "../play/playLogWriter";
import { PLAY_LOG_TARGET, rollDefaultSection } from "../play/playLog";
import { PlayLogModal } from "../play/PlayLogModal";
import { NeighbourFlower, type NeighbourFlowerHost } from "./editor/NeighbourFlower";
import { MapsStrip, type MapsStripHost } from "./editor/MapsStrip";
import { TerrainIconSections, type TerrainIconHost } from "./editor/TerrainIconSections";
import { LinkSections, type LinkSectionHost } from "./editor/LinkSection";

/** Typing pause after which a text section autosaves. */
const TEXT_AUTOSAVE_MS = AUTOSAVE_MS;
/** Unique ids for label for= ↔ textarea pairs. */
let textFieldSeq = 0;

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
  /** What the editor's parts (src/hex-map/editor/) read and call: live, never a copy. */
  private readonly host = this.makeHost();
  private readonly flower = new NeighbourFlower(this.host);
  private readonly mapsStrip = new MapsStrip(this.host);
  private readonly terrainIcons = new TerrainIconSections(this.host);
  private readonly links = new LinkSections(this.host);

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

  /** The one host object every part gets (each part types it to the slice it uses). */
  private makeHost(): NeighbourFlowerHost & MapsStripHost & TerrainIconHost & LinkSectionHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getters below read the editor's live fields
    const modal = this;
    return {
      get app() { return modal.app; },
      get plugin() { return modal.plugin; },
      get x() { return modal.x; },
      get y() { return modal.y; },
      get mapName() { return modal.mapName; },
      get options() { return modal.options; },
      get saves() { return modal.saves; },
      get directTerrain() { return modal.directTerrain; },
      set directTerrain(v) { modal.directTerrain = v; },
      get directIcon() { return modal.directIcon; },
      set directIcon(v) { modal.directIcon = v; },
      onChanged: (...args) => this.onChanged(...args),
      ensureHexNote: (x, y) => this.ensureHexNote(x, y),
      reloadEncounterLinks: (path) => this.reloadEncounterLinks(path),
      chainWheelToModal: (inner) => this.chainWheelToModal(inner),
      addIconFilter: (grid, vaultIcons) => this.addIconFilter(grid, vaultIcons),
      anchorDropdown: (anchorEl, dropdownEl) => this.anchorDropdown(anchorEl, dropdownEl),
      navigate: (nx, ny) => this.navigate(nx, ny),
      close: () => this.close(),
      rerender: () => this.onOpen(),
    };
  }

  /** Move to hex (nx, ny) of this map: read it first, then redraw with no Loading frame. */
  private navigate(nx: number, ny: number): void {
    this.x = nx;
    this.y = ny;
    this.options.onNavigate?.(nx, ny);
    void this.loadData().then(() => {
      this.dataPreloaded = true;
      this.onOpen();
      this.dataPreloaded = false;
    });
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
    this.flower.renderNeighborWidget(titleRow, this.x, this.y);
    this.renderNameField(contentEl, path);
    this.mapsStrip.renderMapsStrip(contentEl);

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

  /** Terrain header summary (editor/TerrainIconSections.ts). */
  private renderTerrainHeader(preview: HTMLElement, terrain: string | null, icon: string | null): void {
    this.terrainIcons.renderTerrainHeader(preview, terrain, icon);
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

  /** The terrain palette grid (editor/TerrainIconSections.ts). */
  private renderTerrainSection(container: HTMLElement, path: string, currentTerrain: string | null, onTerrainChange: () => void): void {
    this.terrainIcons.renderTerrainSection(container, path, currentTerrain, onTerrainChange);
  }

  /** Icon override + GM icon pickers (editor/TerrainIconSections.ts). */
  private renderIconSections(container: HTMLElement, path: string, currentIcon: string | null, currentGmIcons: string[], onIconChange: () => void): void {
    this.terrainIcons.renderIconSections(container, path, currentIcon, currentGmIcons, onIconChange);
  }

  /** A link section (editor/LinkSection.ts); returns its links setter. */
  private renderDropdownSection(
    container: HTMLElement,
    path: string,
    section: LinkSection,
    hexExists: boolean,
    sourceFolder: string,
    initialLinks: string[],
  ): (links: string[]) => void {
    return this.links.renderDropdownSection(container, path, section, hexExists, sourceFolder, initialLinks);
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
