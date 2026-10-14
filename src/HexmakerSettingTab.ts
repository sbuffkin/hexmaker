import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_NAME_FONT, NAME_FAMILIES, NAME_SIZES, NAME_STYLES, nameStyleId, resolveNameFont, type HexNameSize } from "./hex-map/hexNameFont";
import type HexmakerPlugin from "./HexmakerPlugin";
import { normalizeFolder } from "./utils";
import { AddPaletteModal } from "./palettes/AddPaletteModal";
import { repointPaletteName } from "./palettes/paletteOptions";
import { MAP_KINDS, enabledKinds, type MapKind } from "./mapKinds";
import { moduleFolderSettings } from "./modules/runtime";
import { ConfirmModal } from "./worldgen/ConfirmModal";
import { disclosureOpen, setDisclosureOpen, subSectionKey } from "./ui/disclosure";
import { layerOf, partitionSections } from "./ui/placement";
import { GENERATE_WORLD_DATA_NAME } from "./ui/repairHint";
import { noteTemplateEntries } from "./noteTemplates";
import { renderLabeledSlider } from "./ui/sliders";
import {
  DEBUG_CONFIRM_TEXT,
  debugModeConfirmed,
  isDebugMode,
  markDebugModeConfirmed,
  onDebugModeChange,
  setDebugMode,
} from "./ui/debugMode";

/** The settings tab's surface id (placement ids are `Settings.<control>`). */
const SURFACE = "Settings";

/** The order of the Advanced dropdown's sub-sections (src/ui/placement.ts names them). */
const SUB_SECTION_ORDER = ["Folders", "New map sizes", "Palettes"];

/** The Advanced dropdown row's description. */
const ADVANCED_DESC = "Folder layout and other options most people never change.";

/** The debug-mode switch's description. */
const DEBUG_MODE_DESC =
  "Show backend controls (storage folders, maintenance commands) in a Debug section inside each Advanced dropdown. On this device only.";

/** Size names in the settings dropdowns. */
const NAME_SIZE_TEXT: Record<HexNameSize, string> = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };

const PALETTES_FOLDER_DESC =
  "Vault-relative folder for terrain palette notes (one note per palette — edit as text, copy between vaults to share). Defaults to a palettes folder inside the world folder.";

// ---------------------------------------------------------------------------
// Obsidian 1.13 declarative settings API — local structural types.
//
// The installed `obsidian` typings (1.12.0) predate getSettingDefinitions().
// These minimal interfaces mirror the documented shapes in
// obsidianmd/obsidian-api master `obsidian.d.ts` (SettingDefinitionItem,
// SettingDefinition*, SettingControl*, all tagged `@since 1.13.0`). They are
// structural stand-ins only: on Obsidian >= 1.13 the app consumes the
// returned objects and renders the tab declaratively (display() is then never
// called); on older versions the method is simply never invoked and the
// imperative display() fallback is used instead. Delete these when the
// `obsidian` package is bumped to >= 1.13.0.
// ---------------------------------------------------------------------------

type LocalSettingControl =
  | { type: "toggle"; key: string; defaultValue?: boolean }
  | {
      type: "dropdown";
      key: string;
      options: Record<string, string>;
      defaultValue?: string;
    }
  | { type: "text"; key: string; placeholder?: string; defaultValue?: string }
  | {
      type: "number";
      key: string;
      placeholder?: string;
      min?: number;
      max?: number;
      step?: number | "any";
      defaultValue?: number;
    }
  | {
      type: "slider";
      key: string;
      min: number;
      max: number;
      step: number;
      /** @since 1.13.1 — formats the inline value next to the slider. */
      displayFormat?: (value: number) => string;
      defaultValue?: number;
    }
  | { type: "color"; key: string; defaultValue?: string };

interface LocalSettingDefinition {
  /** Display name — used for rendering and search. */
  name: string;
  /** Description text. Used for rendering and search. */
  desc?: string | DocumentFragment;
  /** Additional search terms. */
  aliases?: string[];
  /** `false` excludes the item from settings search. Default: true. */
  searchable?: boolean | (() => boolean);
  /** `false` hides the item (and excludes it from search). Default: true. */
  visible?: boolean | (() => boolean);
  /** Bound control; value flows through get/setControlValue(key). */
  control?: LocalSettingControl;
  /** Imperative escape hatch — renders the row onto the provided Setting. */
  render?: (setting: Setting, group?: unknown) => void | (() => void);
  /** Clickable action row. */
  action?: (el: HTMLElement, index: number) => void;
}

interface LocalSettingGroup {
  type: "group" | "list";
  heading?: string;
  cls?: string;
  items?: LocalSettingDefinition[];
  visible?: boolean | (() => boolean);
}

interface LocalSettingList extends LocalSettingGroup {
  type: "list";
  emptyState?: string | DocumentFragment;
  onReorder?: (oldIndex: number, newIndex: number) => void;
  onDelete?: (index: number) => void;
  addItem?: { name: string; action: (el: HTMLElement) => void };
}

type LocalSettingDefinitionItem =
  | LocalSettingDefinition
  | LocalSettingGroup
  | LocalSettingList;

/** The Templates folder setting's description. */
const TEMPLATES_FOLDER_DESC =
  "Vault-relative folder for the plugin's note templates: the hex template (unless Template path points elsewhere) and one per kind of linked note (town.md, dungeon.md, feature.md, quest.md, faction.md). Edit them there; new notes use them. Blank = \"templates\" in the world folder. Workflow templates stay with their workflows.";

/** "Add default palettes": deleted palettes stay deleted until asked. */
const ADD_DEFAULTS_DESC = "Put the built-in palettes back. Palettes you delete stay deleted; they only come back from here.";

