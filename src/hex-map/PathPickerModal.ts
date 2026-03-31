import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { PathType } from "../types";
import { PathTypeEditorModal } from "./PathTypeEditorModal";

// ── Mini hex SVG preview for a path type ─────────────────────────────────────

export function buildPathPreviewSvg(pt: PathType): SVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "36");
  svg.setAttribute("height", "36");
  svg.setAttribute("viewBox", "0 0 36 36");

  // Hex polygon: radius 14, center (18,18), starting at 0° (right vertex)
  // Vertices: V0(32,18) right, V1(25,30) lower-right, V2(11,30) lower-left,
  //           V3(4,18) left,   V4(11,6) upper-left,  V5(25,6) upper-right
  const r = 14;
  const cx = 18, cy = 18;
  const hexPts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    hexPts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  const hex = document.createElementNS(svgNS, "polygon");
  hex.setAttribute("points", hexPts.join(" "));
  hex.setAttribute("fill", "var(--background-secondary)");
  hex.setAttribute("stroke", "var(--background-modifier-border)");
  hex.setAttribute("stroke-width", "1");
  svg.appendChild(hex);

  // Path line — shape depends on routing mode
  const DASH_ARRAYS: Record<string, string> = { solid: "", dashed: "4 2", dotted: "1.5 2" };
  const strokeW = String(Math.max(1, Math.min(pt.width, 4)) * 0.6);
  const dash = DASH_ARRAYS[pt.lineStyle] ?? "";

  let pathD: string;
  if (pt.routing === "edge") {
    // One vertex per shared edge: enters from left, hugs the lower-left boundary vertex,
    // crosses to the lower-right boundary vertex, exits right — one corner per hex.
    pathD = "M 4 18 L 11 30 L 32 18";
  } else if (pt.routing === "meander") {
    // Gentle curve through the lower third of the hex
    pathD = "M 4 18 Q 18 26 32 18";
  } else {
    // "through": straight line through hex center
    pathD = "M 4 18 L 32 18";
  }

  const pathEl = document.createElementNS(svgNS, "path");
  pathEl.setAttribute("d", pathD);
  pathEl.setAttribute("stroke", pt.color);
  pathEl.setAttribute("stroke-width", strokeW);
  pathEl.setAttribute("stroke-linecap", "round");
  pathEl.setAttribute("stroke-linejoin", "round");
  pathEl.setAttribute("fill", "none");
  if (dash) pathEl.setAttribute("stroke-dasharray", dash);
  svg.appendChild(pathEl);

  return svg;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export class PathPickerModal extends HexmakerModal {
  private editMode = false;
  private editChanged = false;
  private selectionMade = false;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private currentTypeName: string | null,
    private onSelect: (typeName: string) => void,
    private onDismiss?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.render();
  }

  onClose(): void {
    if (this.editChanged) {
      this.plugin.refreshHexMap();
    }
    if (!this.selectionMade) {
      this.onDismiss?.();
    }
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");

    const header = contentEl.createDiv({ cls: "duckmage-tpe-header" });
    header.createEl("h2", {
      text: this.editMode ? "Edit path types" : "Select path type",
    });
    const toggleBtn = header.createEl("button", {
      cls: "duckmage-tpe-edit-btn",
      text: this.editMode ? "← Done" : "✏ Edit",
    });
    toggleBtn.addEventListener("click", () => {
      this.editMode = !this.editMode;
      this.render();
    });

    if (this.editMode) {
      this.renderEditMode();
    } else {
      this.renderPickMode();
    }
  }

  private renderPickMode(): void {
    const { contentEl } = this;
    const pathTypes = this.plugin.settings.pathTypes;

    const section = contentEl.createDiv({ cls: "duckmage-editor-section" });
    const grid = section.createDiv({
      cls: "duckmage-terrain-picker duckmage-terrain-picker-full",
    });

    for (const pt of pathTypes) {
      const btn = grid.createDiv({ cls: "duckmage-terrain-option" });
      btn.toggleClass("is-selected", pt.name === this.currentTypeName);

      const preview = btn.createDiv({ cls: "duckmage-path-preview" });
      preview.appendChild(buildPathPreviewSvg(pt));

      btn.createSpan({ text: pt.name, cls: "duckmage-terrain-option-name" });
      btn.addEventListener("click", () => {
        this.selectionMade = true;
        this.currentTypeName = pt.name;
        this.onSelect(pt.name);
        this.close();
      });
    }

    if (pathTypes.length === 0) {
      grid.createEl("p", { text: "No path types defined. Switch to edit mode to add one.", cls: "duckmage-tpe-empty" });
    }
  }

  private renderEditMode(): void {
    const { contentEl } = this;
    const pathTypes = this.plugin.settings.pathTypes;

    const grid = contentEl.createDiv({
      cls: "duckmage-terrain-picker duckmage-terrain-picker-full",
    });
    let dragSrcIndex = -1;

    const renderTiles = () => {
      grid.empty();

      for (let i = 0; i < pathTypes.length; i++) {
        const pt = pathTypes[i];
        const tile = grid.createDiv({
          cls: "duckmage-terrain-option duckmage-terrain-option-editable",
        });
        tile.draggable = true;

        tile.createSpan({ cls: "duckmage-terrain-edit-grip", text: "⠿" });
        tile.createSpan({ cls: "duckmage-terrain-edit-pencil", text: "✏" });

        tile.addEventListener("click", () => {
          new PathTypeEditorModal(
            this.app,
            this.plugin,
            pt,
            () => { this.editChanged = true; renderTiles(); },
            () => { this.editChanged = true; renderTiles(); },
          ).open();
        });

        const preview = tile.createDiv({ cls: "duckmage-path-preview" });
        preview.appendChild(buildPathPreviewSvg(pt));

        tile.createSpan({ text: pt.name, cls: "duckmage-terrain-option-name" });

        // Drag-to-reorder
        tile.addEventListener("dragstart", (e: DragEvent) => {
          dragSrcIndex = i;
          tile.addClass("duckmage-palette-dragging");
          e.dataTransfer?.setDragImage(tile, 0, 0);
        });
        tile.addEventListener("dragend", () => {
          tile.removeClass("duckmage-palette-dragging");
          grid
            .querySelectorAll(".duckmage-palette-drop-target")
            .forEach((el) => el.classList.remove("duckmage-palette-drop-target"));
        });
        tile.addEventListener("dragover", (e: DragEvent) => {
          e.preventDefault();
          grid
            .querySelectorAll(".duckmage-palette-drop-target")
            .forEach((el) => el.classList.remove("duckmage-palette-drop-target"));
          tile.addClass("duckmage-palette-drop-target");
        });
        tile.addEventListener("drop", (e: DragEvent) => {
          e.preventDefault();
          if (dragSrcIndex === -1 || dragSrcIndex === i) return;
          const [moved] = pathTypes.splice(dragSrcIndex, 1);
          pathTypes.splice(i, 0, moved);
          dragSrcIndex = -1;
          this.editChanged = true;
          void this.plugin.saveSettings().then(() => renderTiles());
        });
      }

      // "+" add tile
      const addTile = grid.createDiv({
        cls: "duckmage-terrain-option duckmage-terrain-option-add",
      });
      addTile
        .createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-add" })
        .setText("+");
      addTile.createSpan({ text: "Add", cls: "duckmage-terrain-option-name" });
      addTile.addEventListener("click", () => {
        void (async () => {
        const newPt: PathType = { name: "New path", color: "#888888", width: 3, lineStyle: "solid", routing: "through" };
        pathTypes.push(newPt);
        this.editChanged = true;
        await this.plugin.saveSettings();
        renderTiles();
        new PathTypeEditorModal(
          this.app,
          this.plugin,
          newPt,
          () => { this.editChanged = true; renderTiles(); },
          () => { this.editChanged = true; renderTiles(); },
        ).open();
        })();
      });
    };

    renderTiles();
  }
}
