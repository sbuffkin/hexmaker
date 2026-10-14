/**
 * The `pack.md` manifest at the root of a content pack: a readable note
 * (name, description, which version made it, when, and what's inside).
 *
 * ```
 * ---
 * hexmaker-pack: 1
 * name: "Coast tables"
 * made-with: "Hexmap World Creator 1.6.0"
 * date: 2026-10-14
 * ---
 *
 * # Coast tables
 *
 * Description…
 *
 * ## Contents
 *
 * | What | Folder | From | Notes |
 * |---|---|---|---|
 * | Random tables | tables | world/tables | 2 |
 *
 * ## Files
 *
 * ### Random tables
 * - tables/Weather.md
 * ```
 *
 * "Folder" is the pack's own folder for that kind (its id); "From" is
 * where the notes lived in the vault that made it (used to fix links on
 * import). Parsing is forgiving: anything missing gets a default, and a
 * pack with no manifest at all can still be read (see inferManifest).
 *
 * Pure: no Obsidian imports.
 */

/** The manifest file's name, at the pack root. */
export const MANIFEST_FILE = "pack.md";

/** The manifest format this build writes. */
export const PACK_FORMAT = 1;

export interface PackManifestKind {
  /** The pack folder (a kind id: "tables", "towns"…). */
  id: string;
  /** Its name for people ("Random tables"). */
  label: string;
  /** Where the notes were in the vault that made the pack ("" when unknown). */
  from: string;
  /** Pack paths of its notes ("tables/Weather.md"). */
  files: string[];
}

export interface PackManifest {
  format: number;
  name: string;
  description: string;
  madeWith: string;
  /** YYYY-MM-DD. */
  date: string;
  kinds: PackManifestKind[];
}

const yamlString = (s: string): string => JSON.stringify(s);

/** A table cell: pipes escaped, one line. */
const cell = (s: string): string => s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

/** The manifest note's text. */
export function formatManifest(m: PackManifest): string {
  const lines = [
    "---",
    `hexmaker-pack: ${m.format}`,
    `name: ${yamlString(m.name)}`,
    `made-with: ${yamlString(m.madeWith)}`,
    `date: ${m.date}`,
    "---",
    "",
    `# ${m.name}`,
    "",
  ];
  if (m.description.trim()) lines.push(m.description.trim(), "");
  lines.push("## Contents", "", "| What | Folder | From | Notes |", "|---|---|---|---|");
  for (const k of m.kinds) lines.push(`| ${cell(k.label)} | ${cell(k.id)} | ${cell(k.from)} | ${k.files.length} |`);
  lines.push("", "## Files");
  for (const k of m.kinds) {
    lines.push("", `### ${k.label}`);
    for (const f of k.files) lines.push(`- ${f}`);
  }
  return lines.join("\n") + "\n";
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.startsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, t.endsWith('"') ? -1 : undefined);
    }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length > 1) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** Split a table row into cells (escaped pipes kept). */
function cells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Read a manifest note. Never throws: missing parts get defaults. */
export function parseManifest(text: string, fallbackName = "Content pack"): PackManifest {
  const src = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, "\n");
  const fm: Record<string, string> = {};
  let body = src;
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (fmMatch) {
    body = src.slice(fmMatch[0].length);
    for (const line of fmMatch[1].split("\n")) {
      const m = /^([\w-]+):\s*(.*)$/.exec(line);
      if (m) fm[m[1]] = unquote(m[2]);
    }
  }
  const lines = body.split("\n");
  const titleAt = lines.findIndex((l) => /^# /.test(l));
  const contentsAt = lines.findIndex((l) => /^## Contents\s*$/i.test(l));
  const filesAt = lines.findIndex((l) => /^## Files\s*$/i.test(l));
  const descEnd = [contentsAt, filesAt].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? lines.length;
  const description = lines.slice(titleAt + 1, descEnd).join("\n").trim();

  const kinds: PackManifestKind[] = [];
  if (contentsAt >= 0) {
    for (const line of lines.slice(contentsAt + 1, filesAt > contentsAt ? filesAt : undefined)) {
      if (!line.trim().startsWith("|")) continue;
      const c = cells(line);
      if (c.length < 2 || /^-+$/.test(c[1].replace(/:/g, "")) || c[1].toLowerCase() === "folder") continue;
      if (!c[1]) continue;
      kinds.push({ label: c[0] || c[1], id: c[1], from: c[2] ?? "", files: [] });
    }
  }
  if (filesAt >= 0) {
    let current: PackManifestKind | undefined;
    for (const line of lines.slice(filesAt + 1)) {
      const head = /^### (.+)$/.exec(line);
      if (head) {
        current = kinds.find((k) => k.label === head[1].trim());
        continue;
      }
      const item = /^- (.+)$/.exec(line);
      if (!item) continue;
      const path = item[1].trim();
      const owner = current ?? kinds.find((k) => path.startsWith(k.id + "/"));
      owner?.files.push(path);
    }
  }
  const format = parseInt(fm["hexmaker-pack"] ?? "", 10);
  return {
    format: Number.isFinite(format) ? format : PACK_FORMAT,
    name: fm["name"] || (titleAt >= 0 ? lines[titleAt].slice(2).trim() : "") || fallbackName,
    description,
    madeWith: fm["made-with"] ?? "",
    date: fm["date"] ?? "",
    kinds,
  };
}

/**
 * The manifest of a pack that has none (a folder zipped by hand): its
 * top-level folders that are known kinds, with the files under them.
 */
export function inferManifest(paths: readonly string[], known: readonly { id: string; label: string }[], name: string): PackManifest {
  const kinds: PackManifestKind[] = [];
  for (const k of known) {
    const files = paths.filter((p) => p.startsWith(k.id + "/"));
    if (files.length) kinds.push({ id: k.id, label: k.label, from: "", files });
  }
  return { format: PACK_FORMAT, name, description: "", madeWith: "", date: "", kinds };
}