/** The palette list row's description. */
const PALETTE_LIST_DESC = "Rename a palette in place, edit its terrains, or delete it (not while a map uses it).";

/** The "Palette for new maps" setting's description. */
const DEFAULT_PALETTE_DESC =
  "The palette a new map starts on. First palette = the first one listed below (overland before space).";

/** Settings keys holding vault paths that must be run through normalizeFolder. */
const FOLDER_PATH_KEYS = new Set<string>([
  "templatePath",
  "iconsFolder",
  "worldFolder",
  "hexFolder",
  "townsFolder",
  "dungeonsFolder",
  "questsFolder",
  "featuresFolder",
  "factionsFolder",
  "regionsFolder",
  "tablesFolder",
  "workflowsFolder",
  "templatesFolder",
  "palettesFolder",
]);

/** A folder-path key: the core's, or a module's folder setting (Space: World types folder). */
const isFolderPathKey = (key: string): boolean =>
  FOLDER_PATH_KEYS.has(key) || moduleFolderSettings().some((d) => d.key === key);

/** Settings keys whose change should re-render open hex map views. */
const MAP_REFRESH_KEYS = new Set<string>([
  "coordPlacement",
  "coordFontSize",
  "coordFontFamily",
  "coordFontColor",
  "hexGap",
  "hexNameFont",
  "hexNameSize",
  "hexNameStyle",
]);

/** Settings keys that must be persisted as positive integers. */
const POSITIVE_INT_KEYS = new Set<string>([
  "defaultNewMapCols",
  "defaultNewMapRows",
  "defaultSubmapCols",
  "defaultSubmapRows",
]);

/** A setting row with its placement id (`Settings.<control>`, src/ui/placement.ts). */
type Tagged = { id: string; item: LocalSettingDefinition };

/** A titled block of the page; its rows' placements decide which stay in it. */
type Section = { heading?: string; cls?: string; items: Tagged[] };

export class HexmakerSettingTab extends PluginSettingTab {
  plugin: HexmakerPlugin;

  /** Redraws rows that list the palettes (the list, the dropdowns), pruned once gone. */
  private paletteRefreshers = new Set<{ el: HTMLElement; redraw: () => void }>();

  constructor(app: App, plugin: HexmakerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Pre-1.13 fallback. On Obsidian >= 1.13 this is never called, because
   * getSettingDefinitions() returns a non-empty array and the tab is
   * rendered declaratively from it. Here the SAME definitions are drawn
   * imperatively (renderDefinitions), so both paths have the same rows in
   * the same order and one placement entry places both.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.renderDefinitions(containerEl, this.getSettingDefinitions());
  }

