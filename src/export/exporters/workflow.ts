/**
 * Workflow exporter (Phase 1, item 1.6).
 *
 * Produces a PDF showing the workflow definition (steps table + template)
 * plus N rolled sample outputs. Reuses the existing roll logic from
 * `random-tables/workflow.ts` and `random-tables/randomTable.ts`.
 *
 * Structure:
 *   # {workflow name}
 *   {description if any}
 *   ## Steps          — table of (#, Table/Formula, Rolls, Label)
 *   ## Template       — fenced code block of the raw template
 *   ## Sample outputs — N <section> blocks, each with the rolled values
 *                       breakdown table + the template filled with those values
 */

import { Notice, TFile, type App } from "obsidian";
import { exportToPdfBytes } from "../pdfExporter";
import { renderMarkdownToHtml } from "../htmlRenderer";
import { ensureExportFolder } from "../exportFolder";
import { stripFrontmatter, serializeMarkdown } from "../mdSerializer";
import {
  parseWorkflow,
  stepPlaceholder,
  rollDiceFormulaWithBreakdown,
  type Workflow,
  type WorkflowStep,
} from "../../random-tables/workflow";
import {
  parseRandomTable,
  rollOnTable,
} from "../../random-tables/randomTable";
import { normalizeFolder } from "../../utils";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { fillPlaceholders, escapeTableCell } from "../../textUtils";
import { openExported } from "../exportFolder";

export interface WorkflowExportOptions {
  /** Filename stem (no extension). Defaults to workflow basename. */
  outputName?: string;
  /** Number of sample outputs to roll. Default 5. */
  numSamples?: number;
  /** Include the raw template content. Default true. */
  includeTemplate?: boolean;
  /** Include the per-sample rolls breakdown table. Default true. */
  includeRollsBreakdown?: boolean;
}

