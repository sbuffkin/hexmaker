import { describe, it, before, after } from "node:test";
import expect from "expect";
import vm from "node:vm";
import { buildInjectScript, exportToPdfBytes, PRINT_PAGE_CSP, WEBVIEW_ATTRS } from "../src/export/pdfExporter";

/**
 * Security review #2: the PDF export's webview gets note-derived HTML, so
 * it must not have Node, and the page must refuse scripts and remote
 * loads (CSP set before the HTML goes in).
 */

/** A stand-in for the webview guest's document: records what the script does, in order. */
function guestDocument() {
	const ops: string[] = [];
	const el = (tag: string) => {
		const attrs: Record<string, string> = {};
		return {
			tag, attrs, textContent: "",
			setAttribute(k: string, v: string) { attrs[k] = v; },
		};
	};
	const head = {
		children: [] as ReturnType<typeof el>[],
		set innerHTML(v: string) { ops.push(`head.innerHTML=${JSON.stringify(v)}`); this.children = []; },
		appendChild(c: ReturnType<typeof el>) { ops.push(`head.append ${c.tag}`); this.children.push(c); },
	};
	const body = {
		className: "",
		html: "",
		removeAttribute(_k: string) {},
		set innerHTML(v: string) { ops.push("body.innerHTML"); this.html = v; },
	};
	return { ops, head, body, title: "", createElement: el };
}

/** Run the inject script as the webview would. */
function runInGuest(script: string) {
	const document = guestDocument();
	vm.runInNewContext(script, { document, decodeURIComponent });
	return document;
}

describe("PDF webview lock-down (security #2)", () => {
	it("the webview has no nodeintegration (and only a src)", () => {
		expect(WEBVIEW_ATTRS).toEqual({ src: "app://obsidian.md/help.html" });
		expect(Object.keys(WEBVIEW_ATTRS)).not.toContain("nodeintegration");
	});

	it("the policy blocks scripts, the network, frames and objects; allows data:/blob:/app: images", () => {
		const d = Object.fromEntries(PRINT_PAGE_CSP.split("; ").map((x) => { const [k, ...v] = x.split(" "); return [k, v.join(" ")]; }));
		expect(d["default-src"]).toBe("'none'");
		expect(d["script-src"]).toBe("'none'");
		expect(d["object-src"]).toBe("'none'");
		expect(d["frame-src"]).toBe("'none'");
		expect(d["connect-src"]).toBe("'none'");
		expect(d["img-src"]).toBe("data: blob: app:");
		expect(PRINT_PAGE_CSP).not.toMatch(/https?:|\*|'unsafe-eval'/);
	});

	it("puts the CSP in the head before the HTML, then the CSS, then the body", () => {
		const html = `<p>Hi</p><img src="https://example.invalid/x.png"><img src=x onerror="alert(1)">`;
		const doc = runInGuest(buildInjectScript({ bodyHtml: html, css: "p { color: red }", title: "T `${x}`" }));
		expect(doc.ops).toEqual(['head.innerHTML=""', "head.append meta", "head.append style", "body.innerHTML"]);
		const [meta, style] = doc.head.children;
		expect(meta.attrs).toEqual({ "http-equiv": "Content-Security-Policy", content: PRINT_PAGE_CSP });
		expect(style.textContent).toBe("p { color: red }");
		// The payload arrives intact (no template-literal break-out).
		expect(doc.body.html).toBe(html);
		expect(doc.title).toBe("T `${x}`");
	});

	it("doesn't rely on Obsidian's globals inside the guest", () => {
		const script = buildInjectScript({ bodyHtml: "", css: "", title: "" });
		expect(script).not.toMatch(/activeDocument|activeWindow|require\(/);
	});
});

describe("exportToPdfBytes drives a locked-down webview", () => {
	const g = globalThis as Record<string, unknown>;
	const saved: Record<string, unknown> = {};
	let made: { attrs: Record<string, string>; cls: string; removed: boolean; ran: string[] }[] = [];
	before(() => {
		for (const k of ["createEl", "activeDocument", "window"]) saved[k] = g[k];
		made = [];
		g.window = { setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); if (ms > 1000) t.unref(); return t; } };
		g.activeDocument = {
			body: {
				appendChild(w: { fire: (ev: string) => void }) { setTimeout(() => w.fire("did-finish-load"), 0); },
			},
		};
		g.createEl = (_tag: string, o: { cls: string; attr: Record<string, string> }) => {
			const listeners = new Map<string, (() => void)[]>();
			const rec = { attrs: { ...o.attr }, cls: o.cls, removed: false, ran: [] as string[] };
			made.push(rec);
			return {
				addEventListener(ev: string, f: () => void) { listeners.set(ev, [...(listeners.get(ev) ?? []), f]); },
				removeEventListener(ev: string, f: () => void) { listeners.set(ev, (listeners.get(ev) ?? []).filter((x) => x !== f)); },
				fire(ev: string) { for (const f of listeners.get(ev) ?? []) f(); },
				async executeJavaScript(code: string) { rec.ran.push(code); runInGuest(code); },
				async printToPDF() { return new TextEncoder().encode("%PDF-1.4\n%%EOF\n"); },
				remove() { rec.removed = true; },
			};
		};
	});
	after(() => { for (const [k, v] of Object.entries(saved)) g[k] = v; });

	it("creates it without nodeintegration, injects once, prints and removes it", async () => {
		const bytes = await exportToPdfBytes({ bodyHtml: "<p>x</p>", css: "", title: "x" });
		expect(new TextDecoder().decode(bytes).startsWith("%PDF-")).toBe(true);
		expect(made).toHaveLength(1);
		expect(made[0].attrs).toEqual(WEBVIEW_ATTRS);
		expect(made[0].cls).toBe("duckmage-export-webview");
		expect(made[0].ran).toHaveLength(1);
		expect(made[0].ran[0]).toContain(encodeURIComponent(PRINT_PAGE_CSP));
		expect(made[0].removed).toBe(true);
	});
});
