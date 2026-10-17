/**
 * Migration audit: is a migrated vault 1:1 with the 1.5.x vault it came from?
 *
 *   node node_modules/tsx/dist/cli.mjs --tsconfig ./tsconfig.test.json --import ./tests/register.mjs \
 *     dev/migration/audit.mts --seed <pre vault> --data <pre data.json> (--plugin-dir <build> | --run <sandbox run dir>) [--out report.md]
 *
 * `--seed` is the vault before migration (a copy, never the live vault),
 * `--data` its plugin data.json. With `--plugin-dir` (a folder with the built
 * main.js, manifest.json, styles.css) a hidden sandbox is made from the seed
 * and data, the plugin starts and migrates it, and nothing else is done in
 * it. With `--run`, an existing sandbox run whose vault was migrated from
 * that seed is started again instead.
 *
 * Checks, beyond the smoke suite's M-* checks (hex data, bodies, backups):
 *   paths     every road/river step (pair of hexes) of every legacy chain is a
 *             step of a routed path of the same type, and no routed step is new
 *   settings  each map's data.json settings are what the plugin holds now
 *   tables    a rewritten table rolls the same: same results, weights, die
 *   files     nothing lost; every other rewritten note shown as a diff
 * Exit 0 when paths, settings and tables are 1:1 and nothing was lost.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const rtMod = await import("../../src/random-tables/randomTable.ts") as Record<string, unknown> & { default?: Record<string, unknown> };
const parseRandomTable = (rtMod.parseRandomTable ?? rtMod.default?.parseRandomTable) as typeof import("../../src/random-tables/randomTable.ts").parseRandomTable;

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const seed = arg("seed"), dataFile = arg("data"), pluginDir = arg("plugin-dir");
let runDir = arg("run");
const outFile = arg("out");
if (!seed || !dataFile || (!runDir && !pluginDir)) {
  console.error("usage: audit.mts --seed <pre vault> --data <pre data.json> (--plugin-dir <build> | --run <sandbox run dir>) [--out report.md]");
  process.exit(2);
}
const ob = await import("../smoke/lib/obsidian.mjs");
const P = await import("../smoke/lib/page.mjs");
if (!runDir) {
  // A copy of data.json: the sandbox never sees the given file.
  const created = await ob.createSandbox({ pluginDir, seed, pluginData: dataFile, name: "migration-audit" });
  runDir = created.runDir as string;
  console.log(`sandbox ${runDir}`);
}

type LegacyMap = { name: string; pathChains?: { typeName?: string; type?: string; hexes?: string[] }[] } & Record<string, unknown>;
type Branch = { path: string; typeName: string; branch: number; hexes: string[] };
type Probe = { maps: Record<string, { settings: Record<string, unknown>; branches: Branch[] | null }>; pluginId: string };

const data = JSON.parse(fs.readFileSync(dataFile, "utf8")) as { maps?: LegacyMap[]; regions?: LegacyMap[]; hexFolder?: string };
const run = JSON.parse(fs.readFileSync(path.join(runDir!, "run.json"), "utf8")) as { vault: string; pluginId: string };
const post = run.vault;

// ── what the plugin holds now (sandbox, hidden) ─────────────────────────────

async function probe(): Promise<Probe> {
  await ob.launchSandbox(runDir);
  const conn = await ob.connectPage(runDir);
  try {
    // Started: the migration runs; wait until the plugin is ready and the vault quiet.
    const ready = await conn.page.evaluate(P.waitReady, run.pluginId, 900_000) as { ready: boolean; ms: number };
    if (!ready.ready) throw new Error("plugin never became ready");
    await conn.page.evaluate(P.settle, run.pluginId, 5000, 900_000);
    const errors = ob.pluginErrors(conn.log, run.pluginId);
    if (errors.length) console.log(`plugin errors: ${errors.map((e: { text: string }) => e.text.slice(0, 200)).join(" | ")}`);
    // Plain text, not a function: tsx's keepNames helpers don't exist in the page.
    return await conn.page.evaluate(`(async (id) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const p = window.app.plugins.plugins[id];
      const t0 = Date.now();
      while (Date.now() - t0 < 600000 && !(p.settings.maps ?? []).every((m) => p.mapStore.isReady(m.name))) await sleep(500);
      const out = {};
      for (const m of p.settings.maps) {
        if (out[m.name]) continue;
        const settings = JSON.parse(JSON.stringify({ ...p.getMap(m.name), paths: undefined, pathChains: undefined }));
        let branches = null;
        try {
          branches = (p.mapStore.resolved(m.name) ?? []).map((b) => ({ path: b.path, typeName: b.typeName, branch: b.branch, hexes: [...b.hexes] }));
        } catch { branches = null; }
        out[m.name] = { settings, branches };
      }
      return { maps: out, pluginId: id };
    })(${JSON.stringify(run.pluginId)})`) as Probe;
  } finally {
    await conn.close();
    await ob.stopSandbox(runDir);
  }
}

// ── comparisons ─────────────────────────────────────────────────────────────

const edge = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const canon = (v: unknown): string => {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])])) : x;
  return JSON.stringify(sort(v));
};

/**
 * Legacy chains vs routed paths, step by step (an unordered pair of hexes).
 * One-hex chains are `dots`: 1.5.x never drew a chain under two hexes and
 * the migration leaves them out (listed in each map's paths report, kept in
 * its backup), so they're information, not a loss.
 */
