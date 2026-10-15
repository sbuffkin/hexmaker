/**
 * Reading a content pack and planning its import: which notes go where
 * in this vault, which are already here, which can't be read. Nothing is
 * written here (see packIO.ts).
 *
 * Pure: no Obsidian imports.
 */

import { MANIFEST_FILE, inferManifest, parseManifest, type PackManifest } from "./packManifest";
import { isSafePackPath, keepBothPath, rewriteFolderLinks, vaultPathOf, type PackKind } from "./packKinds";

/** A file of the pack (from a zip or a picked folder). */
export interface PackFile {
  path: string;
  data: Uint8Array;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface LoadedPack {
  manifest: PackManifest;
  /** True when there was no pack.md and the folders were read by name. */
  inferred: boolean;
  /** Pack files under the pack root (manifest left out), paths relative to it. */
  files: PackFile[];
}

/**
 * The pack inside `files`: its root is the folder holding pack.md (a zip
 * of the pack's folder has everything one level down), else the one top
 * folder they all share, else the top. Files outside the root are left out.
 */
export function loadPack(files: readonly PackFile[], known: readonly { id: string; label: string }[], fallbackName: string): LoadedPack {
  const norm = files.map((f) => ({ path: f.path.replace(/\\/g, "/").replace(/^\/+/, ""), data: f.data }))
    .filter((f) => !f.path.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store"));
  const manifests = norm.filter((f) => f.path === MANIFEST_FILE || f.path.endsWith("/" + MANIFEST_FILE))
    .sort((a, b) => a.path.length - b.path.length);
  let root = "";
  if (manifests.length) root = manifests[0].path.slice(0, -MANIFEST_FILE.length);
  else {
    const tops = new Set(norm.map((f) => (f.path.includes("/") ? f.path.slice(0, f.path.indexOf("/") + 1) : "")));
    const [only] = [...tops];
    if (tops.size === 1 && only && !known.some((k) => k.id + "/" === only)) root = only;
  }
  const inside = norm.filter((f) => f.path.startsWith(root)).map((f) => ({ path: f.path.slice(root.length), data: f.data }));
  const manifestFile = inside.find((f) => f.path === MANIFEST_FILE);
  const rest = inside.filter((f) => f !== manifestFile);
  const name = root ? root.replace(/\/$/, "").split("/").pop()! : fallbackName;
  if (manifestFile) {
    return { manifest: parseManifest(decodeText(manifestFile.data) ?? "", name), inferred: false, files: rest };
  }
  return { manifest: inferManifest(rest.map((f) => f.path), known, name), inferred: true, files: rest };
}

/** UTF-8 text, or null when the bytes aren't readable text. A leading BOM is kept. */
export function decodeText(data: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

export type PlanStatus = "new" | "same" | "conflict";

export interface PlanItem {
  packPath: string;
  kindId: string;
  /** Where it goes in this vault. */
  target: string;
  /** The text to write (links and roller blocks fixed for this vault). */
  text: string;
  /** new: nothing there; same: an identical note is there; conflict: a different note is there. */
  status: PlanStatus;
}

export interface ImportPlan {
  items: PlanItem[];
  skipped: SkippedFile[];
  /** Notes pack.md lists that aren't in the pack. */
  missing: string[];
}

/**
 * Plan the import of `pack` into this vault's `kinds`. `read` gives the
 * text of a vault note at a path (null when there's none).
 */
export async function planImport(
  pack: LoadedPack,
  kinds: readonly PackKind[],
  read: (path: string) => Promise<string | null>,
): Promise<ImportPlan> {
  const items: PlanItem[] = [];
  const skipped: SkippedFile[] = [];
  const fromOf = new Map(pack.manifest.kinds.map((k) => [k.id, k.from]));
  for (const f of pack.files) {
    if (!isSafePackPath(f.path)) {
      skipped.push({ path: f.path, reason: "unsafe path" });
      continue;
    }
    if (!f.path.toLowerCase().endsWith(".md")) {
      skipped.push({ path: f.path, reason: "not a note (.md)" });
      continue;
    }
    const where = vaultPathOf(f.path, kinds);
    if (!where) {
      const top = f.path.includes("/") ? f.path.slice(0, f.path.indexOf("/")) : "";
      skipped.push({ path: f.path, reason: top ? `this vault has no place for "${top}"` : "not in a content folder" });
      continue;
    }
    const raw = decodeText(f.data);
    if (raw === null) {
      skipped.push({ path: f.path, reason: "not readable text" });
      continue;
    }
    let text = raw;
    for (const k of kinds) {
      const from = fromOf.get(k.id);
      if (from) text = rewriteFolderLinks(text, from, k.folder);
    }
    if (where.kind.fixText) text = where.kind.fixText(text);
    const existing = await read(where.path);
    const status: PlanStatus = existing === null ? "new" : existing === text ? "same" : "conflict";
    items.push({ packPath: f.path, kindId: where.kind.id, target: where.path, text, status });
  }
  const present = new Set(pack.files.map((f) => f.path));
  const missing = pack.manifest.kinds.flatMap((k) => k.files).filter((p) => !present.has(p));
  return { items, skipped, missing };
}

/** What to do with a note that's already here. */
export type ConflictChoice = "skip" | "both" | "replace";

export const CONFLICT_LABELS: Record<ConflictChoice, string> = {
  skip: "Skip",
  both: "Keep both",
  replace: "Replace",
};

export interface ImportStep {
  item: PlanItem;
  action: "create" | "replace" | "skip";
  /** Where it's written (a "Name 2" path for Keep both). */
  path: string;
}

/**
 * What the import will do for each item: new notes are created, identical
 * ones skipped, conflicts follow `choice` (default Keep both). Keep-both
 * names never land on another note or another item's target.
 */
export function resolveSteps(
  items: readonly PlanItem[],
  choice: (item: PlanItem) => ConflictChoice,
  exists: (path: string) => boolean,
): ImportStep[] {
  const targets = new Set(items.map((i) => i.target.toLowerCase()));
  const used = new Set<string>();
  const taken = (p: string) => exists(p) || targets.has(p.toLowerCase()) || used.has(p.toLowerCase());
  return items.map((item) => {
    if (item.status === "new") return { item, action: "create", path: item.target };
    if (item.status === "same") return { item, action: "skip", path: item.target };
    const c = choice(item);
    if (c === "skip") return { item, action: "skip", path: item.target };
    if (c === "replace") return { item, action: "replace", path: item.target };
    const path = keepBothPath(item.target, taken);
    used.add(path.toLowerCase());
    return { item, action: "create", path };
  });
}
