import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { deflateSync, inflateSync } from "node:zlib";
import { Notice, TFile, TFolder } from "./__mocks__/obsidian";
import {
	binaryHasExportMarker,
	exportPathCandidate,
	markBinaryExport,
	markPdf,
	markPng,
	pdfHasExportMarker,
	pickExportPath,
	pngHasExportMarker,
	textHasExportMarker,
} from "../src/export/exportMarker";
import { announceExport, saveExport } from "../src/export/vaultWrite";
import { withExportProvenance } from "../src/export/exportFolder";
import { crc32 } from "../src/packs/zip";
import type { App } from "obsidian";

const enc = new TextEncoder();
const dec = new TextDecoder("latin1");

/** A tiny but real PDF (what printToPDF hands back, in shape). */
const PDF = enc.encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n");

/** One PNG chunk: length, type, data, CRC. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const body = new Uint8Array([...enc.encode(type), ...data]);
	const out = new Uint8Array(body.length + 8);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(body, 4);
	view.setUint32(out.length - 4, crc32(body));
	return out;
}

/** A valid 1×1 RGBA PNG: signature, IHDR, IDAT, IEND. */
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	...pngChunk("IHDR", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
	...pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
	...pngChunk("IEND", new Uint8Array()),
]);

/** The PNG's chunks as [type, crc ok]. */
function chunks(png: Uint8Array): [string, boolean][] {
	const out: [string, boolean][] = [];
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let at = 8;
	while (at < png.length) {
		const len = view.getUint32(at);
		const type = dec.decode(png.subarray(at + 4, at + 8));
		const crc = view.getUint32(at + 8 + len);
		out.push([type, crc32(png.subarray(at + 4, at + 8 + len)) === crc]);
		at += 12 + len;
	}
	return out;
}

