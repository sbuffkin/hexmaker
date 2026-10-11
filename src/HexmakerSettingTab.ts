import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_NAME_FONT, NAME_FAMILIES, NAME_SIZES, NAME_STYLES, nameStyleId, resolveNameFont, type HexNameSize } from "./hex-map/hexNameFont";
import type HexmakerPlugin from "./HexmakerPlugin";
import { normalizeFolder } from "./utils";
import { AddPaletteModal } from "./palettes/AddPaletteModal";
import { repointPaletteName } from "./palettes/paletteOptions";
import { MAP_KINDS, enabledKinds, type MapKind } from "./mapKinds";
import { ConfirmModal } from "./worldgen/ConfirmModal";
import { moduleFolderSettings } from "./modules/runtime";
import { Disclosure, disclosureOpen, setDisclosureOpen } from "./ui/disclosure";
import { partition } from "./ui/placement";
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

/** The Advanced dropdown row's description (both settings paths). */
const ADVANCED_DESC = "Folder layout and other options most people never change.";

/** The debug-mode switch's description (both settings paths). */
const DEBUG_MODE_DESC =
  "Show backend controls (engine tuning, maintenance) in a Debug section inside each Advanced dropdown. On this device only.";

/** Size names in the settings dropdowns. */
const NAME_SIZE_TEXT: Record<HexNameSize, string> = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };

const PALETTES_FOLDER_DESC =
  "Vault-relative folder for terrain palette notes (one note per palette — edit as text, copy between vaults to share). Defaults to a palettes folder inside the world folder.";

const BIOMES_FOLDER_DESC =
  "Vault-relative folder for overworld biome notes (one note per biome: its mix of terrain types, colour and transitions). Defaults to a biomes folder inside the world folder.";

const BIOME_POOLS_FOLDER_DESC =
  "Vault-relative folder for biome pool notes (each lists the biomes a generated overworld may use). Defaults to a biome-pools folder inside the world folder.";

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

/** The Templates folder setting's description (both settings paths). */
const TEMPLATES_FOLDER_DESC =
  "Vault-relative folder for the plugin's note templates: the hex template (unless Template path points elsewhere) and the town template. Edit them there; new notes use them. Blank = \"templates\" in the world folder. Workflow templates stay with their workflows.";

/** "Add default palettes" (both settings paths): deleted palettes stay deleted until asked. */
const ADD_DEFAULTS_DESC = "Put the built-in palettes back. Palettes you delete stay deleted; they only come back from here.";

/** The "Palette for new maps" setting's description (both settings paths). */
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
  "biomesFolder",
  "biomePoolsFolder",
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

export class HexmakerSettingTab extends PluginSettingTab {
  plugin: HexmakerPlugin;