  /**
   * Obsidian 1.13+ declarative settings API (and, drawn by display(), the
   * pre-1.13 page). Returning a non-empty array makes the tab render from
   * these definitions and makes every setting appear in Obsidian's
   * settings search.
   *
   * The page, top to bottom: the simple, common settings (palettes, how the
   * map looks, defaults), then the ones most people set once (setup, map
   * types), then the collapsed Advanced dropdown (with its sub-sections and,
   * in debug mode, Debug), then the debug-mode switch. Which rows go in
   * Advanced or Debug is the placement map's call, by row id.
   */
  getSettingDefinitions(): LocalSettingDefinitionItem[] {
    const folderText = (name: string, key: string, placeholder: string, desc: string): LocalSettingDefinition => ({
      name,
      desc,
      control: { type: "text", key, placeholder },
    });
    const T = (id: string, item: LocalSettingDefinition): Tagged => ({ id, item });

    const mapOptions: Record<string, string> = {};
    for (const r of this.plugin.settings.maps) mapOptions[r.name] = r.name;

    const sections: Section[] = [
      // ── Simple: palettes (customisation is not "advanced"), look, defaults ──
      {
        heading: "Terrain palettes",
        items: [
          T("Settings.defaultPalette", {
            name: "Palette for new maps",
            desc: DEFAULT_PALETTE_DESC,
            aliases: ["palette", "default palette"],
            render: (setting: Setting) => this.renderDefaultPalette(setting),
          }),
          T("Settings.paletteList", {
            name: "Your palettes",
            desc: PALETTE_LIST_DESC,
            aliases: ["palettes", "rename palette", "delete palette", "add palette"],
            render: (setting: Setting) => this.renderPaletteList(setting),
          }),
          T("Settings.addDefaultPalettes", {
            name: "Add default palettes",
            desc: ADD_DEFAULTS_DESC,
            visible: () => this.plugin.missingDefaultPalettes().length > 0,
            render: (setting: Setting) => {
              setting.addButton((b) =>
                b.setButtonText(`Add ${this.plugin.missingDefaultPalettes().join(" and ")}`).onClick(() => {
                  void this.plugin.addDefaultPalettes().then(() => {
                    this.redrawPalettes();
                    this.refresh();
                  });
                }),
              );
            },
          }),
          T("Settings.paletteRowOpenNote", {
            name: "Open a palette's note",
            desc: "Each palette is a note you can edit as text, or copy to another vault.",
            render: (setting: Setting) => this.renderOpenPaletteNote(setting),
          }),
        ],
      },
      {
        heading: "Map look",
        items: [
          T("Settings.staggerOffset", {
            name: "Stagger offset",
            desc: "Which set of columns (flat-top) or rows (pointy-top) is offset by half a hex. Affects how new maps render unless overridden per-map.",
            render: (setting: Setting) => {
              let val: "odd" | "even" = this.plugin.settings.staggerOffset ?? "odd";
              const btn = setting.controlEl.createEl("button", { cls: "duckmage-stagger-toggle" });
              btn.setText(val === "odd" ? "Odd" : "Even");
              btn.toggleClass("is-even", val === "even");
              btn.addEventListener("click", () => {
                val = val === "odd" ? "even" : "odd";
                btn.setText(val === "odd" ? "Odd" : "Even");
                btn.toggleClass("is-even", val === "even");
                this.plugin.settings.staggerOffset = val;
                void this.plugin.saveSettings();
              });
            },
          }),
          T("Settings.coordPlacement", {
            name: "Coordinate placement",
            desc: "Where the coordinate label sits inside each hex. Move to top or bottom to keep it from clashing with a centered terrain icon.",
            control: { type: "dropdown", key: "coordPlacement", options: { top: "Top", middle: "Middle", bottom: "Bottom" }, defaultValue: "bottom" },
          }),
          T("Settings.coordFontSize", {
            name: "Coordinate label size",
            desc: "Size of the coordinate label, relative to the hex.",
            control: { type: "slider", key: "coordFontSize", min: 0.5, max: 1.5, step: 0.05, displayFormat: (value) => value.toFixed(2), defaultValue: 0.8 },
          }),
          T("Settings.coordFontFamily", {
            name: "Coordinate label font",
            desc: "Font used for the coordinate label.",
            control: { type: "dropdown", key: "coordFontFamily", options: { interface: "Interface", serif: "Serif", monospace: "Monospace" }, defaultValue: "interface" },
          }),
          T("Settings.coordFontColor", {
            name: "Coordinate label color",
            desc: "Color of the coordinate label.",
            control: { type: "color", key: "coordFontColor", defaultValue: "#ffffff" },
          }),
          T("Settings.hexNameFont", {
            name: "Hex name font",
            desc: "Default font for hex names on maps and in PNG exports. Each map can pick its own in the layers menu.",
            control: { type: "dropdown", key: "hexNameFont", options: Object.fromEntries(NAME_FAMILIES.map((f) => [f.id, f.label])), defaultValue: DEFAULT_NAME_FONT.family },
          }),
          T("Settings.hexNameSize", {
            name: "Hex name size",
            desc: "Default size for hex names. Names never get smaller than readable on screen.",
            control: { type: "dropdown", key: "hexNameSize", options: Object.fromEntries(NAME_SIZES.map((s) => [s.id, NAME_SIZE_TEXT[s.id]])), defaultValue: "medium" },
          }),
          T("Settings.hexNameStyle", {
            name: "Hex name style",
            desc: "Default weight and slant for hex names.",
            control: { type: "dropdown", key: "hexNameStyle", options: Object.fromEntries(NAME_STYLES.map((s) => [s.id, s.label])), defaultValue: "bold" },
          }),
          T("Settings.hexGap", {
            name: "Hex cell spacing",
            desc: "Gap between hex cells (0 – 0.5 em).",
            control: { type: "slider", key: "hexGap", min: 0, max: 0.5, step: 0.01, displayFormat: (value) => value.toFixed(2), defaultValue: 0.15 },
          }),
        ],
      },
      {
        heading: "Defaults",
        items: [
          T("Settings.defaultTableDice", {
            name: "Default die for new tables",
            desc: "Die size used when creating new random table notes (d6, d20, d100, etc.).",
            aliases: ["dice"],
            control: {
              type: "dropdown",
              key: "defaultTableDice",
              options: { "4": "D4", "6": "D6", "8": "D8", "10": "D10", "12": "D12", "20": "D20", "100": "D100", "200": "D200", "500": "D500", "1000": "D1000" },
              defaultValue: "100",
            },
          }),
          T("Settings.collapseSections", {
            name: "Hex editor sections start collapsed",
            desc: "Choose which sections open collapsed by default in the right-click hex editor.",
            aliases: ["terrain", "features", "notes", "collapse"],
            render: (setting: Setting) => this.buildCollapseTogglesRow(setting),
          }),
          T("Settings.hexOrientation", {
            name: "Hex orientation",
            desc: "Pointy-top: points face north/south, flat sides east/west. Flat-top: flat sides face north/south, points east/west.",
            control: { type: "dropdown", key: "hexOrientation", options: { pointy: "Pointy-top", flat: "Flat-top" }, defaultValue: "pointy" },
          }),
          T("Settings.defaultMap", {
            name: "Default map",
            desc: "The map opened when the hex map is launched.",
            control: { type: "dropdown", key: "defaultMap", options: mapOptions, defaultValue: this.plugin.settings.maps[0]?.name ?? "" },
          }),
          T("Settings.defaultNewMapCols", {
            name: "Default new map columns",
            desc: "Default number of columns when creating a new top-level map.",
            control: { type: "number", key: "defaultNewMapCols", placeholder: "Cols", min: 1, step: 1, defaultValue: 20 },
          }),
          T("Settings.defaultNewMapRows", {
            name: "Default new map rows",
            desc: "Default number of rows when creating a new top-level map.",
            control: { type: "number", key: "defaultNewMapRows", placeholder: "Rows", min: 1, step: 1, defaultValue: 16 },
          }),
          T("Settings.defaultSubmapCols", {
            name: "Default submap columns",
            desc: "Default number of columns when creating a new submap.",
            control: { type: "number", key: "defaultSubmapCols", placeholder: "Cols", min: 1, step: 1, defaultValue: 10 },
          }),
          T("Settings.defaultSubmapRows", {
            name: "Default submap rows",
            desc: "Default number of rows when creating a new submap.",
            control: { type: "number", key: "defaultSubmapRows", placeholder: "Rows", min: 1, step: 1, defaultValue: 10 },
          }),
        ],
      },
      // ── Set once: setup, where things live, map types ──
      {
        heading: "Setup",
        items: [
          T("Settings.rerunSetupWizard", {
            name: "Setup wizard",
            desc: "Re-open the setup wizard to reconfigure folders or create a new map.",
            render: (setting: Setting) => {
              setting.addButton((btn) =>
                btn.setButtonText("Re-run setup wizard").onClick(() => {
                  this.plugin.settings.setupDismissed = false;
                  void this.plugin.saveSettings().then(() => this.plugin.openSetupWizard());
                }),
              );
            },
          }),
          T("Settings.worldFolder", folderText("World notes folder", "worldFolder", "World.", "Vault-relative path. Scopes the file search when adding links to hexes.")),
          // SX1: the starter templates are yours to change; easy to find here.
          T("Settings.noteTemplates", {
            name: "Note templates",
            desc: "New notes start from these. Open one to change what new notes get. They live in the templates folder.",
            aliases: ["templates", "template", "town template", "hex template"],
            render: (setting: Setting) => {
              for (const t of noteTemplateEntries(this.plugin.settings)) {
                setting.addButton((btn) =>
                  btn
                    .setButtonText(t.label)
                    .setTooltip(`Open ${t.path}`)
                    .onClick(() => void this.plugin.openNoteTemplate(t.path)),
                );
              }
            },
          }),
          T("Settings.iconsFolder", folderText(
            "Custom icons folder",
            "iconsFolder",
            "Icons",
            "Vault-relative folder containing additional icon images (PNG, JPG, SVG, etc.) for the terrain palette and hex icon override. These are merged with the built-in icons.",
          )),
          T("Settings.generateWorldData", {
            name: GENERATE_WORLD_DATA_NAME,
            desc: "Creates missing terrain table notes, adds roller links to all table notes (so they can be opened in the hexmaker roller from within Obsidian), and links each hex note's terrain encounters table into its encounters table section. Use it when a table or link is missing. Set the folders first. Safe to run more than once: existing notes and links are not overwritten.",
            aliases: ["repair", "fix", "missing tables", "broken links", "terrain tables"],
            render: (setting: Setting) => {
              setting.addButton((btn) =>
                btn
                  .setButtonText("Generate")
                  .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("Generating…");
                    try {
                      await this.plugin.ensureTerrainTables();
                      await this.plugin.ensureAllRollerLinks();
                      await this.plugin.backfillTerrainLinks();
                      await this.plugin.backfillRegionLinks();
                    } finally {
                      btn.setDisabled(false);
                      btn.setButtonText("Generate");
                    }
                  }),
              );
            },
          }),
          T("Settings.generateFolders", {
            name: "Set up folders",
            desc: "Populates any blank folder settings below with defaults under the world folder, then creates those folders in your vault. Only blank fields are affected — manually set values are left untouched.",
            render: (setting: Setting) => {
              setting.addButton((btn) =>
                btn
                  .setButtonText("Generate folders")
                  .setCta()
                  .onClick(() => void this.generateFolders()),
              );
            },
          }),
          T("Settings.templatePath", folderText(
            "Template path",
            "templatePath",
            "templates/hex.md",
            "Vault-relative path to a hex note template. Supports {{x}}, {{y}}, {{title}}. Include ### Towns, ### Dungeons, and ### Features headings for the link sections. Blank = hex.md in the templates folder.",
          )),
          T("Settings.hexFolder", folderText("Hex notes folder", "hexFolder", "World/hexes", "Vault-relative path where hex notes (X_y.md) are stored.")),
          T("Settings.townsFolder", folderText("Towns folder", "townsFolder", "World/towns", "Vault-relative folder to populate the towns dropdown in the hex editor. Files starting with _ are excluded.")),
          T("Settings.dungeonsFolder", folderText("Dungeons folder", "dungeonsFolder", "World/dungeons", "Vault-relative folder to populate the dungeons dropdown in the hex editor. Files starting with _ are excluded.")),
          T("Settings.questsFolder", folderText("Quests folder", "questsFolder", "World/quests", "Vault-relative folder to populate the quests dropdown in the hex editor. Files starting with _ are excluded.")),
          T("Settings.featuresFolder", folderText("Features folder", "featuresFolder", "World/features", "Vault-relative folder to populate the features dropdown in the hex editor. Files starting with _ are excluded.")),
          T("Settings.factionsFolder", folderText("Factions folder", "factionsFolder", "World/factions", "Vault-relative folder to populate the factions dropdown in the hex editor. Files starting with _ are excluded.")),
          T("Settings.regionsFolder", folderText("Areas folder", "regionsFolder", "World/regions", "Vault-relative folder for area notes (named areas like a basin or a kingdom, painted with the Areas tool). Files starting with _ are excluded.")),
          T("Settings.tablesFolder", folderText("Tables folder", "tablesFolder", "World/tables", "Vault-relative folder for random table notes. Used by the encounters table section and the random tables view.")),
          T("Settings.workflowsFolder", folderText("Workflows folder", "workflowsFolder", "World/workflows", "Vault-relative folder for workflow notes. Browsable from the random tables view via the workflows tab.")),
          T("Settings.templatesFolder", folderText("Templates folder", "templatesFolder", "World/templates", TEMPLATES_FOLDER_DESC)),
          T("Settings.palettesFolder", folderText("Palettes folder", "palettesFolder", "World/palettes", PALETTES_FOLDER_DESC)),
          // Each module's folder settings.
          ...moduleFolderSettings().map((d) => T(d.id, folderText(d.name, d.key, d.placeholder, d.desc))),
        ],
      },
      {
        heading: "Map types",
        items: MAP_KINDS.map((k) =>
          T(mapKindSettingId(k.id), {
            name: k.label,
            desc: k.description,
            render: (setting: Setting) => {
              setting.addToggle((t) =>
                t.setValue(enabledKinds(this.plugin.settings).has(k.id)).onChange((v) => void this.setMapKind(k.id, v)),
              );
            },
          }),
        ),
      },
      {
        heading: "Path types",
        items: [
          T("Settings.pathTypesNote", {
            name: "",
            desc: "Roads, rivers and other path types belong to palettes. Edit them in the table in each palette note, or with the edit button in a map's path picker.",
            searchable: false,
          }),
        ],
      },
    ];
    this.watchDebugMode(() => this.refresh());
    return this.layoutDefinitions(sections);
  }

  /**
   * Obsidian 1.13+ hook (and the pre-1.13 page's) — reads the current value
   * for a control key. Handles the keys whose stored type differs from the
   * control's value type (defaultTableDice: number stored, string dropdown;
   * hexGap: string stored, number slider) and the hex-name defaults (unset
   * = what maps draw with). Everything else reads straight from settings;
   * undefined falls back to the control's defaultValue.
   */
  getControlValue(key: string): unknown {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    const raw = s[key];
    switch (key) {
      case "defaultTableDice":
        return String(typeof raw === "number" ? raw : 100);
      case "hexGap":
        return (typeof raw === "string" ? parseFloat(raw) : NaN) || 0.15;
      case "defaultMap":
        return (typeof raw === "string" ? raw : undefined) ?? this.plugin.settings.maps[0]?.name ?? "";
      case "hexNameFont":
      case "hexNameSize":
      case "hexNameStyle": {
        const font = resolveNameFont(undefined, this.plugin.settings);
        if (key === "hexNameFont") return font.family;
        if (key === "hexNameSize") return font.size ?? "medium";
        return nameStyleId(font.bold, font.italic);
      }
      default:
        return raw;
    }
  }

  /**
   * Obsidian 1.13+ hook (and the pre-1.13 page's) — persists a control
   * value with the coercions and side effects each key needs: folder-path
   * normalisation, positive-int guards for map sizes, hex map refresh for
   * display keys, and store reloads for the folders they read.
   */
  setControlValue(key: string, value: unknown): void | Promise<void> {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "defaultTableDice") {
      s[key] = parseInt(String(value), 10);
    } else if (key === "hexGap") {
      s[key] = String(value);
    } else if (POSITIVE_INT_KEYS.has(key)) {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n <= 0) return;
      s[key] = n;
    } else if (isFolderPathKey(key)) {
      s[key] = normalizeFolder(typeof value === "string" ? value : "");
    } else {
      s[key] = value;
    }
    return this.plugin.saveSettings().then(() => {
      if (MAP_REFRESH_KEYS.has(key)) this.plugin.refreshHexMap();
      moduleFolderSettings().find((d) => d.key === key)?.changed?.(this.plugin);
      if (key === "iconsFolder") this.plugin.loadAvailableIcons();
    });
  }

  /**
   * Turn a map type on/off. Hides (never deletes) its presets, generators
   * and icon pack. At least one type stays on.
   */
  private async setMapKind(kind: MapKind, on: boolean): Promise<void> {
    const kinds = enabledKinds(this.plugin.settings);
    if (on) kinds.add(kind);
    else kinds.delete(kind);
    if (kinds.size === 0) {
      new Notice("Keep at least one map type enabled.");
      kinds.add(kind);
    }
    this.plugin.settings.mapKinds = MAP_KINDS.map((k) => k.id).filter((id) => kinds.has(id));
    await this.plugin.saveSettings();
    // A type turned on for the first time gets its content now (SP3).
    await this.plugin.applyKindContent();
  }

  /** "Set up folders": blank folder settings get defaults under the world folder, and the folders are made. */
  private async generateFolders(): Promise<void> {
    const world = normalizeFolder(this.plugin.settings.worldFolder) || "world";
    const defaults: [keyof typeof this.plugin.settings, string][] = [
      ["hexFolder", `${world}/hexes`],
      ["townsFolder", `${world}/towns`],
      ["dungeonsFolder", `${world}/dungeons`],
      ["questsFolder", `${world}/quests`],
      ["featuresFolder", `${world}/features`],
      ["factionsFolder", `${world}/factions`],
      ["regionsFolder", `${world}/regions`],
      ["tablesFolder", `${world}/tables`],
      ["workflowsFolder", `${world}/workflows`],
      ["templatesFolder", `${world}/templates`],
    ];
    for (const [key, path] of defaults) {
      if (!this.plugin.settings[key]) {
        (this.plugin.settings as unknown as Record<string, unknown>)[key] = path;
        try {
          if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
        } catch {
          /* folder already exists */
        }
      }
    }
    await this.plugin.saveSettings();
    // Note templates (hex, town) into the templates folder (PA3).
    await this.plugin.ensureTemplates();
    // Ensure all map subfolders exist and generate hex notes
    const hexF = normalizeFolder(this.plugin.settings.hexFolder);
    if (hexF) {
      let totalCreated = 0;
      for (const map of this.plugin.settings.maps) {
        const mapFolder = `${hexF}/${map.name}`;
        if (!this.app.vault.getAbstractFileByPath(mapFolder)) {
          try {
            await this.app.vault.createFolder(mapFolder);
          } catch {
            /* exists */
          }
        }
        const { cols, rows } = map.gridSize;
        const { x: ox, y: oy } = map.gridOffset;
        const xs = Array.from({ length: cols }, (_, i) => ox + i);
        const ys = Array.from({ length: rows }, (_, i) => oy + i);
        totalCreated += await this.plugin.generateHexNotes(map.name, xs, ys);
      }
      if (totalCreated > 0) new Notice(`Generated ${totalCreated} hex note${totalCreated !== 1 ? "s" : ""}.`);
    }
    new Notice("Folders generated.");
    this.refresh();
  }

  /** Choices for "Palette for new maps": first palette, then every palette (the saved one kept even if gone). */
  private defaultPaletteOptions(): Record<string, string> {
    const out: Record<string, string> = { "": "First palette" };
    for (const p of this.plugin.settings.terrainPalettes) out[p.name] = p.name;
    const saved = this.plugin.settings.defaultPalette;
    if (saved && !(saved in out)) out[saved] = `${saved} (not installed)`;
    return out;
  }

  /** Remember a row that lists palettes, so a palette change redraws it in place. */
  private onPalettesChange(el: HTMLElement, redraw: () => void): void {
    this.paletteRefreshers.add({ el, redraw });
  }

  /** Redraw every palette-listing row still on the page (drawn in place, so nothing around them moves). */
  private redrawPalettes(): void {
    for (const r of [...this.paletteRefreshers]) {
      if (!r.el.isConnected) this.paletteRefreshers.delete(r);
      else r.redraw();
    }
  }

  /** "Palette for new maps": a dropdown refilled when palettes change. */
  private renderDefaultPalette(setting: Setting): void {
    setting.addDropdown((d) => {
      const fill = () => {
        d.selectEl.empty();
        d.addOptions(this.defaultPaletteOptions()).setValue(this.plugin.settings.defaultPalette ?? "");
      };
      fill();
      d.onChange(async (v) => {
        this.plugin.settings.defaultPalette = v;
        await this.plugin.saveSettings();
      });
      this.onPalettesChange(d.selectEl, fill);
    });
  }

  /**
   * The palette list (simple: custom palettes are part of the streamlined
   * view): rename in place, Edit, Delete (not while a map uses it, nor the
   * last one), Add palette. It redraws inside its own box, so the rows
   * around it never move (the declarative renderer re-appends a changed
   * list at the END of the page, which is why this isn't a "list" item).
   */
  private renderPaletteList(setting: Setting): void {
    setting.setClass("duckmage-palette-mgmt-setting");
    const host = setting.settingEl.createDiv({ cls: "duckmage-palette-mgmt-host" });
    const draw = () => {
      host.empty();
      const palettes = this.plugin.settings.terrainPalettes;
      const listEl = host.createDiv({ cls: "duckmage-palette-mgmt-list" });
      if (!palettes.length) listEl.createDiv({ cls: "setting-item-description", text: "No terrain palettes yet." });
      palettes.forEach((pal, i) => {
        const usedBy = this.plugin.settings.maps.filter((r) => r.paletteName === pal.name).length;
        const rowEl = listEl.createDiv({ cls: "duckmage-palette-mgmt-row" });
        const nameInput = rowEl.createEl("input", { type: "text", value: pal.name, cls: "duckmage-palette-mgmt-name", attr: { "aria-label": "Palette name" } });
        nameInput.addEventListener("blur", () => {
          void (async () => {
            const trimmed = nameInput.value.trim();
            if (!trimmed || trimmed === pal.name) {
              nameInput.value = pal.name;
              return;
            }
            if (palettes.some((p, j) => j !== i && p.name.toLowerCase() === trimmed.toLowerCase())) {
              new Notice(`Palette "${trimmed}" already exists.`);
              nameInput.value = pal.name;
              return;
            }
            // Repoint maps, the new-map default and child palettes.
            repointPaletteName(this.plugin.settings, pal.name, trimmed);
            pal.name = trimmed;
            await this.plugin.saveSettings();
            this.redrawPalettes();
          })();
        });
        rowEl.createSpan({ cls: "duckmage-palette-mgmt-badge", text: `(${usedBy} map${usedBy !== 1 ? "s" : ""})` });
        rowEl.createEl("button", { text: "Edit" }).addEventListener("click", () => {
          void this.plugin.openPaletteEditor(pal.name);
        });
        const deleteBtn = rowEl.createEl("button", { text: "Delete" });
        deleteBtn.disabled = usedBy > 0 || palettes.length <= 1;
        deleteBtn.title = usedBy > 0 ? "Can't delete: a map uses it" : palettes.length <= 1 ? "Can't delete the last palette" : "";
        deleteBtn.addEventListener("click", () => {
          void (async () => {
            palettes.splice(i, 1);
            await this.plugin.saveSettings();
            this.redrawPalettes();
            // "Add default palettes" may apply now.
            this.refresh();
          })();
        });
      });
      new Setting(listEl).addButton((btn) =>
        btn.setButtonText("Add palette").onClick(() => {
          new AddPaletteModal(this.app, this.plugin, () => this.redrawPalettes()).open();
        }),
      );
    };
    draw();
    this.onPalettesChange(host, draw);
  }

  /** Advanced: open any palette's note (the raw table) in a new tab. */
  private renderOpenPaletteNote(setting: Setting): void {
    let pick = "";
    setting.addDropdown((d) => {
      const fill = () => {
        d.selectEl.empty();
        const names = this.plugin.settings.terrainPalettes.map((p) => p.name);
        for (const n of names) d.addOption(n, n);
        pick = names.includes(pick) ? pick : (names[0] ?? "");
        d.setValue(pick);
      };
      fill();
      d.onChange((v) => {
        pick = v;
      });
      this.onPalettesChange(d.selectEl, fill);
    });
    setting.addButton((b) =>
      b.setButtonText("Open note").onClick(() => {
        const file = pick ? this.plugin.paletteStore.noteFor(pick) : null;
        if (!file) {
          new Notice(`No note found for palette "${pick}" yet.`);
          return;
        }
        void this.app.workspace.getLeaf("tab").openFile(file);
      }),
    );
  }

  /**
   * Lay the sections out by placement: each section keeps its main (then
   * more) rows under its heading; Advanced rows from every section gather,
   * in page order, in the collapsed Advanced dropdown after them: plain
   * ones first, then each sub-section (its own collapsible row), then Debug
   * (debug mode only). The debug-mode switch is the very last row.
   */
  private layoutDefinitions(sections: Section[]): LocalSettingDefinitionItem[] {
    const out: LocalSettingDefinitionItem[] = [];
    const tucked: Tagged[] = [];
    for (const section of sections) {
      // Every layer is laid out; Debug shows only while debug mode is on.
      const { main, more } = partitionSections(section.items, true);
      if (main.length || more.length) out.push({ type: "group", heading: section.heading, cls: section.cls, items: [...main, ...more] });
      tucked.push(...section.items.filter((t) => !["main", "more"].includes(layerOf(t.id))));
    }
    const { advanced: plain, subs: found, debug } = partitionSections(tucked, true);
    // Most-wanted sub-section first; any other in the order first used.
    const rank = (name: string) => (SUB_SECTION_ORDER.includes(name) ? SUB_SECTION_ORDER.indexOf(name) : SUB_SECTION_ORDER.length);
    const subs = [...found].sort((a, b) => rank(a.name) - rank(b.name));
    const open = () => disclosureOpen(this.app, SURFACE);
    const debugOn = () => isDebugMode(this.app);
    const shownWhen = (items: LocalSettingDefinition[], when: () => boolean): LocalSettingDefinition[] =>
      items.map((i) => {
        const own = i.visible;
        return { ...i, visible: () => when() && (own === undefined || (typeof own === "function" ? own() : own)) };
      });
    if (plain.length || subs.length || debug.length) {
      out.push({
        type: "group",
        cls: "duckmage-settings-advanced",
        items: [
          {
            name: "Advanced",
            desc: ADVANCED_DESC,
            aliases: ["folders"],
            render: (setting: Setting) => this.renderDisclosureRow(setting, SURFACE, "advanced settings"),
          },
          ...shownWhen(plain, open),
          ...subs.flatMap(({ name, items }) => {
            const key = subSectionKey(SURFACE, name);
            const header: LocalSettingDefinition = {
              name,
              render: (setting: Setting) => this.renderDisclosureRow(setting, key, name.toLowerCase(), true),
            };
            return [...shownWhen([header], open), ...shownWhen(items, () => open() && disclosureOpen(this.app, key))];
          }),
        ],
      });
      if (debug.length)
        out.push({
          type: "group",
          heading: "Debug",
          cls: "duckmage-settings-debug",
          visible: () => open() && debugOn(),
          items: shownWhen(debug, () => open() && debugOn()),
        });
    }
    out.push({ type: "group", cls: "duckmage-settings-debug-mode", items: [this.debugModeDefinition()] });
    return out;
  }

  /** A dropdown's header row (Advanced, or one of its sub-sections): click to open or close it (remembered on this device). */
  private renderDisclosureRow(setting: Setting, key: string, what: string, sub = false): void {
    const open = disclosureOpen(this.app, key);
    setting.settingEl.addClass("duckmage-settings-advanced-row");
    setting.settingEl.toggleClass("is-sub", sub);
    setting.settingEl.toggleClass("is-open", open);
    setting.settingEl.setAttr("role", "button");
    setting.settingEl.setAttr("aria-expanded", String(open));
    setting.addExtraButton((b) => b.setIcon(open ? "chevron-down" : "chevron-right").setTooltip(open ? `Hide ${what}` : `Show ${what}`));
    setting.settingEl.addEventListener("click", () => {
      setDisclosureOpen(this.app, key, !open);
      this.refresh();
    });
  }

  /**
   * The debug-mode switch: the only way to turn debug mode on. The first
   * time on this device it asks first. The page redraws through
   * watchDebugMode.
   */
  private debugModeDefinition(): LocalSettingDefinition {
    return {
      name: "Debug mode",
      desc: DEBUG_MODE_DESC,
      aliases: ["debug", "developer", "maintenance"],
      render: (setting: Setting) => {
        setting.addToggle((t) =>
          t.setValue(isDebugMode(this.app)).onChange((on) => {
            if (!on || debugModeConfirmed(this.app)) {
              setDebugMode(this.app, on);
              return;
            }
            // Not on until the user confirms.
            t.setValue(false);
            new ConfirmModal(this.app, DEBUG_CONFIRM_TEXT.title, DEBUG_CONFIRM_TEXT.body, DEBUG_CONFIRM_TEXT.confirm, () => {
              markDebugModeConfirmed(this.app);
              setDebugMode(this.app, true);
            }).open();
          }),
        );
      },
    };
  }

  /** Redraws the tab when debug mode changes (this switch, or the status bar). */
  private stopDebugWatch?: () => void;

  hide(): void {
    this.stopDebugWatch?.();
    this.stopDebugWatch = undefined;
    super.hide();
  }

  private watchDebugMode(refresh: () => void): void {
    this.stopDebugWatch?.();
    this.stopDebugWatch = onDebugModeChange(() => refresh());
  }

  /**
   * Redraw the page after a structural change (a dropdown opened, folders
   * generated, debug mode switched): SettingTab.update() on Obsidian >=
   * 1.13 (typed dynamically: the installed 1.12 typings predate it, and
   * declaring it here would shadow the real one), display() before that.
   */
  private refresh(): void {
    const tab = this as unknown as { update?: () => void };
    // update() / display() rebuild the tab's children, which resets the
    // scroll position. The actual scroller varies (containerEl or an
    // ancestor in the settings modal), and Obsidian's own node-insertion
    // scroll keepers can re-zero it asynchronously AFTER the rebuild — so
    // capture every scrolled element in the chain and re-assert the
    // positions over several frames until they stick.
    const scrolled: { el: HTMLElement; top: number }[] = [];
    let el: HTMLElement | null = this.containerEl;
    while (el) {
      if (el.scrollTop > 0) scrolled.push({ el, top: el.scrollTop });
      el = el.parentElement;
    }
    if (typeof tab.update === "function") tab.update();
    // Pre-1.13: redraw only while the tab is on screen.
    else if (this.containerEl.isConnected) this.display();
    if (scrolled.length === 0) return;
    const restore = () => {
      for (const s of scrolled) {
        if (s.el.isConnected) s.el.scrollTop = s.top;
      }
    };
    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 60);
    window.setTimeout(restore, 180);
  }

  /**
   * Compact single-row builder for the three hex-editor collapse toggles:
   * label + toggle pairs in one setting row. Uses standard
   * ToggleComponents — addToggle puts `.mod-toggle` on the row, which keeps
   * Obsidian's narrow-pane layout from stretching the controls (the old
   * raw-checkbox composite row was mangled below 400px pane width because
   * it lacked that exemption).
   */
  private buildCollapseTogglesRow(setting: Setting): void {
    setting.setClass("duckmage-collapse-row");
    const add = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      setting.controlEl.createSpan({ text: label, cls: "duckmage-collapse-toggle-label" });
      setting.addToggle((t) =>
        t.setValue(get()).onChange(async (v) => {
          set(v);
          await this.plugin.saveSettings();
        }),
      );
    };
    add("Terrain", () => this.plugin.settings.hexEditorTerrainCollapsed, (v) => {
      this.plugin.settings.hexEditorTerrainCollapsed = v;
    });
    add("Features", () => this.plugin.settings.hexEditorFeaturesCollapsed, (v) => {
      this.plugin.settings.hexEditorFeaturesCollapsed = v;
    });
    add("Notes", () => this.plugin.settings.hexEditorNotesCollapsed, (v) => {
      this.plugin.settings.hexEditorNotesCollapsed = v;
    });
  }

  /**
   * Draw definitions imperatively (the pre-1.13 page): headings, rows,
   * bound controls through get/setControlValue, render callbacks. Rows and
   * groups whose `visible` is false are skipped.
   */
  private renderDefinitions(container: HTMLElement, items: LocalSettingDefinitionItem[]): void {
    const shown = (v: LocalSettingDefinition["visible"]) => (v === undefined ? true : typeof v === "function" ? v() : v);
    for (const item of items) {
      if ("type" in item && (item.type === "group" || item.type === "list")) {
        const group = item;
        if (!shown(group.visible)) continue;
        const box = container.createDiv(group.cls ? { cls: group.cls } : {});
        if (group.heading) new Setting(box).setName(group.heading).setHeading();
        this.renderDefinitions(box, group.items ?? []);
        continue;
      }
      const def = item as LocalSettingDefinition;
      if (!shown(def.visible)) continue;
      const setting = new Setting(container);
      if (def.name) setting.setName(def.name);
      if (def.desc) setting.setDesc(def.desc);
      if (def.control) this.renderControl(setting, def.control, def.name);
      def.render?.(setting);
    }
  }

  /** One bound control (pre-1.13 page), read and written like the declarative ones. */
  private renderControl(setting: Setting, c: LocalSettingControl, name = ""): void {
    const value = this.getControlValue(c.key);
    const save = (v: unknown) => void this.setControlValue(c.key, v);
    switch (c.type) {
      case "toggle":
        setting.addToggle((t) => t.setValue(typeof value === "boolean" ? value : !!c.defaultValue).onChange(save));
        break;
      case "dropdown":
        setting.addDropdown((d) => d.addOptions(c.options).setValue(typeof value === "string" ? value : (c.defaultValue ?? "")).onChange(save));
        break;
      case "text":
        setting.addText((t) => t.setPlaceholder(c.placeholder ?? "").setValue(typeof value === "string" ? value : (c.defaultValue ?? "")).onChange(save));
        break;
      case "number":
        setting.addText((t) => {
          t.inputEl.type = "number";
          if (c.min !== undefined) t.inputEl.min = String(c.min);
          if (c.max !== undefined) t.inputEl.max = String(c.max);
          t.setPlaceholder(c.placeholder ?? "")
            .setValue(String(typeof value === "number" ? value : (c.defaultValue ?? "")))
            .onChange((v) => save(Number(v)));
        });
        break;
      case "slider": {
        const start = typeof value === "number" ? value : (c.defaultValue ?? c.min);
        const format = c.displayFormat ?? ((v: number) => String(v));
        // The shared slider (value always shown; src/ui/sliders.ts).
        renderLabeledSlider(setting.controlEl, {
          label: "", ariaLabel: name, min: c.min, max: c.max, step: c.step, value: start, format,
          reset: c.defaultValue !== undefined ? { value: c.defaultValue } : undefined,
          onChange: (v) => save(v),
        });
        break;
      }
      case "color":
        setting.addColorPicker((p) => p.setValue(typeof value === "string" ? value : (c.defaultValue ?? "#ffffff")).onChange(save));
        break;
    }
  }
}

/** The settings id of a map type's switch (`Settings.mapKindWorld`, `Settings.mapKindSpace`). */
export function mapKindSettingId(kind: string): string {
  return `Settings.mapKind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}
