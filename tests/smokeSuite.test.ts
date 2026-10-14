import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
// The smoke suite's pure helpers (dev/smoke; the suite itself needs Windows Obsidian).
import { canon, jsonDiff, oneTimeOnly } from "../dev/smoke/lib/compare.mjs";
import { bodyFieldLines, comparableBody, diff, hexDataFromFm, hexNoteMapLink, noteFormatBackups, paletteTerrains, tableRangeBackups, verifyPaletteUpgrade } from "../dev/smoke/lib/disk.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { JOB_MEM_BYTES, pickJobs, stopUntilGone } from "../dev/smoke/lib/concurrency.mjs";
import { readSurface } from "./helpers/source";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("smoke suite: comparison helpers", () => {
  it("canon ignores key order at every level", () => {
    expect(canon({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: 3 } })).toBe(canon({ a: { c: 3, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(canon([2, 1])).not.toBe(canon([1, 2]));
  });

  it("jsonDiff names the paths that differ", () => {
    const d = jsonDiff({ maps: [{ name: "a", zoom: 1 }], x: 1 }, { maps: [{ name: "a", zoom: 2 }], x: 1 });
    expect(d).toEqual(["maps[0].zoom: 1 → 2"]);
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("a restart may only write the one-time settings", () => {
    expect(oneTimeOnly({ a: 1 }, { a: 1, tableRangesUpgraded: true })).toBe(true);
    expect(oneTimeOnly({ a: 1 }, { a: 1, noteFormatUpgrades: ["NF1"], tableRangesUpgraded: true })).toBe(true);
    // The churn the suite found: maps' path lists written back on a later start.
    expect(oneTimeOnly({ maps: [{ name: "a" }] }, { maps: [{ name: "a", pathChains: [] }], tableRangesUpgraded: true })).toBe(false);
    expect(oneTimeOnly({ a: 1 }, { a: 1 })).toBe(false);
  });

  it("snapshot diff tells changed, rewritten, added and removed apart", () => {
    const a = { x: { h: "1", m: 1 }, y: { h: "2", m: 1 }, z: { h: "3", m: 1 } };
    const b = { x: { h: "1", m: 1 }, y: { h: "9", m: 2 }, z: { h: "3", m: 5 }, w: { h: "4", m: 1 } };
    expect(diff(a, b)).toEqual({ added: ["w"], removed: [], changed: ["y"], touched: ["z"] });
    expect(diff(b, a).removed).toEqual(["w"]);
  });
});

describe("smoke suite: legacy hex data and palette upgrades", () => {
  it("reads 1.5.5 hex-note frontmatter like MapStore.hexDataFromFrontmatter", () => {
    expect(hexDataFromFm({ terrain: "grass", "gm-icon": "I_Ruins.png", "duckmage-submap": "harbour", locked: "true", tags: ["x"] }))
      .toEqual({ terrain: "grass", gmIcons: ["I_Ruins.png"], locations: ["harbour"], locked: true });
    expect(hexDataFromFm({ terrain: "" })).toEqual({});
    expect(hexDataFromFm(null)).toEqual({});
  });

  const OLD = [
    "---", "hexmaker-palette: 1", "---", "", "| Terrain | Color | Icon | Icon color | Category | Type |", "| --- | --- | --- | --- | --- | --- |",
    "| water | #60a5fa |  |  |  | water |", "| grass | #69a168 | bw-grassland.png |  | lowlands | grassland |", "",
  ].join("\n");
  const NEW = [
    "---", "hexmaker-palette: 1", "---", "", "| Terrain | Color | Icon | Icon color | Category | Type | Impassable |", "| --- | --- | --- | --- | --- | --- | --- |",
    "| water | `#60a5fa` |  |  |  | water | (yes) |", "| grass | `#69a168` | bw-grassland.png |  | lowlands | grassland | (no) |", "",
    "## Path types", "", "| Path | Color |", "| --- | --- |", "| Road | `#a16207` |", "",
  ].join("\n");

  it("a palette note upgrade that only adds columns and tables passes", () => {
    expect(paletteTerrains(NEW).get("grass")).toBe("#69a168|bw-grassland.png||lowlands|grassland");
    expect(paletteTerrains(NEW).has("Road")).toBe(false);
    expect(verifyPaletteUpgrade(OLD, NEW)).toEqual([]);
  });

  it("NF1/NF2: a hex note's map link under either key; bodies compare without the moved lines", () => {
    expect(hexNoteMapLink({ map: "[[_coast]]" })).toBe("[[_coast]]");
    expect(hexNoteMapLink({ map: "Sword Coast", "hexmaker-map": "[[_coast]]" })).toBe("[[_coast]]");
    expect(hexNoteMapLink({ "hexmaker-map": 5 })).toBe(null);
    const before = "# Hex 0, 1\n\n**Region:** [[Dustbowl]]\n**Terrain:** mountain\n**Terrain:** *(fill)*\n\n### Description\nCold.\n";
    expect(bodyFieldLines(before)).toEqual([["region", "[[Dustbowl]]"], ["terrain", "mountain"]]);
    const after = "# Hex 0, 1\n\n> [!hexmaker] Map data\n> Terrain: dunes\n> Old region: [[Dustbowl]]\n> Old terrain: mountain\n\n**Terrain:** *(fill)*\n\n### Description\nCold.\n";
    expect(comparableBody(after)).toBe(comparableBody(before));
    expect(comparableBody(after.replace("Cold.", "Warm."))).not.toBe(comparableBody(before));
  });

  it("a rewrite that loses or changes a terrain is caught", () => {
    expect(verifyPaletteUpgrade(OLD, NEW.replace("| water |", "| sea |"))).toEqual(['terrain "water" gone', 'terrain "sea" added']);
    expect(verifyPaletteUpgrade(OLD, NEW.replace("`#69a168`", "`#000000`"))).toHaveLength(1);
  });
});

/**
 * Regression guards for the bugs the smoke suite's first run found
 * (2026-10-11). Each has a scripted check in dev/smoke too; these keep the
 * fixes from quietly reverting between smoke runs.
 */
describe("smoke suite findings stay fixed", () => {
  it("C6: a terrain stroke remembers the old terrain from the map data, not the hex note's frontmatter", () => {
    const src = readSurface("map-view");
    const start = src.indexOf("  private onHexPaintClick(");
    const body = src.slice(start, src.indexOf("\n  }\n", start));
    expect(body).toMatch(/oldTerrain = pending \? pending\.terrain : getTerrainFromFile\(this\.app, path\)/);
    expect(body).not.toMatch(/getCache\(path\)\?\.frontmatter/);
  });

  it("C5: views restored as deferred tabs are skipped, never cast and called", () => {
    const src = readSurface("plugin");
    expect(src).not.toMatch(/\(leaf\.view as Hex(Map|Table)View\)\./);
    expect(src).toMatch(/if \(leaf\.view instanceof HexMapView\) leaf\.view\.renderGrid\(\);/);
  });

  it("C5: startup saves wait for the map notes to load", () => {
    const src = readSurface("plugin");
    expect(src).toMatch(/rangesDone = storesReady\.then\(\(\) => upgradeTableRangesOnce\(plugin\)\);/);
  });
});

describe("smoke suite: concurrency and stopping", () => {
	const GB = 2 ** 30;

	it("--jobs wins, within 1..4", () => {
		// @ts-expect-error: --jobs arrives as a CLI string
		expect(pickJobs({ requested: "2", freeMem: 0.5 * GB, cpuBusy: 0.99, cpuCount: 2 })).toEqual({ jobs: 2, reason: "--jobs" });
		expect(pickJobs({ requested: 9, freeMem: 64 * GB, cpuCount: 32 }).jobs).toBe(4);
		// @ts-expect-error: --jobs arrives as a CLI string
		expect(pickJobs({ requested: "abc", freeMem: 64 * GB, cpuCount: 32 }).reason).not.toBe("--jobs");
	});

	it("runs 4 on an idle machine with room", () => {
		expect(pickJobs({ freeMem: 16 * GB, cpuBusy: 0.1, cpuCount: 16 }).jobs).toBe(4);
		expect(pickJobs({ freeMem: 16 * GB, cpuCount: 16 }).jobs).toBe(4);
	});

	it("runs fewer when free memory is low", () => {
		expect(pickJobs({ freeMem: 2 * GB + 3 * JOB_MEM_BYTES, cpuBusy: 0, cpuCount: 16 }).jobs).toBe(3);
		expect(pickJobs({ freeMem: 4 * GB, cpuBusy: 0, cpuCount: 16 }).jobs).toBe(1);
		// Never 0: one at a time still runs.
		expect(pickJobs({ freeMem: 0.5 * GB, cpuBusy: 0, cpuCount: 16 }).jobs).toBe(1);
	});

	it("runs fewer when the CPU is busy or there are few cores", () => {
		expect(pickJobs({ freeMem: 32 * GB, cpuBusy: 0.7, cpuCount: 16 }).jobs).toBe(2);
		expect(pickJobs({ freeMem: 32 * GB, cpuBusy: 0.9, cpuCount: 16 }).jobs).toBe(1);
		expect(pickJobs({ freeMem: 32 * GB, cpuBusy: 0, cpuCount: 4 }).jobs).toBe(2);
		expect(pickJobs({ freeMem: 32 * GB, cpuBusy: 0.7, cpuCount: 16 }).reason).toMatch(/70% busy/);
	});

	it("stopUntilGone retries while the run's processes linger, then reports the last result", async () => {
		const waits: number[] = [];
		const sleep = async (ms: number) => { waits.push(ms); };
		const results = [{ ok: false, remainingSandbox: 2 }, { ok: false, remainingSandbox: 1 }, { ok: true, remainingSandbox: 0 }];
		let calls = 0;
		const r = await stopUntilGone(async () => results[calls++], { attempts: 5, waitMs: 100, sleep });
		expect(r).toMatchObject({ ok: true, attempts: 3 });
		expect(waits).toEqual([100, 100]);

		let n = 0;
		const never = await stopUntilGone(async () => { n++; throw new Error("busy"); }, { attempts: 3, waitMs: 1, sleep });
		expect(never).toMatchObject({ ok: false, attempts: 3, error: "busy" });
		expect(n).toBe(3);
	});

	it("only counts the suite's own processes (other Obsidian sessions may come and go)", () => {
		const run = read("dev", "smoke", "run.mjs");
		expect(run).toMatch(/ok: leftMine\.length === 0,/);
		expect(run).not.toMatch(/otherBefore\.length === otherAfter\.length/);
		expect(run).toMatch(/pickJobs\(\{ requested: val\("jobs", null\)/);
		const lib = read("dev", "smoke", "lib", "obsidian.mjs");
		expect(lib).toMatch(/stopUntilGone\(/);
	});
});

describe("smoke suite: silent table-range upgrade (DJ-Q6) is an allowed, backed-up rewrite", () => {
  it("reads the table-ranges backups, and only those", () => {
    const vault = mkdtempSync(path.join(tmpdir(), "smoke-tr-"));
    const dir = path.join(vault, ".obsidian", "plugins", "p", "backups", "table-ranges-2026-10-11");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "tables.json.gz"), gzipSync(JSON.stringify({ kind: "table-ranges", notes: { "tables/beach.md": "| Result | Weight |" } })));
    const tr = tableRangeBackups(vault, "p");
    expect(Object.keys(tr)).toEqual(["tables/beach.md"]);
    expect((tr as Record<string, string>)["tables/beach.md"]).toMatch(/^[0-9a-f]+$/);
    expect(noteFormatBackups(vault, "p")).toEqual({});
  });

  it("C4 allows a changed table only when its backed-up original matches", () => {
    const src = read("dev", "smoke", "run.mjs");
    expect(src).toContain("trBackups[p] === snap0[p]?.h");
    expect(src).toContain("ranged.includes(p)");
  });
});