  constructor(app: App, plugin: HexmakerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Pre-1.13 fallback. On Obsidian >= 1.13 this is never called, because
  // getSettingDefinitions() below returns a non-empty array and the tab is
  // rendered declaratively from those definitions instead.
  display(): void {
    this.renderSettings();
  }

  /**
   * Obsidian 1.13+ declarative settings API. Returning a non-empty array
   * makes the tab render from these definitions and — crucially — makes
   * every setting appear in Obsidian's settings search.
   *
   * Mirrors renderSettings() below (which remains the pre-1.13 fallback):
   * simple controls are declared as bound controls (value routed through
   * getControlValue / setControlValue), button rows and custom widgets use
   * `render` callbacks with the same handlers.
   */
  getSettingDefinitions(): LocalSettingDefinitionItem[] {
    const folderText = (
      name: string,
      key: string,
      placeholder: string,
      desc: string,
    ): LocalSettingDefinition => ({
      name,
      desc,
      control: { type: "text", key, placeholder },
    });

    const mapOptions: Record<string, string> = {};
    for (const r of this.plugin.settings.maps) {
      mapOptions[r.name] = r.name;
    }

    const palettes = this.plugin.settings.terrainPalettes;
    const paletteItems: LocalSettingDefinition[] = palettes.map((pal, i) => {
      const usedBy = this.plugin.settings.maps.filter(
        (r) => r.paletteName === pal.name,
      ).length;
      return {
        name: pal.name,
        desc: `${usedBy} region${usedBy !== 1 ? "s" : ""}`,
        render: (setting: Setting) => {
          const nameInput = setting.controlEl.createEl("input", {
            type: "text",
            value: pal.name,
          });
          nameInput.addClass("duckmage-palette-mgmt-name");
          nameInput.addEventListener("blur", () => {
            void (async () => {
              const trimmed = nameInput.value.trim();
              if (!trimmed || trimmed === pal.name) {
                nameInput.value = pal.name;
                return;
              }
              const isDupe = palettes.some(
                (p, j) =>
                  j !== i && p.name.toLowerCase() === trimmed.toLowerCase(),
              );
              if (isDupe) {
                new Notice(`Palette "${trimmed}" already exists.`);
                nameInput.value = pal.name;
                return;
              }
              // Repoint maps, the new-map default and child palettes.
              repointPaletteName(this.plugin.settings, pal.name, trimmed);
              pal.name = trimmed;
              await this.plugin.saveSettings();
              this.requestDeclarativeRerender();
            })();
          });
          this.addOpenNoteButton(setting.controlEl, pal.name);
        },
      };
    });

    const T = (id: string, item: LocalSettingDefinitionItem) => ({ id, item });
    const tagged: { id: string; item: LocalSettingDefinitionItem }[] = [
      T("Settings.rerunSetupWizard", {
        name: "Setup wizard",
        desc: "Re-open the setup wizard to reconfigure folders or create a new map.",
        render: (setting: Setting) => {
          setting.addButton((btn) =>
            btn.setButtonText("Re-run setup wizard").onClick(() => {
              this.plugin.settings.setupDismissed = false;
              void this.plugin
                .saveSettings()
                .then(() => this.plugin.openSetupWizard());
            }),
          );
        },
      }),
      T("Settings.defaultTableDice", {
        name: "Default die for new tables",
        desc: "Die size used when creating new random table notes (d6, d20, d100, etc.).",
        aliases: ["dice"],
        control: {
          type: "dropdown",
          key: "defaultTableDice",
          options: {
            "4": "D4",
            "6": "D6",
            "8": "D8",
            "10": "D10",
            "12": "D12",
            "20": "D20",
            "100": "D100",
            "200": "D200",
            "500": "D500",
            "1000": "D1000",
          },
          defaultValue: "100",
        },
      }),
      T("Settings.collapseSections", {
        name: "Hex editor sections start collapsed",
        desc: "Choose which sections open collapsed by default in the right-click hex editor.",
        aliases: ["terrain", "features", "notes", "collapse"],
        render: (setting: Setting) => this.buildCollapseTogglesRow(setting),
      }),
      T("Settings.templatePath", folderText(
        "Template path",
        "templatePath",
        "templates/hex.md",
        "Vault-relative path to a hex note template. Supports {{x}}, {{y}}, {{title}}. Include ### Towns, ### Dungeons, and ### Features headings for the link sections. Blank = hex.md in the templates folder.",
      )),
      T("Settings.defaultMap", {
        name: "Default map",
        desc: "The map opened when the hex map is launched.",
        control: {
          type: "dropdown",
          key: "defaultMap",
          options: mapOptions,
          defaultValue: this.plugin.settings.maps[0]?.name ?? "",
        },
      }),
      T("Settings.hexOrientation", {
        name: "Hex orientation",
        desc: "Pointy-top: points face north/south, flat sides east/west. Flat-top: flat sides face north/south, points east/west.",
        control: {
          type: "dropdown",
          key: "hexOrientation",
          options: { pointy: "Pointy-top", flat: "Flat-top" },
          defaultValue: "pointy",
        },
      }),
      T("Settings.staggerOffset", {
        name: "Stagger offset",
        desc: "Which set of columns (flat-top) or rows (pointy-top) is offset by half a hex. Affects how new maps render unless overridden per-map.",
        render: (setting: Setting) => {
          let val: "odd" | "even" = this.plugin.settings.staggerOffset ?? "odd";
          const btn = setting.controlEl.createEl("button", {
            cls: "duckmage-stagger-toggle",
          });
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
        control: {
          type: "dropdown",
          key: "coordPlacement",
          options: { top: "Top", middle: "Middle", bottom: "Bottom" },
          defaultValue: "bottom",
        },
      }),
      T("Settings.coordFontSize", {
        name: "Coordinate label size",
        desc: "Size of the coordinate label, relative to the hex.",
        control: {
          type: "slider",
          key: "coordFontSize",
          min: 0.5,
          max: 1.5,
          step: 0.05,
          displayFormat: (value) => value.toFixed(2),
          defaultValue: 0.8,
        },
      }),
      T("Settings.coordFontFamily", {
        name: "Coordinate label font",
        desc: "Font used for the coordinate label.",
        control: {
          type: "dropdown",
          key: "coordFontFamily",
          options: {
            interface: "Interface",
            serif: "Serif",
            monospace: "Monospace",
          },
          defaultValue: "interface",
        },
      }),
      T("Settings.coordFontColor", {
        name: "Coordinate label color",
        desc: "Color of the coordinate label.",
        control: {
          type: "color",
          key: "coordFontColor",
          defaultValue: "#ffffff",
        },
      }),
      T("Settings.hexNameFont", {
        name: "Hex name font",
        desc: "Default font for hex names on maps and in PNG exports. Each map can pick its own in the layers menu.",
        control: {
          type: "dropdown",
          key: "hexNameFont",
          options: Object.fromEntries(NAME_FAMILIES.map((f) => [f.id, f.label])),
          defaultValue: DEFAULT_NAME_FONT.family,
        },
      }),
      T("Settings.hexNameSize", {
        name: "Hex name size",
        desc: "Default size for hex names. Names never get smaller than readable on screen.",
        control: {
          type: "dropdown",
          key: "hexNameSize",
          options: Object.fromEntries(NAME_SIZES.map((s) => [s.id, NAME_SIZE_TEXT[s.id]])),
          defaultValue: "medium",
        },
      }),
      T("Settings.hexNameStyle", {
        name: "Hex name style",
        desc: "Default weight and slant for hex names.",
        control: {
          type: "dropdown",
          key: "hexNameStyle",
          options: Object.fromEntries(NAME_STYLES.map((s) => [s.id, s.label])),
          defaultValue: "bold",
        },
      }),
      T("Settings.hexGap", {
        name: "Hex cell spacing",
        desc: "Gap between hex cells (0 – 0.5 em).",
        control: {
          type: "slider",
          key: "hexGap",
          min: 0,
          max: 0.5,
          step: 0.01,
          displayFormat: (value) => value.toFixed(2),
          defaultValue: 0.15,
        },
      }),
      T("Settings.defaultNewMapCols", {
        name: "Default new map columns",
        desc: "Default number of columns when creating a new top-level map.",
        control: {
          type: "number",
          key: "defaultNewMapCols",
          placeholder: "Cols",
          min: 1,
          step: 1,
          defaultValue: 20,
        },
      }),
      T("Settings.defaultNewMapRows", {
        name: "Default new map rows",
        desc: "Default number of rows when creating a new top-level map.",
        control: {
          type: "number",
          key: "defaultNewMapRows",
          placeholder: "Rows",
          min: 1,
          step: 1,
          defaultValue: 16,
        },
      }),
      T("Settings.defaultSubmapCols", {
        name: "Default submap columns",
        desc: "Default number of columns when creating a new submap.",
        control: {
          type: "number",
          key: "defaultSubmapCols",
          placeholder: "Cols",
          min: 1,
          step: 1,
          defaultValue: 10,
        },
      }),
      T("Settings.defaultSubmapRows", {
        name: "Default submap rows",
        desc: "Default number of rows when creating a new submap.",
        control: {
          type: "number",
          key: "defaultSubmapRows",
          placeholder: "Rows",
          min: 1,
          step: 1,
          defaultValue: 10,
        },
      }),
      T("Settings.iconsFolder", folderText(
        "Custom icons folder",
        "iconsFolder",
        "Icons",
        "Vault-relative folder containing additional icon images (PNG, JPG, SVG, etc.) for the terrain palette and hex icon override. These are merged with the built-in icons.",
      )),
      T("Settings.generateWorldData", {
        name: "Generate terrain tables & hex links",
        desc: "Creates missing terrain table notes, adds roller links to all table notes (so they can be opened in the hexmaker roller from within Obsidian), and links each hex note's terrain encounters table into its encounters table section. Set the folders first. Safe to run more than once: existing notes and links are not overwritten.",
        render: (setting: Setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText("Generate")
              .setCta()
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
      T("Settings.pathTypesNote", {
        type: "group",
        heading: "Path types",
        items: [
          {
            name: "",
            desc: "Roads, rivers and other path types belong to palettes. Edit them in the table in each palette note, or with the edit button in a map's path picker.",
            searchable: false,
          },
        ],
      }),
      T("Settings.worldFolder", folderText(
        "World notes folder",
        "worldFolder",
        "World.",
        "Vault-relative path. Scopes the file search when adding links to hexes.",
      )),
      T("Settings.generateFolders", {
        name: "Set up folders",
        desc: "Populates any blank folder settings below with defaults under the world folder, then creates those folders in your vault. Only blank fields are affected — manually set values are left untouched.",
        render: (setting: Setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText("Generate folders")
              .setCta()
              .onClick(async () => {
                const world =
                  normalizeFolder(this.plugin.settings.worldFolder) || "world";
                const defaults: [keyof typeof this.plugin.settings, string][] =
                  [
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
                    (
                      this.plugin.settings as unknown as Record<string, unknown>
                    )[key] = path;
                    try {
                      if (!this.app.vault.getAbstractFileByPath(path)) {
                        await this.app.vault.createFolder(path);
                      }
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
                    totalCreated += await this.plugin.generateHexNotes(
                      map.name,
                      xs,
                      ys,
                    );
                  }
                  if (totalCreated > 0)
                    new Notice(
                      `Generated ${totalCreated} hex note${totalCreated !== 1 ? "s" : ""}.`,
                    );
                }
                new Notice("Folders generated.");
                this.requestDeclarativeRerender();
              }),
          );
        },
      }),
      T("Settings.hexFolder", folderText(
        "Hex notes folder",
        "hexFolder",
        "World/hexes",
        "Vault-relative path where hex notes (X_y.md) are stored.",
      )),
      T("Settings.townsFolder", folderText(
        "Towns folder",
        "townsFolder",
        "World/towns",
        "Vault-relative folder to populate the towns dropdown in the hex editor. Files starting with _ are excluded.",
      )),
      T("Settings.dungeonsFolder", folderText(
        "Dungeons folder",
        "dungeonsFolder",
        "World/dungeons",
        "Vault-relative folder to populate the dungeons dropdown in the hex editor. Files starting with _ are excluded.",
      )),
      T("Settings.questsFolder", folderText(
        "Quests folder",
        "questsFolder",
        "World/quests",
        "Vault-relative folder to populate the quests dropdown in the hex editor. Files starting with _ are excluded.",
      )),
      T("Settings.featuresFolder", folderText(
        "Features folder",
        "featuresFolder",
        "World/features",
        "Vault-relative folder to populate the features dropdown in the hex editor. Files starting with _ are excluded.",
      )),
      T("Settings.factionsFolder", folderText(
        "Factions folder",
        "factionsFolder",
        "World/factions",
        "Vault-relative folder to populate the factions dropdown in the hex editor. Files starting with _ are excluded.",
      )),
      T("Settings.regionsFolder", folderText(
        "Regions folder",
        "regionsFolder",
        "World/regions",
        "Vault-relative folder for geographic region notes (used by the region overlay paint tool). Files starting with _ are excluded.",
      )),
      T("Settings.tablesFolder", folderText(
        "Tables folder",
        "tablesFolder",
        "World/tables",
        "Vault-relative folder for random table notes. Used by the encounters table section and the random tables view.",
      )),
      T("Settings.workflowsFolder", folderText(
        "Workflows folder",
        "workflowsFolder",
        "World/workflows",
        "Vault-relative folder for workflow notes. Browsable from the random tables view via the workflows tab.",
      )),
      T("Settings.templatesFolder", folderText(
        "Templates folder",
        "templatesFolder",
        "World/templates",
        TEMPLATES_FOLDER_DESC,
      )),
      T("Settings.palettesFolder", folderText(
        "Palettes folder",
        "palettesFolder",
        "World/palettes",
        PALETTES_FOLDER_DESC,
      )),
      T("Settings.biomesFolder", folderText(
        "Biomes folder",
        "biomesFolder",
        "World/biomes",
        BIOMES_FOLDER_DESC,
      )),
      T("Settings.biomePoolsFolder", folderText(
        "Biome pools folder",
        "biomePoolsFolder",
        "World/biome-pools",
        BIOME_POOLS_FOLDER_DESC,
      )),
      // Each module's folder settings (Space: World types folder).
      ...moduleFolderSettings().map((d) => T(d.id, folderText(d.name, d.key, d.placeholder, d.desc))),
      T("Settings.mapKinds", {
        type: "group",
        heading: "Map types",
        items: MAP_KINDS.map((k): LocalSettingDefinition => ({
          name: k.label,
          desc: k.description,
          render: (setting: Setting) => {
            setting.addToggle((t) =>
              t.setValue(enabledKinds(this.plugin.settings).has(k.id))
                .onChange((v) => void this.setMapKind(k.id, v)),
            );
          },
        })),
      }),
    ];
    // Terrain palettes LAST among the regular settings (see the comment on
    // them); the Advanced dropdown and the debug-mode switch go after them.
    const palettesSection: LocalSettingDefinitionItem[] = [
      // Terrain palettes LAST, deliberately: on update() the declarative
      // renderer reuses unchanged rows but re-creates a changed list and
      // appends it at the END of the page — a mid-page list visibly "drops
      // to the bottom" every time a palette is added/renamed/deleted. As
      // the final section its re-append lands where it already is.
      {
        type: "group",
        heading: "Terrain palettes",
        items: [
          {
            name: "",
            desc: "Each region uses one palette. Assign a palette when creating a region — it cannot be changed after. Edit palette contents from the terrain tool on the hex map, or as a table in the palette's note.",
            searchable: false,
          },
          {
            name: "Palette for new maps",
            desc: DEFAULT_PALETTE_DESC,
            control: {
              type: "dropdown",
              key: "defaultPalette",
              options: this.defaultPaletteOptions(),
              defaultValue: "",
            },
          },
          {
            name: "Add default palettes",
            desc: ADD_DEFAULTS_DESC,
            visible: () => this.plugin.missingDefaultPalettes().length > 0,
            render: (setting: Setting) => {
              setting.addButton((b) =>
                b.setButtonText(`Add ${this.plugin.missingDefaultPalettes().join(" and ")}`).onClick(() => {
                  void this.plugin.addDefaultPalettes().then(() => this.requestDeclarativeRerender());
                }),
              );
            },
          },
        ],
      },
      {
        type: "list",
        items: paletteItems,
        emptyState: "No terrain palettes defined.",
        onDelete: (index: number) => {
          const pal = palettes[index];
          if (!pal) return;
          const usedBy = this.plugin.settings.maps.filter(
            (r) => r.paletteName === pal.name,
          ).length;
          if (usedBy > 0) {
            new Notice("Cannot delete — in use by a region.");
            return;
          }
          if (palettes.length <= 1) {
            new Notice("Cannot delete the last palette.");
            return;
          }
          palettes.splice(index, 1);
          void this.plugin
            .saveSettings()
            .then(() => this.requestDeclarativeRerender());
        },
        addItem: {
          name: "Add palette",
          action: () => {
            new AddPaletteModal(this.app, this.plugin, () =>
              this.requestDeclarativeRerender(),
            ).open();
          },
        },
      },
    ];
    this.watchDebugMode(() => this.requestDeclarativeRerender());
    return this.layoutDefinitions(tagged, palettesSection);
  }

  /**
   * Obsidian 1.13+ hook — reads the current value for a declarative control
   * key. Handles the two keys whose stored type differs from the control's
   * value type (defaultTableDice: number stored, string dropdown; hexGap:
   * string stored, number slider). Everything else reads straight from
   * settings; undefined falls back to the control's defaultValue.
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
        return (
          (typeof raw === "string" ? raw : undefined) ??
          this.plugin.settings.maps[0]?.name ??
          ""
        );
      default:
        return raw;
    }
  }

  /**
   * Obsidian 1.13+ hook — persists a declarative control value, applying the
   * same coercions and side effects as the imperative onChange handlers in
   * renderSettings(): folder-path normalisation, positive-int guards for map
   * sizes, hex map refresh for display keys, and icon reload for iconsFolder.
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
      if (key === "biomesFolder") void this.plugin.biomeStore.reload();
      moduleFolderSettings().find((d) => d.key === key)?.changed?.(this.plugin);
      if (key === "iconsFolder") this.plugin.loadAvailableIcons();
    });
  }

  /**
   * Calls SettingTab.update() (Obsidian >= 1.13) to rebuild the declarative
   * definitions after a structural change (palette added/removed, folders
   * generated). Typed dynamically because the installed 1.12 typings predate
   * the method; declaring it on this class would shadow the real one.
   */
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

  /** Choices for "Palette for new maps": first palette, then every palette (the saved one kept even if gone). */
  private defaultPaletteOptions(): Record<string, string> {
    const out: Record<string, string> = { "": "First palette" };
    for (const p of this.plugin.settings.terrainPalettes) out[p.name] = p.name;
    const saved = this.plugin.settings.defaultPalette;
    if (saved && !(saved in out)) out[saved] = `${saved} (not installed)`;
    return out;
  }

  /** "Open note" button for a palette row — opens the palette's note in a new tab. */
  private addOpenNoteButton(parent: HTMLElement, paletteName: string): void {
    parent.createEl("button", { text: "Edit", cls: "mod-cta" }).addEventListener("click", () => {
      void this.plugin.openPaletteEditor(paletteName);
    });
    const btn = parent.createEl("button", { text: "Open note" });
    btn.addEventListener("click", () => {
      const file = this.plugin.paletteStore.noteFor(paletteName);
      if (!file) {
        new Notice(`No note found for palette "${paletteName}" yet.`);
        return;
      }
      void this.app.workspace.getLeaf("tab").openFile(file);
    });
  }

  /**
   * The declarative page: the regular settings above the fold (`main`, then
   * `more`), Terrain palettes, then the collapsed Advanced dropdown with its
   * Debug subsection (only in debug mode), then the debug-mode switch at the
   * very bottom. Each setting's layer comes from the placement map
   * (src/ui/placement.ts), keyed by its `Settings.<control>` id.
   */
  private layoutDefinitions(
    tagged: { id: string; item: LocalSettingDefinitionItem }[],
    palettesSection: LocalSettingDefinitionItem[],
  ): LocalSettingDefinitionItem[] {
    // Every layer is laid out; Debug shows only while debug mode is on.
    const { main, more, advanced, debug } = partition(tagged, true);
    const open = () => disclosureOpen(this.app, SURFACE);
    const debugOn = () => isDebugMode(this.app);
    // Settings in a dropdown are flat rows: a group's rows go in without its heading.
    const flat = (items: LocalSettingDefinitionItem[]): LocalSettingDefinition[] =>
      items.flatMap((i) => ("type" in i && (i.type === "group" || i.type === "list") ? (i.items ?? []) : [i as LocalSettingDefinition]));
    const shownWhen = (items: LocalSettingDefinition[], when: () => boolean): LocalSettingDefinition[] =>
      items.map((i) => {
        const own = i.visible;
        return { ...i, visible: () => when() && (own === undefined || (typeof own === "function" ? own() : own)) };
      });
    const out: LocalSettingDefinitionItem[] = [...main, ...more, ...palettesSection];
    if (advanced.length || debug.length) {
      out.push({
        type: "group",
        cls: "duckmage-settings-advanced",
        items: [
          {
            name: "Advanced",
            desc: ADVANCED_DESC,
            aliases: ["folders"],
            render: (setting: Setting) => this.renderAdvancedRow(setting, () => this.requestDeclarativeRerender()),
          },
          ...shownWhen(flat(advanced), open),
        ],
      });
      if (debug.length)
        out.push({
          type: "group",
          heading: "Debug",
          cls: "duckmage-settings-debug",
          visible: () => open() && debugOn(),
          items: shownWhen(flat(debug), () => open() && debugOn()),
        });
    }
    out.push({
      type: "group",
      cls: "duckmage-settings-debug-mode",
      items: [this.debugModeDefinition()],
    });
    return out;
  }

  /** The Advanced dropdown's header row: click to open or close it (remembered on this device). */
  private renderAdvancedRow(setting: Setting, refresh: () => void): void {
    const open = disclosureOpen(this.app, SURFACE);
    setting.settingEl.addClass("duckmage-settings-advanced-row");
    setting.settingEl.toggleClass("is-open", open);
    setting.settingEl.setAttr("role", "button");
    setting.settingEl.setAttr("aria-expanded", String(open));
    setting.addExtraButton((b) =>
      b.setIcon(open ? "chevron-down" : "chevron-right").setTooltip(open ? "Hide advanced settings" : "Show advanced settings"),
    );
    setting.settingEl.addEventListener("click", () => {
      setDisclosureOpen(this.app, SURFACE, !open);
      refresh();
    });
  }

  /**
   * The debug-mode switch (both settings paths): the only way to turn debug
   * mode on. The first time on this device it asks first. The page redraws
   * through watchDebugMode.
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

  private requestDeclarativeRerender(): void {
    const tab = this as unknown as { update?: () => void };
    if (typeof tab.update !== "function") return;
    // update() → refreshCurrentPage() rebuilds the tab's children, which
    // resets the scroll position — actions mid-page (e.g. "Add palette")
    // jump the settings pane back to the top. The actual scroller varies
    // (containerEl or an ancestor in the settings modal), and Obsidian's
    // own node-insertion scroll keepers can re-zero it asynchronously
    // AFTER the rebuild — so capture every scrolled element in the chain
    // and re-assert the positions over several frames until they stick.
    const scrolled: { el: HTMLElement; top: number }[] = [];
    let el: HTMLElement | null = this.containerEl;
    while (el) {
      if (el.scrollTop > 0) scrolled.push({ el, top: el.scrollTop });
      el = el.parentElement;
    }
    tab.update();
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
   * label + toggle pairs in one setting row, shared by the declarative and
   * imperative paths. Uses standard ToggleComponents — addToggle puts
   * `.mod-toggle` on the row, which keeps Obsidian's narrow-pane layout
   * from stretching the controls (the old raw-checkbox composite row was
   * mangled below 400px pane width because it lacked that exemption).
   */
  private buildCollapseTogglesRow(setting: Setting): void {
    setting.setClass("duckmage-collapse-row");
    const add = (
      label: string,
      get: () => boolean,
      set: (v: boolean) => void,
    ) => {
      setting.controlEl.createSpan({
        text: label,
        cls: "duckmage-collapse-toggle-label",
      });
      setting.addToggle((t) =>
        t.setValue(get()).onChange(async (v) => {
          set(v);
          await this.plugin.saveSettings();
        }),
      );
    };
    add(
      "Terrain",
      () => this.plugin.settings.hexEditorTerrainCollapsed,
      (v) => {
        this.plugin.settings.hexEditorTerrainCollapsed = v;
      },
    );
    add(
      "Features",
      () => this.plugin.settings.hexEditorFeaturesCollapsed,
      (v) => {
        this.plugin.settings.hexEditorFeaturesCollapsed = v;
      },
    );
    add(
      "Notes",
      () => this.plugin.settings.hexEditorNotesCollapsed,
      (v) => {
        this.plugin.settings.hexEditorNotesCollapsed = v;
      },
    );
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.watchDebugMode(() => this.renderSettings());
    // Each row's layer comes from the placement map (Settings.<control> ids):
    // built above the fold, in the Advanced dropdown, in Debug, or nowhere
    // (a detached element) when it isn't shown.
    const disclosure = new Disclosure(this.app, SURFACE, () => containerEl);
    const at = (id: string): HTMLElement => disclosure.target(id, containerEl) ?? createDiv();

    new Setting(at("Settings.rerunSetupWizard"))
      .setName("Setup wizard")
      .setDesc("Re-open the setup wizard to reconfigure folders or create a new map.")
      .addButton((btn) =>
        btn
          .setButtonText("Re-run setup wizard")
          .onClick(() => {
            this.plugin.settings.setupDismissed = false;
            void this.plugin.saveSettings().then(() => this.plugin.openSetupWizard());
          }),
      );

    new Setting(at("Settings.defaultTableDice"))
      .setName("Default die for new tables")
      .setDesc(
        "Die size used when creating new random table notes (d6, d20, d100, etc.).",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("4", "D4")
          .addOption("6", "D6")
          .addOption("8", "D8")
          .addOption("10", "D10")
          .addOption("12", "D12")
          .addOption("20", "D20")
          .addOption("100", "D100")
          .addOption("200", "D200")
          .addOption("500", "D500")
          .addOption("1000", "D1000")
          .setValue(String(this.plugin.settings.defaultTableDice ?? 100))
          .onChange(async (value) => {
            this.plugin.settings.defaultTableDice = parseInt(value, 10);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.collapseSections"))
      .setName("Hex editor sections start collapsed")
      .setDesc(
        "Choose which sections open collapsed by default in the right-click hex editor.",
      )
      .then((setting) => this.buildCollapseTogglesRow(setting));

    new Setting(at("Settings.templatePath"))
      .setName("Template path")
      .setDesc(
        "Vault-relative path to a hex note template. Supports {{x}}, {{y}}, {{title}}. Include ### Towns, ### Dungeons, and ### Features headings for the link sections. Blank = hex.md in the templates folder.",
      )
      .addText((text) =>
        text
          .setPlaceholder("templates/hex.md")
          .setValue(this.plugin.settings.templatePath)
          .onChange(async (value) => {
            this.plugin.settings.templatePath = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.defaultMap"))
      .setName("Default map")
      .setDesc("The map opened when the hex map is launched.")
      .addDropdown((dropdown) => {
        for (const r of this.plugin.settings.maps) {
          dropdown.addOption(r.name, r.name);
        }
        dropdown
          .setValue(
            this.plugin.settings.defaultMap ??
              this.plugin.settings.maps[0]?.name ??
              "",
          )
          .onChange(async (value) => {
            this.plugin.settings.defaultMap = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(at("Settings.hexOrientation"))
      .setName("Hex orientation")
      .setDesc(
        "Pointy-top: points face north/south, flat sides east/west. Flat-top: flat sides face north/south, points east/west.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("pointy", "Pointy-top")
          .addOption("flat", "Flat-top")
          .setValue(this.plugin.settings.hexOrientation ?? "pointy")
          .onChange(async (value) => {
            this.plugin.settings.hexOrientation = value as "pointy" | "flat";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.staggerOffset"))
      .setName("Stagger offset")
      .setDesc(
        "Which set of columns (flat-top) or rows (pointy-top) is offset by half a hex. Affects how new maps render unless overridden per-map.",
      )
      .then((setting) => {
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
      });

    new Setting(at("Settings.coordPlacement"))
      .setName("Coordinate placement")
      .setDesc(
        "Where the coordinate label sits inside each hex. Move to top or bottom to keep it from clashing with a centered terrain icon.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("top", "Top")
          .addOption("middle", "Middle")
          .addOption("bottom", "Bottom")
          .setValue(this.plugin.settings.coordPlacement ?? "bottom")
          .onChange(async (value) => {
            this.plugin.settings.coordPlacement = value as
              | "top"
              | "middle"
              | "bottom";
            await this.plugin.saveSettings();
            this.plugin.refreshHexMap();
          }),
      );

    {
      const coordSetting = new Setting(at("Settings.coordFontSize"))
        .setName("Coordinate label")
        .setDesc(
          "Size (relative to the hex) and font for the coordinate label.",
        );
      const valueEl = coordSetting.controlEl.createSpan({
        cls: "duckmage-slider-value",
        text: (this.plugin.settings.coordFontSize ?? 0.8).toFixed(2),
      });
      coordSetting
        .addSlider((slider) =>
          slider
            .setLimits(0.5, 1.5, 0.05)
            .setValue(this.plugin.settings.coordFontSize ?? 0.8)
            .onChange(async (value) => {
              valueEl.setText(value.toFixed(2));
              this.plugin.settings.coordFontSize = value;
              await this.plugin.saveSettings();
              this.plugin.refreshHexMap();
            }),
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption("interface", "Interface")
            .addOption("serif", "Serif")
            .addOption("monospace", "Monospace")
            .setValue(this.plugin.settings.coordFontFamily ?? "interface")
            .onChange(async (value) => {
              this.plugin.settings.coordFontFamily = value as
                | "interface"
                | "serif"
                | "monospace";
              await this.plugin.saveSettings();
              this.plugin.refreshHexMap();
            }),
        )
        .addColorPicker((picker) =>
          picker
            .setValue(this.plugin.settings.coordFontColor ?? "#ffffff")
            .onChange(async (value) => {
              this.plugin.settings.coordFontColor = value;
              await this.plugin.saveSettings();
              this.plugin.refreshHexMap();
            }),
        );
    }

    {
      // Hex names (NM3): the default for maps without their own font.
      const font = resolveNameFont(undefined, this.plugin.settings);
      const save = async () => {
        await this.plugin.saveSettings();
        this.plugin.refreshHexMap();
      };
      new Setting(at("Settings.hexNameFont"))
        .setName("Hex name font")
        .setDesc("Default font, size and style for hex names on maps and in PNG exports. Each map can pick its own in the layers menu.")
        .addDropdown((dropdown) => {
          for (const f of NAME_FAMILIES) dropdown.addOption(f.id, f.label);
          dropdown.setValue(font.family).onChange(async (value) => {
            this.plugin.settings.hexNameFont = value;
            await save();
          });
        })
        .addDropdown((dropdown) => {
          for (const s of NAME_SIZES) dropdown.addOption(s.id, NAME_SIZE_TEXT[s.id]);
          dropdown.setValue(font.size ?? "medium").onChange(async (value) => {
            this.plugin.settings.hexNameSize = value;
            await save();
          });
        })
        .addDropdown((dropdown) => {
          for (const s of NAME_STYLES) dropdown.addOption(s.id, s.label);
          dropdown.setValue(nameStyleId(font.bold, font.italic)).onChange(async (value) => {
            this.plugin.settings.hexNameStyle = value;
            await save();
          });
        });
    }

    {
      const gapSetting = new Setting(at("Settings.hexGap"))
        .setName("Hex cell spacing")
        .setDesc("Gap between hex cells (0 – 0.5 em).");
      const currentGap =
        parseFloat(this.plugin.settings.hexGap ?? "0.15") || 0.15;
      const valueEl = gapSetting.controlEl.createSpan({
        cls: "duckmage-slider-value",
        text: currentGap.toFixed(2),
      });
      gapSetting.addSlider((slider) =>
        slider
          .setLimits(0, 0.5, 0.01)
          .setValue(currentGap)
          .onChange(async (value) => {
            valueEl.setText(value.toFixed(2));
            this.plugin.settings.hexGap = String(value);
            await this.plugin.saveSettings();
            this.plugin.refreshHexMap();
          }),
      );
    }

    new Setting(at("Settings.defaultNewMapCols"))
      .setName("Default new map size")
      .setDesc("Default columns and rows when creating a new top-level map.")
      .addText((text) =>
        text
          .setPlaceholder("Cols")
          .setValue(String(this.plugin.settings.defaultNewMapCols ?? 20))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (n > 0) { this.plugin.settings.defaultNewMapCols = n; await this.plugin.saveSettings(); }
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("Rows")
          .setValue(String(this.plugin.settings.defaultNewMapRows ?? 16))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (n > 0) { this.plugin.settings.defaultNewMapRows = n; await this.plugin.saveSettings(); }
          }),
      );

    new Setting(at("Settings.defaultSubmapCols"))
      .setName("Default submap size")
      .setDesc("Default columns and rows when creating a new submap.")
      .addText((text) =>
        text
          .setPlaceholder("Cols")
          .setValue(String(this.plugin.settings.defaultSubmapCols ?? 10))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (n > 0) { this.plugin.settings.defaultSubmapCols = n; await this.plugin.saveSettings(); }
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("Rows")
          .setValue(String(this.plugin.settings.defaultSubmapRows ?? 10))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (n > 0) { this.plugin.settings.defaultSubmapRows = n; await this.plugin.saveSettings(); }
          }),
      );

    new Setting(at("Settings.iconsFolder"))
      .setName("Custom icons folder")
      .setDesc(
        "Vault-relative folder containing additional icon images (PNG, JPG, SVG, etc.) for the terrain palette and hex icon override. These are merged with the built-in icons.",
      )
      .addText((text) =>
        text
          .setPlaceholder("Icons")
          .setValue(this.plugin.settings.iconsFolder ?? "")
          .onChange(async (value) => {
            this.plugin.settings.iconsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
            this.plugin.loadAvailableIcons();
          }),
      );

    new Setting(at("Settings.generateWorldData"))
      .setName("Generate terrain tables & hex links")
      .setDesc(
        "Creates missing terrain table notes, adds roller links to all table notes (so they can be opened in the hexmaker roller from within Obsidian), and links each hex note's terrain encounters table into its encounters table section. Set the folders first. Safe to run more than once: existing notes and links are not overwritten.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Generate")
          .setCta()
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

    new Setting(containerEl).setName("Path types").setHeading();
    containerEl.createEl("p", {
      text: "Roads, rivers and other path types belong to palettes. Edit them in the table in each palette note, or with the edit button in a map's path picker.",
      cls: "setting-item-description",
    });

    new Setting(at("Settings.worldFolder"))
      .setName("World notes folder")
      .setDesc(
        "Vault-relative path. Scopes the file search when adding links to hexes.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World.")
          .setValue(this.plugin.settings.worldFolder)
          .onChange(async (value) => {
            this.plugin.settings.worldFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.generateFolders"))
      .setName("Set up folders")
      .setDesc(
        "Populates any blank folder settings below with defaults under the world folder, then creates those folders in your vault. Only blank fields are affected — manually set values are left untouched.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Generate folders")
          .setCta()
          .onClick(async () => {
            const world =
              normalizeFolder(this.plugin.settings.worldFolder) || "world";
            const defaults: [keyof typeof this.plugin.settings, string][] = [
              ["hexFolder", `${world}/hexes`],
              ["townsFolder", `${world}/towns`],
              ["dungeonsFolder", `${world}/dungeons`],
              ["questsFolder", `${world}/quests`],
              ["featuresFolder", `${world}/features`],
              ["factionsFolder", `${world}/factions`],
              ["regionsFolder",  `${world}/regions`],
              ["tablesFolder", `${world}/tables`],
              ["workflowsFolder", `${world}/workflows`],
              ["templatesFolder", `${world}/templates`],
            ];
            for (const [key, path] of defaults) {
              if (!this.plugin.settings[key]) {
                (this.plugin.settings as unknown as Record<string, unknown>)[
                  key
                ] = path;
                try {
                  if (!this.app.vault.getAbstractFileByPath(path)) {
                    await this.app.vault.createFolder(path);
                  }
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
                totalCreated += await this.plugin.generateHexNotes(
                  map.name,
                  xs,
                  ys,
                );
              }
              if (totalCreated > 0)
                new Notice(
                  `Generated ${totalCreated} hex note${totalCreated !== 1 ? "s" : ""}.`,
                );
            }
            new Notice("Folders generated.");
            this.renderSettings();
          }),
      );

    new Setting(at("Settings.hexFolder"))
      .setName("Hex notes folder")
      .setDesc("Vault-relative path where hex notes (X_y.md) are stored.")
      .addText((text) =>
        text
          .setPlaceholder("World/hexes")
          .setValue(this.plugin.settings.hexFolder)
          .onChange(async (value) => {
            this.plugin.settings.hexFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.townsFolder"))
      .setName("Towns folder")
      .setDesc(
        "Vault-relative folder to populate the towns dropdown in the hex editor. Files starting with _ are excluded.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/towns")
          .setValue(this.plugin.settings.townsFolder)
          .onChange(async (value) => {
            this.plugin.settings.townsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.dungeonsFolder"))
      .setName("Dungeons folder")
      .setDesc(
        "Vault-relative folder to populate the dungeons dropdown in the hex editor. Files starting with _ are excluded.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/dungeons")
          .setValue(this.plugin.settings.dungeonsFolder)
          .onChange(async (value) => {
            this.plugin.settings.dungeonsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.questsFolder"))
      .setName("Quests folder")
      .setDesc(
        "Vault-relative folder to populate the quests dropdown in the hex editor. Files starting with _ are excluded.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/quests")
          .setValue(this.plugin.settings.questsFolder)
          .onChange(async (value) => {
            this.plugin.settings.questsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.featuresFolder"))
      .setName("Features folder")
      .setDesc(
        "Vault-relative folder to populate the features dropdown in the hex editor. Files starting with _ are excluded.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/features")
          .setValue(this.plugin.settings.featuresFolder)
          .onChange(async (value) => {
            this.plugin.settings.featuresFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.factionsFolder"))
      .setName("Factions folder")
      .setDesc(
        "Vault-relative folder to populate the factions dropdown in the hex editor. Files starting with _ are excluded.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/factions")
          .setValue(this.plugin.settings.factionsFolder)
          .onChange(async (value) => {
            this.plugin.settings.factionsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.regionsFolder"))
      .setName("Regions folder")
      .setDesc(
        "Vault-relative folder for geographic region notes (used by the region overlay paint tool). Files starting with _ are excluded.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/regions")
          .setValue(this.plugin.settings.regionsFolder)
          .onChange(async (value) => {
            this.plugin.settings.regionsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.tablesFolder"))
      .setName("Tables folder")
      .setDesc(
        "Vault-relative folder for random table notes. Used by the encounters table section and the random tables view.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/tables")
          .setValue(this.plugin.settings.tablesFolder)
          .onChange(async (value) => {
            this.plugin.settings.tablesFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.workflowsFolder"))
      .setName("Workflows folder")
      .setDesc(
        "Vault-relative folder for workflow notes. Browsable from the random tables view via the workflows tab.",
      )
      .addText((text) =>
        text
          .setPlaceholder("World/workflows")
          .setValue(this.plugin.settings.workflowsFolder)
          .onChange(async (value) => {
            this.plugin.settings.workflowsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.templatesFolder"))
      .setName("Templates folder")
      .setDesc(TEMPLATES_FOLDER_DESC)
      .addText((text) =>
        text
          .setPlaceholder("World/templates")
          .setValue(this.plugin.settings.templatesFolder ?? "")
          .onChange(async (value) => {
            this.plugin.settings.templatesFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.palettesFolder"))
      .setName("Palettes folder")
      .setDesc(PALETTES_FOLDER_DESC)
      .addText((text) =>
        text
          .setPlaceholder("World/palettes")
          .setValue(this.plugin.settings.palettesFolder)
          .onChange(async (value) => {
            this.plugin.settings.palettesFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(at("Settings.biomesFolder"))
      .setName("Biomes folder")
      .setDesc(BIOMES_FOLDER_DESC)
      .addText((text) =>
        text
          .setPlaceholder("World/biomes")
          .setValue(this.plugin.settings.biomesFolder ?? "")
          .onChange(async (value) => {
            this.plugin.settings.biomesFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
            void this.plugin.biomeStore.reload();
          }),
      );

    new Setting(at("Settings.biomePoolsFolder"))
      .setName("Biome pools folder")
      .setDesc(BIOME_POOLS_FOLDER_DESC)
      .addText((text) =>
        text
          .setPlaceholder("World/biome-pools")
          .setValue(this.plugin.settings.biomePoolsFolder ?? "")
          .onChange(async (value) => {
            this.plugin.settings.biomePoolsFolder = normalizeFolder(value ?? "");
            await this.plugin.saveSettings();
          }),
      );

    // Each module's folder settings (Space: World types folder).
    for (const d of moduleFolderSettings()) {
      const settings = this.plugin.settings as unknown as Record<string, unknown>;
      new Setting(at(d.id))
        .setName(d.name)
        .setDesc(d.desc)
        .addText((text) =>
          text
            .setPlaceholder(d.placeholder)
            .setValue(typeof settings[d.key] === "string" ? settings[d.key] as string : "")
            .onChange(async (value) => {
              settings[d.key] = normalizeFolder(value ?? "");
              await this.plugin.saveSettings();
              d.changed?.(this.plugin);
            }),
        );
    }

    new Setting(containerEl).setName("Map types").setHeading();
    for (const k of MAP_KINDS) {
      new Setting(containerEl)
        .setName(k.label)
        .setDesc(k.description)
        .addToggle((t) =>
          t.setValue(enabledKinds(this.plugin.settings).has(k.id))
            .onChange((v) => void this.setMapKind(k.id, v)),
        );
    }

    // Terrain palettes last — mirrors getSettingDefinitions() ordering
    // (see comment there: the declarative renderer re-appends a changed
    // list at the page end, so the list lives at the end in both paths).
    new Setting(containerEl).setName("Terrain palettes").setHeading();
    containerEl.createEl("p", {
      text: "Each region uses one palette. Assign a palette when creating a region — it cannot be changed after. Edit palette contents from the terrain tool on the hex map, or as a table in the palette's note.",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Palette for new maps")
      .setDesc(DEFAULT_PALETTE_DESC)
      .addDropdown((d) =>
        d
          .addOptions(this.defaultPaletteOptions())
          .setValue(this.plugin.settings.defaultPalette ?? "")
          .onChange(async (v) => {
            this.plugin.settings.defaultPalette = v;
            await this.plugin.saveSettings();
          }),
      );

    const missingDefaults = this.plugin.missingDefaultPalettes();
    if (missingDefaults.length) {
      new Setting(containerEl)
        .setName("Add default palettes")
        .setDesc(ADD_DEFAULTS_DESC)
        .addButton((b) =>
          b.setButtonText(`Add ${missingDefaults.join(" and ")}`).onClick(() => {
            void this.plugin.addDefaultPalettes().then(() => this.display());
          }),
        );
    }

    const palettes = this.plugin.settings.terrainPalettes;

    // The list redraws inside its own host, so what's below it stays below.
    const listHost = containerEl.createDiv();
    const renderPaletteList = () => {
      listHost.empty();
      const listEl = listHost.createDiv({
        cls: "duckmage-palette-mgmt-list",
      });

      for (let i = 0; i < palettes.length; i++) {
        const pal = palettes[i];
        const usedBy = this.plugin.settings.maps.filter(
          (r) => r.paletteName === pal.name,
        ).length;
        const rowEl = listEl.createDiv({ cls: "duckmage-palette-mgmt-row" });

        const nameInput = rowEl.createEl("input", {
          type: "text",
          value: pal.name,
        });
        nameInput.addClass("duckmage-palette-mgmt-name");
        nameInput.addEventListener("blur", () => {
          void (async () => {
            const trimmed = nameInput.value.trim();
            if (!trimmed || trimmed === pal.name) {
              nameInput.value = pal.name;
              return;
            }
            const isDupe = palettes.some(
              (p, j) =>
                j !== i && p.name.toLowerCase() === trimmed.toLowerCase(),
            );
            if (isDupe) {
              new Notice(`Palette "${trimmed}" already exists.`);
              nameInput.value = pal.name;
              return;
            }
            // Repoint maps, the new-map default and child palettes.
            repointPaletteName(this.plugin.settings, pal.name, trimmed);
            pal.name = trimmed;
            await this.plugin.saveSettings();
          })();
        });

        rowEl.createSpan({
          cls: "duckmage-palette-mgmt-badge",
          text: `(${usedBy} region${usedBy !== 1 ? "s" : ""})`,
        });

        this.addOpenNoteButton(rowEl, pal.name);

        const deleteBtn = rowEl.createEl("button", { text: "Delete" });
        deleteBtn.disabled = usedBy > 0 || palettes.length <= 1;
        deleteBtn.title =
          usedBy > 0
            ? "Cannot delete — in use by a region"
            : palettes.length <= 1
              ? "Cannot delete the last palette"
              : "";
        deleteBtn.addEventListener("click", () => {
          void (async () => {
            palettes.splice(i, 1);
            await this.plugin.saveSettings();
            renderPaletteList();
          })();
        });
      }

      new Setting(listEl).addButton((btn) =>
        btn.setButtonText("Add palette").onClick(() => {
          new AddPaletteModal(this.app, this.plugin, renderPaletteList).open();
        }),
      );
    };

    renderPaletteList();

    // The Advanced dropdown (with Debug inside) below everything else, then
    // the debug-mode switch at the very bottom.
    disclosure.toEnd();
    const debugRow = new Setting(containerEl).setName("Debug mode");
    const debugDef = this.debugModeDefinition();
    if (typeof debugDef.desc === "string") debugRow.setDesc(debugDef.desc);
    debugDef.render?.(debugRow);
  }
}
