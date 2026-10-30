#!/usr/bin/env node
/**
 * Mobile emulation check (issue #20): the built plugin in a HIDDEN sandbox
 * Obsidian with app.emulateMobile(true) and a phone-sized viewport. It
 * checks the plugin reloads on "mobile" without console errors, then drives
 * the hex map with CDP touch events: one-finger drag (pan), two-finger pinch
 * (zoom), a tap, and a long-press that must open the hex editor. Screenshots
 * go to the run's shots/ folder; the run folder is deleted at the end.
 *
 *   UX_RUNS_DIR=~/hexmaker-runs node dev/smoke/mobile-emulation.mjs [--keep]
 *
 * Emulation is not a phone: it covers the plugin's own touch handling, not
 * a real WebView's quirks (iOS Safari, the soft keyboard, safe areas).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, launchSandbox, stopSandbox, connectPage, pluginErrors, shot, sleep } from "./lib/obsidian.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const keep = process.argv.includes("--keep");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };

const work = path.join(os.homedir(), ".cache", "hexmaker-mobile", String(Date.now()));
const build = path.join(work, "build");
const seed = path.join(work, "seed");
fs.mkdirSync(build, { recursive: true });
fs.mkdirSync(seed, { recursive: true });
fs.writeFileSync(path.join(seed, ".hexmaker-sandbox"), "mobile emulation sandbox\n");
for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(ROOT, f), path.join(build, f));
const manifest = JSON.parse(fs.readFileSync(path.join(build, "manifest.json"), "utf8"));
check("manifest isDesktopOnly is false", manifest.isDesktopOnly === false);

let runDir = null, sess = null;
try {
  const created = await createSandbox({ pluginDir: build, seed, name: "mobile-emulation" });
  runDir = created.runDir;
  await launchSandbox(runDir);
  sess = await connectPage(runDir);
  const { page } = sess;
  const id = manifest.id;
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const ready = await ev(async (pid) => {
    for (let i = 0; i < 300; i++) { const p = window.app.plugins.plugins[pid]; if (p?.mapStore) return true; await new Promise((r) => setTimeout(r, 200)); }
    return false;
  }, id);
  check("plugin loaded (desktop mode)", ready);

  // A map, made on "desktop" so the store is ready.
  const mapName = await ev(async (pid) => {
    const p = window.app.plugins.plugins[pid];
    p.settings.setupComplete = true;
    window.app.workspace.getLeavesOfType("duckmage-setup-wizard").forEach((l) => l.detach());
    const r = await p.createNewMap({ name: "Phone Map", cols: 14, rows: 12, quiet: true });
    if ("error" in r) throw new Error(r.error);
    await p.saveSettings(); await p.mapStore.flush();
    return r.name;
  }, id);

  // ── mobile ──
  const mark = sess.log.length;
  // emulateMobile reloads the window: the plugin then loads fresh, as it would on a phone.
  await ev(() => { setTimeout(() => window.app.emulateMobile(true), 50); return true; }).catch(() => {});
  await sleep(4000);
  let loaded = false;
  for (let i = 0; i < 120 && !loaded; i++) {
    loaded = await ev((pid) => !!window.app?.plugins?.plugins?.[pid]?.mapStore, id).catch(() => false);
    if (!loaded) await sleep(500);
  }
  const isMobile = await ev(() => ({ body: document.body.classList.contains("is-mobile"), phone: document.body.classList.contains("is-phone") }));
  check("app.emulateMobile(true): body.is-mobile", isMobile.body, JSON.stringify(isMobile));
  check("plugin loads on mobile", loaded);
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await sleep(1500);

  const opened = await ev(async (pid, name) => {
    const p = window.app.plugins.plugins[pid];
    await p.showMap(name);
    for (let i = 0; i < 200; i++) {
      const v = window.app.workspace.getLeavesOfType("duckmage-hex-map")[0]?.view;
      if (v?.containerEl.querySelectorAll(".duckmage-hex[data-x]").length > 20) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }, id, mapName);
  check("hex map renders on mobile", opened);
  await sleep(800);
  await shot(page, runDir, "01-map-mobile");

  const geo = await ev(() => {
    const v = window.app.workspace.getLeavesOfType("duckmage-hex-map")[0].view;
    const clip = v.containerEl.querySelector(".duckmage-hex-map-clip");
    const r = clip.getBoundingClientRect();
    const hex = [...v.containerEl.querySelectorAll(".duckmage-hex[data-x]")].map((h) => ({ h, b: h.getBoundingClientRect() }))
      .filter((o) => o.b.left > r.left + 30 && o.b.right < r.right - 30 && o.b.top > r.top + 30 && o.b.bottom < r.bottom - 30)[0];
    const b = hex.b;
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, clip: { l: r.left, t: r.top, w: r.width, h: r.height }, touchAction: getComputedStyle(clip).touchAction };
  });
  check("map clip has touch-action none", geo.touchAction === "none", geo.touchAction);
  check("map fits a ~390px screen", geo.clip.w <= 392, `clip width ${Math.round(geo.clip.w)}`);
  // The zoom is baked into the font size after a pause, so measure the drawn hex width.
  const vp = () => ev(() => { const v = window.app.workspace.getLeavesOfType("duckmage-hex-map")[0].view; const h = v.containerEl.querySelector(".duckmage-hex[data-x]").getBoundingClientRect(); return { zoom: h.width, panX: v.viewport.panX, panY: v.viewport.panY }; });

  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const x0 = geo.clip.l + geo.clip.w / 2, y0 = geo.clip.t + geo.clip.h / 2;

  // one-finger drag pans
  let a = await vp();
  await touch("touchStart", [[x0, y0]]);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", [[x0 + i * 8, y0 + i * 5]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(200);
  let b = await vp();
  check("one-finger drag pans the map", Math.abs(b.panX - a.panX - 64) < 8 && Math.abs(b.panY - a.panY - 40) < 8 && Math.abs(b.zoom - a.zoom) < 0.5, `pan ${a.panX.toFixed(0)},${a.panY.toFixed(0)} -> ${b.panX.toFixed(0)},${b.panY.toFixed(0)}`);
  check("a drag does not open the hex editor", (await ev(() => document.querySelectorAll(".modal-container .modal").length)) === 0);

  // two-finger pinch zooms (spread)
  a = await vp();
  await touch("touchStart", [[x0 - 30, y0], [x0 + 30, y0]]);
  for (let i = 1; i <= 10; i++) { await touch("touchMove", [[x0 - 30 - i * 8, y0], [x0 + 30 + i * 8, y0]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(500);
  b = await vp();
  check("two-finger spread zooms in", b.zoom > a.zoom * 1.8, `zoom ${a.zoom.toFixed(2)} -> ${b.zoom.toFixed(2)}`);
  await shot(page, runDir, "02-after-pinch-in");
  a = b;
  await touch("touchStart", [[x0 - 110, y0], [x0 + 110, y0]]);
  for (let i = 1; i <= 10; i++) { await touch("touchMove", [[x0 - 110 + i * 8, y0], [x0 + 110 - i * 8, y0]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(500);
  b = await vp();
  check("two-finger pinch zooms out", b.zoom < a.zoom * 0.75, `zoom ${a.zoom.toFixed(2)} -> ${b.zoom.toFixed(2)}`);
  check("a pinch does not open a hex or editor", (await ev(() => document.querySelectorAll(".modal-container .modal").length)) === 0);

  // long-press opens the hex editor
  const g2 = await ev(() => {
    const v = window.app.workspace.getLeavesOfType("duckmage-hex-map")[0].view;
    const r = v.containerEl.querySelector(".duckmage-hex-map-clip").getBoundingClientRect();
    const hex = [...v.containerEl.querySelectorAll(".duckmage-hex[data-x]")].map((h) => h.getBoundingClientRect())
      .filter((q) => q.left > r.left + 20 && q.right < r.right - 20 && q.top > r.top + 20 && q.bottom < r.bottom - 20)[0];
    return { x: hex.left + hex.width / 2, y: hex.top + hex.height / 2 };
  });
  await touch("touchStart", [[g2.x, g2.y]]);
  await sleep(750);
  await touch("touchEnd", []);
  await sleep(900);
  const menu = await ev(() => { const m = document.querySelector(".menu"); return m ? { items: [...m.querySelectorAll(".menu-item-title")].map((i) => i.textContent), w: m.getBoundingClientRect().width } : null; });
  const stray = await ev(() => document.querySelectorAll(".modal-container .modal").length);
  check("long-press opens the hex menu (what right-click opens)", !!menu && menu.items.length > 2, menu ? `${menu.items.length} items: ${menu.items.slice(0, 4).join(", ")}…` : "no menu");
  check("the lift after a long-press doesn't click a menu item", stray === 0, `modals open: ${stray}`);
  check("hex menu fits the phone width", !!menu && menu.w <= 390, menu ? `${Math.round(menu.w)}px` : "");
  await shot(page, runDir, "03-long-press-hex-menu");
  await ev(() => document.querySelector(".menu-item-title") && document.body.click());
  await page.keyboard.press("Escape");
  await sleep(500);
  // the hex editor itself (Open hex editor / Edit hex…): is it narrow enough?
  await ev((pid) => { const p = window.app.plugins.plugins[pid]; return p; }, id);

  // a quick tap on a hex still opens its note (click path intact)
  const before = await ev(() => window.app.workspace.getLeavesOfType("markdown").length);
  await touch("touchStart", [[g2.x, g2.y]]);
  await sleep(60);
  await touch("touchEnd", []);
  await sleep(1500);
  const after = await ev(() => ({ md: window.app.workspace.getLeavesOfType("markdown").length, modals: document.querySelectorAll(".modal-container .modal").length, menu: !!document.querySelector(".menu") }));
  check("a tap still opens the hex (click path)", after.md > before || after.modals > 0 || after.menu, `markdown leaves ${before} -> ${after.md}, modals ${after.modals}`);
  await shot(page, runDir, "04-after-tap");

  // HF11 on a phone: Start exploring from the long-press menu, the party bar's Sees 2 is one tap,
  // a tap on the party's own hex reveals ring 2 (token unmoved), and the Reveal hexes brush takes a finger drag.
  const hasFog = await ev((pid) => window.app.plugins.plugins[pid].moduleGenerators({ toPaths: () => ({ paths: [], missing: [] }), procGrid: (g) => g }).some((k) => k.id === "procedural:hex-flower"), id);
  if (hasFog) {
    await ev(() => { document.querySelector(".menu") && document.body.click(); document.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click()); window.app.workspace.getLeavesOfType("markdown").forEach((l) => l.detach()); });
    for (let i = 0; i < 3 && (await ev(() => document.querySelectorAll(".modal").length)); i++) { await page.keyboard.press("Escape"); await sleep(400); }
    await ev(async (pid, name) => { const p = window.app.plugins.plugins[pid]; await p.showMap(name); window.app.workspace.getLeavesOfType("duckmage-hex-map")[0].view.setWorkMode("play"); }, id, mapName);
    await sleep(1200);
    const tapAt = async (x, y) => { await touch("touchStart", [[x, y]]); await sleep(40); await touch("touchEnd", []); await sleep(500); };
    const centreOf = (sel) => ev((q) => { const el = document.querySelector(q); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }, sel);
    const g3 = await ev(() => {
      const v = window.app.workspace.getLeavesOfType("duckmage-hex-map")[0].view;
      const r = v.containerEl.querySelector(".duckmage-hex-map-clip").getBoundingClientRect();
      const mid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const hexes = [...v.containerEl.querySelectorAll(".duckmage-hex[data-x]")].map((h) => ({ k: `${h.dataset.x}_${h.dataset.y}`, b: h.getBoundingClientRect() }))
        .filter((o) => o.b.left > r.left + 20 && o.b.right < r.right - 20 && o.b.top > r.top + 20 && o.b.bottom < r.bottom - 20)
        .sort((a, b) => Math.hypot(a.b.left - mid.x, a.b.top - mid.y) - Math.hypot(b.b.left - mid.x, b.b.top - mid.y));
      const h = hexes[0];
      return { k: h.k, x: h.b.left + h.b.width / 2, y: h.b.top + h.b.height / 2 };
    });
    await touch("touchStart", [[g3.x, g3.y]]);
    await sleep(750);
    await touch("touchEnd", []);
    await sleep(900);
    const start = await ev(() => { const i = [...document.querySelectorAll(".menu .menu-item")].find((m) => m.textContent.includes("Start exploring")); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const why = start ? "" : await ev((pid, name) => JSON.stringify({ mode: window.app.plugins.plugins[pid].getMap(name).workMode, items: [...document.querySelectorAll(".menu .menu-item")].map((m) => m.textContent), modals: [...document.querySelectorAll(".modal")].map((m) => m.className) }), id, mapName);
    check("long-press menu offers Start exploring (Play)", !!start, why);
    if (start) {
      await tapAt(start.x, start.y);
      await sleep(600);
      const dlg = await ev(() => { const m = document.querySelector(".duckmage-start-exploring")?.closest(".modal"); return m ? m.getBoundingClientRect().width : null; });
      check("Start exploring dialog fits the phone", dlg !== null && dlg <= 392, `${dlg}px`);
      const cta = await centreOf(".duckmage-start-exploring .mod-cta");
      if (cta) await tapAt(cta.x, cta.y);
      await sleep(1200);
      const fog = await ev((pid, name) => { const p = window.app.plugins.plugins[pid]; return { on: p.getMap(name).exploreFog, fogged: document.querySelectorAll(".duckmage-hex-fogged").length }; }, id, mapName);
      check("a tap on Start exploring fogs the map", fog.on === "on" && fog.fogged > 0, JSON.stringify(fog));
      const tok = await centreOf(".duckmage-token.is-party");
      if (tok) await tapAt(tok.x, tok.y);
      await sleep(600);
      const bar = await ev(() => { const b = document.querySelector(".duckmage-party-controls"); return b ? b.getBoundingClientRect().width : null; });
      check("tapping the party shows its bar, within the phone width", bar !== null && bar <= 390, `${bar}px`);
      await shot(page, runDir, "05-fog-party-bar");
      const s2 = await centreOf('.duckmage-party-controls button[aria-label="Sees 2"]');
      if (s2) await tapAt(s2.x, s2.y);
      const seesNow = await ev((pid, name) => window.app.plugins.plugins[pid].getMap(name).exploreReveal, id, mapName);
      check("Sees 2 is one tap", seesNow === "2 rings", String(seesNow));
      // The party's own hex, away from the token.
      const own = await ev((k) => {
        const [x, y] = k.split("_");
        const h = document.querySelector(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
        const r = h.getBoundingClientRect();
        for (const [fx, fy] of [[0.5, 0.12], [0.5, 0.88], [0.2, 0.5], [0.8, 0.5], [0.3, 0.2], [0.7, 0.8]]) {
          const px = r.left + r.width * fx, py = r.top + r.height * fy;
          const at = document.elementFromPoint(px, py);
          if (at && at.closest(".duckmage-hex") === h && !at.closest(".duckmage-token")) return { x: px, y: py };
        }
        return null;
      }, g3.k);
      const seenBefore = await ev((pid, name) => (window.app.plugins.plugins[pid].getMap(name).exploreSeen ?? []).join(";"), id, mapName);
      if (own) await tapAt(own.x, own.y);
      await sleep(800);
      const look = await ev((pid, name, k) => {
        const p = window.app.plugins.plugins[pid];
        const n = (p.getMap(name).exploreSeen ?? []).reduce((a, row) => a + row.split(":")[1].split(",").reduce((c, r) => { const [x0, x1] = r.trim().split("-").map(Number); return c + (x1 === undefined ? 1 : x1 - x0 + 1); }, 0), 0);
        const v = window.app.workspace.getLeavesOfType("duckmage-hex-map")[0].view;
        v.tokens.loadTokensForMap();
        return { n, at: v.tokens.tokenEntries.find((t) => t.party)?.hex, k };
      }, id, mapName, g3.k);
      check("a tap on the party's own hex reveals ring 2, token unmoved", !!own && look.n === 19 && look.at === g3.k, `${own ? "" : "no free spot on the hex; "}seen ${seenBefore.length ? "" : "0 "}→ ${look.n}, party on ${look.at}`);
      await shot(page, runDir, "06-fog-look");
      // The brush: a one-finger drag over hidden hexes reveals them.
      const pick = await centreOf('.duckmage-party-controls button[aria-label="Reveal hexes Pick"]');
      if (pick) await tapAt(pick.x, pick.y);
      const path = await ev(() => {
        const r = document.querySelector(".duckmage-hex-map-clip").getBoundingClientRect();
        const hid = [...document.querySelectorAll(".duckmage-hex-fogged")].map((h) => ({ k: `${h.dataset.x}_${h.dataset.y}`, b: h.getBoundingClientRect() }))
          .filter((o) => o.b.left > r.left + 10 && o.b.right < r.right - 10 && o.b.top > r.top + 10 && o.b.bottom < r.bottom - 10);
        const a = hid[0];
        const b = a && hid.find((o) => o.k !== a.k && Math.abs(o.b.left - a.b.left) < 2 && Math.abs(o.b.top - a.b.bottom) < a.b.height * 0.6);
        return a && b ? { keys: [a.k, b.k], from: [a.b.left + a.b.width / 2, a.b.top + a.b.height / 2], to: [b.b.left + b.b.width / 2, b.b.top + b.b.height / 2] } : null;
      });
      if (path) {
        await touch("touchStart", [path.from]);
        for (let i = 1; i <= 6; i++) { await touch("touchMove", [[path.from[0] + (path.to[0] - path.from[0]) * i / 6, path.from[1] + (path.to[1] - path.from[1]) * i / 6]]); await sleep(20); }
        await touch("touchEnd", []);
        await sleep(900);
      }
      const brushed = path ? await ev((ks) => ks.map((k) => { const [x, y] = k.split("_"); return document.querySelector(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`)?.classList.contains("duckmage-hex-fogged"); }), path.keys) : null;
      check("Reveal hexes: a finger drag reveals the hexes crossed", !!pick && !!brushed && brushed.every((f) => f === false), path ? `${path.keys.join(" + ")}: fogged ${JSON.stringify(brushed)}` : "no pair of hidden hexes on screen");
      await shot(page, runDir, "07-fog-brush");
    }
  }

  const errs = pluginErrors(sess.log.slice(mark), id).filter((e) => !/emulateMobile/.test(e.text));
  check("no plugin console errors on mobile", errs.length === 0, errs.slice(0, 3).map((e) => e.text.slice(0, 160)).join(" | "));
} catch (e) {
  check("run completed", false, String(e?.stack ?? e).slice(0, 600));
} finally {
  try { await sess?.close(); } catch { /* gone */ }
  if (runDir) {
    const shots = path.join(runDir, "shots");
    if (keep && fs.existsSync(shots)) console.log("shots kept in " + shots);
    else if (fs.existsSync(shots)) {
      const out = path.join(os.homedir(), ".cache", "hexmaker-mobile", "shots");
      fs.mkdirSync(out, { recursive: true });
      for (const f of fs.readdirSync(shots)) fs.copyFileSync(path.join(shots, f), path.join(out, f));
      console.log("screenshots copied to " + out);
    }
    try { await stopSandbox(runDir); } catch (e) { console.log("stop failed: " + e.message); }
    if (!keep) fs.rmSync(runDir, { recursive: true, force: true });
  }
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
