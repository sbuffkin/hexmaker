/**
 * End-to-end integration test for the single-note exporter (1.2).
 * Drives the real `exportSingleNoteAsMarkdown` against the simulated vault.
 */

import { describe, it, before, after } from "node:test";
import expect from "expect";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { MockHexmakerPlugin, MockTFile } from "../helpers/simVault";
import { exportSingleNoteAsMarkdown } from "../../src/export/exporters/singleNote";

let tmpDir: string;
let plugin: MockHexmakerPlugin;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "duckmage-e2e-sn-"));
  plugin = new MockHexmakerPlugin(tmpDir);
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("e2e: single-note exporter against sim-vault", () => {
  it("exports a town note with frontmatter stripped and title prepended", async () => {
    const file = plugin.app.vault.getAbstractFileByPath(
      "towns/Saltwatch.md",
    );
    expect(file).toBeTruthy();
    await exportSingleNoteAsMarkdown(plugin as never, file as MockTFile as never);

    const written = await fs.readFile(
      path.join(tmpDir, "exports/Saltwatch.md"),
      "utf8",
    );
    // Provenance frontmatter (X1), then the note.
    expect(written).toMatch(/^---\nexported-from: "\[\[towns\/Saltwatch\]\]"\nexported: \d{4}-\d\d-\d\dT[\d:]+\nhexmaker-export: note\n---\n/);
    const out = written.replace(/^---\n[\s\S]*?\n---\n/, "");
    // Title prepended since the source had no leading H1
    expect(out.startsWith("# Saltwatch\n")).toBe(true);
    // Frontmatter stripped
    expect(out).not.toMatch(/population:/);
    // Content preserved
    expect(out).toMatch(/A small fishing town/);
    expect(out).toMatch(/Maren Kell/);
  });

  it("does not double up the title when the note already has an H1", async () => {
    const file = plugin.app.vault.getAbstractFileByPath(
      "tables/treasure/gold pile.md",
    );
    expect(file).toBeTruthy();
    await exportSingleNoteAsMarkdown(plugin as never, file as MockTFile as never);

    const out = (await fs.readFile(
      path.join(tmpDir, "exports/gold pile.md"),
      "utf8",
    )).replace(/^---\n[\s\S]*?\n---\n/, "");
    // gold pile.md has no H1 → title is prepended
    expect(out.startsWith("# gold pile\n")).toBe(true);
    // Single h1 only
    const h1Count = (out.match(/^# /gm) ?? []).length;
    expect(h1Count).toBe(1);
  });
});
