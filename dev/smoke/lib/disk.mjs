/**
 * Disk truth for the smoke suite (promoted from the migration runs'
 * C:/Users/markr/work/tmp/migtest/disk.mjs).
 *
 * - snapshot(): content hash + mtime of every vault file that is the user's
 *   (everything outside .obsidian) plus the plugin's own folder (data.json,
 *   backups), so "nothing changed" can be checked file by file.
 * - legacyTruth(): the map data that pre-map-note hex notes carry in their
 *   frontmatter, plus a hash of each note's body and non-data keys, to
 *   verify a migration moved exactly that and touched nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const YAML = createRequire(path.join(ROOT, "package.json"))("yaml");

const BUILD_FILES = new Set(["main.js", "manifest.json", "styles.css"]);
export const DATA_KEYS = ["terrain", "icon", "gm-icons", "gm-icon", "region", "duckmage-submap", "locked"];
const FM = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const sha = (buf) => crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);

/** Vault-relative, forward slashes. */
const rel = (vault, p) => path.relative(vault, p).split(path.sep).join("/");

/**
 * { "<rel path>": { h, m, size } } for the user's files and the plugin's
 * folder (minus the three build files). Obsidian's own config (workspace
 * layout etc.) is left out: it changes on every start.
 */
export function snapshot(vault, pluginId) {
  const out = {};
  const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (dir === vault && (e.name === ".obsidian" || e.name === ".trash")) continue;
        walk(p);
      } else if (e.isFile()) add(p);
    }
  };
  const add = (p) => {
    const st = fs.statSync(p);
    const buf = fs.readFileSync(p);
    const entry = { h: sha(buf), m: Math.round(st.mtimeMs), size: st.size };
    // Palette notes keep their text, so a format upgrade can be checked row by row.
    if (p.endsWith(".md") && st.size < 512 * 1024) {
      const text = buf.toString("utf8");
      if (/^---\r?\n[\s\S]*?hexmaker-palette\s*:/.test(text)) entry.text = text;
    }
    out[rel(vault, p)] = entry;
  };
  walk(vault);
  if (fs.existsSync(pluginDir)) {
    const walkPlugin = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkPlugin(p);
        else if (e.isFile() && !(dir === pluginDir && BUILD_FILES.has(e.name))) add(p);
      }
    };
    walkPlugin(pluginDir);
  }
  return out;
}

/** What changed between two snapshots. `touched` = rewritten with the same bytes. */
export function diff(a, b) {
  const added = [], removed = [], changed = [], touched = [];
  for (const [p, x] of Object.entries(a)) {
    const y = b[p];
    if (!y) removed.push(p);
    else if (y.h !== x.h) changed.push(p);
    else if (y.m !== x.m) touched.push(p);
  }
  for (const p of Object.keys(b)) if (!a[p]) added.push(p);
  return { added, removed, changed, touched };
}

/** Hex data a legacy hex note's frontmatter carries (as MapStore.hexDataFromFrontmatter reads it). */
export function hexDataFromFm(fm) {
  const h = {};
  if (!fm) return h;
  if (typeof fm.terrain === "string" && fm.terrain) h.terrain = fm.terrain;
  if (typeof fm.icon === "string" && fm.icon) h.icon = fm.icon;
  const gm = Array.isArray(fm["gm-icons"]) ? fm["gm-icons"].filter((v) => typeof v === "string") : typeof fm["gm-icon"] === "string" ? [fm["gm-icon"]] : [];
  if (gm.length) h.gmIcons = gm;
  if (typeof fm.region === "string" && fm.region) h.region = fm.region;
  if (typeof fm["duckmage-submap"] === "string" && fm["duckmage-submap"]) h.locations = [fm["duckmage-submap"]];
  if (fm.locked === true || fm.locked === "true") h.locked = true;
  return h;
}

function parseNote(text) {
  const mm = FM.exec(text);
  let fm = null, err = null;
  if (mm) { try { fm = YAML.parse(mm[1]) ?? {}; } catch (e) { err = String(e).slice(0, 80); } }
  const body = mm ? text.slice(mm[0].length) : text;
  const other = {};
  for (const [k, v] of Object.entries(fm ?? {})) if (!DATA_KEYS.includes(k) && k !== "hexmaker-map") other[k] = v;
  return { fm, err, body, other };
}

/**
 * Pre-migration truth: per map, the hex data in its hex notes; per note,
 * hashes of body and non-data frontmatter. Maps are the unique names in
 * data.json (first wins, like the plugin).
 */
export function legacyTruth(vault, data) {
  const hexFolder = (data.hexFolder ?? "").replace(/^\/+|\/+$/g, "");
  const maps = [...new Set((data.maps ?? data.regions ?? []).map((m) => m.name))];
  const out = { maps: {}, notes: {} };
  for (const m of maps) {
    const dir = path.join(vault, hexFolder, m);
    out.maps[m] = {};
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^-?\d+_-?\d+\.md$/.test(f)) continue;
      const relPath = `${hexFolder ? hexFolder + "/" : ""}${m}/${f}`;
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const n = parseNote(text);
      const h = hexDataFromFm(n.fm);
      if (Object.keys(h).length) out.maps[m][f.replace(/\.md$/, "")] = h;
      out.notes[relPath] = { text: sha(text), body: sha(n.body), other: sha(JSON.stringify(n.other)), dataKeys: DATA_KEYS.filter((k) => n.fm && k in n.fm), yamlError: n.err };
    }
  }
  return out;
}

/** A wikilink or plain name → the bare name ("[[_chult|Chult]]" → "chult"). */
const bare = (s) => String(s ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0].split("/").pop().replace(/^_/, "").replace(/\.md$/, "").trim().toLowerCase();

