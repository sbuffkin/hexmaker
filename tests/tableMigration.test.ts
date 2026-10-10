import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { App } from "obsidian";
import { MemVault } from "./helpers/memVault";
import { parseRandomTable, parseRandomTableWithReport, resolveTable } from "../src/random-tables/randomTable";
import { isTableNotePath, planTableMigration } from "../src/random-tables/tableMigration";
import { checkTables, formatTableReport, migrateTables, surveyTableMigration, writeTableReport } from "../src/random-tables/tableMaintenance";

(globalThis as Record<string, unknown>).window ??= globalThis;

async function gunzipJson(bytes: Uint8Array) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as { notes: Record<string, string> };
}

// Checkouts on Windows may turn fixtures CRLF; they were written LF.
const LEGACY = readFileSync(path.join(process.cwd(), "tests/fixtures/compat/legacy-table-1.5.6.md"), "utf8").replace(/\r\n/g, "\n");

const LEGACY_MIGRATED = LEGACY
  .replace(
    "[🎲 Open in Duckmage Roller](obsidian://duckmage-roll?vault=journal&file=RPG%2Fduckmage%2Ftables%2Fbeach.md)",
    "```duckmage-roller\n```",
  )
  .replace(
    "| Result | Weight | Notes |\n|--------|--------|-------|\n| crabmen | 4 | 2d4, at low tide |\n| [[Sea Hag\\|the hag]] | 1 |  |\n| fishmen | 1 | |\n| smugglers | 2 | see [[Smugglers' Cove]] |\n| kraken | 0 | only in the epilogue |",
    "| d20 | Result | Weight | Notes |\n|-----|--------|--------|-------|\n| 1–10 | crabmen | 4 | 2d4, at low tide |\n| 11–13 | [[Sea Hag\\|the hag]] | 1 |  |\n| 14–15 | fishmen | 1 | |\n| 16–20 | smugglers | 2 | see [[Smugglers' Cove]] |\n| — | kraken | 0 | only in the epilogue |",
  );

describe("legacy table fixture (compat)", () => {
  it("still parses: results, weights (0 kept), alias stripped, description", () => {
    const { table, issues } = parseRandomTableWithReport(LEGACY);
    expect(table.dice).toBe(20);
    expect(table.entries).toEqual([
      { result: "crabmen", weight: 4 },
      { result: "Sea Hag", weight: 1, isLink: true },
      { result: "fishmen", weight: 1 },
      { result: "smugglers", weight: 2 },
      { result: "kraken", weight: 0 },
    ]);
    expect(table.description).toBe("Beach encounters. Roll when the party camps on the shore.");
    expect(issues.map((i) => i.code)).toEqual(["legacy-roller-link"]);
  });

  it("migrates to | d20 | Result | Weight | with everything else verbatim", () => {
    const plan = planTableMigration(LEGACY);
    expect(plan).toEqual({ action: "change", content: LEGACY_MIGRATED });
    // The migrated note reads back as the same table, now rolled by its ranges.
    const after = parseRandomTable(LEGACY_MIGRATED);
    expect(after.entries.map((e) => [e.result, e.weight])).toEqual(parseRandomTable(LEGACY).entries.map((e) => [e.result, e.weight]));
    expect(resolveTable(after).mode).toBe("ranges");
    expect(parseRandomTableWithReport(LEGACY_MIGRATED).issues).toEqual([]);
  });

  it("migrating twice changes nothing", () => {
    expect(planTableMigration(LEGACY_MIGRATED)).toEqual({ action: "none" });
  });

  it("keeps CRLF line endings", () => {
    const plan = planTableMigration(LEGACY.replace(/\n/g, "\r\n"));
    expect(plan).toEqual({ action: "change", content: LEGACY_MIGRATED.replace(/\n/g, "\r\n") });
  });
});

