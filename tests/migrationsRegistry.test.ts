import { describe, it } from "node:test";
import expect from "expect";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS, NOTE_REWRITES, migrationsByPhase, recordMigrationRun, runSettingsMigrations } from "../src/migrations/registry";
import { PHASE_ORDER } from "../src/migrations/types";
import { migrate as flatHexNotes } from "../src/migrations/v1.0-flat-hex-notes-to-default-map";
import { migrate as flatTerrainTables } from "../src/migrations/v1.0-flat-terrain-tables-to-subfolders";
import { migrateMapData } from "../src/compat";
import { MemVault } from "./helpers/memVault";

/**
 * Owner MG7: every data upgrade lives in src/migrations, one file per step,
 * listed in the registry in start-up order.
 */

const DIR = path.join(process.cwd(), "src", "migrations");
/** Files in the folder that aren't a step. */
const NOT_STEPS = new Set(["types.ts", "registry.ts", "noteRewrites.ts", "stamp.ts", "upgradeNote.ts", "upgradeReport.ts"]);

describe("migrations registry", () => {
  it("lists every step file in src/migrations, by its file name", () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts") && !NOT_STEPS.has(f)).map((f) => f.replace(/\.ts$/, ""));
    expect([...MIGRATIONS.map((m) => m.id)].sort()).toEqual(files.sort());
  });

  it("has unique ids, a one-sentence change each, and runs phase by phase", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MIGRATIONS) {
      expect(m.change).toMatch(/^[A-Z].*\.$/);
      expect(m.change.split(/\.\s/).length).toBe(1);
      expect(m.recordedBy.length).toBeGreaterThan(0);
    }
    const order = MIGRATIONS.map((m) => PHASE_ORDER.indexOf(m.phase));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(migrationsByPhase().flatMap((p) => p.steps)).toEqual([...MIGRATIONS]);
  });

  it("keeps the note rewrites' record ids (data.json's noteFormatUpgrades) as released", () => {
    expect(NOTE_REWRITES.map((s) => s.recordId)).toEqual(["hex-map-key", "hex-body-lines", "note-links", "ref-links", "area-line", "hex-properties"]);
  });

  it("is described in the folder's README (every id)", () => {
    const readme = fs.readFileSync(path.join(DIR, "README.md"), "utf8");
    for (const m of MIGRATIONS) expect(readme).toContain(m.id);
  });

  it("records what ran, once each, in order", () => {
    const s: { migrationsRun?: string[] } = {};
    expect(recordMigrationRun(s, "a")).toBe(true);
    expect(recordMigrationRun(s, "b")).toBe(true);
    expect(recordMigrationRun(s, "a")).toBe(false);
    expect(s.migrationsRun).toEqual(["a", "b"]);
  });
});

describe("settings-phase steps", () => {
  it("1.0.26: regions → maps, defaultRegion → defaultMap (the new key wins when both are there)", () => {
    const data: Record<string, unknown> = { regions: [{ name: "a" }], defaultRegion: "a", tableRangesPrompt: true };
    expect(runSettingsMigrations(data)).toEqual(["v1.0.26-settings-regions-to-maps", "unreleased-drop-table-ranges-prompt"]);
    expect(data).toEqual({ maps: [{ name: "a" }], defaultMap: "a" });
    const both: Record<string, unknown> = { regions: [{ name: "old" }], maps: [{ name: "new" }] };
    runSettingsMigrations(both);
    expect(both).toEqual({ maps: [{ name: "new" }] });
    expect(runSettingsMigrations({ maps: [] })).toEqual([]);
  });

  it("1.2: roadChains / riverChains become Road and River path chains", () => {
    const m = migrateMapData({ name: "x", roadChains: [["1_1", "2_1"], []], riverChains: [["0_0"]] });
    expect(m.pathChains).toEqual([{ typeName: "Road", hexes: ["1_1", "2_1"] }, { typeName: "River", hexes: ["0_0"] }]);
    expect(m).not.toHaveProperty("roadChains");
    expect(m).not.toHaveProperty("riverChains");
  });

  it("pre-1.0: loose hex notes move into the default map's folder; nothing else is touched", async () => {
    const vault = new MemVault({
      "world/hexes/1_2.md": "a",
      "world/hexes/-3_4.md": "b",
      "world/hexes/notes.md": "c",
      "world/hexes/coast/1_2.md": "d",
      "world/hexes/default/-3_4.md": "taken",
    });
    const app = vault.app() as never;
    expect(await flatHexNotes(app, "world/hexes/")).toBe(1);
    expect(vault.files.get("world/hexes/default/1_2.md")).toBe("a");
    expect(vault.files.get("world/hexes/-3_4.md")).toBe("b"); // its new path is taken: stays
    expect(vault.files.get("world/hexes/notes.md")).toBe("c");
    expect(vault.files.get("world/hexes/coast/1_2.md")).toBe("d");
    // A vault without loose notes: nothing, and no folder made.
    const fresh = new MemVault({ "world/hexes/coast/0_0.md": "x" });
    expect(await flatHexNotes(fresh.app() as never, "world/hexes")).toBe(0);
    expect(fresh.folders.has("world/hexes/default")).toBe(false);
  });

  it("pre-1.0: flat-named terrain tables move into their type folders", async () => {
    const vault = new MemVault({
      "t/terrain/forest - encounters.md": "e",
      "t/terrain/forest - description.md": "d",
      "t/terrain/hills - encounters.md": "old",
      "t/terrain/encounters/hills.md": "new",
    });
    await flatTerrainTables(vault.app() as never, "t/terrain", ["forest", "hills"]);
    expect(vault.files.get("t/terrain/encounters/forest.md")).toBe("e");
    expect(vault.files.get("t/terrain/description/forest.md")).toBe("d");
    expect(vault.files.get("t/terrain/hills - encounters.md")).toBe("old");
    expect(vault.files.get("t/terrain/encounters/hills.md")).toBe("new");
  });
});