/** Compare one hex: legacy truth vs what the store holds now. Returns a problem string or null. */
function hexDiff(truth, store) {
  const s = store ?? {};
  const probs = [];
  for (const k of ["terrain", "icon"]) if ((truth[k] ?? null) !== (s[k] ?? null)) probs.push(`${k} ${truth[k]} → ${s[k]}`);
  if (JSON.stringify(truth.gmIcons ?? []) !== JSON.stringify(s.gmIcons ?? [])) probs.push(`gmIcons ${truth.gmIcons} → ${s.gmIcons}`);
  if (!!truth.locked !== !!s.locked) probs.push(`locked ${truth.locked} → ${s.locked}`);
  if (truth.region && bare(truth.region) !== bare(s.region)) probs.push(`region ${truth.region} → ${s.region}`);
  if (truth.locations) {
    const have = new Set([...(s.locations ?? []), ...(s.regionMap ? [s.regionMap] : [])].map(bare));
    for (const l of truth.locations) if (!have.has(bare(l))) probs.push(`location ${l} missing`);
  }
  return probs.length ? probs.join("; ") : null;
}

/**
 * After migration: store data matches the truth, every note with data got
 * cleaned (data keys gone, map link added), bodies and other keys
 * untouched, no hex note created or lost.
 */
export function verifyMigration(vault, truth, store) {
  const problems = [];
  let hexes = 0, cleaned = 0, bodies = 0;
  for (const [m, hs] of Object.entries(truth.maps)) {
    for (const [k, h] of Object.entries(hs)) {
      hexes++;
      const p = hexDiff(h, store[m]?.[k]);
      if (p) problems.push(`data ${m}/${k}: ${p}`);
    }
    for (const k of Object.keys(store[m] ?? {})) {
      const s = store[m][k];
      // Only hexes the notes gave data to; a name-only or extra row is new data.
      if (!hs[k] && (s.terrain || s.icon || s.gmIcons?.length)) problems.push(`extra hex in store ${m}/${k}: ${JSON.stringify(s)}`);
    }
  }
  for (const [p, t] of Object.entries(truth.notes)) {
    const file = path.join(vault, p);
    if (!fs.existsSync(file)) { problems.push(`hex note missing: ${p}`); continue; }
    const n = parseNote(fs.readFileSync(file, "utf8"));
    if (sha(n.body) !== t.body) problems.push(`body changed: ${p}`); else bodies++;
    if (sha(JSON.stringify(n.other)) !== t.other) problems.push(`user frontmatter changed: ${p}`);
    const left = DATA_KEYS.filter((k) => n.fm && k in n.fm);
    if (left.length) problems.push(`data keys left: ${p} ${left}`);
    else if (t.dataKeys.length) {
      cleaned++;
      if (!n.fm?.["hexmaker-map"]) problems.push(`no map link: ${p}`);
    }
  }
  return { hexesChecked: hexes, notesChecked: Object.keys(truth.notes).length, bodiesIdentical: bodies, cleaned, problems };
}

/** The migration's full-text backups (*.json.gz) hold each cleaned note exactly as it was. */
export function verifyBackups(vault, pluginId, seedTexts) {
  const bdir = path.join(vault, ".obsidian", "plugins", pluginId, "backups");
  const out = { backupDirs: 0, notes: 0, mismatches: 0, mapJson: 0 };
  if (!fs.existsSync(bdir)) return out;
  for (const day of fs.readdirSync(bdir)) {
    const d = path.join(bdir, day);
    if (!fs.statSync(d).isDirectory()) continue;
    out.backupDirs++;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith(".json") && !f.includes("hex-notes")) out.mapJson++;
      if (!/hex-notes\.json(\.gz)?$/.test(f)) continue;
      const buf = fs.readFileSync(path.join(d, f));
      const b = JSON.parse((f.endsWith(".gz") ? zlib.gunzipSync(buf) : buf).toString("utf8"));
      for (const [p, text] of Object.entries(b.notes ?? {})) {
        out.notes++;
        if (seedTexts[p] !== undefined && seedTexts[p] !== sha(text)) out.mismatches++;
      }
    }
  }
  return out;
}

/** note path → hash of its full text (for verifyBackups). */
export const noteTextHashes = (truth) => Object.fromEntries(Object.entries(truth.notes).map(([p, t]) => [p, t.text]));

/** A palette note's terrain rows: name → "color|icon|icon color|category|type" (backticks and derived "(…)" cells ignored). */
export function paletteTerrains(text) {
  const out = new Map();
  const lines = text.replace(/\r/g, "").split("\n");
  let cols = null;
  for (const line of lines) {
    if (!line.startsWith("|")) { if (cols) break; continue; }
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
    if (!cols) {
      if (cells[0].toLowerCase() !== "terrain") continue;
      cols = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (/^-+$/.test(cells[0])) continue;
    const at = (name) => { const i = cols.indexOf(name); return i >= 0 ? (cells[i] ?? "").toLowerCase() : ""; };
    out.set(cells[0], [at("color"), at("icon"), at("icon color"), at("category"), at("type")].join("|"));
  }
  return out;
}

/** Problems when a rewritten palette note lost or changed a terrain (a format upgrade may only add columns). */
export function verifyPaletteUpgrade(before, after) {
  const a = paletteTerrains(before), b = paletteTerrains(after);
  const probs = [];
  if (!a.size) probs.push("no terrain table before");
  for (const [name, v] of a) {
    if (!b.has(name)) probs.push(`terrain "${name}" gone`);
    else if (b.get(name) !== v) probs.push(`terrain "${name}": ${v} → ${b.get(name)}`);
  }
  for (const name of b.keys()) if (!a.has(name)) probs.push(`terrain "${name}" added`);
  return probs;
}
