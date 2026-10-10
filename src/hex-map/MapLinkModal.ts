import { App, Setting } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";

export class MapLinkModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private onInsert: (mapName: string, linkText: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");
    this.makeDraggable();

    contentEl.createEl("h2", { text: "Insert map link" });

    const maps = this.plugin.settings.maps;
    if (maps.length === 0) {
      contentEl.createEl("p", {
        text: "No maps found. Create a map first.",
        cls: "duckmage-maplinkmodal-empty",
      });
      contentEl.createEl("button", { text: "Cancel" })
        .addEventListener("click", () => this.close());
      return;
    }

    let selectedMap = maps[0].name;
    let linkTextInput!: HTMLInputElement;

    // ── Map combo ─────────────────────────────────────────────────────────
    const mapLabel = contentEl.createDiv({ cls: "setting-item" });
    mapLabel.createDiv({ cls: "setting-item-info" }).createDiv({
      cls: "setting-item-name",
      text: "Map",
    });

    const controlEl = mapLabel.createDiv({ cls: "setting-item-control" });
    const comboWrap = controlEl.createDiv({ cls: "duckmage-link-combo" });
    const mapInput = comboWrap.createEl("input", {
      type: "text",
      cls: "duckmage-link-combo-input",
      attr: { placeholder: "Filter maps…" },
    });
    mapInput.value = "";

    comboWrap.createEl("button", {
      text: "▾",
      cls: "duckmage-link-combo-arrow",
      attr: { title: "Show all" },
    }).addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (dropdown.isShown()) closeDropdown();
      else openDropdown(mapInput.value);
    });

    const dropdown = comboWrap.createDiv({ cls: "duckmage-link-combo-dropdown" });
    dropdown.hide();

    let isOpen = false;

    const populateDropdown = (query: string) => {
      dropdown.empty();
      const q = query.trim().toLowerCase();
      const matches = maps.filter((m) => !q || m.name.toLowerCase().includes(q) || this.plugin.mapLabel(m.name).toLowerCase().includes(q));
      if (matches.length === 0) {
        dropdown.createDiv({ cls: "duckmage-link-combo-empty", text: "No matching maps" });
        return;
      }
      for (const m of matches) {
        const item = dropdown.createDiv({ cls: "duckmage-link-combo-item" });
        item.textContent = this.plugin.mapLabel(m.name);
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectedMap = m.name;
          mapInput.value = this.plugin.mapLabel(m.name);
          if (!linkTextInput.value.trim()) linkTextInput.value = this.plugin.mapLabel(m.name);
          closeDropdown();
        });
      }
    };

    let anchor: { reposition: () => void; detach: () => void } | null = null;

    const openDropdown = (query: string) => {
      isOpen = true;
      populateDropdown(query);
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

    mapInput.addEventListener("focus", () => openDropdown(""));
    mapInput.addEventListener("blur", () => window.setTimeout(() => closeDropdown(), 150));
    mapInput.addEventListener("input", () => {
      if (!isOpen) openDropdown(mapInput.value);
      else {
        populateDropdown(mapInput.value);
        anchor?.reposition();
      }
    });
    mapInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDropdown();
    });

    // ── Link text ─────────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName("Link text")
      .addText((t) => {
        linkTextInput = t.inputEl;
        t.setValue("");
      });

    // ── Buttons ───────────────────────────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    btnRow.createEl("button", { text: "Insert", cls: "mod-cta" })
      .addEventListener("click", () => {
        const typed = mapInput.value.trim();
        // The box shows display names; link the slug.
        const lc = typed.toLowerCase();
        const map = !typed ? selectedMap
          : maps.find((m) => m.name === selectedMap && this.plugin.mapLabel(m.name) === typed)?.name
            ?? maps.find((m) => m.name.toLowerCase() === lc || this.plugin.mapLabel(m.name).toLowerCase() === lc)?.name
            ?? typed;
        const text = linkTextInput.value.trim() || this.plugin.mapLabel(map);
        this.close();
        this.onInsert(map, text);
      });
    btnRow.createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
