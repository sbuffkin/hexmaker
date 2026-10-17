/**
 * The `hexmaker-export` marker: how an export recognises a file it wrote
 * before, so re-exporting replaces its own earlier copy but never a note,
 * image or PDF the user made (security review #11).
 *
 *   - Markdown exports: the `hexmaker-export:` frontmatter key that
 *     withExportProvenance writes (X1).
 *   - PDF: a `%hexmaker-export` comment line after the final `%%EOF`.
 *     Text after `%%EOF` is where incremental updates go, so readers skip
 *     a comment there and the byte offsets the file relies on don't move.
 *   - PNG: a `tEXt` chunk with the keyword `hexmaker-export`, right after
 *     IHDR (the standard place for text metadata).
 *
 * A file at the export's name without the marker is kept, and the export
 * goes to the first "<name> 2.<ext>", "<name> 3.<ext>"… that is free or is
 * itself an earlier export (numbered like a content pack's "keep both").
 *
 * Pure: no Obsidian imports.
 */

import { crc32 } from "../packs/zip";

/** The marker's name, in every form. */
export const EXPORT_MARKER = "hexmaker-export";

const PDF_COMMENT = `%${EXPORT_MARKER}`;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** How far from the end of a PDF the marker is looked for. */
const PDF_TAIL = 1024;

const enc = new TextEncoder();
const dec = new TextDecoder("latin1");

/** The file's extension, lower case, without the dot ("" when none). */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// ── Markdown ──────────────────────────────────────────────────────────────

/** True when the note's frontmatter has a `hexmaker-export:` key. */
export function textHasExportMarker(text: string): boolean {
  const fm = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!fm) return false;
  return new RegExp(`^${EXPORT_MARKER}[ \\t]*:`, "m").test(fm[1]);
}

// ── PDF ───────────────────────────────────────────────────────────────────

function isPdf(bytes: Uint8Array): boolean {
  return dec.decode(bytes.subarray(0, 5)) === "%PDF-";
}

/** The PDF with the marker comment appended (unchanged if it has one already). */
export function markPdf(bytes: Uint8Array): Uint8Array {
  if (pdfHasExportMarker(bytes)) return bytes;
  const tail = enc.encode(`${bytes[bytes.length - 1] === 0x0a ? "" : "\n"}${PDF_COMMENT}\n`);
  const out = new Uint8Array(bytes.length + tail.length);
  out.set(bytes);
  out.set(tail, bytes.length);
  return out;
}

/** True when the PDF ends with the marker comment. */
export function pdfHasExportMarker(bytes: Uint8Array): boolean {
  if (!isPdf(bytes)) return false;
  const tail = dec.decode(bytes.subarray(Math.max(0, bytes.length - PDF_TAIL)));
  const eof = tail.lastIndexOf("%%EOF");
  return eof >= 0 && tail.slice(eof).split(/\r?\n/).some((line) => line.trim() === PDF_COMMENT);
}

// ── PNG ───────────────────────────────────────────────────────────────────

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function putU32(out: Uint8Array, at: number, n: number): void {
  out[at] = (n >>> 24) & 0xff;
  out[at + 1] = (n >>> 16) & 0xff;
  out[at + 2] = (n >>> 8) & 0xff;
  out[at + 3] = n & 0xff;
}

/** Each chunk's type and data, until IEND or the bytes run out. */
function* pngChunks(bytes: Uint8Array): Generator<{ type: string; data: Uint8Array; end: number }> {
  let at = 8;
  while (at + 12 <= bytes.length) {
    const len = u32(bytes, at);
    const type = dec.decode(bytes.subarray(at + 4, at + 8));
    const end = at + 12 + len;
    if (end > bytes.length) return;
    yield { type, data: bytes.subarray(at + 8, at + 8 + len), end };
    if (type === "IEND") return;
    at = end;
  }
}

/** The PNG with a `tEXt` marker chunk after IHDR (unchanged if it has one already or isn't a PNG). */
export function markPng(bytes: Uint8Array, value = "png"): Uint8Array {
  if (!isPng(bytes) || pngHasExportMarker(bytes)) return bytes;
  const first = pngChunks(bytes).next();
  if (first.done || first.value.type !== "IHDR") return bytes;
  const afterIhdr = first.value.end;
  const body = enc.encode(`tEXt${EXPORT_MARKER}\0${value}`);
  const chunk = new Uint8Array(body.length + 8);
  putU32(chunk, 0, body.length - 4);
  chunk.set(body, 4);
  putU32(chunk, chunk.length - 4, crc32(body));
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, afterIhdr));
  out.set(chunk, afterIhdr);
  out.set(bytes.subarray(afterIhdr), afterIhdr + chunk.length);
  return out;
}

/** True when the PNG has a `tEXt` chunk with the marker keyword (looked for before the image data). */
export function pngHasExportMarker(bytes: Uint8Array): boolean {
  if (!isPng(bytes)) return false;
  const key = enc.encode(`${EXPORT_MARKER}\0`);
  for (const c of pngChunks(bytes)) {
    if (c.type === "IDAT") return false;
    if (c.type === "tEXt" && c.data.length >= key.length && key.every((b, i) => c.data[i] === b)) return true;
  }
  return false;
}

// ── Any export ────────────────────────────────────────────────────────────

/** The export's bytes carrying the marker, for the formats that can hold one (.pdf, .png). */
export function markBinaryExport(path: string, bytes: Uint8Array): Uint8Array {
  const ext = extensionOf(path);
  if (ext === "pdf") return isPdf(bytes) ? markPdf(bytes) : bytes;
  if (ext === "png") return markPng(bytes);
  return bytes;
}

/** True when an existing binary file is an earlier export (carries the marker). */
export function binaryHasExportMarker(path: string, bytes: Uint8Array): boolean {
  const ext = extensionOf(path);
  if (ext === "pdf") return pdfHasExportMarker(bytes);
  if (ext === "png") return pngHasExportMarker(bytes);
  return false;
}

/**
 * "<name>.<ext>", then "<name> 2.<ext>", "<name> 3.<ext>"…: the paths an
 * export may be written to, in the order they are tried.
 */
export function exportPathCandidate(path: string, n: number): string {
  if (n === 0) return path;
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${path.slice(0, slash + 1)}${stem} ${n + 1}${ext}`;
}

/** How many numbered names are tried before giving up. */
export const MAX_EXPORT_NAME_TRIES = 1000;

/**
 * Where to write an export meant for `path`: the first candidate that is
 * free (`replaced: false`) or holds an earlier export (`replaced: true`).
 * `look` says what is at a path: "free", "export" or "other".
 */
export async function pickExportPath(
  path: string,
  look: (p: string) => Promise<"free" | "export" | "other">,
): Promise<{ path: string; replaced: boolean }> {
  for (let n = 0; n < MAX_EXPORT_NAME_TRIES; n++) {
    const p = exportPathCandidate(path, n);
    const what = await look(p);
    if (what === "free") return { path: p, replaced: false };
    if (what === "export") return { path: p, replaced: true };
  }
  throw new Error(`No free file name for ${path}`);
}
