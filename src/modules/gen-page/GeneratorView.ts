import { ItemView, type WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { GeneratorPanel } from "./GeneratorPanel";
import { worldMaps } from "../active";

/** The view type of the generator page (stable: workspaces saved it). */
export const VIEW_TYPE_GENERATOR = "duckmage-terrain-generator";

/** Full-page terrain generator (wave function collapse). */
export class GeneratorView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: HexmakerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GENERATOR;
  }

  getDisplayText(): string {
    return "Terrain generator";
  }

  getIcon(): string {
    return "wand-sparkles";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  /** Re-render, e.g. after the selected region or generator changed. */
  refresh(): void {
    this.contentEl.empty();
    this.render();
  }

  private render(): void {
    this.contentEl.addClass("duckmage-wfc-page");
    new GeneratorPanel(this.app, this.plugin, { rerender: () => this.render() }).render(this.contentEl);
  }

  async onClose(): Promise<void> {
    worldMaps()?.BiomePanel.dispose();
    this.contentEl.empty();
  }
}
