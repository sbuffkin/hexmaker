#!/usr/bin/env node
/**
 * Rebuilds the bundled "Places" icon pack in icons/ (files named place-*.svg):
 * settlements, castles, towers, ruins, temples, camps and caves picked by the
 * owner from game-icons.net (dev/icon-candidates.html, 2026-10-10).
 *
 *   node dev/build-place-icons.mjs
 *
 * SVGs come from the Iconify API (one batched request) in the same shape as
 * the space set: explicit width/height so they rasterise in <img> and canvas
 * (PNG export), and black glyphs so tinted rendering can use them as a mask.
 *
 * Writes:
 *   icons/place-<name>.svg
 *   src/bundledPlaceIcons.ts   (imports + each icon's kind, for picker grouping)
 *   icons/CREDITS.md           (the block between the place-icons markers)
 *
 * All icons are CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/);
 * every one is credited to its author. Zero dependencies (Node ≥ 22).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "icons");

/** Picker sub-groups, in display order: [id, label]. */
export const PLACE_KINDS = [
  ["settlement", "Settlements"],
  ["castle", "Castles"],
  ["tower", "Towers"],
  ["ruin", "Ruins"],
  ["temple", "Temples"],
  ["camp", "Camps"],
  ["cave", "Caves & mines"],
];

const AUTHORS = {
  "delapouite": "Delapouite",
  "lorc": "Lorc",
  "caro-asercion": "Caro Asercion",
  "pepijn-poolman": "Pepijn Poolman",
  "heavenly-dog": "HeavenlyDog",
  "quoting": "Quoting",
};

// [game-icons name, author slug, kind] — bundled as place-<name>.svg.
export const PLACE_ICONS = [
  ["village", "delapouite", "settlement"],
  ["huts-village", "delapouite", "settlement"],
  ["medieval-village-01", "caro-asercion", "settlement"],
  ["house", "delapouite", "settlement"],
  ["family-house", "delapouite", "settlement"],
  ["hut", "delapouite", "settlement"],
  ["viking-longhouse", "delapouite", "settlement"],
  ["windmill", "delapouite", "settlement"],
  ["harbor-dock", "delapouite", "settlement"],
  ["tavern-sign", "delapouite", "settlement"],
  ["treehouse", "caro-asercion", "settlement"],
  ["castle", "delapouite", "castle"],
  ["elven-castle", "pepijn-poolman", "castle"],
  ["hill-fort", "delapouite", "castle"],
  ["military-fort", "delapouite", "castle"],
  ["locked-fortress", "lorc", "castle"],
  ["medieval-gate", "delapouite", "castle"],
  ["defensive-wall", "heavenly-dog", "castle"],
  ["stone-tower", "lorc", "tower"],
  ["watchtower", "delapouite", "tower"],
  ["white-tower", "lorc", "tower"],
  ["guarded-tower", "lorc", "tower"],
  ["tower-flag", "delapouite", "tower"],
  ["evil-tower", "delapouite", "tower"],
  ["clock-tower", "caro-asercion", "tower"],
  ["lighthouse", "delapouite", "tower"],
  ["castle-ruins", "delapouite", "ruin"],
  ["ancient-ruins", "delapouite", "ruin"],
  ["tower-fall", "lorc", "ruin"],
  ["broken-wall", "delapouite", "ruin"],
  ["damaged-house", "quoting", "ruin"],
  ["spooky-house", "delapouite", "ruin"],
  ["tombstone", "lorc", "ruin"],
  ["church", "delapouite", "temple"],
  ["greek-temple", "delapouite", "temple"],
  ["egyptian-temple", "delapouite", "temple"],
  ["byzantin-temple", "delapouite", "temple"],
  ["temple-gate", "delapouite", "temple"],
  ["shinto-shrine", "delapouite", "temple"],
  ["fire-shrine", "delapouite", "temple"],
  ["crystal-shrine", "delapouite", "temple"],
  ["mayan-pyramid", "delapouite", "temple"],
  ["great-pyramid", "delapouite", "temple"],
  ["egyptian-pyramids", "delapouite", "temple"],
  ["camping-tent", "delapouite", "camp"],
  ["campfire", "lorc", "camp"],
  ["forest-camp", "delapouite", "camp"],
  ["desert-camp", "delapouite", "camp"],
  ["goblin-camp", "delapouite", "camp"],
  ["barracks-tent", "delapouite", "camp"],
  ["cave-entrance", "delapouite", "cave"],
  ["mountain-cave", "delapouite", "cave"],
  ["dungeon-gate", "delapouite", "cave"],
  ["gold-mine", "delapouite", "cave"],
  ["mine-wagon", "delapouite", "cave"],
];

