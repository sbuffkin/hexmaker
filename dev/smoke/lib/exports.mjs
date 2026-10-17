/**
 * C11 exports, end to end in real Obsidian (security review #2 and #11).
 * Runs in the page like the other helpers in page.mjs (sent as source
 * text, so it must be self-contained).
 *
 * - A note with a vault image and a remote image is exported to PDF with
 *   the "Export current note to PDF" command: the PDF is written, carries
 *   the hexmaker-export marker, and has the vault image in it. The print
 *   webview has no nodeintegration, and its page refuses the remote image
 *   (a CSP report in the webview's console).
 * - Overwrite rule: a hand-made file at the markdown export's name is kept
 *   and the export goes to "<name> 2.md"; exporting again replaces that
 *   copy (no "<name> 3"); a second PDF export replaces the first.
 * - The map export form (Export current map…): PNG (with the marker
 *   chunk), the PDF with reference table and the hexcrawl manual are all
 *   written.
 * Everything made here is deleted again, so the C5 restart compares a
 * clean vault.
 *
 * PDF parts need Electron <webview>s, which never load in the headless
 * Linux sandbox (not even about:blank, 2026-10-17), so on Linux they are
 * skipped and reported as such; the markdown and PNG parts always run.
 * The webview's set-up is unit tested in tests/pdfWebview.test.ts.
 */
