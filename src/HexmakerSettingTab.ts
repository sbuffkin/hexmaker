import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type HexmakerPlugin from "./HexmakerPlugin";
import { normalizeFolder } from "./utils";

export class HexmakerSettingTab extends PluginSettingTab {
  plugin: HexmakerPlugin;

  constructor(app: App, plugin: HexmakerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
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

    new Setting(containerEl)
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
              ["tablesFolder", `${world}/tables`],
              ["workflowsFolder", `${world}/workflows`],
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
            // Ensure all region subfolders exist and generate hex notes
            const hexF = normalizeFolder(this.plugin.settings.hexFolder);
            if (hexF) {
              let totalCreated = 0;
              for (const region of this.plugin.settings.regions) {
                const regionFolder = `${hexF}/${region.name}`;
                if (!this.app.vault.getAbstractFileByPath(regionFolder)) {
                  try {
                    await this.app.vault.createFolder(regionFolder);
                  } catch {
                    /* exists */
                  }
                }
                const { cols, rows } = region.gridSize;
                const { x: ox, y: oy } = region.gridOffset;
                const xs = Array.from({ length: cols }, (_, i) => ox + i);
                const ys = Array.from({ length: rows }, (_, i) => oy + i);
                totalCreated += await this.plugin.generateHexNotes(
                  region.name,
                  xs,
                  ys,
                );
              }
              if (totalCreated > 0)
                new Notice(
                  `Hexmaker: generated ${totalCreated} hex note${totalCreated !== 1 ? "s" : ""}.`,
                );
            }
            new Notice("Folders generated.");
            this.display();
          }),
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Hex editor sections start collapsed")
      .setDesc(
        "Choose which sections open collapsed by default in the right-click hex editor.",
      )
      .then((setting) => {
        const addCb = (
          label: string,
          get: () => boolean,
          set: (v: boolean) => void,
        ) => {
          const lbl = setting.controlEl.createEl("label", {
            cls: "duckmage-collapse-cb-label",
          });
          const cb = lbl.createEl("input");
          cb.type = "checkbox";
          cb.checked = get();
          cb.addEventListener("change", () => {
            void (async () => {
              set(cb.checked);
              await this.plugin.saveSettings();
            })();
          });
          lbl.appendText(label);
        };
        addCb(
          "Terrain",
          () => this.plugin.settings.hexEditorTerrainCollapsed,
          (v) => {
            this.plugin.settings.hexEditorTerrainCollapsed = v;
          },
        );
        addCb(
          "Features",
          () => this.plugin.settings.hexEditorFeaturesCollapsed,
          (v) => {
            this.plugin.settings.hexEditorFeaturesCollapsed = v;
          },
        );
        addCb(
          "Notes",
          () => this.plugin.settings.hexEditorNotesCollapsed,
          (v) => {
            this.plugin.settings.hexEditorNotesCollapsed = v;
          },
        );
      });

    new Setting(containerEl)
      .setName("Template path")
      .setDesc(
        "Vault-relative path to a hex note template. Supports {{x}}, {{y}}, {{title}}. Include ## Towns, ## Dungeons, and ## Features headings for the link sections.",
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

    new Setting(containerEl)
      .setName("Default region")
      .setDesc("The region opened when the hex map is launched.")
      .addDropdown((dropdown) => {
        for (const r of this.plugin.settings.regions) {
          dropdown.addOption(r.name, r.name);
        }
        dropdown
          .setValue(
            this.plugin.settings.defaultRegion ??
              this.plugin.settings.regions[0]?.name ??
              "",
          )
          .onChange(async (value) => {
            this.plugin.settings.defaultRegion = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Hex cell spacing")
      .setDesc("Gap between hex cells (0 – 0.5 em).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 0.5, 0.01)
          .setValue(parseFloat(this.plugin.settings.hexGap ?? "0.15") || 0.15)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.hexGap = String(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
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
            await this.plugin.loadAvailableIcons();
          }),
      );

    new Setting(containerEl).setName("Generate world data").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description duckmage-generate-warning",
      text: "⚠️ configure all folder settings above before selecting generate. This will create terrain table notes, add roller links to all table notes, and link each hex note to its terrain's encounters table. Safe to run multiple times — existing notes and links are not overwritten.",
    });
    new Setting(containerEl)
      .setName("Generate terrain tables & hex links")
      .setDesc(
        "Creates missing terrain table notes, adds roller links to all table notes (so they can be opened in the hexmaker roller from within Obsidian), and links each hex note's terrain encounters table into its encounters table section.",
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
            } finally {
              btn.setDisabled(false);
              btn.setButtonText("Generate");
            }
          }),
      );

    new Setting(containerEl).setName("Path types").setHeading();
    containerEl.createEl("p", {
      text: "Path types define the available drawing tools (roads, rivers, etc.). Edit them from the path tool on the hex map.",
      cls: "setting-item-description",
    });
    const pathList = containerEl.createDiv({ cls: "duckmage-path-type-list" });
    for (const pt of this.plugin.settings.pathTypes) {
      const row = pathList.createDiv({ cls: "duckmage-path-type-row" });
      const swatch = row.createSpan({ cls: "duckmage-path-type-swatch" });
      swatch.style.backgroundColor = pt.color;
      row.createSpan({
        text: `${pt.name}  (${pt.width}px, ${pt.lineStyle}, ${pt.routing})`,
      });
    }

    new Setting(containerEl).setName("Terrain palettes").setHeading();
    containerEl.createEl("p", {
      text: "Each region uses one palette. Assign a palette when creating a region — it cannot be changed after. Edit palette contents from the terrain tool on the hex map.",
      cls: "setting-item-description",
    });

    const palettes = this.plugin.settings.terrainPalettes;

    const renderPaletteList = () => {
      const existingList = containerEl.querySelector(
        ".duckmage-palette-mgmt-list",
      );
      if (existingList) existingList.remove();

      const listEl = containerEl.createDiv({
        cls: "duckmage-palette-mgmt-list",
      });

      for (let i = 0; i < palettes.length; i++) {
        const pal = palettes[i];
        const usedBy = this.plugin.settings.regions.filter(
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
            // Update any regions using this palette
            for (const r of this.plugin.settings.regions) {
              if (r.paletteName === pal.name) r.paletteName = trimmed;
            }
            pal.name = trimmed;
            await this.plugin.saveSettings();
          })();
        });

        rowEl.createSpan({
          cls: "duckmage-palette-mgmt-badge",
          text: `(${usedBy} region${usedBy !== 1 ? "s" : ""})`,
        });

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
        btn.setButtonText("Add palette").onClick(async () => {
          palettes.push({
            name: "New palette",
            terrains:
              this.plugin.settings.terrainPalettes[0]?.terrains.map((t) => ({
                ...t,
              })) ?? [],
          });
          await this.plugin.saveSettings();
          renderPaletteList();
        }),
      );
    };

    renderPaletteList();
  }
}