describe("planTableMigration skips", () => {
  it("tables with no die", () => {
    expect(planTableMigration("| Result | Weight |\n|---|---|\n| a | 1 |\n")).toMatchObject({ action: "skip", reason: expect.stringMatching(/no die/) });
  });
  it("tables that don't fit their die", () => {
    const t = "---\ndice: 4\n---\n| Result | Weight |\n|---|---|\n" + Array.from({ length: 6 }, (_, i) => `| r${i} | 1 |`).join("\n") + "\n";
    expect(planTableMigration(t)).toMatchObject({ action: "skip", reason: "6 rows don't fit on a d4" });
  });
  it("tables with parse issues", () => {
    expect(planTableMigration("---\ndice: 6\n---\n| Result | Weight |\n|---|---|\n| a | x2 |\n")).toMatchObject({ action: "skip", reason: expect.stringMatching(/can't be read cleanly/) });
  });
  it("notes with no roll table", () => {
    expect(planTableMigration("# Just notes\n")).toEqual({ action: "skip", reason: "no roll table" });
  });
  it("leaves hand-typed ranges and fills only the blank ones", () => {
    const t = "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1 | a | 3 |\n|  | b | 1 |\n";
    expect(planTableMigration(t)).toEqual({ action: "change", content: t.replace("|  | b | 1 |", "| 2–6 | b | 1 |") });
  });
});

describe("isTableNotePath", () => {
  it("only notes in the tables folder, never _ notes or workflows", () => {
    expect(isTableNotePath("world/tables/beach.md", "world/tables", "world/tables/workflows")).toBe(true);
    expect(isTableNotePath("world/tables/_Index_of_tables.md", "world/tables", "")).toBe(false);
    expect(isTableNotePath("world/tables/workflows/loot.md", "world/tables", "world/tables/workflows")).toBe(false);
    expect(isTableNotePath("world/towns/a.md", "world/tables", "")).toBe(false);
  });
});

// ── The vault-side migration ─────────────────────────────────────────────────

const SCOPE = { tablesFolder: "tables", workflowsFolder: "workflows" };
const BACKUPS = "plugin/backups/table-ranges-test";

function vault(): MemVault {
  return new MemVault({
    "tables/beach.md": LEGACY,
    "tables/_Index_of_tables.md": "[🎲 Open in Duckmage Roller](obsidian://duckmage-roll?vault=journal&file=x.md)\n\n| Result | Weight |\n|---|---|\n| [[beach]] | 1 |\n",
    "tables/no die.md": "| Result | Weight |\n|---|---|\n| a | 1 |\n",
    "tables/cool words.md": "---\ndice: 4\n---\n| Result | Weight |\n|---|---|\n" + Array.from({ length: 6 }, (_, i) => `| w${i} | 1 |`).join("\n") + "\n",
    "tables/bad.md": "---\ndice: 6\n---\n| Result | Weight |\n|---|---|\n| a | x2 |\n",
    "tables/done.md": "---\ndice: 6\n---\n| d6 | Result | Weight |\n|---|---|---|\n| 1–6 | a | 1 |\n",
    "tables/notes.md": "# Not a table\n",
    "workflows/loot.md": "| Table | Rolls | Label |\n|---|---|---|\n| [[tables/beach]] | 1 | beach |\n",
  });
}

const app = (v: MemVault) => v.app() as unknown as App;

describe("migrateTables", () => {
  it("backs up first, changes what it can, reports the rest", async () => {
    const v = vault();
    const before = new Map(v.files);
    const res = await migrateTables(app(v), SCOPE, BACKUPS);
    expect(res.error).toBeUndefined();
    expect(res.changed).toEqual(["tables/beach.md"]);
    expect(v.files.get("tables/beach.md")).toBe(LEGACY_MIGRATED);
    expect(res.skipped.map((s) => s.path).sort()).toEqual(["tables/bad.md", "tables/cool words.md", "tables/no die.md"]);
    expect(res.unchanged).toBe(1);
    expect(res.notTables).toBe(1);
    // Backup: every changed note's original text.
    expect(res.backup).toBe(`${BACKUPS}/tables.json.gz`);
    const backup = await gunzipJson(v.binaries.get(res.backup!)!);
    expect(backup.notes).toEqual({ "tables/beach.md": LEGACY });
    // Nothing else was touched: _ notes, skipped tables, workflows.
    for (const [p, c] of before) if (p !== "tables/beach.md") expect(v.files.get(p)).toBe(c);
  });

  it("running it twice is safe: nothing changes and no second backup", async () => {
    const v = vault();
    await migrateTables(app(v), SCOPE, BACKUPS);
    const after = new Map(v.files);
    const again = await migrateTables(app(v), SCOPE, BACKUPS);
    expect(again.changed).toEqual([]);
    expect(again.backup).toBeUndefined();
    expect(v.files).toEqual(after);
    expect([...v.binaries.keys()]).toHaveLength(1);
  });

  it("if the backup can't be written, no table is changed", async () => {
    const v = vault();
    v.failBinary = true;
    const before = new Map(v.files);
    const res = await migrateTables(app(v), SCOPE, BACKUPS);
    expect(res.error).toMatch(/backup/);
    expect(res.changed).toEqual([]);
    expect(v.files).toEqual(before);
  });

  it("survey counts what would change without writing", async () => {
    const v = vault();
    const before = new Map(v.files);
    const s = await surveyTableMigration(app(v), SCOPE);
    expect([...s.changes.keys()]).toEqual(["tables/beach.md"]);
    expect(v.files).toEqual(before);
  });
});

describe("Check tables report", () => {
  it("lists tables with issues in a _ note in the tables folder", async () => {
    const v = vault();
    const check = await checkTables(app(v), SCOPE);
    expect(check.checked).toBe(5);
    expect(check.problems.map((p) => p.path)).toEqual(["tables/bad.md", "tables/beach.md", "tables/cool words.md"]);
    const text = formatTableReport(new Date("2026-10-10T12:00:00Z"), check);
    expect(text).toContain("### [[tables/bad|bad]]");
    expect(text).toContain("isn't a whole number");
    const p = await writeTableReport(app(v), SCOPE, text);
    expect(p).toBe("tables/_table-check.md");
    expect(v.files.get(p)).toBe(text);
    // The report is a _ note, so it's never a table itself.
    expect(isTableNotePath(p, "tables", "")).toBe(false);
  });
});
