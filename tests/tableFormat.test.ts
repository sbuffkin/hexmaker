import { describe, it } from "node:test";
import expect from "expect";
import {
  allocateFaces,
  dieFaces,
  getDieRanges,
  parseDie,
  parseRandomTable,
  parseRandomTableWithReport,
  parseRangeCell,
  resolveTable,
  rollTable,
  rowOdds,
  syncLinkedRows,
  withRollerBlock,
  writeRollTable,
  type RandomTable,
  type TableWrite,
} from "../src/random-tables/randomTable";

/** Write back every parsed row unchanged, in order. */
function rewrite(content: string, ranges: TableWrite["ranges"], dice?: number): string {
  const { table } = parseRandomTableWithReport(content);
  return writeRollTable(content, {
    dice: dice ?? table.dice,
    rows: table.entries.map((entry, source) => ({ entry, source })),
    ranges,
  });
}

const codes = (content: string) => parseRandomTableWithReport(content).issues.map((i) => i.code);

// ── Dice ──────────────────────────────────────────────────────────────────────

describe("dice", () => {
  it("reads 20, d20, 1d20, d% and d66", () => {
    expect(parseDie("20")).toBe(20);
    expect(parseDie("d20")).toBe(20);
    expect(parseDie("1d20")).toBe(20);
    expect(parseDie("d%")).toBe(100);
    expect(parseDie("d66")).toBe(66);
    expect(parseDie("lots")).toBe(0);
  });

  it("d66 has the 36 two-d6 faces", () => {
    const f = dieFaces(66);
    expect(f).toHaveLength(36);
    expect(f.slice(0, 7)).toEqual([11, 12, 13, 14, 15, 16, 21]);
    expect(f[35]).toBe(66);
  });

  it("frontmatter dice: d20 and dice: 1d20 both work", () => {
    expect(parseRandomTable("---\ndice: d20\n---\n| Result | Weight |\n|---|---|\n| a | 1 |").dice).toBe(20);
    expect(parseRandomTable("---\ndice: 1d20\n---\n| Result | Weight |\n|---|---|\n| a | 1 |").dice).toBe(20);
    expect(parseRandomTable("---\ndice: d66\n---\n| Result | Weight |\n|---|---|\n| a | 1 |").dice).toBe(66);
  });

  it("CRLF frontmatter is read", () => {
    const t = parseRandomTable("---\r\ndice: 6\r\nlinkedFolder: world/towns\r\n---\r\n\r\n| Result | Weight |\r\n|---|---|\r\n| a | 2 |\r\n");
    expect(t.dice).toBe(6);
    expect(t.linkedFolder).toBe("world/towns");
    expect(t.entries).toEqual([{ result: "a", weight: 2 }]);
  });
});

// ── Parsing by header name ────────────────────────────────────────────────────

