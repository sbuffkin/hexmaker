import { describe, it } from "node:test";
import expect from "expect";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The UI consistency drift guard (audit 2026-10-12, fix plan step 14;
 * design rule 9, "one concept, one control", checked periodically).
 * It fails when new code:
 *
 * 1. builds its own slider instead of the shared ones (LabeledSlider,
 *    MultiplierSlider, ShareSliders: src/ui/sliders.ts, shareSliders.ts);
 * 2. puts more than one primary (mod-cta) button on a surface;
 * 3. adds a modal that skips the shared base class (HexmakerModal);
 * 4. builds a footer row by hand instead of the footer helper
 *    (HexmakerModal.footer / renderFooter, src/ui/footer.ts);
 * 5. uses a word the owner retired (2026-10-13: Q4, Q8, Q9/R1, Q11, Q12):
 *    "colour", "Re-roll", "Place" as a kind of submap, "Region areas" /
 *    "region overlay" for painted areas, "Blend (built-in mixing)";
 * 6. builds a fold by hand instead of the shared Fold (src/ui/disclosure.ts);
 * 7. builds a picker's filter, empty state, drag grip or edit toggle by
 *    hand instead of src/ui/pickers.ts;
 * 8. writes the plugin's name onto a notice by hand (src/ui/notify.ts:
 *    noticeBackground, for background notices only).
 *
 * Fix the code, not this test. An allow-list entry needs a reason a
 * reviewer would accept (two surfaces in one class, never shown together).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : [];
  });
}

