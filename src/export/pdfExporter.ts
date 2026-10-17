/**
 * PDF export primitive — wraps Electron's webview `printToPDF()`.
 *
 * Architecture: see knowledgebase/projects/duckmage-plugin/notes/impl/ref-better-export-pdf.md
 * and plan-export-phase1.md.
 *
 * Strategy: create a hidden <webview>, inject the rendered HTML + CSS, force
 * light theme (dark backgrounds print badly), then call printToPDF and clean up.
 *
 * The webview is locked down (security review #2): the HTML comes from
 * notes, so it gets no Node access (no `nodeintegration`) and a
 * Content-Security-Policy, set before the HTML goes in, that allows no
 * scripts and no network: images, fonts and styles only from data:, blob:
 * and the app's own app:// files. executeJavaScript and printToPDF are
 * driven from outside the page, so neither needs Node.
 *
 * No `partition` of its own: Electron registers a protocol per session,
 * and Obsidian serves app:// (this page, vault images, the theme's fonts)
 * in its default session only, so in a session of its own the page
 * wouldn't load. A partition would need every resource inlined first.
 */

// Minimal local types — avoids adding `electron` as a dependency just for typings.
interface PrintToPDFOptions {
  landscape?: boolean;
  printBackground?: boolean;
  pageSize?: string | { width: number; height: number };
  margins?: {
    marginType?: "default" | "none" | "printableArea" | "custom";
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  scale?: number;
}

interface WebviewElement extends HTMLElement {
  printToPDF(options: PrintToPDFOptions): Promise<Uint8Array>;
  executeJavaScript(code: string): Promise<unknown>;
}

export interface PdfExportOptions {
  pageSize?: "A4" | "Letter" | "Legal" | "Tabloid" | { width: number; height: number };
  landscape?: boolean;
  /** Margins in inches. Omit for default. */
  margins?: { top: number; bottom: number; left: number; right: number };
  printBackground?: boolean;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  scale?: number;
}

export interface RenderedDoc {
  /** HTML for the page <body> — does NOT include the <body> tag itself. */
  bodyHtml: string;
  /** CSS rules captured from activeDocument.styleSheets, joined with newlines. */
  css: string;
  /** Document title. */
  title: string;
}

/**
 * Render a {@link RenderedDoc} to a PDF byte buffer via a hidden webview.
 * Caller is responsible for writing the bytes (e.g. `vault.createBinary`).
 */
export async function exportToPdfBytes(
  doc: RenderedDoc,
  opts: PdfExportOptions = {},
): Promise<Uint8Array> {
  // "webview" is an Electron tag not present in HTMLElementTagNameMap, so the
  // tag name (and the resulting element) need casts.
  const webview = createEl("webview" as keyof HTMLElementTagNameMap, {
    cls: "duckmage-export-webview",
    attr: WEBVIEW_ATTRS,
  }) as HTMLElement as WebviewElement;
  activeDocument.body.appendChild(webview);

  try {
    await waitForWebviewLoad(webview);

    const injectScript = buildInjectScript(doc);
    await webview.executeJavaScript(injectScript);

    // Give the webview time to lay out, load fonts, and resolve any deferred work
    // (image decode, late-bound CSS). 300ms is enough for plugin-generated content.
    await sleep(300);

    const printOptions: PrintToPDFOptions = {
      landscape: opts.landscape ?? false,
      printBackground: opts.printBackground ?? true,
      pageSize: opts.pageSize ?? "Letter",
      margins: opts.margins
        ? {
            marginType: "custom",
            top: opts.margins.top,
            bottom: opts.margins.bottom,
            left: opts.margins.left,
            right: opts.margins.right,
          }
        : { marginType: "default" },
      displayHeaderFooter: opts.displayHeaderFooter ?? false,
      headerTemplate: opts.headerTemplate ?? "<span></span>",
      footerTemplate: opts.footerTemplate ?? "<span></span>",
      scale: opts.scale ?? 1,
    };

    const bytes = await webview.printToPDF(printOptions);
    return bytes;
  } finally {
    webview.remove();
  }
}

function waitForWebviewLoad(webview: HTMLElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutMs = 10_000;
    let settled = false;
    const onLoad = () => {
      if (settled) return;
      settled = true;
      webview.removeEventListener("did-finish-load", onLoad);
      resolve();
    };
    webview.addEventListener("did-finish-load", onLoad);
    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      webview.removeEventListener("did-finish-load", onLoad);
      reject(new Error(`webview did not load within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * The webview's attributes: the page to print into, and nothing else.
 * Never `nodeintegration` (the page never needs Node) and no `partition`
 * (see the header: app:// only loads in the default session).
 */
export const WEBVIEW_ATTRS: Readonly<Record<string, string>> = {
  src: "app://obsidian.md/help.html",
};

/**
 * The policy the print page runs under: no scripts, no network, no
 * frames, objects or forms. Images, fonts and styles may come only from
 * the document itself (inline), data:/blob: URIs or the app's own app://
 * files (vault images in a rendered note).
 */
export const PRINT_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "img-src data: blob: app:",
  "style-src 'unsafe-inline' data: app:",
  "font-src data: app:",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** The script that puts the document into the webview (exported for tests). */
export function buildInjectScript(doc: RenderedDoc): string {
  // Encode payloads as URI-component-encoded strings so backticks and ${} in
  // content can't break out of the template literal we're constructing below.
  const bodyEnc = encodeURIComponent(doc.bodyHtml);
  const cssEnc = encodeURIComponent(doc.css);
  const titleEnc = encodeURIComponent(doc.title);
  const cspEnc = encodeURIComponent(PRINT_PAGE_CSP);

  // Runs inside the webview's renderer process, which has none of
  // Obsidian's globals: it uses the page's own document.
  return `
    (() => {
      const d = globalThis.document;
      const body = decodeURIComponent("${bodyEnc}");
      const css = decodeURIComponent("${cssEnc}");
      const title = decodeURIComponent("${titleEnc}");

      // The policy goes in first, so it covers everything the HTML below
      // asks for (scripts, remote images, fonts, frames).
      d.head.innerHTML = "";
      const csp = d.createElement("meta");
      csp.setAttribute("http-equiv", "Content-Security-Policy");
      csp.setAttribute("content", decodeURIComponent("${cspEnc}"));
      d.head.appendChild(csp);

      // Then a single <style> block from captured CSS plus a minimal print
      // reset. We don't try to preserve the original head — the host page
      // is just a render context.
      const styleEl = d.createElement("style");
      styleEl.textContent = css;
      d.head.appendChild(styleEl);

      // Force light theme — dark backgrounds print poorly. This matches the
      // better-export-pdf approach.
      d.body.className = "theme-light";
      d.body.removeAttribute("style");
      d.body.innerHTML = body;

      d.title = title;
    })();
  `;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
