import { describe, it } from "node:test";
import expect from "expect";
import type { App, TFile } from "obsidian";
import { MemVault } from "./helpers/memVault";
import { importHandEdit } from "../src/random-tables/tableImport";
import { processTableNote, TableStore } from "../src/random-tables/TableStore";
import { parseRandomTable, resolveTable } from "../src/random-tables/randomTable";

const note = (dice: string, header: string, rows: string[]) =>
  `---\ndice: ${dice}\n---\n\nIntro.\n\n| ${header} | Result | Weight | Notes |\n|---|---|---|---|\n${rows.join("\n")}\n\nAfter.\n`;

const D6 = note("6", "d6", ["| 1–3 | a | 1 | x |", "| 4–6 | b | 1 |  |"]);

describe("importHandEdit", () => {
  it("valid ranges typed by hand are adopted; weights follow the face counts", () => {
    const cur = note("6", "d6", ["| 1 | a | 1 | x |", "| 2–6 | b | 1 |  |"]);
    const r = importHandEdit(D6, cur);
    expect(r.kind).toBe("ranges");
    expect(r.content).toBe(note("6", "d6", ["| 1 | a | 1 | x |", "| 2–6 | b | 5 |  |"]));
    expect(resolveTable(parseRandomTable(r.content)).issues).toEqual([]);
  });

  it("a changed die header is a die change: dice: follows and ranges are redone", () => {
    const cur = note("6", "d12", ["| 1–3 | a | 1 | x |", "| 4–6 | b | 1 |  |"]);
    const r = importHandEdit(D6, cur);
    expect(r.kind).toBe("die");
    expect(r.content).toBe(note("12", "d12", ["| 1–6 | a | 1 | x |", "| 7–12 | b | 1 |  |"]));
  });

  it("a changed dice: is a die change: the header follows and ranges are redone", () => {
    const cur = note("d20", "d6", ["| 1–3 | a | 1 | x |", "| 4–6 | b | 1 |  |"]);
    const r = importHandEdit(D6, cur);
    expect(r.kind).toBe("die");
    expect(r.content).toBe(note("d20", "d20", ["| 1–10 | a | 1 | x |", "| 11–20 | b | 1 |  |"]));
  });

  it("die and ranges both changed, ranges valid for the new die: ranges kept, weights follow", () => {
    const cur = note("6", "d12", ["| 1–2 | a | 1 | x |", "| 3–12 | b | 1 |  |"]);
    const r = importHandEdit(D6, cur);
    expect(r.kind).toBe("die");
    expect(r.content).toBe(note("12", "d12", ["| 1–2 | a | 2 | x |", "| 3–12 | b | 10 |  |"]));
  });

  it("header and dice: changed to different dice: ambiguous, nothing changed", () => {
    const cur = note("8", "d12", ["| 1–3 | a | 1 | x |", "| 4–6 | b | 1 |  |"]);
    expect(importHandEdit(D6, cur)).toEqual({ kind: "ambiguous", content: cur });
  });

  it("only a weight changed and the ranges matched the old weights: ranges are redone", () => {
    const cur = note("6", "d6", ["| 1–3 | a | 2 | x |", "| 4–6 | b | 1 |  |"]);
    const r = importHandEdit(D6, cur);
    expect(r.kind).toBe("weights");
    expect(r.content).toBe(note("6", "d6", ["| 1–4 | a | 2 | x |", "| 5–6 | b | 1 |  |"]));
  });

  it("a row added or removed by hand redoes the ranges", () => {
    const added = note("6", "d6", ["| 1–3 | a | 1 | x |", "| 4–6 | b | 1 |  |", "|  | c | 1 |  |"]);
    expect(importHandEdit(D6, added).content).toBe(note("6", "d6", ["| 1–2 | a | 1 | x |", "| 3–4 | b | 1 |  |", "| 5–6 | c | 1 |  |"]));
    const removed = note("6", "d6", ["| 4–6 | b | 1 |  |"]);
    expect(importHandEdit(D6, removed).content).toBe(note("6", "d6", ["| 1–6 | b | 1 |  |"]));
  });

  it("a weight changed when the ranges never matched the weights: ambiguous, nothing changed", () => {
    const prev = note("6", "d6", ["| 1 | a | 1 | x |", "| 2–6 | b | 1 |  |"]);
    const cur = note("6", "d6", ["| 1 | a | 3 | x |", "| 2–6 | b | 1 |  |"]);
    expect(importHandEdit(prev, cur)).toEqual({ kind: "ambiguous", content: cur });
  });

  it("ranges with a gap or an overlap: ambiguous, kept as typed", () => {
    const gap = note("6", "d6", ["| 1–2 | a | 1 | x |", "| 5–6 | b | 1 |  |"]);
    expect(importHandEdit(D6, gap)).toEqual({ kind: "ambiguous", content: gap });
    const overlap = note("6", "d6", ["| 1–4 | a | 1 | x |", "| 4–6 | b | 1 |  |"]);
    expect(importHandEdit(D6, overlap)).toEqual({ kind: "ambiguous", content: overlap });
    const unreadable = note("6", "d6", ["| one | a | 1 | x |", "| 2–6 | b | 1 |  |"]);
    expect(importHandEdit(D6, unreadable)).toEqual({ kind: "ambiguous", content: unreadable });
  });

  it("more rows than faces: ambiguous, kept as typed", () => {
    const prev = note("4", "d4", ["| 1–2 | a | 1 | x |", "| 3–4 | b | 1 |  |"]);
    const cur = note("4", "d4", ["| 1–2 | a | 1 | x |", "| 3–4 | b | 1 |  |", "|  | c | 1 |  |", "|  | d | 1 |  |", "|  | e | 1 |  |"]);
    expect(importHandEdit(prev, cur)).toEqual({ kind: "ambiguous", content: cur });
  });

  it("text-only edits (results, notes, prose) need nothing", () => {
    const cur = D6.replace("| a |", "| apple |").replace("After.", "After, edited.");
    expect(importHandEdit(D6, cur)).toEqual({ kind: "none", content: cur });
  });

  it("older tables without a roll column are left alone", () => {
    const prev = "---\ndice: 6\n---\n| Result | Weight |\n|---|---|\n| a | 1 |\n";
    const cur = prev.replace("| a | 1 |", "| a | 3 |");
    expect(importHandEdit(prev, cur)).toEqual({ kind: "none", content: cur });
  });
});

