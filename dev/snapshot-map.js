// Snapshot the open hex map view (DOM + theme vars) for dev/real-map-bench.html.
// Run inside Obsidian, e.g. `obsidian eval` via a base64 wrapper; writes
// dev/out/snap-<map>.json. Open the map you want first.
(() => {
  const v = app.workspace.getLeavesOfType("duckmage-hex-map")[0].view;
  const clip = v.contentEl.querySelector(".duckmage-hex-map-clip");
  const css = require("fs").readFileSync(app.vault.adapter.basePath + "/.obsidian/plugins/duckmage-plugin/styles.css", "utf8");
  const names = [...new Set(css.match(/var\(--[\w-]+/g).map(s => s.slice(4)))];
  const cs = getComputedStyle(clip);
  const vars = {}; for (const n of names) { const val = cs.getPropertyValue(n).trim(); if (val) vars[n] = val; }
  const out = { map: v.activeMapName, hexes: clip.querySelectorAll(".duckmage-hex").length,
    clipW: clip.clientWidth, clipH: clip.clientHeight, bodyClass: document.body.className,
    vars, html: clip.outerHTML, elements: clip.querySelectorAll("*").length,
    svgNodes: clip.querySelectorAll("svg *").length, imgs: clip.querySelectorAll("img").length };
  require("fs").writeFileSync(app.vault.adapter.basePath + "/.obsidian/plugins/duckmage-plugin/dev/out/snap-" + v.activeMapName + ".json", JSON.stringify(out));
  return JSON.stringify({ map: out.map, hexes: out.hexes, elements: out.elements, svgNodes: out.svgNodes, imgs: out.imgs, size: out.html.length, clip: [out.clipW, out.clipH] });
})()