describe("parsing by header name", () => {
  it("old | Result | Weight | tables parse exactly as before", () => {
    const t = parseRandomTable("---\ndice: 20\n---\n\n| Result | Weight |\n|--------|--------|\n| crabmen | 4 |\n| [[Mage]] | 1 |\n");
    expect(t).toEqual({ dice: 20, entries: [{ result: "crabmen", weight: 4 }, { result: "Mage", weight: 1, isLink: true }], linkedFolder: undefined, description: undefined });
  });

  it("finds columns by name, in any order", () => {
    const t = parseRandomTable("| Weight | Notes | Result |\n|---|---|---|\n| 3 | wet | crabmen |");
    expect(t.entries).toEqual([{ result: "crabmen", weight: 3 }]);
  });

  for (const [range, result, weight] of [
    ["Range", "Result", "Weight"],
    ["Roll", "Entry", "W"],
    ["Die", "Outcome", "Wt"],
    ["d6", "Item", "Weight"],
    ["#", "Result", "Weight"],
    ["**d6**", "**Result**", "**Weight**"],
  ]) {
    it(`reads | ${range} | ${result} | ${weight} |`, () => {
      const t = parseRandomTable(`---\ndice: 6\n---\n| ${range} | ${result} | ${weight} |\n|---|---|---|\n| 1–4 | crabmen | 2 |\n| 5–6 | mage | 1 |`);
      expect(t.entries.map((e) => [e.range, e.result, e.weight])).toEqual([["1–4", "crabmen", 2], ["5–6", "mage", 1]]);
    });
  }

  it("our old export | Roll | Result | Weight | reads the result from the Result column", () => {
    const t = parseRandomTable("# Loot\n\n| Roll | Result | Weight |\n| --- | --- | --- |\n| 1–3 | gold | 3 |\n| 4–6 | gems | 3 |");
    expect(t.entries.map((e) => e.result)).toEqual(["gold", "gems"]);
  });

  it("| d6 | Result | with no weight column: weights follow the ranges, die from the header", () => {
    const { table, issues } = parseRandomTableWithReport("| d6 | Result |\n|---|---|\n| 1–4 | crabmen |\n| 5 | mage |\n| 6 | kraken |");
    expect(table.dice).toBe(6);
    expect(table.entries.map((e) => e.weight)).toEqual([4, 1, 1]);
    expect(issues.map((i) => i.code)).toEqual(["die-from-header"]);
  });

  it("the frontmatter die wins over the header, and the clash is reported", () => {
    const { table, issues } = parseRandomTableWithReport("---\ndice: 8\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–8 | a | 1 |");
    expect(table.dice).toBe(8);
    expect(issues.map((i) => i.code)).toContain("die-mismatch");
  });

  it("skips tables inside code fences and callouts", () => {
    const content = [
      "---", "dice: 6", "---",
      "```", "| Result | Weight |", "|---|---|", "| fenced | 1 |", "```",
      "> | Result | Weight |", "> |---|---|", "> | callout | 1 |",
      "", "| Result | Weight |", "|---|---|", "| real | 1 |",
    ].join("\n");
    expect(parseRandomTable(content).entries.map((e) => e.result)).toEqual(["real"]);
  });

  it("prefers the table with a Result column over an earlier unrelated table", () => {
    const content = "| Stat | Value |\n|---|---|\n| HP | 7 |\n\nText\n\n| Result | Weight |\n|---|---|\n| goblin | 1 |";
    expect(parseRandomTable(content).entries.map((e) => e.result)).toEqual(["goblin"]);
  });

  it("weight 0 rows are kept, shown as — and never rolled", () => {
    const table = parseRandomTable("---\ndice: 6\n---\n| Result | Weight |\n|---|---|\n| a | 1 |\n| kraken | 0 |");
    expect(table.entries[1]).toEqual({ result: "kraken", weight: 0 });
    expect(getDieRanges(table)).toEqual(["1–6", "—"]);
    for (let i = 0; i < 50; i++) expect(rollTable(table, () => i / 50)?.entry.result).toBe("a");
  });

  it("reports a header it had to guess", () => {
    expect(codes("| d6 | Monster |\n|---|---|\n| 1–6 | goblin |")).toContain("result-column-guessed");
  });

  it("reports an old roller link", () => {
    expect(codes("[🎲 Open in Duckmage Roller](obsidian://duckmage-roll?vault=journal&file=x.md)\n\n| Result | Weight |\n|---|---|\n| a | 1 |")).toContain("legacy-roller-link");
  });
});

// ── Range cells ───────────────────────────────────────────────────────────────

