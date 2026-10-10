import { TFile, type App } from "obsidian";
import { templateFileCandidates, type WorkflowStep } from "./workflow";
import { dieLabel, parseRandomTable } from "./randomTable";

/**
 * The note a workflow's `template-file` names, however it was typed (a
 * path with or without ".md", a quoted wiki-link), or null.
 */
export function resolveWorkflowTemplate(app: App, raw: string | undefined, sourcePath: string): TFile | null {
  const candidates = templateFileCandidates(raw);
  for (const p of candidates) {
    const f = app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) return f;
  }
  if (candidates[0]) {
    const linked = app.metadataCache.getFirstLinkpathDest(candidates[0].replace(/\.md$/i, ""), sourcePath);
    if (linked instanceof TFile) return linked;
  }
  return null;
}

/** Where a new template file goes for a hand-set `template-file` that doesn't exist yet. */
export function newTemplatePath(raw: string | undefined): string | null {
  const candidates = templateFileCandidates(raw);
  return candidates.length ? candidates[candidates.length - 1] : null;
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
