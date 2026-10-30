import { describe, it } from "node:test";
import expect from "expect";
import {
  formatRandomTableMarkdown,
  formatLinkedNotesAppendix,
} from "../src/export/exporters/randomTable";
import { stripFrontmatter } from "../src/export/mdSerializer";
import { parseRandomTable, type RandomTable } from "../src/random-tables/randomTable";

const makeTable = (overrides: Partial<RandomTable> = {}): RandomTable => ({
  dice: 0,
  entries: [],
  ...overrides,
});

describe("formatRandomTableMarkdown", () => {
  it("renders the table name as an h1", () => {
    const md = formatRandomTableMarkdown(
      "Forest Encounters",
      makeTable({ entries: [{ result: "Wolf", weight: 1 }] }),
    );
    expect(md.startsWith("# Forest Encounters\n")).toBe(true);
  });

  it("omits the dice line when dice = 0", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({ entries: [{ result: "A", weight: 1 }] }),
    );
    expect(md).not.toMatch(/Roll d/);
  });

  it("includes a 'Roll dN' line when dice > 0", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({ dice: 20, entries: [{ result: "A", weight: 1 }] }),
    );
    expect(md).toMatch(/\*Roll d20\*/);
  });

  it("emits the description when present", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({
        entries: [{ result: "A", weight: 1 }],
        description: "Some flavour text.",
      }),
    );
    expect(md).toMatch(/Some flavour text\./);
  });

  it("uses '#' header column when dice = 0", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({ entries: [{ result: "A", weight: 1 }] }),
    );
    expect(md).toMatch(/\| # \| Result \|/);
  });

  it("uses the die as the header of the range column when dice > 0, and keeps weights", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({
        dice: 10,
        entries: [
          { result: "A", weight: 4 },
          { result: "B", weight: 6 },
        ],
      }),
    );
    expect(md).toMatch(/\| d10 \| Result \| Weight \|/);
    // 10 faces, 4:6 split → 1–4 and 5–10
    expect(md).toMatch(/\| 1–4 \| A \| 4 \|/);
    expect(md).toMatch(/\| 5–10 \| B \| 6 \|/);
  });

  it("round-trips: the export reads back as the same table", () => {
    const table = parseRandomTable(
      "---\ndice: 20\n---\n| d20 | Result | Weight |\n|---|---|---|\n| 1–16 | crabmen | 4 |\n| 17–20 | [[Mage Tower]] | 1 |\n| — | kraken | 0 |\n",
    );
    const back = parseRandomTable(formatRandomTableMarkdown("Beach", table));
    expect(back.dice).toBe(20);
    expect(back.entries).toEqual(table.entries);
    // A hand-typed range that disagrees with its weight survives too.
    const typed = parseRandomTable("---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1 | a | 5 |\n| 2–6 | b | 1 |\n");
    expect(parseRandomTable(formatRandomTableMarkdown("T", typed)).entries).toEqual(typed.entries);
  });

  it("omits the Weight column when all weights are 1 (no die)", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({
        entries: [
          { result: "A", weight: 1 },
          { result: "B", weight: 1 },
        ],
      }),
    );
    expect(md).not.toMatch(/Weight/);
    expect(md).toMatch(/\| # \| Result \|/);
  });

  it("includes the Weight column when any weight is non-1", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({
        entries: [
          { result: "A", weight: 1 },
          { result: "B", weight: 3 },
        ],
      }),
    );
    expect(md).toMatch(/\| # \| Result \| Weight \|/);
    expect(md).toMatch(/\| 1 \| A \| 1 \|/);
    expect(md).toMatch(/\| 2 \| B \| 3 \|/);
  });

  it("omits the Odds column entirely", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({ entries: [{ result: "A", weight: 1 }] }),
    );
    expect(md).not.toMatch(/Odds/);
    expect(md).not.toMatch(/%/);
  });

  it("escapes pipes inside entry results", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({
        entries: [{ result: "left | right", weight: 1 }],
      }),
    );
    expect(md).toMatch(/left \\\| right/);
  });

  it("uses row index as # column when dice = 0", () => {
    const md = formatRandomTableMarkdown(
      "T",
      makeTable({
        entries: [
          { result: "A", weight: 1 },
          { result: "B", weight: 1 },
          { result: "C", weight: 1 },
        ],
      }),
    );
    expect(md).toMatch(/\| 1 \| A \|/);
    expect(md).toMatch(/\| 2 \| B \|/);
    expect(md).toMatch(/\| 3 \| C \|/);
  });

  it("renders empty-entries table without crashing", () => {
    const md = formatRandomTableMarkdown("Empty", makeTable({ entries: [] }));
    expect(md).toMatch(/# Empty/);
    // Table header still present
    expect(md).toMatch(/\| # \| Result \|/);
  });
});