export async function exportsRoundTrip(id, withMapForm = true) {
  const app = window.app;
  const p = app.plugins.plugins[id];
  const vault = app.vault;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { ok: true, steps: [], problems: [] };
  const pdfs = window.process?.platform !== "linux";
  if (!pdfs) out.steps.push("PDF exports skipped: webviews don't load in the headless Linux sandbox");
  const fail = (m) => { out.ok = false; out.problems.push(m); };
  const norm = (f) => (f ?? "").replace(/^\/+|\/+$/g, "");
  const folder = norm(p.settings.exportFolder) || (norm(p.settings.worldFolder) ? `${norm(p.settings.worldFolder)}/exports` : "exports");
  const file = (path) => vault.getAbstractFileByPath(path);
  const waitFile = async (path, ms = 60_000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (file(path)) return true; await sleep(250); }
    return false;
  };
  const bytes = async (path) => new Uint8Array(await vault.readBinary(file(path)));
  const latin = (b) => new TextDecoder("latin1").decode(b);
  const run = (cmd) => app.commands.executeCommandById(`${id}:${cmd}`);
  const made = [];
  const keep = (path) => { if (!made.includes(path)) made.push(path); };

  // Every print webview: its attributes and what its page logs.
  const webviews = [];
  const mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.tagName !== "WEBVIEW") continue;
      const w = { nodeintegration: n.getAttribute("nodeintegration"), partition: n.getAttribute("partition"), src: n.getAttribute("src"), console: [] };
      n.addEventListener("console-message", (e) => w.console.push(String(e.message)));
      webviews.push(w);
    }
  });
  mo.observe(activeDocument.body, { childList: true });

  try {
    // ── the probe note: a vault image and a remote one ──
    const dir = "smoke-export";
    if (!file(dir)) await vault.createFolder(dir);
    keep(dir);
    const canvas = activeDocument.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const g = canvas.getContext("2d");
    g.fillStyle = "#c0392b"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#2c3e50"; g.fillRect(16, 16, 32, 32);
    const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
    await vault.createBinary(`${dir}/probe.png`, await png.arrayBuffer());
    keep(`${dir}/probe.png`);
    const note = await vault.create(`${dir}/Export probe.md`, "# Export probe\n\nSome text to print.\n\n![[probe.png]]\n\n![remote](https://example.invalid/remote-probe.png)\n");
    keep(note.path);
    await sleep(500);
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(note);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await sleep(800);

    // ── PDF of the note ──
    const pdfPath = `${folder}/Export probe.pdf`;
    if (pdfs) {
    if (!run("export-current-note-pdf")) fail("export-current-note-pdf didn't run");
    if (!(await waitFile(pdfPath))) fail(`no ${pdfPath} after 60 s`);
    else {
      keep(pdfPath);
      const b = await bytes(pdfPath);
      const t = latin(b);
      const tail = t.slice(-200);
      if (!t.startsWith("%PDF-")) fail("note PDF: not a PDF");
      if (!/%%EOF\s*%hexmaker-export\s*$/.test(tail)) fail(`note PDF: no export marker at the end (${JSON.stringify(tail.slice(-40))})`);
      if (!/\/Subtype\s*\/Image/.test(t)) fail("note PDF: the vault image isn't in it");
      else out.steps.push(`note PDF ${b.length} bytes, marker, image`);
    }
    const w = webviews[0];
    if (!w) fail("no print webview seen");
    else {
      if (w.nodeintegration !== null) fail(`webview nodeintegration="${w.nodeintegration}"`);
      const refused = w.console.filter((m) => /Content Security Policy/i.test(m) && /example\.invalid/.test(m));
      if (!refused.length) fail(`remote image not refused by the CSP; webview console: ${w.console.slice(0, 5).join(" | ") || "(empty)"}`);
      else out.steps.push("webview: no nodeintegration, remote image refused by the CSP");
    }
    if (activeDocument.querySelector("webview")) fail("print webview left in the page");

    // A second PDF export replaces the first.
    await sleep(1500);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    run("export-current-note-pdf");
    await sleep(6000);
    if (file(`${folder}/Export probe 2.pdf`)) { keep(`${folder}/Export probe 2.pdf`); fail("second PDF export didn't replace the first (wrote Export probe 2.pdf)"); }
    else out.steps.push("re-export replaced the PDF");
    }

    // ── markdown: never over a file it didn't make ──
    const own = "# Export probe\n\nMy own notes, not an export.\n";
    const ownPath = `${folder}/Export probe.md`;
    if (!file(folder)) await vault.createFolder(folder);
    await vault.create(ownPath, own);
    keep(ownPath);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    run("export-current-note-markdown");
    const copy = `${folder}/Export probe 2.md`;
    if (!(await waitFile(copy, 15_000))) fail(`markdown export: no ${copy}`);
    else {
      keep(copy);
      await sleep(500);
      if ((await vault.read(file(ownPath))) !== own) fail("markdown export changed the hand-made file");
      if (!/^---\n[\s\S]*hexmaker-export: note/.test(await vault.read(file(copy)))) fail("markdown copy has no hexmaker-export");
      app.workspace.setActiveLeaf(leaf, { focus: true });
      run("export-current-note-markdown");
      await sleep(3000);
      if (file(`${folder}/Export probe 3.md`)) { keep(`${folder}/Export probe 3.md`); fail("re-export wrote Export probe 3.md instead of replacing its copy"); }
      else out.steps.push("markdown: hand-made file kept, copy as 'Export probe 2.md', re-export replaced it");
    }
    leaf.detach();

    // ── the map export form ──
    if (withMapForm) {
      // The form opens on the map in the open map view (C3 left one open).
      run("export-current-map");
      await sleep(1000);
      const modal = () => activeDocument.querySelector(".modal-container .modal");
      const click = (label) => {
        const b = [...(modal()?.querySelectorAll("button") ?? [])].find((x) => x.textContent.trim() === label);
        if (!b) { fail(`map export form: no "${label}" button`); return false; }
        b.click();
        return true;
      };
      const before = new Set(vault.getFiles().map((f) => f.path));
      const newFile = async (ext, ms = 90_000) => {
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          const f = vault.getFiles().find((x) => !before.has(x.path) && x.path.startsWith(`${folder}/`) && x.extension === ext && !made.includes(x.path));
          if (f) { keep(f.path); return f.path; }
          await sleep(300);
        }
        return null;
      };
      if (modal() && click("Export PNG")) {
        const f = await newFile("png");
        if (!f) fail("map PNG: not written");
        else {
          const t = latin(await bytes(f));
          if (!t.includes("tEXthexmaker-export")) fail("map PNG: no export marker chunk");
          else out.steps.push(`map PNG ${f} with its marker`);
        }
      }
      if (pdfs && !modal()) { run("export-current-map"); await sleep(1000); }
      if (pdfs && modal() && click("Export PDF with reference table")) {
        const f = await newFile("pdf");
        if (!f) fail("map PDF: not written");
        else if (!/%hexmaker-export\s*$/.test(latin(await bytes(f)).slice(-60))) fail(`map PDF ${f}: no export marker`);
        else out.steps.push(`map PDF ${f}`);
      }
      if (pdfs && !modal()) { run("export-current-map"); await sleep(1000); }
      if (pdfs && modal() && click("Export hexcrawl manual (PDF)")) {
        const f = await newFile("pdf", 120_000);
        if (!f) fail("hexcrawl manual: not written");
        else out.steps.push(`manual ${f}`);
      }
      activeDocument.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
    }
    const open = webviews.filter((x) => x.nodeintegration !== null);
    if (open.length) fail(`${open.length} print webviews with nodeintegration`);
    else if (webviews.length) out.steps.push(`${webviews.length} print webviews, none with nodeintegration`);
  } catch (e) {
    fail(`crash: ${e?.stack ?? e}`);
  } finally {
    mo.disconnect();
    // Close tabs showing what was made, then delete it (files first).
    app.workspace.getLeavesOfType("pdf").concat(app.workspace.getLeavesOfType("image"), app.workspace.getLeavesOfType("markdown"))
      .filter((l) => made.includes(l.view?.file?.path)).forEach((l) => l.detach());
    await sleep(500);
    for (const path of [...made].reverse()) {
      const f = file(path);
      if (f) { try { await vault.delete(f, true); } catch (e) { out.problems.push(`cleanup ${path}: ${e}`); } }
    }
  }
  return out;
}
