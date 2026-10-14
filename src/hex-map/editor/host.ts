/**
 * What the hex editor's parts (src/hex-map/editor/*) need from the editor
 * (HexEditorModal). Each part takes the narrow host it uses; the modal
 * passes one object that answers all of them, reading its own fields live
 * (so a part sees the hex the editor is on now, as the code did when it
 * was all in the modal).
 */

import type { App, TFile } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { HexEditorOptions } from "../../types";
import type { SaveTracker } from "../saveStatus";

/** The editor's change callback: overrides the map can't read from its cache yet. */
export type HexEditorChanged = (
  terrainOverrides?: Map<string, string | null>,
  iconOverrides?: Map<string, string | null>,
  gmIconsOverrides?: Map<string, string[]>,
) => void;

/** The hex the editor is on. */
export interface EditorHexHost {
  readonly app: App;
  readonly plugin: HexmakerPlugin;
  readonly x: number;
  readonly y: number;
  readonly mapName: string;
  readonly options: HexEditorOptions;
}

/** A part that writes to the hex (tracked by the editor's save status). */
export interface EditorWriteHost extends EditorHexHost {
  readonly saves: SaveTracker;
  onChanged: HexEditorChanged;
  /** The hex note of (x, y), made if missing (default: the editor's hex). */
  ensureHexNote(x?: number, y?: number): Promise<TFile | null>;
  close(): void;
}

/** Base of the editor's parts: `this.app`, `this.mapName`… read through the host. */
export abstract class EditorPart<H extends EditorHexHost = EditorHexHost> {
  constructor(protected readonly host: H) {}
  protected get app(): App {
    return this.host.app;
  }
  protected get plugin(): HexmakerPlugin {
    return this.host.plugin;
  }
  protected get x(): number {
    return this.host.x;
  }
  protected get y(): number {
    return this.host.y;
  }
  protected get mapName(): string {
    return this.host.mapName;
  }
  protected get options(): HexEditorOptions {
    return this.host.options;
  }
}

/** A part that writes: `this.saves`, `this.onChanged()`, `this.ensureHexNote()`, `this.close()`. */
export abstract class EditorWritePart<H extends EditorWriteHost = EditorWriteHost> extends EditorPart<H> {
  protected get saves(): SaveTracker {
    return this.host.saves;
  }
  protected onChanged(...args: Parameters<HexEditorChanged>): void {
    this.host.onChanged(...args);
  }
  protected ensureHexNote(x?: number, y?: number): Promise<TFile | null> {
    return this.host.ensureHexNote(x, y);
  }
  protected close(): void {
    this.host.close();
  }
}
