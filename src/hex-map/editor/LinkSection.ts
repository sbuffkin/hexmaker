/**
 * A link section of the hex editor (Towns, Dungeons, Quests, Factions,
 * Features): a combo box to link or create a note, the linked notes, and
 * "Show on map" (SF4: the section's icon as the hex's icon).
 */

import { Notice, TFile } from "obsidian";
import { canDo } from "../../modeGate";
import { getIconUrl, normalizeFolder } from "../../utils";
import { setIconOverrideInFile } from "../../frontmatter";
import { addLinkToSection, removeLinkFromSection, addBacklinkToFile } from "../../sections";
import type { LinkSection } from "../../types";
import { linkDisplayName } from "../../encounterLinks";
import { openNoteFocused } from "../../openNote";
import { linkNoteTemplatePathFor } from "../../noteTemplates";
import { withRepairHint } from "../../ui/repairHint";
import { linkSectionIcon, showOnMapOffer } from "../../play/linkIcons";
import { EditorWritePart, type EditorWriteHost } from "./host";

export interface LinkSectionHost extends EditorWriteHost {
  /** The hex's icon override as last read or written here. */
  directIcon: string | null;
  /** HexmakerModal.anchorDropdown: keep a dropdown on screen beside its input. */
  anchorDropdown(anchorEl: HTMLElement, dropdownEl: HTMLElement): { reposition: () => void; detach: () => void };
}

export class LinkSections extends EditorWritePart<LinkSectionHost> {
  private get directIcon(): string | null {
    return this.host.directIcon;
  }
  private set directIcon(icon: string | null) {
    this.host.directIcon = icon;
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

  renderDropdownSection(
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
      anchor = this.host.anchorDropdown(comboWrap, dropdown);
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
}