const FILES = tsFiles(SRC).map((p) => ({ path: relative(SRC, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));

/** The user docs: the README and the in-app help. */
const DOCS = [
  { path: "README.md", text: readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8") },
  { path: "src/hex-map/help.md", text: readFileSync(join(SRC, "hex-map", "help.md"), "utf8") },
];

// ── 1. sliders ─────────────────────────────────────────────────────────────

/** Places a range input is built: a `type: "range"` element, `.type = "range"`, or Obsidian's addSlider. */
export function sliderSites(text: string): number[] {
  const out: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/type:\s*["']range["']|\.type\s*=\s*["']range["']|\.addSlider\(/.test(line)) out.push(i + 1);
  });
  return out;
}

// ── 2. one primary per surface ─────────────────────────────────────────────

/** Primary buttons per class in a file ("(module)" for code outside any class). */
export function primariesByClass(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const classRe = /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/gm;
  const starts: { name: string; at: number }[] = [{ name: "(module)", at: 0 }];
  for (const m of text.matchAll(classRe)) starts.push({ name: m[1], at: m.index });
  starts.forEach((s, i) => {
    // Comments don't count (they may say "mod-cta").
    const block = text.slice(s.at, starts[i + 1]?.at ?? text.length).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const n = (block.match(/mod-cta|\.setCta\(\)|\bprimary:(?!\s*undefined\b)/g) ?? []).length;
    if (n) out.set(s.name, (out.get(s.name) ?? 0) + n);
  });
  return out;
}

/**
 * Classes allowed more than one primary in the source, because they draw
 * surfaces that never show together. `file#Class`: how many, and why.
 */
const PRIMARY_ALLOW: Record<string, [number, string]> = {
  "hex-map/SubmapPickerModal.ts#SubmapPickerModal": [2, "New location… is the primary only when there are no maps, and then there is no Link"],
  "overworld/EditRegionModal.ts#EditRegionModal": [2, "normal Edit (Enter region) and new-region mode (Create) are never shown together"],
  "random-tables/RandomTableView.ts#RandomTableView": [2, "Tables and Workflows modes: Roll and Roll workflow are never shown together"],
  "random-tables/RandomTableModal.ts#RandomTableModal": [2, "the picker mode and the direct-roll mode each have one Roll"],
};

// ── 3. modals ──────────────────────────────────────────────────────────────

/** `class X extends Modal` / SuggestModal / FuzzySuggestModal straight from Obsidian. */
export function rawModals(text: string): string[] {
  return [...text.matchAll(/class\s+(\w+)(?:<[^>]*>)?\s+extends\s+(Modal|SuggestModal|FuzzySuggestModal)\b/g)].map((m) => `${m[1]} extends ${m[2]}`);
}

/** Obsidian's SuggestModal can't share HexmakerModal's base (CLAUDE.md: the one exception). */
const MODAL_ALLOW: Record<string, string> = {
  "hex-map/FileLinkSuggestModal.ts": "extends SuggestModal (fuzzy file search); can't inherit from HexmakerModal",
  "HexmakerModal.ts": "the shared base class itself",
};

// ── 4. footers ─────────────────────────────────────────────────────────────

/** Hand-built footer rows the footer helper replaced. */
const OLD_FOOTERS = /duckmage-token-modal-buttons|duckmage-confirm-btn-row|modal-button-container|duckmage-table-editor-footer|duckmage-tee-buttons|duckmage-faction-editor-btns|duckmage-terrain-editor-actions/;

// ── 5. words ───────────────────────────────────────────────────────────────

/** The string literals on a line ('…', "…" and `…` without their quotes); comment lines are skipped. */
export function stringLiterals(line: string): string[] {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/**
 * Retired words in user-visible text, and why. A string literal counts as
 * user-visible text when it has a space or a capital letter (bare data
 * keys like "colour" or "region" don't).
 */
export const RETIRED_WORDS: { re: RegExp; why: string }[] = [
  { re: /\bcolours?\b|\bcoloured\b|\brecolour/i, why: "Q11: spell it color" },
  { re: /\bre-roll/i, why: "Q4: Reroll (a new seed) or Regenerate (same seed)" },
  { re: /\b(new|locked|this|the) place\b|^Place$/i, why: "Q9/R1: a submap is a Region or a Location, never a Place" },
  { re: /\bregion areas?\b|\bregion overlay\b|\bregions folder\b/i, why: "Q8: painted areas are Areas" },
  { re: /\bBlend \(built-in mixing\)/, why: "Q12: the generator option is Built-in mixing" },
];

/** Retired words in one source text (or a doc, every line): "line: word (why)". */
export function retiredWords(text: string, isDoc = false): string[] {
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const pieces = isDoc ? [line] : stringLiterals(line).filter((s) => /\s|[A-Z]/.test(s));
    for (const s of pieces) {
      for (const { re, why } of RETIRED_WORDS) {
        const m = s.match(re);
        if (m) out.push(`${i + 1}: ${m[0]} (${why})`);
      }
    }
  });
  return out;
}

/**
 * Data, not UI: a stored key or value that keeps the old word so notes
 * written before still read (the parsers accept both).
 */
const WORD_ALLOW: Record<string, RegExp> = {
  "palettes/paletteNote.ts": /"icon colour"/, // palette note column header, read as an alias of "Icon color"
  "migrations/v1.5-palette-colors-as-code.ts": /backups\/palette-colours-/, // backup folder name of the one-time colour conversion
  "overworld/migrations/biome-colour-key-to-color.ts": /colour:|colour-key|\/\^colour/, // the old biome-note key it renames (O7)
};

/** The text with allowed lines blanked (line numbers kept). */
function withoutAllowed(text: string, allow: RegExp | undefined): string {
  return allow ? text.split(/\r?\n/).map((l) => (allow.test(l) ? "" : l)).join("\n") : text;
}

// ── 6. folds ───────────────────────────────────────────────────────────────

/** Lines that build a `<details>` / `<summary>` by hand. */
export function rawFolds(text: string): number[] {
  const out: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/createEl\(\s*["'`](details|summary)["'`]/.test(line)) out.push(i + 1);
  });
  return out;
}

// ── 7. pickers ─────────────────────────────────────────────────────────────

/** Picker parts built by hand that src/ui/pickers.ts replaced. */
const OLD_PICKER_PARTS = /duckmage-(icon-filter|biome-filter|terrain-filter|faction-picker|picker-list|wfc-library)-empty|"⋮⋮"|text: "⠿"|"← Done"|"✏ Edit"|"Manage icons"|"← pick icons"|placeholder: "(Find|Search) (a )?(map|location|terrain)/;

/** Pickers that must use the shared filter (addPickerFilter). */
const FILTERED_PICKERS = [
  "hex-map/TerrainPickerModal.ts",
  "hex-table/HexTerrainPickerModal.ts",
  "hex-table/TerrainFilterModal.ts",
  "hex-map/FactionPickerModal.ts",
  "hex-map/GeoRegionPickerModal.ts",
  "hex-map/HexEditorModal.ts",
  "overworld/biomeChooser.ts",
  "overworld/BiomeLibraryModal.ts",
];

// ── 8. notices ─────────────────────────────────────────────────────────────

/** Lines where a notice writes the plugin's name by hand ("Hexmap World Creator: …", "Hexmaker: …"). */
export function prefixedNotices(text: string): number[] {
  const flat = text.replace(/\r\n/g, "\n");
  const re = /new Notice\(\s*[`"'](?:Hexmap World Creator|Hexmaker)\b|(?:setMessage|lines\.push)\(\s*[`"'](?:Hexmap World Creator|Hexmaker):/g;
  return [...flat.matchAll(re)].map((m) => flat.slice(0, m.index).split("\n").length);
}

describe("UI consistency drift guard", () => {
  it("sliders come from the shared kit: no range input outside src/ui/", () => {
    const found = FILES.filter((f) => !f.path.startsWith("ui/")).flatMap((f) => sliderSites(f.text).map((line) => `${f.path}:${line}`));
    // Use renderLabeledSlider / renderMultiplierSlider / renderShareSliders.
    expect(found).toEqual([]);
  });

  it("one primary (mod-cta) per surface", () => {
    const over: string[] = [];
    for (const f of FILES) {
      for (const [cls, n] of primariesByClass(f.text)) {
        const key = `${f.path}#${cls}`;
        const allowed = PRIMARY_ALLOW[key]?.[0] ?? 1;
        if (n > allowed) over.push(`${key}: ${n} (allowed ${allowed})`);
      }
    }
    expect(over).toEqual([]);
  });

  it("the allow-list doesn't go stale", () => {
    const stale: string[] = [];
    for (const [key, [n]] of Object.entries(PRIMARY_ALLOW)) {
      const [path, cls] = key.split("#");
      const f = FILES.find((x) => x.path === path);
      const have = f ? primariesByClass(f.text).get(cls) ?? 0 : 0;
      if (have < n) stale.push(`${key}: ${have} (list says ${n}); lower or drop the entry`);
    }
    expect(stale).toEqual([]);
  });

  it("every modal extends the shared base class (HexmakerModal)", () => {
    const raw = FILES.filter((f) => !MODAL_ALLOW[f.path]).flatMap((f) => rawModals(f.text).map((m) => `${f.path}: ${m}`));
    expect(raw).toEqual([]);
    // And nothing outside the base imports Obsidian's Modal to build one.
    const imports = FILES.filter((f) => !MODAL_ALLOW[f.path] && /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*"obsidian"/.test(f.text)).map((f) => f.path);
    expect(imports).toEqual([]);
  });

  it("modal footers come from the footer helper (no hand-built button rows)", () => {
    expect(FILES.filter((f) => OLD_FOOTERS.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("the shared reset is the only reset look: no text Reset or ↺ buttons", () => {
    const found = FILES.filter((f) => /createEl\("button",\s*\{[^}]*text:\s*"(Reset|↺)"/.test(f.text)).map((f) => f.path);
    expect(found).toEqual([]);
  });

  it("retired words stay out of user-visible text and the docs (Q4, Q8, Q9/R1, Q11, Q12)", () => {
    const found: string[] = [];
    for (const f of FILES) for (const hit of retiredWords(withoutAllowed(f.text, WORD_ALLOW[f.path]))) found.push(`${f.path}:${hit}`);
    for (const d of DOCS) for (const hit of retiredWords(d.text, true)) found.push(`${d.path}:${hit}`);
    expect(found).toEqual([]);
  });

  it("folds come from the shared Fold: no <details> built outside src/ui/disclosure.ts", () => {
    const found = FILES.filter((f) => f.path !== "ui/disclosure.ts").flatMap((f) => rawFolds(f.text).map((l) => `${f.path}:${l}`));
    // Use new Fold(parent, { title, store, surface }) (src/ui/disclosure.ts).
    expect(found).toEqual([]);
  });

  it("pickers use the shared parts: filter, empty state, drag grip and edit toggle", () => {
    expect(FILES.filter((f) => f.path !== "ui/pickers.ts" && OLD_PICKER_PARTS.test(f.text)).map((f) => f.path)).toEqual([]);
    const missing = FILTERED_PICKERS.filter((p) => !FILES.find((f) => f.path === p)?.text.includes("addPickerFilter("));
    expect(missing).toEqual([]);
    // Every filter box is a search box ("Filter <things>…"), not a text box.
    const textFilters = FILES.flatMap((f) => {
      const flat = f.text.replace(/\r\n/g, "\n");
      return [...flat.matchAll(/type: "text",[^}]{0,120}?placeholder: "Filter/g)].map((m) => `${f.path}:${flat.slice(0, m.index).split("\n").length}`);
    });
    // The map link combo (pattern-filterable-combo) is a text input by design.
    expect(textFilters.filter((s) => !s.startsWith("hex-map/MapLinkModal.ts"))).toEqual([]);
  });

  it("only background notices carry the plugin's name, through noticeBackground", () => {
    const found = FILES.filter((f) => f.path !== "ui/notify.ts").flatMap((f) => prefixedNotices(f.text).map((l) => `${f.path}:${l}`));
    expect(found).toEqual([]);
  });

  // The checks themselves catch what they should.
  it("self-check: the word, fold and notice scanners flag what they should", () => {
    expect(retiredWords(`el.createEl("button", { text: "Re-roll" });`)).toHaveLength(1);
    expect(retiredWords(`setName("Colour")`)).toHaveLength(1);
    expect(retiredWords(`fm.get("colour") ?? fm.get("color")`)).toEqual([]);
    expect(retiredWords(`setName("Color")`)).toEqual([]);
    expect(retiredWords(`text: open ? "New place" : "Locked place"`)).toHaveLength(2);
    expect(retiredWords(`const what = kind === "region" ? "Region" : "Place";`)).toHaveLength(1);
    expect(retiredWords(`"Revealed only through actions. True nature of a place."`)).toEqual([]);
    expect(retiredWords(`export const TOOL = "Region areas";`)).toHaveLength(1);
    expect(retiredWords(`// the region overlay: a comment`)).toEqual([]);
    expect(retiredWords("**Region areas** paints a colour", true)).toHaveLength(2);
    expect(rawFolds(`const d = el.createEl("details", { cls: "x" });\nd.createEl("summary", { text: "T" });\nnew Fold(el, { title: "T" });`)).toEqual([1, 2]);
    expect(prefixedNotices(`new Notice("Hexmaker: palette");\nnew Notice(\n  \`Hexmap World Creator: moved\`);\nnew Notice("Saved.");\nnoticeBackground("moved");`)).toEqual([1, 2]);
  });

  it("self-check: the scanners flag a one-off slider, a second primary and a raw modal", () => {
    expect(sliderSites(`const s = row.createEl("input", { type: "range" });\nnew Setting(el).addSlider((s) => s);\nx.type = "range";`)).toEqual([1, 2, 3]);
    expect(sliderSites(`renderLabeledSlider(el, { label: "Width" });`)).toEqual([]);
    const two = `export class A extends HexmakerModal {\n  a() { el.createEl("button", { cls: "mod-cta" }); this.footer({ primary: { text: "Go" } }); }\n}\nclass B extends HexmakerModal { b() { btn.setCta(); } }`;
    expect([...primariesByClass(two)]).toEqual([["A", 2], ["B", 1]]);
    expect(primariesByClass(`this.footer({ primary: undefined, cancel })`).size).toBe(0);
    expect(rawModals(`export class X extends Modal {}\nclass Y extends HexmakerModal {}\nclass Z extends SuggestModal<TFile> {}`)).toEqual(["X extends Modal", "Z extends SuggestModal"]);
  });
});
