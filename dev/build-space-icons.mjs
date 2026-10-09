#!/usr/bin/env node
/**
 * Rebuilds the bundled space icon set in icons/ (files named space-*.svg / .png).
 *
 *   node dev/build-space-icons.mjs <path-to-unzipped-kenney_simple-space>
 *
 * SVGs come from the Iconify API (one batched request per collection) and are
 * written with explicit width/height so they rasterise correctly in <img> and
 * canvas (PNG export). Kenney sprites are white; they are recoloured to black
 * silhouettes (alpha kept) so they read like the other glyphs in untinted
 * picker previews. Tinted map rendering uses them as a mask, so colour there
 * comes from the terrain's icon colour either way.
 *
 * Sources and licences: see icons/CREDITS.md. Zero dependencies (Node ≥ 22).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "icons");
const kenneyDir = process.argv[2];

// [collection, source name, bundled basename]
export const SVG_ICONS = [
  // game-icons.net — CC BY 3.0 (Lorc, Delapouite)
  ["game-icons", "uncertainty", "space-anomaly"],
  ["game-icons", "black-hole-bolas", "space-black-hole"],
  ["game-icons", "comet-spark", "space-comet"],
  ["game-icons", "fragmented-meteor", "space-debris"],
  ["game-icons", "dust-cloud", "space-dust-cloud"],
  ["game-icons", "star-swirl", "space-star-swirl"],
  ["game-icons", "world", "space-world"],
  ["game-icons", "ringed-planet", "space-ringed-planet"],
  ["game-icons", "frozen-orb", "space-frozen-orb"],
  ["game-icons", "radial-balance", "space-radial-balance"],
  ["game-icons", "portal", "space-portal"],
  ["game-icons", "star-gate", "space-star-gate"],
  ["game-icons", "planet-core", "space-planet-core"],
  ["game-icons", "galaxy", "space-galaxy"],
  ["game-icons", "stone-sphere", "space-stone-sphere"],
  ["game-icons", "vortex", "space-vortex"],
  ["game-icons", "sun", "space-sun"],
  ["game-icons", "orbital", "space-orbital"],
  ["game-icons", "defense-satellite", "space-defense-satellite"],
  // Tabler Icons — MIT
  ["tabler", "atom-2", "space-atom-outline"],
  ["tabler", "circle-dot", "space-target-outline"],
  ["tabler", "shield", "space-shield-outline"],
  ["tabler", "meteor", "space-meteor-outline"],
  ["tabler", "circle-dashed", "space-ring-dashed"],
  ["tabler", "planet", "space-planet-outline"],
  ["tabler", "moon", "space-moon-outline"],
  ["tabler", "sun", "space-sun-outline"],
  ["tabler", "orbit", "space-orbit-outline"],
  ["tabler", "building-broadcast-tower", "space-beacon-outline"],
  // Material Design Icons (Pictogrammers) — Apache 2.0
  ["mdi", "circle-double", "space-double-ring"],
  ["mdi", "meteor", "space-meteor"],
  ["mdi", "dots-hexagon", "space-dots-hex"],
  ["mdi", "circle-slice-8", "space-ring-segments"],
  ["mdi", "star-four-points-outline", "space-twinkle"],
  ["mdi", "rocket-launch", "space-rocket"],
  ["mdi", "earth", "space-earth"],
  ["mdi", "planet", "space-planet"],
  ["mdi", "circle-outline", "space-ring"],
  ["mdi", "moon-full", "space-moon"],
  ["mdi", "water-circle", "space-water-world"],
  ["mdi", "ufo-outline", "space-ufo"],
  ["mdi", "white-balance-sunny", "space-sun-rays"],
  ["mdi", "orbit", "space-orbit"],
  ["mdi", "space-station", "space-station"],
  ["mdi", "radioactive", "space-radioactive"],
];

// Kenney Simple Space — CC0. [sprite, bundled basename]
export const KENNEY_ICONS = [
  ["meteor_detailedLarge", "space-asteroid"],
  ["star_large", "space-star-large"],
  ["star_medium", "space-star-medium"],
  ["ship_sidesA", "space-ship-sides-a"],
  ...["A", "B", "C", "D", "F", "G", "I", "J", "K", "L"].map((l) => [`ship_${l}`, `space-ship-${l.toLowerCase()}`]),
  ...["A", "B", "C", "D"].map((l) => [`enemy_${l}`, `space-raider-${l.toLowerCase()}`]),
  ...["A", "B", "C"].map((l) => [`station_${l}`, `space-station-${l.toLowerCase()}`]),
  ...["A", "B", "C", "D"].map((l) => [`satellite_${l}`, `space-satellite-${l.toLowerCase()}`]),
];

async function buildSvgs() {
  const byCollection = new Map();
  for (const [col, name, out] of SVG_ICONS) {
    if (!byCollection.has(col)) byCollection.set(col, []);
    byCollection.get(col).push([name, out]);
  }
  for (const [col, list] of byCollection) {
    const url = `https://api.iconify.design/${col}.json?icons=${list.map(([n]) => n).join(",")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const data = await res.json();
    for (const [name, out] of list) {
      const icon = data.icons?.[name] ?? data.icons?.[data.aliases?.[name]?.parent];
      if (!icon) throw new Error(`${col}:${name} not found`);
      const w = icon.width ?? data.width ?? 24;
      const h = icon.height ?? data.height ?? 24;
      // Size up small-grid sets so <img>/canvas rasterise them crisply.
      const scale = Math.max(1, Math.round(128 / Math.max(w, h)));
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">` +
        `${icon.body.replace(/currentColor/g, "#000")}</svg>\n`;
      fs.writeFileSync(path.join(outDir, `${out}.svg`), svg);
    }
    console.log(`${col}: ${list.length} icons`);
  }
}

/** Blacken an indexed-colour PNG's palette; transparency (tRNS) is untouched. */
function blackenIndexedPng(buf) {
  if (buf[25] !== 3) throw new Error("expected an indexed-colour PNG");
  const out = Buffer.from(buf);
  let off = 8;
  while (off < out.length) {
    const len = out.readUInt32BE(off);
    const type = out.toString("latin1", off + 4, off + 8);
    if (type === "PLTE") {
      out.fill(0, off + 8, off + 8 + len);
      const crc = zlib.crc32(out.subarray(off + 4, off + 8 + len));
      out.writeUInt32BE(crc >>> 0, off + 8 + len);
    }
    off += 12 + len;
  }
  return out;
}