function comparePaths(legacy: LegacyMap, branches: Branch[] | null): { probs: string[]; dots: string[] } {
  const probs: string[] = [], dotNotes: string[] = [];
  if (branches === null) return { probs: ["paths didn't resolve"], dots: [] };
  const oldEdges = new Map<string, Set<string>>(), oldDots = new Map<string, Set<string>>();
  const newEdges = new Map<string, Set<string>>(), newHexes = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, t: string, v: string) => { if (!m.has(t)) m.set(t, new Set()); m.get(t)!.add(v); };
  for (const c of legacy.pathChains ?? []) {
    const t = String(c.typeName ?? c.type ?? "?").toLowerCase();
    const hs = c.hexes ?? [];
    if (hs.length === 1) add(oldDots, t, hs[0]);
    for (let i = 1; i < hs.length; i++) if (hs[i] !== hs[i - 1]) add(oldEdges, t, edge(hs[i - 1], hs[i]));
  }
  for (const b of branches) {
    const t = b.typeName.toLowerCase();
    for (const h of b.hexes) add(newHexes, t, h);
    for (let i = 1; i < b.hexes.length; i++) if (b.hexes[i] !== b.hexes[i - 1]) add(newEdges, t, edge(b.hexes[i - 1], b.hexes[i]));
  }
  for (const t of new Set([...oldEdges.keys(), ...newEdges.keys(), ...oldDots.keys()])) {
    const o = oldEdges.get(t) ?? new Set(), n = newEdges.get(t) ?? new Set();
    const missing = [...o].filter((e) => !n.has(e)), extra = [...n].filter((e) => !o.has(e));
    // A one-hex legacy chain is a single hex: kept if that hex is on a path of its type.
    const dots = [...(oldDots.get(t) ?? [])].filter((h) => !(newHexes.get(t)?.has(h)) && ![...o].some((e) => e.split("|").includes(h)));
    if (missing.length) probs.push(`${t}: ${missing.length} steps lost (${missing.slice(0, 6).join(", ")})`);
    if (extra.length) probs.push(`${t}: ${extra.length} steps added (${extra.slice(0, 6).join(", ")})`);
    if (dots.length) dotNotes.push(`${t} ${dots.length}`);
  }
  return { probs, dots: dotNotes };
}

/** Map keys kept in the map note (or the plugin) under the same name and meaning. */
const SKIP_SETTING = new Set(["pathChains", "paths", "savedViewport"]);
function compareSettings(legacy: LegacyMap, now: Record<string, unknown>): string[] {
  const probs: string[] = [];
  for (const [k, v] of Object.entries(legacy)) {
    if (SKIP_SETTING.has(k)) continue;
    if (!(k in now)) { probs.push(`${k} gone (was ${JSON.stringify(v)})`); continue; }
    if (canon(v) !== canon(now[k])) probs.push(`${k}: ${JSON.stringify(v)} → ${JSON.stringify(now[k])}`);
  }
  return probs;
}

const sha = (f: string) => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
function walk(root: string, rel = "", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.name === ".obsidian" || e.name === ".git" || e.name === ".trash") continue;
    if (e.isDirectory()) walk(root, r, out); else out.push(r);
  }
  return out;
}

function isTable(text: string): boolean {
  return /^---[\s\S]*?\ndice:/m.test(text) || /\|\s*(Result|Weight)\s*\|/i.test(text);
}
function compareTable(before: string, after: string): string | null {
  const a = parseRandomTable(before), b = parseRandomTable(after);
  const rows = (t: typeof a) => t.entries.map((e) => `${e.result}\u0000${e.weight}`);
  if (canon(rows(a)) !== canon(rows(b))) return `entries differ: ${a.entries.length} → ${b.entries.length}`;
  if (a.dice !== b.dice) return `die d${a.dice} → d${b.dice}`;
  return null;
}

// ── run ─────────────────────────────────────────────────────────────────────

const report: string[] = [];
let failed = false;
const section = (title: string, lines: string[], ok: boolean) => {
  report.push(`## ${ok ? "OK" : "PROBLEM"}: ${title}`, "", ...(lines.length ? lines : ["(nothing)"]), "");
  if (!ok) failed = true;
};

