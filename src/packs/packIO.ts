/**
 * Making a content pack (.zip) and importing one, through narrow hosts
 * (the plugin's are in packVault.ts; tests pass in-memory ones).
 *
 * Pure: no Obsidian imports.
 */

import { writeZip, type ZipEntry } from "./zip";
import { formatManifest, MANIFEST_FILE, PACK_FORMAT, type PackManifest } from "./packManifest";
import { packPathOf, type PackKind } from "./packKinds";
import type { ImportStep, SkippedFile } from "./packPlan";

export interface PackReadHost {
  /** A vault note's text. */
  read(path: string): Promise<string>;
}

export interface PackExportInput {
  name: string;
  description: string;
  /** "Hexmap World Creator 1.6.0". */
  madeWith: string;
  when: Date;
  /** The notes picked, by kind (vault paths). Kinds with none are left out. */
  picked: { kind: PackKind; files: string[] }[];
}

/** YYYY-MM-DD in local time. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The pack: pack.md, then each note as it is, under its kind's folder. */
export async function buildPack(host: PackReadHost, input: PackExportInput): Promise<{ bytes: Uint8Array; manifest: PackManifest }> {
  const enc = new TextEncoder();
  const picked = input.picked.filter((p) => p.files.length);
  const manifest: PackManifest = {
    format: PACK_FORMAT,
    name: input.name.trim() || "Content pack",
    description: input.description,
    madeWith: input.madeWith,
    date: localDate(input.when),
    kinds: picked.map((p) => ({
      id: p.kind.id,
      label: p.kind.label,
      from: p.kind.folder,
      files: p.files.map((f) => packPathOf(p.kind, f)),
    })),
  };
  const entries: ZipEntry[] = [{ path: MANIFEST_FILE, data: enc.encode(formatManifest(manifest)) }];
  for (const p of picked) {
    for (const f of p.files) entries.push({ path: packPathOf(p.kind, f), data: enc.encode(await host.read(f)) });
  }
  return { bytes: await writeZip(entries, input.when), manifest };
}

/** A pack file name for `name` ("Coast tables.zip"): no characters a vault path can't hold. */
export function packFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  return `${clean || "Content pack"}.zip`;
}

export interface PackWriteHost {
  exists(path: string): boolean;
  read(path: string): Promise<string>;
  create(path: string, text: string): Promise<void>;
  modify(path: string, text: string): Promise<void>;
  /** Make a folder and its missing parents. */
  ensureFolderPath(folder: string): Promise<void>;
  /** Save the notes about to be replaced; returns where. Throws if it couldn't. */
  backup(notes: { path: string; text: string }[], label: string): Promise<string>;
}

export interface ImportReport {
  created: string[];
  replaced: string[];
  /** Keep both: the pack note, written under a new name. */
  keptBoth: { target: string; path: string }[];
  /** Left out: identical, chosen Skip, or unreadable (with why). */
  skipped: SkippedFile[];
  failed: SkippedFile[];
  /** Where the replaced notes were saved first. */
  backup?: string;
}

/**
 * Write the planned notes. Replaced notes are all backed up first, in
 * one backup; when that fails nothing is replaced (those are reported
 * as skipped). One note failing doesn't stop the others.
 */
export async function runImport(host: PackWriteHost, steps: readonly ImportStep[], label: string): Promise<ImportReport> {
  const report: ImportReport = { created: [], replaced: [], keptBoth: [], skipped: [], failed: [] };
  const replacing = steps.filter((s) => s.action === "replace" && host.exists(s.path));
  let canReplace = true;
  if (replacing.length) {
    try {
      const notes = await Promise.all(replacing.map(async (s) => ({ path: s.path, text: await host.read(s.path) })));
      report.backup = await host.backup(notes, label);
    } catch (e) {
      canReplace = false;
      report.failed.push({ path: "(backup)", reason: `couldn't back up the notes to replace, so none were replaced: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  for (const s of steps) {
    if (s.action === "skip") {
      report.skipped.push({ path: s.item.target, reason: s.item.status === "same" ? "already here, the same" : "already here, skipped" });
      continue;
    }
    try {
      const folder = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/")) : "";
      if (folder) await host.ensureFolderPath(folder);
      if (s.action === "replace" && host.exists(s.path)) {
        if (!canReplace) {
          report.skipped.push({ path: s.path, reason: "not replaced (no backup)" });
          continue;
        }
        await host.modify(s.path, s.item.text);
        report.replaced.push(s.path);
      } else {
        await host.create(s.path, s.item.text);
        if (s.path === s.item.target) report.created.push(s.path);
        else report.keptBoth.push({ target: s.item.target, path: s.path });
      }
    } catch (e) {
      report.failed.push({ path: s.path, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}