describe("export marker (security #11)", () => {
	it("markdown: the hexmaker-export frontmatter key, nowhere else", () => {
		const exported = withExportProvenance("# Saltwatch\n\nBody\n", "towns/Saltwatch.md", "note");
		expect(textHasExportMarker(exported)).toBe(true);
		expect(textHasExportMarker(exported.replace(/\n/g, "\r\n"))).toBe(true);
		expect(textHasExportMarker("# Saltwatch\n\nBody\n")).toBe(false);
		expect(textHasExportMarker("---\ntags: town\n---\nhexmaker-export: note\n")).toBe(false);
		expect(textHasExportMarker("---\nhexmaker-exported: no\n---\n")).toBe(false);
		expect(textHasExportMarker("")).toBe(false);
	});

	it("PDF: a comment after %%EOF, added once", () => {
		expect(pdfHasExportMarker(PDF)).toBe(false);
		const marked = markPdf(PDF);
		expect(dec.decode(marked.subarray(0, PDF.length))).toBe(dec.decode(PDF));
		expect(dec.decode(marked.subarray(PDF.length))).toBe("%hexmaker-export\n");
		expect(pdfHasExportMarker(marked)).toBe(true);
		expect(markPdf(marked)).toBe(marked);
		// No trailing newline: the comment still starts its own line.
		const bare = PDF.subarray(0, PDF.length - 1);
		expect(dec.decode(markPdf(bare)).endsWith("%%EOF\n%hexmaker-export\n")).toBe(true);
		// Not a PDF, or the marker text before %%EOF: not ours.
		expect(pdfHasExportMarker(enc.encode("%hexmaker-export\n%%EOF\n"))).toBe(false);
		expect(pdfHasExportMarker(enc.encode("%PDF-1.4\n%hexmaker-export\n%%EOF\n"))).toBe(false);
	});

	it("PNG: a tEXt chunk after IHDR with a valid CRC; the image is untouched", () => {
		expect(pngHasExportMarker(PNG)).toBe(false);
		const marked = markPng(PNG);
		expect(chunks(marked)).toEqual([["IHDR", true], ["tEXt", true], ["IDAT", true], ["IEND", true]]);
		expect(pngHasExportMarker(marked)).toBe(true);
		expect(markPng(marked)).toBe(marked);
		// The pixels decode the same.
		const idat = (png: Uint8Array) => {
			const i = dec.decode(png).indexOf("IDAT");
			const len = new DataView(png.buffer, png.byteOffset).getUint32(i - 4);
			return inflateSync(png.subarray(i + 4, i + 4 + len));
		};
		expect(idat(marked)).toEqual(idat(PNG));
		expect(markPng(enc.encode("not a png"))).toEqual(enc.encode("not a png"));
	});

	it("only PDF and PNG get a binary marker", () => {
		expect(binaryHasExportMarker("a/x.pdf", markBinaryExport("a/x.pdf", PDF))).toBe(true);
		expect(binaryHasExportMarker("a/x.PNG", markBinaryExport("a/x.PNG", PNG))).toBe(true);
		expect(markBinaryExport("a/x.zip", PDF)).toBe(PDF);
		expect(binaryHasExportMarker("a/x.zip", markPdf(PDF))).toBe(false);
		// A .pdf name holding something else is left as it is.
		expect(markBinaryExport("a/x.pdf", PNG)).toBe(PNG);
	});

	it("numbered names: 'name 2.ext', 'name 3.ext'…", () => {
		expect(exportPathCandidate("world/exports/Coast.pdf", 0)).toBe("world/exports/Coast.pdf");
		expect(exportPathCandidate("world/exports/Coast.pdf", 1)).toBe("world/exports/Coast 2.pdf");
		expect(exportPathCandidate("world/exports/v1.2 map.png", 3)).toBe("world/exports/v1.2 map 4.png");
		expect(exportPathCandidate("Coast", 2)).toBe("Coast 3");
	});

	it("picks the first name that is free or an earlier export", async () => {
		const at = (m: Record<string, "export" | "other">) => async (p: string) => m[p] ?? "free";
		expect(await pickExportPath("e/a.pdf", at({}))).toEqual({ path: "e/a.pdf", replaced: false });
		expect(await pickExportPath("e/a.pdf", at({ "e/a.pdf": "export" }))).toEqual({ path: "e/a.pdf", replaced: true });
		expect(await pickExportPath("e/a.pdf", at({ "e/a.pdf": "other" }))).toEqual({ path: "e/a 2.pdf", replaced: false });
		expect(await pickExportPath("e/a.pdf", at({ "e/a.pdf": "other", "e/a 2.pdf": "export" }))).toEqual({ path: "e/a 2.pdf", replaced: true });
		await expect(pickExportPath("e/a.pdf", async () => "other")).rejects.toThrow("No free file name");
	});
});

/** Just enough vault for saveExport: text and binary files plus folders. */
function fakeApp(initial: Record<string, string | Uint8Array> = {}, folders: string[] = []) {
	const files = new Map<string, string | Uint8Array>(Object.entries(initial));
	const file = (p: string) => Object.assign(new TFile(), { path: p, name: p.slice(p.lastIndexOf("/") + 1) });
	const opened: string[] = [];
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (files.has(p) ? file(p) : folders.includes(p) ? Object.assign(new TFolder(), { path: p }) : null),
			read: async (f: TFile) => String(files.get(f.path)),
			readBinary: async (f: TFile) => { const b = files.get(f.path) as Uint8Array; return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
			create: async (p: string, c: string) => { if (files.has(p)) throw new Error("exists"); files.set(p, c); return file(p); },
			modify: async (f: TFile, c: string) => { files.set(f.path, c); },
			createBinary: async (p: string, b: ArrayBuffer) => { if (files.has(p)) throw new Error("exists"); files.set(p, new Uint8Array(b)); return file(p); },
			modifyBinary: async (f: TFile, b: ArrayBuffer) => { files.set(f.path, new Uint8Array(b)); },
		},
		workspace: {
			iterateAllLeaves: () => {},
			getLeaf: () => ({ openFile: async (f: TFile) => { opened.push(f.path); } }),
		},
	};
	return { app: app as unknown as App, files, opened };
}