describe("TableStore", () => {
  const scope = () => ({ tablesFolder: "tables", workflowsFolder: "" });
  const setup = async () => {
    const v = new MemVault({ "tables/t.md": D6, "tables/_index.md": D6 });
    const app = v.app() as unknown as App;
    const store = new TableStore(app, scope);
    await store.init();
    const file = app.vault.getAbstractFileByPath("tables/t.md") as TFile;
    return { v, app, store, file };
  };

  it("imports a hand edit against the content it last saw", async () => {
    const { v, store, file } = await setup();
    v.files.set("tables/t.md", note("6", "d6", ["| 1 | a | 1 | x |", "| 2–6 | b | 1 |  |"]));
    expect(await store.importNow(file, { ignoreFocus: true })).toBe("ranges");
    expect(v.files.get("tables/t.md")).toBe(note("6", "d6", ["| 1 | a | 1 | x |", "| 2–6 | b | 5 |  |"]));
    // Its own write is now the baseline: nothing more to do.
    expect(await store.importNow(file, { ignoreFocus: true })).toBe("none");
  });

  it("never imports the plugin's own writes", async () => {
    const { v, app, store, file } = await setup();
    // The editor reweights and regenerates: weights 1,1 → ranges must not be adopted back as weights.
    const own = note("6", "d6", ["| 1–2 | a | 1 | x |", "| 3–6 | b | 2 |  |"]);
    await processTableNote(app, file, () => own);
    expect(await store.importNow(file, { ignoreFocus: true })).toBe("none");
    expect(v.files.get("tables/t.md")).toBe(own);
  });

  it("an ambiguous edit is kept exactly as typed", async () => {
    const { v, store, file } = await setup();
    const gap = note("6", "d6", ["| 1–2 | a | 1 | x |", "| 5–6 | b | 1 |  |"]);
    v.files.set("tables/t.md", gap);
    expect(await store.importNow(file, { ignoreFocus: true })).toBe("ambiguous");
    expect(v.files.get("tables/t.md")).toBe(gap);
  });

  it("ignores _ notes", () => {
    const store = new TableStore({} as App, scope);
    expect(store.isTable("tables/_index.md")).toBe(false);
    expect(store.isTable("tables/t.md")).toBe(true);
  });
});