export async function exportWorkflowAsPdf(
  plugin: HexmakerPlugin,
  workflowFile: TFile,
  opts: WorkflowExportOptions = {},
): Promise<void> {
  const folder = await ensureExportFolder(plugin);
  const stem =
    (opts.outputName ?? workflowFile.basename).trim() || workflowFile.basename;
  const outPath = `${folder}/${sanitiseFilename(stem)}.pdf`;

  const notice = new Notice(`Exporting ${stem}.pdf…`, 0);
  try {
    const md = await buildWorkflowMarkdown(plugin, workflowFile, opts);
    const rendered = await renderMarkdownToHtml({
      app: plugin.app,
      title: workflowFile.basename,
      sourcePath: workflowFile.path,
      markdown: md,
    });
    const pdfBytes = await exportToPdfBytes(rendered, {
      pageSize: "Letter",
      displayHeaderFooter: true,
      footerTemplate: `<div style="width: 100%; font-size: 9px; text-align: center; color: #666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    await writeBinaryToVault(plugin.app, outPath, pdfBytes);
    new Notice(`Exported to ${outPath}`);
    void openInVault(plugin.app, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Export failed: ${(err as Error).message ?? err}`);
  } finally {
    notice.hide();
  }
}

export async function exportWorkflowAsMarkdown(
  plugin: HexmakerPlugin,
  workflowFile: TFile,
  opts: WorkflowExportOptions = {},
): Promise<void> {
  const folder = await ensureExportFolder(plugin);
  const stem =
    (opts.outputName ?? workflowFile.basename).trim() || workflowFile.basename;
  const outPath = `${folder}/${sanitiseFilename(stem)}.md`;
  try {
    const md = await buildWorkflowMarkdown(plugin, workflowFile, opts);
    const finalMd = serializeMarkdown(md, { wikilinks: "preserve" });
    await writeTextToVault(plugin.app, outPath, finalMd);
    new Notice(`Exported to ${outPath}`);
    void openInVault(plugin.app, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Export failed: ${(err as Error).message ?? err}`);
  }
}

// ── Markdown builder ──────────────────────────────────────────────────────

/**
 * Build the workflow PDF markdown. Reads the workflow + template files from
 * the vault, rolls the requested number of samples, and assembles the full
 * document. Exported for integration tests.
 */
export async function buildWorkflowMarkdown(
  plugin: HexmakerPlugin,
  workflowFile: TFile,
  opts: WorkflowExportOptions = {},
): Promise<string> {
  const numSamples = Math.max(0, opts.numSamples ?? 5);
  const includeTemplate = opts.includeTemplate ?? true;
  const includeBreakdown = opts.includeRollsBreakdown ?? true;

  const raw = await plugin.app.vault.read(workflowFile);
  const workflow = parseWorkflow(raw, workflowFile.basename);
  const template = await loadTemplate(plugin, workflow, workflowFile);

  const lines: string[] = [];

  lines.push(`# ${workflowFile.basename}`);
  lines.push("");
  if (workflow.description) {
    lines.push(workflow.description.trim());
    lines.push("");
  }

  // ── Steps table ──────────────────────────────────────────────────────
  lines.push(`## Steps`);
  lines.push("");
  lines.push(`| # | Table / Formula | Rolls | Label |`);
  lines.push(`| --- | --- | --- | --- |`);
  workflow.steps.forEach((step, i) => {
    const tableCell =
      step.kind === "dice" ? (step.diceFormula ?? "") : step.tablePath;
    lines.push(
      `| ${i + 1} | ${escapeTableCell(tableCell)} | ${step.rolls} | ${escapeTableCell(step.label ?? "")} |`,
    );
  });
  lines.push("");

  // ── Template ─────────────────────────────────────────────────────────
  if (includeTemplate && template) {
    lines.push(`## Template`);
    lines.push("");
    lines.push("```");
    lines.push(stripFrontmatter(template).trim());
    lines.push("```");
    lines.push("");
  }

  // ── Samples ──────────────────────────────────────────────────────────
  if (numSamples > 0 && workflow.steps.length > 0) {
    lines.push(`## Sample outputs`);
    lines.push("");
    for (let i = 0; i < numSamples; i++) {
      const sample = await rollWorkflowSample(plugin, workflow, workflowFile);
      lines.push(`<section class="duckmage-workflow-sample">`);
      lines.push("");
      lines.push(`### Sample ${i + 1}`);
      lines.push("");
      if (includeBreakdown) {
        lines.push(...formatRollsBreakdown(workflow, sample.rolls));
      }
      const filled = fillTemplate(template, workflow, sample.rolls);
      if (filled.trim()) {
        lines.push("");
        lines.push(filled.trim());
      }
      lines.push("");
      lines.push(`</section>`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Sample generation ────────────────────────────────────────────────────

interface WorkflowSample {
  /** rolls[stepIdx][rollIdx] = rolled value (string) */
  rolls: string[][];
}

async function rollWorkflowSample(
  plugin: HexmakerPlugin,
  workflow: Workflow,
  workflowFile: TFile,
): Promise<WorkflowSample> {
  const rolls: string[][] = [];
  for (const step of workflow.steps) {
    const stepRolls: string[] = [];
    for (let r = 0; r < step.rolls; r++) {
      stepRolls.push(await rollSingleStep(plugin, step, workflowFile));
    }
    rolls.push(stepRolls);
  }
  return { rolls };
}

async function rollSingleStep(
  plugin: HexmakerPlugin,
  step: WorkflowStep,
  workflowFile: TFile,
): Promise<string> {
  if (step.kind === "dice") {
    return rollDiceFormulaWithBreakdown(step.diceFormula ?? "1d6");
  }
  const tableFile =
    plugin.app.vault.getAbstractFileByPath(step.tablePath + ".md") ??
    plugin.app.metadataCache.getFirstLinkpathDest(
      step.tablePath,
      workflowFile.path,
    );
  if (!(tableFile instanceof TFile)) {
    return `[missing: ${step.tablePath}]`;
  }
  const content = await plugin.app.vault.read(tableFile);
  const table = parseRandomTable(content);
  const entry = rollOnTable(table);
  if (!entry) return `[empty table: ${step.tablePath}]`;
  return entry.isLink
    ? (entry.result.split("/").pop() ?? entry.result)
    : entry.result;
}

/** Resolve and read the workflow's template file, if specified. */
async function loadTemplate(
  plugin: HexmakerPlugin,
  workflow: Workflow,
  workflowFile: TFile,
): Promise<string> {
  if (!workflow.templateFile) return "";
  // Template may be stored as a vault-relative path (with or without .md) or
  // an Obsidian link target — try both.
  const tf =
    plugin.app.vault.getAbstractFileByPath(workflow.templateFile + ".md") ??
    plugin.app.vault.getAbstractFileByPath(workflow.templateFile) ??
    plugin.app.metadataCache.getFirstLinkpathDest(
      workflow.templateFile,
      workflowFile.path,
    );
  if (!(tf instanceof TFile)) return "";
  return await plugin.app.vault.read(tf);
}

// ── Pure helpers (exported for tests) ────────────────────────────────────

/**
 * Substitute placeholders in a template with rolled values. Same algorithm
 * as `WorkflowWizardModal.assembleResult` but with no DOM dependencies. Pure.
 */
export function fillTemplate(
  template: string,
  workflow: Workflow,
  rolls: string[][],
): string {
  if (!template) return "";
  const values = new Map<string, string>();
  for (let si = 0; si < workflow.steps.length; si++) {
    const step = workflow.steps[si];
    const stepRolls = rolls[si] ?? [];
    for (let ri = 0; ri < step.rolls; ri++) {
      const placeholder = stepPlaceholder(step, ri);
      values.set(placeholder, stepRolls[ri] ?? `[${placeholder}]`);
    }
  }
  return fillPlaceholders(template, values);
}

/**
 * Format a per-sample rolls breakdown as a small markdown table. Pure.
 * Returns an array of markdown lines (no trailing blank line).
 */
export function formatRollsBreakdown(
  workflow: Workflow,
  rolls: string[][],
): string[] {
  if (workflow.steps.length === 0) return [];
  const out: string[] = [];
  out.push(`| Step | Label | Roll | Value |`);
  out.push(`| --- | --- | --- | --- |`);
  workflow.steps.forEach((step, si) => {
    const label =
      step.label ??
      (step.kind === "dice"
        ? (step.diceFormula ?? "")
        : (step.tablePath.split("/").pop() ?? step.tablePath));
    for (let ri = 0; ri < step.rolls; ri++) {
      const value = rolls[si]?.[ri] ?? "";
      const rollDisplay = step.rolls === 1 ? "—" : String(ri + 1);
      out.push(
        `| ${si + 1} | ${escapeTableCell(label)} | ${rollDisplay} | ${escapeTableCell(value)} |`,
      );
    }
  });
  return out;
}


function sanitiseFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

async function writeBinaryToVault(
  app: App,
  path: string,
  data: Uint8Array,
): Promise<void> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, buf);
  } else {
    await app.vault.createBinary(path, buf);
  }
}

async function writeTextToVault(
  app: App,
  path: string,
  data: string,
): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, data);
  } else {
    await app.vault.create(path, data);
  }
}

async function openInVault(app: App, path: string): Promise<void> {
  await openExported(app, path);
}

// `normalizeFolder` is imported even though we don't use it yet — keeping the
// import keeps the file aligned with other exporters and ready to expand.
void normalizeFolder;