describe("range cells", () => {
  it("reads en dash, hyphen, single faces, lists and N+", () => {
    expect(parseRangeCell("1–3", 6)).toEqual({ faces: [1, 2, 3], outside: false });
    expect(parseRangeCell("1-3", 6)).toEqual({ faces: [1, 2, 3], outside: false });
    expect(parseRangeCell("4", 6)).toEqual({ faces: [4], outside: false });
    expect(parseRangeCell("1, 3–4", 6)).toEqual({ faces: [1, 3, 4], outside: false });
    expect(parseRangeCell("5+", 6)).toEqual({ faces: [5, 6], outside: false });
    expect(parseRangeCell("—", 6)).toBe("none");
    expect(parseRangeCell("lots", 6)).toBeNull();
    expect(parseRangeCell("5–9", 6)).toEqual({ faces: [5, 6], outside: true });
  });

  it("d100 reads 01–05 and 00 as 100; d10 reads 0 as 10", () => {
    expect(parseRangeCell("01–05", 100)).toEqual({ faces: [1, 2, 3, 4, 5], outside: false });
    expect(parseRangeCell("96–00", 100)).toEqual({ faces: [96, 97, 98, 99, 100], outside: false });
    expect(parseRangeCell("00", 100)).toEqual({ faces: [100], outside: false });
    expect(parseRangeCell("0", 10)).toEqual({ faces: [10], outside: false });
  });

  it("d66 ranges cover only real d66 faces", () => {
    expect(parseRangeCell("11–16", 66)).toEqual({ faces: [11, 12, 13, 14, 15, 16], outside: false });
    expect(parseRangeCell("15–22", 66)).toEqual({ faces: [15, 16, 21, 22], outside: false });
    expect(parseRangeCell("17", 66)).toEqual({ faces: [], outside: true });
  });

  it("a d66 table rolls by its ranges", () => {
    const table = parseRandomTable("---\ndice: d66\n---\n| d66 | Result |\n|---|---|\n| 11–36 | low |\n| 41–66 | high |");
    expect(table.entries.map((e) => e.weight)).toEqual([18, 18]);
    const r = rollTable(table, () => 0.99);
    expect(r).toEqual({ entry: table.entries[1], index: 1, face: 66 });
  });

  it("overlaps, unreadable and out-of-die ranges are reported and the table rolls by weight", () => {
    const base = "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n";
    expect(codes(base + "| 1–4 | a | 1 |\n| 4–6 | b | 1 |")).toContain("range-overlap");
    expect(codes(base + "| one | a | 1 |\n| 2–6 | b | 1 |")).toContain("range-unreadable");
    expect(codes(base + "| 1–3 | a | 1 |\n| 4–9 | b | 1 |")).toContain("range-out-of-die");
    expect(resolveTable(parseRandomTable(base + "| 1–4 | a | 1 |\n| 4–6 | b | 1 |")).mode).toBe("weight");
  });

  it("a gap is reported; rolls only land on covered faces", () => {
    const table = parseRandomTable("---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–2 | a | 1 |\n| 5–6 | b | 1 |");
    expect(resolveTable(table).issues.map((i) => i.code)).toContain("range-gap");
    for (let i = 0; i < 20; i++) expect([1, 2, 5, 6]).toContain(rollTable(table, () => i / 20)?.face);
  });

  it("ranges and weights that disagree are reported; rolls follow the ranges", () => {
    const table = parseRandomTable("---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1 | a | 5 |\n| 2–6 | b | 1 |");
    const res = resolveTable(table);
    expect(res.mode).toBe("ranges");
    expect(res.issues.map((i) => i.code)).toEqual(["range-weight-mismatch"]);
    expect(rowOdds(table)).toEqual(["17%", "83%"]);
  });

  it("a blank range cell is filled from the weights over the faces left", () => {
    const table = parseRandomTable("---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–3 | a | 3 |\n|  | b | 2 |\n|  | c | 1 |");
    expect(resolveTable(table).labels).toEqual(["1–3", "4–5", "6"]);
  });
});

// ── Range allocation ──────────────────────────────────────────────────────────