function buildKenney() {
  if (!kenneyDir) {
    console.log("kenney: skipped (pass the unzipped kenney_simple-space folder to rebuild)");
    return;
  }
  const src = path.join(kenneyDir, "PNG", "Retina");
  for (const [sprite, out] of KENNEY_ICONS) {
    const png = fs.readFileSync(path.join(src, `${sprite}.png`));
    fs.writeFileSync(path.join(outDir, `${out}.png`), blackenIndexedPng(png));
  }
  console.log(`kenney: ${KENNEY_ICONS.length} icons`);
}

/** Regenerate src/bundledSpaceIcons.ts from whatever space-* files are in icons/. */
function writeImports() {
  const files = fs.readdirSync(outDir).filter((f) => /^space-.*\.(svg|png)$/.test(f)).sort();
  const ident = (f) => f.replace(/\.(svg|png)$/, "").replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  const lines = [
    "// Generated by dev/build-space-icons.mjs — space icon pack (see icons/CREDITS.md).",
    ...files.map((f) => `import ${ident(f)} from "../icons/${f}";`),
    "",
    "export const BUNDLED_SPACE_ICONS: [string, string][] = [",
    ...files.map((f) => `\t["${f}", ${ident(f)}],`),
    "];",
    "",
  ];
  fs.writeFileSync(path.join(root, "src", "bundledSpaceIcons.ts"), lines.join("\n"));
  console.log(`src/bundledSpaceIcons.ts: ${files.length} imports`);
}

await buildSvgs();
buildKenney();
writeImports();
