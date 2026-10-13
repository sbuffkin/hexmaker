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
 *    (HexmakerModal.footer / renderFooter, src/ui/footer.ts).
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

  // The checks themselves catch what they should.
  it("self-check: the scanners flag a one-off slider, a second primary and a raw modal", () => {
    expect(sliderSites(`const s = row.createEl("input", { type: "range" });\nnew Setting(el).addSlider((s) => s);\nx.type = "range";`)).toEqual([1, 2, 3]);
    expect(sliderSites(`renderLabeledSlider(el, { label: "Width" });`)).toEqual([]);
    const two = `export class A extends HexmakerModal {\n  a() { el.createEl("button", { cls: "mod-cta" }); this.footer({ primary: { text: "Go" } }); }\n}\nclass B extends HexmakerModal { b() { btn.setCta(); } }`;
    expect([...primariesByClass(two)]).toEqual([["A", 2], ["B", 1]]);
    expect(primariesByClass(`this.footer({ primary: undefined, cancel })`).size).toBe(0);
    expect(rawModals(`export class X extends Modal {}\nclass Y extends HexmakerModal {}\nclass Z extends SuggestModal<TFile> {}`)).toEqual(["X extends Modal", "Z extends SuggestModal"]);
  });
});
