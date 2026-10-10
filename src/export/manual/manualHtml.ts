/**
 * Build the printable HTML for a hexcrawl manual from {@link ManualData}.
 * Pure (no Obsidian imports), so it can be unit-tested.
 *
 * Layout follows common hexcrawl/gazetteer practice:
 *   title page with the overview map → how to use → legend → random
 *   encounter tables → factions & regions → hex key by map section (section
 *   map, then the keyed hexes in two columns, numbered XXYY) → index.
 * Hexes with nothing beyond their terrain aren't keyed: the map shows them.
 */

import type { ManualData, ManualHex, ManualLinks, ManualPart, ManualSection } from "./manualModel";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const LINK_LABELS: [keyof ManualLinks, string][] = [
  ["towns", "Towns"],
  ["dungeons", "Dungeons"],
  ["features", "Features"],
  ["quests", "Quests"],
  ["factions", "Factions"],
];

/** True when a hex has something to print beyond its terrain (factions alone don't count). */
export function isKeyed(h: Omit<ManualHex, "number">, player: boolean): boolean {
  const text = h.landmark || h.description || h.weather || h.hooks || (!player && (h.hidden || h.secret));
  const links = h.links.towns.length || h.links.dungeons.length || h.links.features.length || h.links.quests.length;
  // A named hex is a place worth a key entry, even with nothing else.
  return !!(text || links || h.name);
}

function titlePage(d: ManualData): string {
  return `
<section class="hx-title-page">
  <div class="hx-kicker">A hexcrawl gazetteer</div>
  <h1 class="hx-title">${esc(d.title)}</h1>
  <img class="hx-overview" src="${d.overviewMapUri}" alt="${esc(d.title)} overview map">
  <div class="hx-meta">${plural(d.hexCount, "hex", "hexes")} · ${plural(d.keyedCount, "keyed location")} · ${esc(d.date)}${d.player ? " · Player edition" : ""}</div>
  <div class="hx-made">Made with Hexmap World Creator ${esc(d.version)}</div>
</section>`;
}

/** Whether an optional part prints (the user can leave parts out of a handout). */
function includes(d: ManualData, part: ManualPart): boolean {
  return !d.omit?.includes(part);
}