describe("stripFrontmatter", () => {
  it("returns content unchanged when no frontmatter is present", () => {
    expect(stripFrontmatter("Hello\nworld")).toBe("Hello\nworld");
  });

  it("strips a basic YAML block", () => {
    const md = "---\ntitle: Foo\ntags: [a, b]\n---\n\n# Body";
    expect(stripFrontmatter(md)).toBe("# Body");
  });

  it("strips with no trailing blank line", () => {
    const md = "---\ntitle: Foo\n---\n# Body";
    expect(stripFrontmatter(md)).toBe("# Body");
  });

  it("strips with CRLF line endings", () => {
    const md = "---\r\ntitle: Foo\r\n---\r\n\r\n# Body";
    expect(stripFrontmatter(md)).toBe("# Body");
  });

  it("does not strip a horizontal rule that isn't frontmatter", () => {
    const md = "Some text\n\n---\n\nMore text";
    expect(stripFrontmatter(md)).toBe(md);
  });

  it("returns content unchanged when frontmatter open is unterminated", () => {
    const md = "---\ntitle: Foo\nno close\n";
    expect(stripFrontmatter(md)).toBe(md);
  });

  it("handles empty frontmatter block", () => {
    const md = "---\n---\n\n# Body";
    expect(stripFrontmatter(md)).toBe("# Body");
  });
});

describe("formatLinkedNotesAppendix", () => {
  it("returns empty string for empty input", () => {
    expect(formatLinkedNotesAppendix([])).toBe("");
  });

  it("wraps a single note in a section with the first-entry class", () => {
    const out = formatLinkedNotesAppendix([
      { name: "Goblin Lair", content: "Dark cave entrance." },
    ]);
    expect(out).toMatch(
      /<section class="duckmage-export-note duckmage-export-note-first">/,
    );
    expect(out).toMatch(/## Goblin Lair/);
    expect(out).toMatch(/Dark cave entrance\./);
    expect(out).toMatch(/<\/section>/);
  });

  it("only the first section gets the duckmage-export-note-first class", () => {
    const out = formatLinkedNotesAppendix([
      { name: "First", content: "One." },
      { name: "Second", content: "Two." },
      { name: "Third", content: "Three." },
    ]);
    const firstClassMatches = out.match(/duckmage-export-note-first/g) ?? [];
    expect(firstClassMatches.length).toBe(1);
  });

  it("wraps each entry in its own section block", () => {
    const out = formatLinkedNotesAppendix([
      { name: "First", content: "One." },
      { name: "Second", content: "Two." },
      { name: "Third", content: "Three." },
    ]);
    const openTags = out.match(/<section class="duckmage-export-note/g) ?? [];
    const closeTags = out.match(/<\/section>/g) ?? [];
    expect(openTags.length).toBe(3);
    expect(closeTags.length).toBe(3);
    expect(out).toMatch(/## First/);
    expect(out).toMatch(/## Second/);
    expect(out).toMatch(/## Third/);
  });

  it("preserves entry order", () => {
    const out = formatLinkedNotesAppendix([
      { name: "Beta", content: "B" },
      { name: "Alpha", content: "A" },
    ]);
    expect(out.indexOf("Beta")).toBeLessThan(out.indexOf("Alpha"));
  });

  it("trims whitespace from note content", () => {
    const out = formatLinkedNotesAppendix([
      { name: "T", content: "\n\n  body  \n\n" },
    ]);
    expect(out).toMatch(/## T\n\nbody/);
  });

  it("emits no horizontal-rule separators (visual separation is via CSS)", () => {
    const out = formatLinkedNotesAppendix([
      { name: "A", content: "alpha" },
      { name: "B", content: "beta" },
    ]);
    expect(out).not.toMatch(/^---$/m);
  });
});
