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

let crcTable: Uint32Array | null = null;

/** CRC-32 (the zip checksum) of `data`. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

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

/** Read the files of a .zip (folder entries are left out). Throws on a damaged or unsupported zip. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
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
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIG) throw new Error("damaged zip (central directory)");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const path = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue;
    if (flags & 0x1) throw new Error(`"${path}" is encrypted`);
    if (view.getUint32(localAt, true) !== LOCAL_SIG) throw new Error(`damaged zip at "${path}"`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      if (!canStream("decompress")) throw new Error("this app can't unpack compressed zips");
      data = await pipe(raw, new DecompressionStream("deflate-raw"));
    } else throw new Error(`"${path}" uses an unsupported compression`);
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`"${path}" is damaged (checksum)`);
    out.push({ path, data });
  }
  return out;
}