// Twice: as migrated, then after a restart (read back from the map notes).
const first = await probe();
const state = await probe();
{
  const lines: string[] = [];
  for (const name of Object.keys(first.maps)) {
    const a = first.maps[name], b = state.maps[name];
    if (!b) { lines.push(`- ${name}: gone after the restart`); continue; }
    if (canon(a.settings) !== canon(b.settings)) lines.push(`- ${name}: settings differ after the restart`);
    if (canon(a.branches) !== canon(b.branches)) lines.push(`- ${name}: paths differ after the restart`);
  }
  section("restart reads back the same maps", lines.length ? lines : [`- ${Object.keys(first.maps).length} maps identical after a restart`], lines.length === 0);
}
const legacyMaps: LegacyMap[] = [];
const seen = new Set<string>();
for (const m of data.maps ?? data.regions ?? []) if (!seen.has(m.name)) { seen.add(m.name); legacyMaps.push(m); }

{
  const lines: string[] = [];
  let ok = true, steps = 0;
  for (const m of legacyMaps) {
    const s = state.maps[m.name];
    if (!s) { lines.push(`- ${m.name}: map missing after migration`); ok = false; continue; }
    const { probs, dots } = comparePaths(m, s.branches);
    const chains = (m.pathChains ?? []).length;
    const dotNote = dots.length ? `; one-hex pieces left out (never drawn by 1.5.x): ${dots.join(", ")}` : "";
    steps += (m.pathChains ?? []).reduce((n, c) => n + Math.max(0, (c.hexes ?? []).length - 1), 0);
    if (probs.length) { ok = false; lines.push(`- ${m.name}: ${probs.join("; ")}${dotNote}`); }
    else if (chains) lines.push(`- ${m.name}: ${chains} legacy chains → ${new Set((s.branches ?? []).map((b) => b.path)).size} paths, every drawn step kept, none added${dotNote}`);
  }
  section(`paths (${steps} legacy steps)`, lines, ok);
}
{
  const lines: string[] = [];
  let ok = true;
  for (const m of legacyMaps) {
    const s = state.maps[m.name];
    if (!s) continue;
    const probs = compareSettings(m, s.settings);
    if (probs.length) { ok = false; lines.push(`- ${m.name}: ${probs.join("; ")}`); }
  }
  if (ok) lines.push(`- ${legacyMaps.length} maps: every data.json setting the same (paths and saved viewport checked separately/ignored)`);
  section("map settings", lines, ok);
}

const before = walk(seed), after = new Set(walk(post));
const lost = before.filter((f) => !after.has(f));
section("files", lost.length ? lost.slice(0, 50).map((f) => `- lost: ${f}`) : [`- ${before.length} files, none lost; ${after.size - before.length + lost.length} new`], lost.length === 0);

const changed = before.filter((f) => after.has(f) && sha(path.join(seed, f)) !== sha(path.join(post, f)));
const hexFolder = (data.hexFolder ?? "").replace(/^\/+|\/+$/g, "");
const isHexNote = (f: string) => f.startsWith(hexFolder + "/") && /\/-?\d+_-?\d+\.md$/.test(f);
{
  const lines: string[] = [];
  let ok = true, n = 0;
  for (const f of changed.filter((f) => !isHexNote(f))) {
    const a = fs.readFileSync(path.join(seed, f), "utf8"), b = fs.readFileSync(path.join(post, f), "utf8");
    if (!isTable(a)) continue;
    n++;
    const p = compareTable(a, b);
    if (p) { ok = false; lines.push(`- ${f}: ${p}`); }
  }
  if (ok) lines.push(`- ${n} rewritten tables roll exactly as before`);
  section("tables", lines, ok);
}
{
  const others = changed.filter((f) => !isHexNote(f) && !isTable(fs.readFileSync(path.join(seed, f), "utf8")));
  const lines = [`${others.length} other notes rewritten (hex notes are checked by the smoke suite's M-data). Diffs:`, ""];
  for (const f of others) {
    let d = "";
    try { execFileSync("diff", ["-u", path.join(seed, f), path.join(post, f)], { encoding: "utf8" }); }
    catch (e) { d = String((e as { stdout?: string }).stdout ?? ""); }
    lines.push("```diff", `# ${f}`, d.split("\n").slice(2).join("\n").trimEnd(), "```", "");
  }
  section("other rewritten notes (for review)", lines, true);
}

const text = [`# Migration audit`, "", `seed ${seed}`, `data ${dataFile}`, `migrated ${post}`, "", ...report].join("\n");
if (outFile) fs.writeFileSync(outFile, text);
console.log(report.filter((l) => l.startsWith("## ")).join("\n"));
console.log(failed ? "AUDIT: PROBLEMS FOUND" : "AUDIT: 1:1");
process.exit(failed ? 1 : 0);
