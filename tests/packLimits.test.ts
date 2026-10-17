import { it } from "node:test";
import { describeWith } from "./helpers/slices";
import expect from "expect";
import { deflateRawSync } from "node:zlib";
import { PACK_LIMITS, crc32, packSizeProblem, readZip, writeZip } from "../src/modules/packs/zip";
import { readFolderPack, type FolderFile } from "../src/modules/packs/packPlan";

const enc = (s: string) => new TextEncoder().encode(s);

/** A one-file zip whose entry holds `body` (method 8 = deflate), with `declared` as its claimed size. */
function zipOf(path: string, body: Uint8Array, opts: { method?: number; declared?: number; crcOf?: Uint8Array } = {}): Uint8Array {
  const name = enc(path);
  const method = opts.method ?? 8;
  const declared = opts.declared ?? body.length;
  const crc = crc32(opts.crcOf ?? body);
  const local = new Uint8Array(30 + name.length + body.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, method, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, body.length, true);
  lv.setUint32(22, declared, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(body, 30 + name.length);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, method, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, body.length, true);
  cv.setUint32(24, declared, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

/** Offset of the (only) central directory record in a zip from writeZip/zipOf. */
const centralAt = (zip: Uint8Array) => new DataView(zip.buffer, zip.byteOffset).getUint32(zip.length - 22 + 16, true);

describeWith("packs", "content packs: zip limits (zip bombs)", () => {
  it("has limits far above a real pack", () => {
    expect(PACK_LIMITS.fileBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(PACK_LIMITS.totalBytes).toBeGreaterThanOrEqual(10 * PACK_LIMITS.fileBytes);
    expect(PACK_LIMITS.files).toBeGreaterThanOrEqual(1000);
  });

  it("a normal pack still reads", async () => {
    const files = [{ path: "pack.md", data: enc("# Pack\n") }, { path: "tables/W.md", data: enc("| Result | Weight |\n".repeat(200)) }];
    const back = await readZip(await writeZip(files));
    expect(back.map((f) => f.path)).toEqual(["pack.md", "tables/W.md"]);
  });

  it("refuses a file that unpacks to more than it declares, stopping early", async () => {
    // 20 MB of zeros deflates to ~20 KB; it claims to be 100 bytes.
    const zeros = new Uint8Array(20 * 1024 * 1024);
    const bomb = zipOf("tables/bomb.md", new Uint8Array(deflateRawSync(zeros)), { declared: 100, crcOf: zeros });
    const t0 = Date.now();
    await expect(readZip(bomb)).rejects.toThrow(/unpacks to more than it says/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("refuses a file that declares more than the per-file limit, before unpacking", async () => {
    const body = new Uint8Array(deflateRawSync(enc("x")));
    await expect(readZip(zipOf("a.md", body, { declared: PACK_LIMITS.fileBytes + 1 }))).rejects.toThrow(/"a\.md" is too big \(over 10 MB\)/);
  });

  it("refuses files that together declare more than the total limit", async () => {
    const files = Array.from({ length: 4 }, (_, i) => ({ path: `n${i}.md`, data: enc("y".repeat(900)) }));
    const zip = await writeZip(files);
    await expect(readZip(zip, { fileBytes: 1000, totalBytes: 3000, files: 10 })).rejects.toThrow(/unpacks to more than/);
    await expect(readZip(zip, { fileBytes: 1000, totalBytes: 4000, files: 10 })).resolves.toHaveLength(4);
  });

  it("refuses more entries than the file limit", async () => {
    const zip = await writeZip(Array.from({ length: 6 }, (_, i) => ({ path: `n${i}.md`, data: enc("z") })));
    await expect(readZip(zip, { fileBytes: 1000, totalBytes: 10_000, files: 5 })).rejects.toThrow(/6 files; a pack may have at most 5/);
  });

  it("refuses offsets outside the file instead of reading past it", async () => {
    const good = await writeZip([{ path: "a.md", data: enc("hello there") }]);
    const cd = centralAt(good);

    const farLocal = good.slice();
    new DataView(farLocal.buffer).setUint32(cd + 42, good.length + 1000, true);
    await expect(readZip(farLocal)).rejects.toThrow(/damaged zip at "a\.md"/);

    const longData = good.slice();
    new DataView(longData.buffer).setUint32(cd + 20, good.length * 4, true);
    await expect(readZip(longData)).rejects.toThrow(/damaged zip at "a\.md"/);

    const farCentral = good.slice();
    new DataView(farCentral.buffer).setUint32(good.length - 22 + 16, good.length + 50, true);
    await expect(readZip(farCentral)).rejects.toThrow(/damaged zip \(central directory\)/);

    const longName = good.slice();
    new DataView(longName.buffer).setUint16(cd + 28, 0xffff, true);
    await expect(readZip(longName)).rejects.toThrow(/damaged zip \(central directory\)/);
  });

  it("packSizeProblem names the problem", () => {
    const lim = { fileBytes: 10, totalBytes: 25, files: 3 };
    expect(packSizeProblem([{ path: "a", size: 10 }, { path: "b", size: 10 }], lim)).toBeNull();
    expect(packSizeProblem([{ path: "big.md", size: 11 }], lim)).toMatch(/"big\.md" is too big/);
    expect(packSizeProblem([{ path: "a", size: 10 }, { path: "b", size: 10 }, { path: "c", size: 10 }], lim)).toMatch(/unpacks to more than/);
    expect(packSizeProblem(Array.from({ length: 4 }, (_, i) => ({ path: `${i}`, size: 1 })), lim)).toMatch(/4 files/);
  });
});

describeWith("packs", "content packs: folder import limits", () => {
  const file = (path: string, size: number, reads: string[]): FolderFile => ({
    path,
    size,
    read: async () => {
      reads.push(path);
      return new Uint8Array(size);
    },
  });

  it("reads only the notes; other files come through empty and unread", async () => {
    const reads: string[] = [];
    const out = await readFolderPack([file("p/pack.md", 5, reads), file("p/tables/W.md", 3, reads), file("p/map.png", 50 * 1024 * 1024, reads)]);
    expect(reads.sort()).toEqual(["p/pack.md", "p/tables/W.md"]);
    expect(out.map((f) => [f.path, f.data.length])).toEqual([["p/pack.md", 5], ["p/tables/W.md", 3], ["p/map.png", 0]]);
  });

  it("refuses an over-limit folder before reading anything", async () => {
    const reads: string[] = [];
    await expect(readFolderPack([file("a.md", 11, reads)], { fileBytes: 10, totalBytes: 100, files: 10 })).rejects.toThrow(/too big/);
    await expect(readFolderPack([file("a.md", 9, reads), file("b.md", 9, reads)], { fileBytes: 10, totalBytes: 15, files: 10 })).rejects.toThrow(/more than/);
    await expect(readFolderPack(Array.from({ length: 11 }, (_, i) => file(`${i}.md`, 1, reads)), { fileBytes: 10, totalBytes: 100, files: 10 })).rejects.toThrow(/11 files/);
    expect(reads).toEqual([]);
  });
});