describe("saveExport: never replaces what it didn't write (security #11)", () => {
	beforeEach(() => { Notice.shown.length = 0; });
	const md = (body: string) => withExportProvenance(`# Saltwatch\n\n${body}\n`, "towns/Saltwatch.md", "note");

	it("writes a new export with its marker", async () => {
		const { app, files } = fakeApp();
		expect(await saveExport(app, "exports/Coast.pdf", PDF)).toEqual({ path: "exports/Coast.pdf", replaced: false });
		expect(pdfHasExportMarker(files.get("exports/Coast.pdf") as Uint8Array)).toBe(true);
		expect(await saveExport(app, "exports/Coast.png", PNG)).toEqual({ path: "exports/Coast.png", replaced: false });
		expect(pngHasExportMarker(files.get("exports/Coast.png") as Uint8Array)).toBe(true);
	});

	it("replaces an earlier export in place", async () => {
		const { app, files } = fakeApp({ "exports/Saltwatch.md": md("old"), "exports/Coast.pdf": markPdf(PDF) });
		expect(await saveExport(app, "exports/Saltwatch.md", md("new"))).toEqual({ path: "exports/Saltwatch.md", replaced: true });
		expect(String(files.get("exports/Saltwatch.md"))).toContain("new");
		expect(await saveExport(app, "exports/Coast.pdf", PDF)).toEqual({ path: "exports/Coast.pdf", replaced: true });
		expect(files.size).toBe(2);
	});

	it("keeps the user's own note, PDF or image and saves under a new name", async () => {
		const own = "# Saltwatch\n\nMy own notes.\n";
		const { app, files } = fakeApp({ "towns/Saltwatch.md": own, "exports/Coast.pdf": PDF, "exports/Coast.png": PNG });
		expect(await saveExport(app, "towns/Saltwatch.md", md("export"))).toEqual({ path: "towns/Saltwatch 2.md", replaced: false });
		expect(files.get("towns/Saltwatch.md")).toBe(own);
		expect(await saveExport(app, "exports/Coast.pdf", PDF)).toEqual({ path: "exports/Coast 2.pdf", replaced: false });
		expect(files.get("exports/Coast.pdf")).toBe(PDF);
		expect(await saveExport(app, "exports/Coast.png", PNG)).toEqual({ path: "exports/Coast 2.png", replaced: false });
		expect(files.get("exports/Coast.png")).toBe(PNG);
		// The next re-export replaces the numbered copy it made, not a third file.
		expect(await saveExport(app, "towns/Saltwatch.md", md("again"))).toEqual({ path: "towns/Saltwatch 2.md", replaced: true });
		expect(await saveExport(app, "exports/Coast.pdf", PDF)).toEqual({ path: "exports/Coast 2.pdf", replaced: true });
		expect(files.size).toBe(6);
	});

	it("steps past a folder of the same name", async () => {
		const { app } = fakeApp({}, ["exports/Coast.pdf"]);
		expect(await saveExport(app, "exports/Coast.pdf", PDF)).toEqual({ path: "exports/Coast 2.pdf", replaced: false });
	});

	it("announces where it really went and opens that file", async () => {
		const { app, files, opened } = fakeApp({ "exports/Coast.pdf": PDF });
		announceExport(app, await saveExport(app, "exports/Coast.pdf", PDF));
		await new Promise((r) => setTimeout(r, 0));
		expect(Notice.shown.map((n) => n.msg)).toEqual(["Exported to exports/Coast 2.pdf"]);
		expect(opened).toEqual(["exports/Coast 2.pdf"]);
		expect(files.has("exports/Coast 2.pdf")).toBe(true);
	});
});