describe("range allocation (largest remainder, never past the die)", () => {
  const ranges = (dice: number, weights: number[]) =>
    getDieRanges({ dice, entries: weights.map((w, i) => ({ result: `r${i}`, weight: w })) });

  it("d6 with weights [100,1,1,1,1,1] stays on the die", () => {
    expect(ranges(6, [100, 1, 1, 1, 1, 1])).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("never allocates more faces than the die has, for many shapes", () => {
    for (const dice of [4, 6, 8, 10, 12, 20, 66, 100]) {
      for (const weights of [[1], [1, 1, 1], [5, 1], [100, 1, 1], [3, 7, 10], Array.from({ length: 30 }, (_, i) => i % 4)]) {
        const counts = allocateFaces(weights, dieFaces(dice).length);
        expect(counts.reduce((s, c) => s + c, 0)).toBeLessThanOrEqual(dieFaces(dice).length);
        weights.forEach((w, i) => { if (w === 0) expect(counts[i]).toBe(0); });
        const live = weights.filter((w) => w > 0).length;
        if (live <= dieFaces(dice).length) {
          expect(counts.reduce((s, c) => s + c, 0)).toBe(dieFaces(dice).length);
          weights.forEach((w, i) => { if (w > 0) expect(counts[i]).toBeGreaterThan(0); });
        }
      }
    }
  });

  it("more rows than faces: the rows that don't fit get —", () => {
    expect(ranges(4, [1, 1, 1, 1, 1, 1])).toEqual(["1", "2", "3", "4", "—", "—"]);
    const table: RandomTable = { dice: 4, entries: Array.from({ length: 6 }, (_, i) => ({ result: `r${i}`, weight: 1 })) };
    const res = resolveTable(table);
    expect(res.mode).toBe("weight");
    expect(res.issues.map((i) => i.code)).toEqual(["too-many-rows"]);
  });

  it("is proportional where it can be", () => {
    expect(ranges(20, [4, 1])).toEqual(["1–16", "17–20"]);
    expect(ranges(20, [3, 7, 10])).toEqual(["1–3", "4–10", "11–20"]);
    expect(ranges(66, [1, 1])).toEqual(["11–36", "41–66"]);
  });
});

// ── Rolling ───────────────────────────────────────────────────────────────────

describe("rolling by ranges", () => {
  it("what you see is what you get: each face lands on the row whose range holds it", () => {
    const table = parseRandomTable("---\ndice: 20\n---\n| d20 | Result | Weight |\n|---|---|---|\n| 1–16 | crabmen | 4 |\n| 17–20 | mage | 1 |");
    for (let face = 1; face <= 20; face++) {
      const r = rollTable(table, () => (face - 0.5) / 20);
      expect(r?.face).toBe(face);
      expect(r?.entry.result).toBe(face <= 16 ? "crabmen" : "mage");
    }
  });

  it("a hand-typed range wins over the weights", () => {
    const table = parseRandomTable("---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1 | a | 99 |\n| 2–6 | b | 1 |");
    expect(rollTable(table, () => 0.5)?.entry.result).toBe("b");
  });

  it("a table with a die and no stored ranges rolls by the ranges it shows", () => {
    const table = parseRandomTable("---\ndice: 20\n---\n| Result | Weight |\n|---|---|\n| a | 1 |\n| b | 1 |");
    expect(getDieRanges(table)).toEqual(["1–10", "11–20"]);
    expect(rollTable(table, () => 0.52)).toEqual({ entry: table.entries[1], index: 1, face: 11 });
  });

  it("no die: a weighted pick with no face", () => {
    const table = parseRandomTable("| Result | Weight |\n|---|---|\n| a | 1 |");
    expect(rollTable(table, () => 0.3)).toEqual({ entry: table.entries[0], index: 0 });
  });

  it("all weights 0 rolls nothing", () => {
    expect(rollTable({ dice: 0, entries: [{ result: "a", weight: 0 }] })).toBeNull();
  });
});

// ── Writer ────────────────────────────────────────────────────────────────────

const NOTE = [
  "---",
  "dice: 20",
  "tags: [x]",
  "---",
  "",
  "```duckmage-roller",
  "```",
  "",
  "Some *prose* before.",
  "",
  "| Result | Weight | Notes |",
  "|--------|--------|-------|",
  "| crabmen | 4 | wet, smelly |",
  "| [[Mage Tower\\|the mage]] | 1 |  |",
  "| kraken | 0 | big |",
  "",
  "Prose between.",
  "",
  "| Other | Weight |",
  "|---|---|",
  "| x | 1 |",
  "",
  "## After",
  "Trailing text.",
  "",
].join("\n");

describe("writeRollTable", () => {
  it("unchanged rows write back byte for byte", () => {
    expect(rewrite(NOTE, "untouched")).toBe(NOTE);
    expect(rewrite(NOTE.replace(/\n/g, "\r\n"), "untouched")).toBe(NOTE.replace(/\n/g, "\r\n"));
  });

  it("adding ranges keeps text around the table, extra columns and aliases", () => {
    const out = rewrite(NOTE, "keep");
    const before = NOTE.slice(0, NOTE.indexOf("| Result"));
    const after = NOTE.slice(NOTE.indexOf("\n\nProse between."));
    expect(out.startsWith(before)).toBe(true);
    expect(out.endsWith(after)).toBe(true);
    expect(out).toContain("| d20 | Result | Weight | Notes |\n|-----|--------|--------|-------|\n| 1–16 | crabmen | 4 | wet, smelly |\n| 17–20 | [[Mage Tower\\|the mage]] | 1 |  |\n| — | kraken | 0 | big |");
    expect(rewrite(out, "keep")).toBe(out); // idempotent
  });

  it("only the changed cell is rewritten", () => {
    const { table } = parseRandomTableWithReport(NOTE);
    const rows = table.entries.map((entry, source) => ({ entry: { ...entry }, source }));
    rows[0].entry.weight = 7;
    const out = writeRollTable(NOTE, { dice: 20, rows, ranges: "untouched" });
    expect(out).toBe(NOTE.replace("| crabmen | 4 | wet, smelly |", "| crabmen | 7 | wet, smelly |"));
  });

  it("deleting, reordering and adding rows keeps the remaining rows' raw text", () => {
    const { table } = parseRandomTableWithReport(NOTE);
    const out = writeRollTable(NOTE, {
      dice: 20,
      rows: [{ entry: table.entries[2], source: 2 }, { entry: table.entries[1], source: 1 }, { entry: { result: "a | b", weight: 2 } }],
      ranges: "untouched",
    });
    expect(out).toContain("| Result | Weight | Notes |\n|--------|--------|-------|\n| kraken | 0 | big |\n| [[Mage Tower\\|the mage]] | 1 |  |\n| a \\| b | 2 |  |\n\nProse between.");
  });

  it("regenerate redoes every range from the weights; keep leaves typed ranges", () => {
    const typed = "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1 | a | 1 |\n| 2–6 | b | 1 |\n";
    expect(rewrite(typed, "keep")).toBe(typed);
    expect(rewrite(typed, "regenerate")).toBe("---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–3 | a | 1 |\n| 4–6 | b | 1 |\n");
  });

  it("changing the die redoes the column and its header", () => {
    const typed = "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–3 | a | 1 |\n| 4–6 | b | 1 |\n";
    expect(rewrite(typed, "regenerate", 4)).toContain("| d4 | Result | Weight |\n|---|---|---|\n| 1–2 | a | 1 |\n| 3–4 | b | 1 |");
  });

  it("rows that don't fit the die are left blank, so the table keeps rolling by weight", () => {
    const many = "---\ndice: 4\n---\n| Result | Weight |\n|---|---|\n" + Array.from({ length: 6 }, (_, i) => `| r${i} | 1 |`).join("\n") + "\n";
    const out = rewrite(many, "keep");
    expect(out).toContain("|  | r0 | 1 |");
    expect(resolveTable(parseRandomTable(out)).mode).toBe("weight");
  });

  it("adds a table at the end of a note that has none", () => {
    const out = writeRollTable("# Loot\n\nIntro.\n", { dice: 6, rows: [{ entry: { result: "gold", weight: 1 } }], ranges: "keep" });
    expect(out).toBe("# Loot\n\nIntro.\n\n| d6 | Result | Weight |\n|----|--------|--------|\n| 1–6 | gold | 1 |\n");
  });

  it("template rows are dropped only when asked", () => {
    const tpl = "---\ndice: 20\n---\n\n| Result | Weight |\n|--------|--------|\n|  | 1 |\n";
    expect(rewrite(tpl, "untouched")).toBe(tpl);
    const out = writeRollTable(tpl, { dice: 20, rows: [{ entry: { result: "a", weight: 1 } }], ranges: "untouched", dropPlaceholders: true });
    expect(out).toBe("---\ndice: 20\n---\n\n| Result | Weight |\n|--------|--------|\n| a | 1 |\n");
  });

  it("adds a Weight column when weights change on a table without one", () => {
    const t = "| d6 | Result |\n|---|---|\n| 1–3 | a |\n| 4–6 | b |\n";
    const { table } = parseRandomTableWithReport(t);
    const rows = table.entries.map((entry, source) => ({ entry: { ...entry }, source }));
    rows[0].entry.weight = 1;
    const out = writeRollTable(t, { dice: 6, rows, ranges: "regenerate" });
    expect(out).toBe("| d6 | Result | Weight |\n|---|---|--------|\n| 1–2 | a | 1 |\n| 3–6 | b | 3 |\n");
  });
});

// ── Roller block ──────────────────────────────────────────────────────────────

describe("withRollerBlock", () => {
  const legacy = "---\ndice: 6\n---\n\n[🎲 Open in Duckmage Roller](obsidian://duckmage-roll?vault=journal&file=gone.md)\n\n| Result | Weight |\n|---|---|\n| a | 1 |\n";

  it("replaces an old roller link with the block", () => {
    expect(withRollerBlock(legacy)).toBe("---\ndice: 6\n---\n\n```duckmage-roller\n```\n\n| Result | Weight |\n|---|---|\n| a | 1 |\n");
  });

  it("removes the old link when the block is already there", () => {
    const both = legacy.replace("\n\n|", "\n\n```duckmage-roller\n```\n\n|");
    expect(withRollerBlock(both)).toBe("---\ndice: 6\n---\n\n\n```duckmage-roller\n```\n\n| Result | Weight |\n|---|---|\n| a | 1 |\n");
  });

  it("adds the block after the frontmatter; a second call changes nothing", () => {
    const plain = "---\ndice: 6\n---\n| Result | Weight |\n|---|---|\n| a | 1 |\n";
    const once = withRollerBlock(plain);
    expect(once).toBe("---\ndice: 6\n---\n\n```duckmage-roller\n```\n\n| Result | Weight |\n|---|---|\n| a | 1 |\n");
    expect(withRollerBlock(once)).toBe(once);
  });

  it("leaves a link that shares its line with other text", () => {
    const inline = "See [roll](obsidian://duckmage-roll?vault=v&file=x.md) here.\n";
    expect(withRollerBlock(inline)).toBe(inline);
  });

  it("keeps CRLF", () => {
    expect(withRollerBlock(legacy.replace(/\n/g, "\r\n"))).toBe(withRollerBlock(legacy).replace(/\n/g, "\r\n"));
  });
});

// ── Linked-folder sync ────────────────────────────────────────────────────────

describe("syncLinkedRows", () => {
  const linked = '---\ndice: 6\nlinkedFolder: "[[world/towns]]"\n---\n\nTowns.\n\n| Result | Weight | Notes |\n|---|---|---|\n| [[Amber]] | 3 | port |\n| [[Briar]] | 1 | |\n\nAfter.\n';

  it("adds rows for new notes and keeps rows whose note is missing", () => {
    const out = syncLinkedRows(linked, ["Amber", "Cove"]);
    expect(out).toContain("| [[Amber]] | 3 | port |\n| [[Briar]] | 1 | |\n| [[Cove]] | 1 |  |\n\nAfter.\n");
  });

  it("a renamed note keeps its row and weight", () => {
    const out = syncLinkedRows(linked, ["Amberly", "Briar"], { renamed: ["Amber", "Amberly"] });
    expect(out).toContain("| [[Amberly]] | 3 | port |\n| [[Briar]] | 1 | |\n");
  });

  it("a deleted or retired note removes its row", () => {
    expect(syncLinkedRows(linked, ["Amber"], { removed: "Briar" })).toContain("| [[Amber]] | 3 | port |\n\nAfter.");
    expect(syncLinkedRows(linked, ["Amber"], { renamed: ["Briar", "_Briar"] })).toContain("| [[Amber]] | 3 | port |\n\nAfter.");
  });

  it("nothing to do leaves the note untouched", () => {
    expect(syncLinkedRows(linked, ["Amber", "Briar", "_old"])).toBe(linked);
  });
});