const fileOf = (name) => `place-${name}.svg`;

async function buildSvgs() {
  const url = `https://api.iconify.design/game-icons.json?icons=${PLACE_ICONS.map(([n]) => n).join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.json();
  for (const [name] of PLACE_ICONS) {
    const icon = data.icons?.[name] ?? data.icons?.[data.aliases?.[name]?.parent];
    if (!icon) throw new Error(`game-icons:${name} not found`);
    const w = icon.width ?? data.width ?? 512;
    const h = icon.height ?? data.height ?? 512;
    const scale = Math.max(1, Math.round(128 / Math.max(w, h)));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">` +
      `${icon.body.replace(/currentColor/g, "#000")}</svg>\n`;
    fs.writeFileSync(path.join(outDir, fileOf(name)), svg);
  }
  console.log(`game-icons: ${PLACE_ICONS.length} place icons`);
}

/** Regenerate src/bundledPlaceIcons.ts from the list above. */
function writeImports() {
  const ident = (name) => "place" + name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  const lines = [
    "// Generated by dev/build-place-icons.mjs — Places icon pack (see icons/CREDITS.md).",
    ...PLACE_ICONS.map(([n]) => `import ${ident(n)} from "../icons/${fileOf(n)}";`),
    "",
    "/** Sub-groups of the Places pack, in picker order: [id, label]. */",
    "export const PLACE_KINDS: [string, string][] = [",
    ...PLACE_KINDS.map(([id, label]) => `\t["${id}", "${label}"],`),
    "];",
    "",
    "/** [file name, data URL, kind id] */",
    "export const BUNDLED_PLACE_ICONS: [string, string, string][] = [",
    ...PLACE_ICONS.map(([n, , kind]) => `\t["${fileOf(n)}", ${ident(n)}, "${kind}"],`),
    "];",
    "",
  ];
  fs.writeFileSync(path.join(root, "src", "bundledPlaceIcons.ts"), lines.join("\n"));
  console.log(`src/bundledPlaceIcons.ts: ${PLACE_ICONS.length} imports`);
}

/** Rewrite the Places block of icons/CREDITS.md (between the markers). */
function writeCredits() {
  const file = path.join(outDir, "CREDITS.md");
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const text = raw.replace(/\r\n/g, "\n");
  const begin = "<!-- place-icons:begin (generated by dev/build-place-icons.mjs) -->";
  const end = "<!-- place-icons:end -->";
  const block = [
    begin,
    "",
    "### Places pack (`place-*.svg`)",
    "",
    "Settlement, castle, tower, ruin, temple, camp and cave icons from https://game-icons.net,",
    "licensed under Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/).",
    "Renamed with a `place-` prefix and set to black; otherwise unmodified.",
    "Rebuild with `node dev/build-place-icons.mjs`.",
    "",
    ...PLACE_ICONS.map(([n, a]) => `- \`${fileOf(n)}\` ← [\`${n}\`](https://game-icons.net/1x1/${a}/${n}.html) — by ${AUTHORS[a] ?? a}`),
    "",
    end,
  ].join("\n");
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  let next;
  if (i >= 0 && j > i) next = text.slice(0, i) + block + text.slice(j + end.length);
  else {
    const anchor = "## Material Design Icons";
    const k = text.indexOf(anchor);
    if (k < 0) throw new Error("CREDITS.md: no place to insert the Places block");
    next = text.slice(0, k) + block + "\n\n" + text.slice(k);
  }
  fs.writeFileSync(file, next.replace(/\n/g, eol));
  console.log("icons/CREDITS.md: Places block written");
}

await buildSvgs();
writeImports();
writeCredits();