function contents(d: ManualData): string {
  const items = [
    "How to use this book",
    includes(d, "legend") ? "Map legend" : "",
    d.tables.length && includes(d, "tables") ? "Random encounter tables" : "",
    (d.factions.length || d.regions.length) && includes(d, "factions") ? "Factions and regions" : "",
    `Hex key (${plural(d.sections.length, "section")})`,
    d.index.some((c) => c.entries.length) && includes(d, "index") ? "Index of locations" : "",
  ].filter(Boolean);
  return `
<section class="hx-page hx-front">
  <h2>Contents</h2>
  <ol class="hx-contents">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>
  <h2>How to use this book</h2>
  <p><b>Hex numbers.</b> Every hex has a ${d.numberDigits * 2}-digit number: the first ${d.numberDigits} digits count columns from the left edge of the map, the last ${d.numberDigits} count rows from the top, both starting at 01. The top-left hex is ${"0".repeat(d.numberDigits - 1)}1${"0".repeat(d.numberDigits - 1)}1. Numbers are printed in each hex on the maps.</p>
  <p><b>Keyed hexes.</b> The hex key lists only hexes with something to find. A hex that isn't listed is plain country of the terrain shown on the map; use its terrain's encounter table.</p>
  ${d.tables.length && includes(d, "tables") ? `<p><b>Encounters.</b> When an encounter check calls for one, roll on the table for the hex's terrain (or the one named in its entry).</p>` : ""}
  ${d.player ? `<p><b>Player edition.</b> Hidden and secret details are left out of this edition.</p>` : `<p><b>Game master material.</b> Entries marked <span class="hx-gm">GM</span> are hidden or secret: not for players until found.</p>`}
  <p class="hx-small">Each hex number is followed by the hex's map coordinates in grey, to find its note in Obsidian.</p>
</section>`;
}

function legend(d: ManualData): string {
  const terrains = d.legend
    .map(
      (t) => `<div class="hx-swatch">
      <span class="hx-chip" style="background:${esc(t.color)}">${t.iconUri ? `<img src="${t.iconUri}" alt="">` : ""}</span>
      <span class="hx-swatch-name">${esc(t.name)}</span><span class="hx-swatch-count">${t.hexCount}</span>
    </div>`,
    )
    .join("");
  const paths = d.paths
    .map(
      (p) => `<div class="hx-swatch">
      <svg class="hx-line" viewBox="0 0 40 10"><line x1="2" y1="5" x2="38" y2="5" stroke="${esc(p.color)}" stroke-width="${Math.max(1.5, Math.min(5, p.width))}"${p.dash ? ` stroke-dasharray="${esc(p.dash)}"` : ""} stroke-linecap="round"/></svg>
      <span class="hx-swatch-name">${esc(p.name)}</span><span class="hx-swatch-count">${p.count}</span>
    </div>`,
    )
    .join("");
  return `
<section class="hx-legend-section">
  <h2>Map legend</h2>
  <h3>Terrain <span class="hx-sub">(hexes)</span></h3>
  <div class="hx-legend">${terrains}</div>
  ${paths ? `<h3>Roads and rivers <span class="hx-sub">(hexes)</span></h3><div class="hx-legend">${paths}</div>` : ""}
</section>`;
}

function tables(d: ManualData): string {
  if (!d.tables.length) return "";
  const blocks = d.tables
    .map(
      (t) => `<div class="hx-table-block">
      <h4>${esc(t.name)}${t.usedBy ? ` <span class="hx-sub">· ${plural(t.usedBy, "hex", "hexes")}</span>` : ""}</h4>
      <table class="hx-table"><thead><tr><th>${esc(t.die || "%")}</th><th>Result</th></tr></thead>
      <tbody>${t.rows.map((r) => `<tr><td class="hx-roll">${esc(r.roll)}</td><td>${r.result}</td></tr>`).join("")}</tbody></table>
    </div>`,
    )
    .join("");
  return `
<section class="hx-page">
  <h2>Random encounter tables</h2>
  <div class="hx-two-col">${blocks}</div>
</section>`;
}

function factionsAndRegions(d: ManualData): string {
  if (!d.factions.length && !d.regions.length) return "";
  const factions = d.factions.length
    ? `<h3>Factions</h3><table class="hx-table hx-wide"><thead><tr><th>Faction</th><th>Hexes</th><th>Regions</th></tr></thead><tbody>${d.factions
        .map((f) => `<tr><td>${esc(f.name)}</td><td class="hx-roll">${f.hexCount}</td><td>${esc(f.regions.join(", "))}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  const regions = d.regions.length
    ? `<h3>Regions</h3><table class="hx-table hx-wide"><thead><tr><th>Region</th><th>Hexes</th></tr></thead><tbody>${d.regions
        .map((r) => `<tr><td>${esc(r.name)}</td><td class="hx-roll">${r.hexCount}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  return `
<section class="hx-page">
  <h2>Factions and regions</h2>
  ${factions}
  ${regions}
</section>`;
}

/** Entry title: the hex's name, else the first named location, else a short landmark, else the terrain. */
export function entryTitle(h: Pick<ManualHex, "landmark" | "terrain" | "links" | "name">): string {
  if (h.name) return esc(h.name);
  const named = h.links.towns[0] ?? h.links.dungeons[0] ?? h.links.features[0];
  if (named) return esc(named);
  const landmark = stripTags(h.landmark).split(/\n/)[0]?.trim() ?? "";
  if (landmark && landmark.length <= 48 && !/[.!?]\s/.test(landmark)) return esc(landmark.replace(/[.]$/, ""));
  return esc(capitalise(h.terrain || "Hex"));
}

function hexEntry(h: ManualHex, player: boolean): string {
  const title = entryTitle(h);
  const parts: string[] = [];
  if (h.description) parts.push(`<div class="hx-read">${h.description}</div>`);
  if (h.landmark && stripTags(h.landmark).replace(/[.]$/, "") !== stripTags(title)) parts.push(runIn("Landmark", h.landmark));
  for (const [key, label] of LINK_LABELS) {
    if (h.links[key].length) parts.push(runIn(label, esc(h.links[key].join(", "))));
  }
  if (h.weather) parts.push(runIn("Weather", h.weather));
  if (h.hooks) parts.push(runIn("Hooks and rumors", h.hooks));
  if (!player && h.hidden) parts.push(runIn("Hidden", h.hidden, true));
  if (!player && h.secret) parts.push(runIn("Secret", h.secret, true));
  const terrain = h.terrain
    ? `<span class="hx-terrain"><span class="hx-dot" style="background:${esc(h.terrainColor ?? "#999")}"></span>${esc(h.terrain)}${h.region ? ` · ${esc(h.region)}` : ""}</span>`
    : "";
  return `<article class="hx-entry" id="hex-${h.number}">
  <header><span class="hx-num">${h.number}</span><span class="hx-entry-title">${title}</span><span class="hx-coord">${h.x}, ${h.y}</span></header>
  ${terrain}
  ${parts.join("\n  ")}
</article>`;
}

function section(s: ManualSection, player: boolean, single: boolean): string {
  const heading = single ? "Hex key" : `Section ${esc(s.label)}`;
  return `
<section class="hx-page hx-section">
  <h2>${heading} <span class="hx-sub">hexes ${esc(s.range)}</span></h2>
  <img class="hx-section-map" src="${s.mapUri}" alt="${heading} map">
  ${s.hexes.length
    ? `<div class="hx-key">${s.hexes.map((h) => hexEntry(h, player)).join("\n")}</div>`
    : `<p class="hx-empty">No keyed hexes in this section.</p>`}
</section>`;
}

function index(d: ManualData): string {
  const cats = d.index.filter((c) => c.entries.length);
  if (!cats.length) return "";
  return `
<section class="hx-page">
  <h2>Index of locations</h2>
  <div class="hx-index">${cats
    .map(
      (c) => `<div class="hx-index-cat"><h4>${esc(c.category)}</h4>${c.entries
        .map((e) => `<div class="hx-index-row"><span>${esc(e.name)}</span><span class="hx-leader"></span><span class="hx-index-hexes">${e.hexes.join(", ")}</span></div>`)
        .join("")}</div>`,
    )
    .join("")}</div>
</section>`;
}

export function buildManualHtml(d: ManualData): string {
  return `<div class="hx-manual">
${titlePage(d)}
${contents(d)}
${includes(d, "legend") ? legend(d) : ""}
${includes(d, "tables") ? tables(d) : ""}
${includes(d, "factions") ? factionsAndRegions(d) : ""}
${d.sections.map((s) => section(s, d.player, d.sections.length === 1)).join("\n")}
${includes(d, "index") ? index(d) : ""}
</div>`;
}

// ── helpers ───────────────────────────────────────────────────────────────

const basename = (target: string) => target.slice(target.lastIndexOf("/") + 1).replace(/\.md$/i, "").split("#")[0];

/** Table results may be links or note paths; print the note's name. */
export function tableResultText(result: string): string {
  const linked = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m: string, target: string, alias?: string) => alias ?? basename(target));
  // A bare vault path (link-type table entries are stored without brackets).
  return /^[^\s/][^\n]*\/[^\n/]+$/.test(linked.trim()) && !/\s\/\s/.test(linked) ? basename(linked.trim()) : linked;
}


function runIn(label: string, html: string, gm = false): string {
  return `<div class="hx-field">${gm ? `<span class="hx-gm">GM</span> ` : ""}<b class="hx-label">${esc(label)}.</b> ${unwrapParagraph(html)}</div>`;
}

/** "<p>text</p>" → "text" so a run-in label can sit on the same line. */
function unwrapParagraph(html: string): string {
  const m = /^\s*<p>([\s\S]*?)<\/p>\s*$/.exec(html);
  return m && !m[1].includes("<p>") ? m[1] : html;
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, "").trim();

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Print stylesheet for the manual. Self-contained: the user's theme isn't used. */
export const MANUAL_CSS = `
html, body { background: #fff; margin: 0; padding: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.hx-manual {
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  font-size: 9.6pt; line-height: 1.38; color: #1f1c17;
}
.hx-manual h1, .hx-manual h2, .hx-manual h3, .hx-manual h4,
.hx-num, .hx-kicker, .hx-meta, .hx-made, .hx-label, .hx-gm, .hx-table th, .hx-sub, .hx-coord, .hx-terrain {
  font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
}
.hx-page { break-before: page; }
.hx-legend-section { margin-top: 14pt; break-inside: avoid; }
.hx-manual h2 {
  font-size: 15pt; font-weight: 700; letter-spacing: 0.02em; color: #5d1a1a;
  border-bottom: 1.5pt solid #5d1a1a; padding-bottom: 3pt; margin: 0 0 9pt;
}
.hx-manual h3 { font-size: 10.5pt; margin: 12pt 0 5pt; color: #3a3328; text-transform: uppercase; letter-spacing: 0.06em; }
.hx-manual h4 { font-size: 9.5pt; margin: 0 0 4pt; color: #3a3328; }
.hx-manual p { margin: 0 0 6pt; }
.hx-sub { font-size: 0.72em; font-weight: 400; color: #8a8174; letter-spacing: 0; text-transform: none; }
.hx-small { font-size: 8.5pt; color: #6b6357; }

/* Title page */
.hx-title-page { text-align: center; padding-top: 0.25in; }
.hx-kicker { font-size: 9pt; letter-spacing: 0.3em; text-transform: uppercase; color: #8a8174; }
.hx-title { font-size: 30pt; margin: 6pt 0 14pt; color: #2a1c12; font-weight: 700; letter-spacing: 0.01em; }
.hx-overview { display: block; max-width: 100%; max-height: 6.6in; margin: 0 auto 14pt; border: 1pt solid #b8ad99; }
.hx-meta { font-size: 9pt; color: #4a4339; letter-spacing: 0.04em; }
.hx-made { margin-top: 4pt; font-size: 7.5pt; color: #9a9184; }

/* Front matter */
.hx-contents { margin: 0 0 14pt 1.2em; padding: 0; }
.hx-contents li { margin: 2pt 0; }

/* Legend */
.hx-legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4pt 12pt; }
.hx-swatch { display: flex; align-items: center; gap: 6pt; break-inside: avoid; }
.hx-chip { width: 18pt; height: 16pt; border-radius: 3pt; border: 0.6pt solid rgba(0,0,0,0.35); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.hx-chip img { width: 12pt; height: 12pt; object-fit: contain; }
.hx-line { width: 30pt; height: 10pt; flex: none; }
.hx-swatch-name { flex: 1; }
.hx-swatch-count { color: #8a8174; font-variant-numeric: tabular-nums; }

/* Tables */
.hx-two-col { column-count: 2; column-gap: 0.3in; }
.hx-table-block { break-inside: avoid; margin-bottom: 10pt; }
.hx-table { width: 100%; border-collapse: collapse; font-size: 8.8pt; }
.hx-table th { text-align: left; font-size: 7.6pt; text-transform: uppercase; letter-spacing: 0.06em; color: #5d1a1a; border-bottom: 1pt solid #5d1a1a; padding: 2pt 4pt; }
.hx-table td { padding: 2pt 4pt; vertical-align: top; border-bottom: 0.4pt solid #e3dccd; }
.hx-table tr:nth-child(even) td { background: #f7f3ea; }
.hx-table p { margin: 0; }
.hx-roll { width: 1%; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; color: #3a3328; }
.hx-wide { margin-bottom: 8pt; }

/* Hex key */
.hx-section-map { display: block; max-width: 100%; max-height: 4.3in; margin: 0 auto 10pt; border: 1pt solid #b8ad99; }
.hx-key { column-count: 2; column-gap: 0.28in; column-rule: 0.5pt solid #ddd5c6; }
.hx-entry { break-inside: avoid; margin: 0 0 9pt; }
.hx-entry header { display: flex; align-items: baseline; gap: 6pt; border-bottom: 0.6pt solid #cfc6b5; padding-bottom: 1.5pt; margin-bottom: 2pt; }
.hx-num { font-weight: 800; font-size: 11pt; color: #5d1a1a; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.hx-entry-title { flex: 1; font-weight: 700; font-variant: small-caps; letter-spacing: 0.03em; }
.hx-coord { font-size: 7pt; color: #a39a8c; }
.hx-terrain { display: block; font-size: 7.6pt; color: #6b6357; margin-bottom: 3pt; text-transform: capitalize; }
.hx-dot { display: inline-block; width: 7pt; height: 7pt; border-radius: 1.5pt; margin-right: 4pt; vertical-align: -0.5pt; border: 0.5pt solid rgba(0,0,0,0.3); }
.hx-read { background: #f4efe4; border-left: 2pt solid #b8ad99; padding: 3pt 6pt; margin: 2pt 0 4pt; font-style: italic; }
.hx-read p { margin: 0 0 3pt; }
.hx-read p:last-child { margin-bottom: 0; }
.hx-field { margin: 0 0 3pt; }
.hx-field p { display: inline; margin: 0; }
.hx-field ul { margin: 1pt 0 2pt 1.1em; padding: 0; }
.hx-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; color: #3a3328; }
.hx-gm { display: inline-block; font-size: 6.5pt; font-weight: 700; color: #fff; background: #5d1a1a; border-radius: 2pt; padding: 0 3pt; letter-spacing: 0.06em; vertical-align: 0.5pt; }
.hx-empty { color: #8a8174; font-style: italic; }
.hx-manual a, .hx-manual .internal-link { color: inherit; text-decoration: none; border-bottom: 0.4pt dotted #8a8174; }

/* Index */
.hx-index { column-count: 3; column-gap: 0.25in; }
.hx-index-cat { break-inside: avoid; margin-bottom: 10pt; }
.hx-index-row { display: flex; align-items: baseline; gap: 3pt; font-size: 8.8pt; }
.hx-leader { flex: 1; border-bottom: 0.6pt dotted #b8ad99; transform: translateY(-2pt); }
.hx-index-hexes { font-variant-numeric: tabular-nums; color: #5d1a1a; font-weight: 600; }
`;
