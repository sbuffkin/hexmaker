import { TFile, type App } from "obsidian";
import { templateFileCandidates, type WorkflowStep } from "./workflow";
import { dieLabel, parseRandomTable } from "./randomTable";
import { isNoteInside } from "../vault/safePaths";
import { ensureFolder } from "../vault/ensureFolder";
import { contentFolder, worldFolderOf } from "../notePickers";

/**
 * The note a workflow's `template-file` names, however it was typed (a
 * path with or without ".md", a quoted wiki-link), or null. Only Markdown
 * notes count: a template is text, never an image or a PDF.
 */
export function resolveWorkflowTemplate(app: App, raw: string | undefined, sourcePath: string): TFile | null {
  const candidates = templateFileCandidates(raw);
  const isNote = (f: unknown): f is TFile => f instanceof TFile && f.extension.toLowerCase() === "md";
  for (const p of candidates) {
    const f = app.vault.getAbstractFileByPath(p);
    if (isNote(f)) return f;
  }
  if (candidates[0]) {
    const linked = app.metadataCache.getFirstLinkpathDest(candidates[0].replace(/\.md$/i, ""), sourcePath);
    if (isNote(linked)) return linked;
  }
  return null;
}

/**
 * The folders the workflow editor may write a template in: the workflows
 * folder and the world folder. A `template-file` comes from note text (a
 * pack, a synced vault), so it must not aim the editor's save at any
 * other note.
 */
export function templateRoots(settings: { worldFolder?: string; workflowsFolder?: string }): string[] {
  return [contentFolder(settings, "workflowsFolder"), worldFolderOf(settings)];
}

/** Whether the workflow editor may write a template at `path` (a safe .md path under `roots`). */
export function isWritableTemplate(path: string, roots: readonly string[]): boolean {
  return isNoteInside(path, roots);
}

/** What the template's save should do, given the text read at open and the text on disk now. */
export type TemplateSave = "skip" | "write" | "stale";

/**
 * The workflow editor's template save: nothing when the text wasn't
 * changed, a write when the note on disk is still what was read at open
 * (`null` = there was no note), else "stale" (it was edited elsewhere
 * meanwhile, so the save would overwrite that: refuse, never merge
 * silently).
 */
export function templateSave(readAtOpen: string | null, edited: string, onDiskNow: string | null): TemplateSave {
  if (readAtOpen !== null && edited === readAtOpen) return "skip";
  return onDiskNow === readAtOpen ? "write" : "stale";
}

/** Where a new template file goes for a hand-set `template-file` that doesn't exist yet. */
export function newTemplatePath(raw: string | undefined): string | null {
  const candidates = templateFileCandidates(raw);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/**
 * Save the workflow editor's template text to `target` (the note read at
 * open, or the path a new one goes to). Nothing is written when the text
 * wasn't changed; "stale" (nothing written) when the note was changed or
 * made elsewhere since `atOpen` was read, checked again inside the write.
 */
export async function saveWorkflowTemplate(app: App, target: TFile | string, atOpen: string | null, text: string): Promise<TemplateSave> {
  const path = target instanceof TFile ? target.path : target;
  const now = app.vault.getAbstractFileByPath(path);
  const onDisk = now instanceof TFile ? await app.vault.read(now) : null;
  let verdict = templateSave(atOpen, text, onDisk);
  if (verdict !== "write") return verdict;
  if (now instanceof TFile) {
    await app.vault.process(now, (current) => {
      if (current === atOpen) return text;
      verdict = "stale";
      return current;
    });
    return verdict;
  }
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (dir) await ensureFolder(app.vault, dir);
  await app.vault.create(path, text);
  return verdict;
}

/** A table step's table file (exact path first, then link resolution). */
export function resolveStepTable(app: App, step: WorkflowStep, sourcePath: string): TFile | null {
  if (step.kind !== "table" || !step.tablePath) return null;
  const f =
    app.vault.getAbstractFileByPath(step.tablePath + ".md") ??
    app.metadataCache.getFirstLinkpathDest(step.tablePath, sourcePath);
  return f instanceof TFile ? f : null;
}

/** Each table step's die ("d12", "" without one), by table path; for the Die column. */
export async function stepDieLabels(app: App, steps: WorkflowStep[], sourcePath: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const step of steps) {
    if (step.kind !== "table" || out.has(step.tablePath)) continue;
    const file = resolveStepTable(app, step, sourcePath);
    if (!file) continue;
    try {
      out.set(step.tablePath, dieLabel(parseRandomTable(await app.vault.cachedRead(file)).dice));
    } catch {
      /* unreadable: the row keeps the die it had */
    }
  }
  return out;
}
