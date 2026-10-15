/**
 * What the generator page's section renderers (src/worldgen/genPage/*)
 * share while one generator is shown: GeneratorPanel.renderGenerator
 * builds one GeneratorPageCtx and passes it to each section in page order.
 */

import type { App, TFile } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GeneratorFile } from "../generators";
import type { GeneratorSave } from "../saveFormat";
import type { GeneratorSettings, HexWfcModel } from "../../../packages/hex-wfc/src";

/** A generator shown on the page: a file, or an unsaved draft (file null). */
export type ShownGenerator = Omit<GeneratorFile, "file"> & { file: TFile | null };

/** The page's host: redraws the whole page (e.g. after learning a new generator). */
export interface GeneratorPageHost {
  rerender(): void;
}

/** The panel's own preview numbers (they live as long as the panel). */
export interface GeneratorPageLocal {
  seed: number;
  previewCols: number;
  previewRows: number;
  previewTimer: number | null;
}

export interface GeneratorPageCtx {
  readonly app: App;
  readonly plugin: HexmakerPlugin;
  readonly host: GeneratorPageHost;
  /** The generator shown. */
  readonly g: ShownGenerator;
  readonly model: HexWfcModel;
  /** The generator's file; null for an unsaved draft, which lives only in memory. */
  readonly file: TFile | null;
  /** The shown generator with its file, or null for a draft. */
  readonly saved: GeneratorFile | null;
  /** The page palette's terrain colours. */
  readonly colors: Map<string, string>;
  /** The page's region (map) name. */
  readonly mapName: string;
  /** Every generator file, once listed (neighbour regions blend with the one they were made from). */
  readonly generators: GeneratorFile[];
  /** The panel's seed, preview size and preview timer. */
  readonly local: GeneratorPageLocal;
  /** The page palette's terrain names. */
  readonly paletteTerrains: () => string[];
  /** Current settings, kept in sync with the file. */
  readonly s: () => Required<GeneratorSettings>;
  /** Change settings (undefined deletes a key): in memory, then the file, then the preview. */
  readonly save: (patch: Partial<Record<keyof GeneratorSettings, unknown>>) => void;
  /** The last settings write, for anything that must re-read the file after it. */
  readonly lastWrite: Promise<void>;
  /** The save is of this generator (by path, or by name). */
  readonly isThisGenerator: (sv: GeneratorSave) => boolean;
  /** Put a control where the placement map says (src/ui/placement.ts), by GenPage.<id>. */
  readonly place: (id: string, control: HTMLElement) => void;
  /** A section whose controls all moved to Advanced or Debug goes. */
  readonly dropIfEmpty: (body: HTMLElement) => void;
  /** A titled, foldable group of controls; returns its body (GeneratorPanel.section). */
  readonly section: (el: HTMLElement, text: string) => HTMLElement;
  /** Redraw the preview shortly (or say why a large map waits). */
  readonly schedulePreview: () => void;
  /** Share readouts in the Terrain mix table (filled by it, written by the preview). */
  readonly shareCells: Map<string, { now: HTMLElement; change: HTMLElement }>;
  /** Path rows (filled by the Paths section, written by the preview). */
  readonly pathRows: Map<string, { placed: HTMLElement; count: HTMLInputElement; auto: number }>;
  /** Each path type's "placed of wanted" total in its group header. */
  readonly pathGroupPlaced: Map<string, { el: HTMLElement; routes: string[] }>;
  /** The last drawn preview, so hovering a path row can redraw it with that route highlighted. */
  readonly preview: { lastDraw: ((highlight?: string) => void) | null; hoveredRoute: string | undefined };
}
