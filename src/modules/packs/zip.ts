/**
 * A small .zip writer and reader for content packs (no dependency).
 *
 * Writes: one entry per file, UTF-8 names, deflated with the platform's
 * CompressionStream("deflate-raw") where it exists, else stored.
 * Reads: stored and deflated entries (what any zip tool makes); folders
 * are implied by the paths. No zip64, no encryption: those throw.
 *
 * Pure: no Obsidian imports.
 */

export interface ZipEntry {
  /** Path inside the zip, "/"-separated ("tables/Weather.md"). */
  path: string;
  data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;

import { crc32 } from "../../crc32";

export { crc32 };

/** A plain ArrayBuffer copy (streams and Blob want one). */
function bufferOf(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return buf;
}

function canStream(kind: "compress" | "decompress"): boolean {
  try {
    if (kind === "compress") new CompressionStream("deflate-raw");
    else new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bufferOf(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** MS-DOS time and date fields for `when` (local time, 2-second steps). */
function dosTime(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** Make a .zip of `entries` (in that order). */
export async function writeZip(entries: readonly ZipEntry[], when: Date = new Date()): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const deflate = canStream("compress");
  const { time, date } = dosTime(when);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.data);
    let body = e.data;
    let method = 0;
    if (deflate && e.data.length > 0) {
      const packed = await pipe(e.data, new CompressionStream("deflate-raw"));
      if (packed.length < e.data.length) {
        body = packed;
        method = 8;
      }
    }
    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_SIG, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * How much a pack may unpack to. A zip declares each file's size, but a
 * hostile one can lie, so both the declared and the actually inflated bytes
 * are held to these (a "zip bomb" of a few MB can otherwise inflate to
 * gigabytes and take the app down). Packs are notes: these are far above
 * any real one.
 */
export const PACK_LIMITS = {
  /** Most bytes one file may unpack to. */
  fileBytes: 10 * 1024 * 1024,
  /** Most bytes all files together may unpack to. */
  totalBytes: 100 * 1024 * 1024,
  /** Most files (entries) a pack may hold. */
  files: 5000,
} as const;

export type PackLimits = { fileBytes: number; totalBytes: number; files: number };

const MB = (n: number): string => `${Math.round(n / (1024 * 1024))} MB`;

/** Why a pack of these files is over `limits`, or null when it fits. Sizes are unpacked bytes. */
export function packSizeProblem(files: readonly { path: string; size: number }[], limits: PackLimits = PACK_LIMITS): string | null {
  if (files.length > limits.files) return `it has ${files.length} files; a pack may have at most ${limits.files}`;
  let total = 0;
  for (const f of files) {
    if (f.size > limits.fileBytes) return `"${f.path}" is too big (over ${MB(limits.fileBytes)})`;
    total += f.size;
    if (total > limits.totalBytes) return `it unpacks to more than ${MB(limits.totalBytes)}`;
  }
  return null;
}

/** Inflate `raw`, stopping as soon as it passes `max` bytes (null then). */
async function inflateAtMost(raw: Uint8Array, max: number): Promise<Uint8Array | null> {
  const reader = new Blob([bufferOf(raw)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch {
      throw new Error("damaged zip (can't unpack)");
    }
    if (step.done) break;
    size += step.value.length;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

interface CentralEntry {
  path: string;
  flags: number;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  localAt: number;
}

/**
 * Read the files of a .zip (folder entries are left out). Throws on a
 * damaged or unsupported zip, and on one over `limits` (checked on the
 * sizes it declares before anything is unpacked, and again on the bytes
 * each file really unpacks to).
 */
export async function readZip(bytes: Uint8Array, limits: PackLimits = PACK_LIMITS): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endAt = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_SIG) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new Error("not a zip file");
  const count = view.getUint16(endAt + 10, true);
  const cdOffset = view.getUint32(endAt + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("zip64 files aren't supported");
  if (count > limits.files) throw new Error(`it has ${count} files; a pack may have at most ${limits.files}`);
  if (cdOffset > endAt) throw new Error("damaged zip (central directory)");

  // 1. The central directory, every offset checked against the buffer.
  const dec = new TextDecoder();
  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > endAt || view.getUint32(p, true) !== CENTRAL_SIG) throw new Error("damaged zip (central directory)");
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > endAt) throw new Error("damaged zip (central directory)");
    const path = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/");
    entries.push({
      path,
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      crc: view.getUint32(p + 16, true),
      csize: view.getUint32(p + 20, true),
      usize: view.getUint32(p + 24, true),
      localAt: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const files = entries.filter((e) => !e.path.endsWith("/"));

  // 2. What the files say they unpack to, before unpacking any.
  const declared = packSizeProblem(files.map((e) => ({ path: e.path, size: e.usize })), limits);
  if (declared) throw new Error(declared);

  // 3. Unpack, holding each file to its declared size.
  const out: ZipEntry[] = [];
  for (const e of files) {
    const { path, localAt, csize, usize } = e;
    if (e.flags & 0x1) throw new Error(`"${path}" is encrypted`);
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== LOCAL_SIG) throw new Error(`damaged zip at "${path}"`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + csize > bytes.length) throw new Error(`damaged zip at "${path}"`);
    const raw = bytes.subarray(dataAt, dataAt + csize);
    let data: Uint8Array;
    if (e.method === 0) data = raw.slice();
    else if (e.method === 8) {
      if (!canStream("decompress")) throw new Error("this app can't unpack compressed zips");
      const inflated = await inflateAtMost(raw, usize);
      if (!inflated) throw new Error(`"${path}" unpacks to more than it says (${usize} bytes)`);
      data = inflated;
    } else throw new Error(`"${path}" uses an unsupported compression`);
    if (data.length !== usize || crc32(data) !== e.crc) throw new Error(`"${path}" is damaged (checksum)`);
    out.push({ path, data });
  }
  return out;
}
