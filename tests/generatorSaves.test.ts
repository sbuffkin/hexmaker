import { describe, it } from "node:test";
import expect from "expect";
import type { TFile } from "obsidian";
import type HexmakerPlugin from "../src/HexmakerPlugin";
import { encodeCells, legacyOrigin, mapForSave, parseSave, serializeSave, type GeneratorSave } from "../src/worldgen/saveFormat";
import { deleteSaves, listSaves, renameSave } from "../src/modules/gen-page/saves";
import { saveRows } from "../src/modules/gen-page/libraryRows";
import { savedMapWhy } from "../src/modules/gen-page/sections/previewColumn";
import { hexKey } from "../src/hexKey";
import { MemVault } from "./helpers/memVault";

/**
 * Generator saves (src/worldgen/saveFormat.ts, saves.ts). The bug these
 * guard: a map generated beside another one doesn't start at 0,0 (the
 * owner's started at -7,-8), and format 1 wrote only the hexes from 0,0 on,
 * so reloading the save showed half the map.
 */

const COLS = 38, ROWS = 25;
const ORIGIN = { x: -7, y: -8 };
const TERRAINS = ["grass", "forest", "hills", "water", "mountain"];

/** Every hex of a cols×rows grid at `origin`, with varied terrain. */
function grid(origin = ORIGIN, cols = COLS, rows = ROWS): Map<string, string> {
  const cells = new Map<string, string>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.set(hexKey(origin.x + x, origin.y + y), TERRAINS[(x * 7 + y * 3) % TERRAINS.length]);
  return cells;
}

const PATHS = [
  { type: "trail", route: "trail: edge > urban", hexes: ["30_-7", "29_-7", "28_-6"] },
  { type: "river", route: "river: peak > edge", hexes: ["-7_0", "-6_0", "-5_1"] },
];

function save(over: Partial<GeneratorSave> = {}): GeneratorSave {
  return {
    name: "alpine-coast-3947429229",
    version: "2.0.0",
    format: 2,
    created: "2026-10-16",
    generatorName: "alpine-coast",
    generatorPath: "world/generators/alpine-coast.md",
    palette: "Default",
    seed: 3947429229,
    cols: COLS,
    rows: ROWS,
    origin: { ...ORIGIN },
    connect: { anchor: "the-coast", side: "east" },
    stagger: "odd",
    orientation: "flat",
    settings: { edgeSmoothing: 0.3 },
    cells: grid(),
    paths: PATHS,
    generatorMarkdown: "---\nhex-wfc: 1\nname: alpine-coast\n---\n",
    ...over,
  };
}

/** What format 1 wrote for the same save: rows and columns from 0,0, no origin or connection. */
function formatOneText(sv: GeneratorSave): string {
  const text = serializeSave(sv)
    .replace(/^hexmaker-save: 2$/m, "hexmaker-save: 1")
    .replace(/^origin:.*\n/m, "")
    .replace(/^connect-(to|side):.*\n/gm, "");
  return text.replace(/(~~~~hexmaker-terrain\n)[\s\S]*?(\n~~~~)/, (_m, a: string, b: string) => a + encodeCells(sv.cells, sv.cols, sv.rows) + b);
}

describe("generator saves: maps that don't start at 0,0", () => {
  it("keep every hex, the origin and the connection", () => {
    const text = serializeSave(save());
    expect(text).toMatch(/^origin: -7,-8$/m);
    expect(text).toMatch(/^connect-to: the-coast$/m);
    expect(text).toMatch(/^connect-side: east$/m);
    const back = parseSave(text);
    if ("error" in back) throw new Error(back.error);
    expect(back.warnings).toEqual([]);
    expect(back.save.origin).toEqual(ORIGIN);
    expect(back.save.connect).toEqual({ anchor: "the-coast", side: "east" });
    expect(back.save.cells).toEqual(grid());
    expect(back.save.paths).toEqual(PATHS);
  });

  it("have no blank rows or columns in the stored terrain", () => {
    const text = serializeSave(save());
    const rows = /~~~~hexmaker-terrain\n([\s\S]*?)\n~~~~/.exec(text)![1].split("\n").slice(1);
    expect(rows).toHaveLength(ROWS);
    for (const r of rows) expect(r).not.toMatch(/-/);
  });

  it("a separate map (no connection) round-trips at 0,0 as before", () => {
    const sv = save({ origin: { x: 0, y: 0 }, connect: undefined, cells: grid({ x: 0, y: 0 }), paths: [] });
    const text = serializeSave(sv);
    expect(text).toMatch(/^origin: 0,0$/m);
    expect(text).not.toMatch(/connect-to/);
    const back = parseSave(text);
    if ("error" in back) throw new Error(back.error);
    expect(back.save.connect).toBeUndefined();
    expect(back.save.cells).toEqual(sv.cells);
  });

  it("refuses an origin it can't read rather than misplacing the map", () => {
    const text = serializeSave(save()).replace("origin: -7,-8", "origin: west");
    expect(parseSave(text)).toEqual({ error: 'bad origin "west"' });
  });

  it("ignores a connection to an unknown side", () => {
    const back = parseSave(serializeSave(save()).replace("connect-side: east", "connect-side: up"));
    if ("error" in back) throw new Error(back.error);
    expect(back.save.connect).toBeUndefined();
  });
});

describe("generator saves: format 1 saves cut off by the old bug", () => {
  it("are put back at their real origin, the surviving hexes where they were", () => {
    const back = parseSave(formatOneText(save()));
    if ("error" in back) throw new Error(back.error);
    const { save: sv, warnings } = back;
    expect(sv.origin).toEqual(ORIGIN);
    // Only x ≥ 0 and y ≥ 0 survived: 31 columns × 17 rows.
    expect(sv.cells.size).toBe(31 * 17);
    for (const [k, t] of sv.cells) expect(grid().get(k)).toBe(t);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/older version saved only part of this map \(423 of 950 hexes are missing\)/);
  });

  it("the owner's save shape: blank right columns and bottom rows, paths above 0,0", () => {
    const cells = grid();
    const shown = new Map([...cells].filter(([k]) => !k.includes("-")));
    expect(legacyOrigin(shown, COLS, ROWS, PATHS)).toEqual({ origin: ORIGIN, lost: COLS * ROWS - shown.size });
  });

  it("aren't touched when the map was whole", () => {
    const sv = save({ origin: { x: 0, y: 0 }, connect: undefined, cells: grid({ x: 0, y: 0 }), paths: [{ type: "road", hexes: ["0_0", "1_0"] }] });
    const back = parseSave(formatOneText(sv));
    if ("error" in back) throw new Error(back.error);
    expect(back.save.origin).toEqual({ x: 0, y: 0 });
    expect(back.warnings).toEqual([]);
  });

  it("aren't moved when a path disagrees (blank edge, but paths all inside 0,0)", () => {
    const cells = grid({ x: 0, y: 0 }, 30, 20);
    expect(legacyOrigin(cells, COLS, ROWS, [{ type: "road", hexes: ["5_5", "6_5"] }])).toBeNull();
    // With no paths, the blank edge alone decides.
    expect(legacyOrigin(cells, COLS, ROWS, [])).toEqual({ origin: { x: -8, y: -5 }, lost: COLS * ROWS - 600 });
  });

  it("an empty save has nothing to place", () => {
    expect(legacyOrigin(new Map(), COLS, ROWS, PATHS)).toBeNull();
  });
});

describe("generator saves: which map a loaded save shows", () => {
  it("the same map: same", () => {
    const r = mapForSave({ cells: grid() }, grid());
    expect(r.same).toBe(true);
    expect(r.filled).toBe(0);
  });

  it("a cut-off save whose hexes all match: the generated map, lost hexes filled", () => {
    const cut = new Map([...grid()].filter(([k]) => !k.includes("-")));
    const r = mapForSave({ cells: cut }, grid());
    expect(r.same).toBe(false);
    expect(r.filled).toBe(COLS * ROWS - cut.size);
    expect(r.cells).toEqual(grid());
  });

  it("a different map: the saved one, unchanged", () => {
    const other = new Map(grid());
    other.set("0_0", "lava");
    const r = mapForSave({ cells: grid() }, other);
    expect(r).toEqual({ cells: grid(), same: false, filled: 0 });
  });
});

// ── In the vault ───────────────────────────────────────────────────────────

const SAVES = "world/generators/saves";

function vaultWith(names: string[]): { v: MemVault; plugin: HexmakerPlugin } {
  const files: Record<string, string> = {};
  for (const n of names) files[`${SAVES}/${n}.md`] = serializeSave(save({ name: n }));
  const v = new MemVault(files);
  const plugin = { app: v.app(), settings: { worldFolder: "world" } } as unknown as HexmakerPlugin;
  return { v, plugin };
}
const fileOf = (plugin: HexmakerPlugin, path: string) => plugin.app.vault.getAbstractFileByPath(path) as TFile;

describe("generator saves: rename and delete", () => {
  it("rename moves the file and updates its name and title", async () => {
    const { v, plugin } = vaultWith(["coast-1"]);
    const r = await renameSave(plugin, fileOf(plugin, `${SAVES}/coast-1.md`), "  My Good Coast ");
    expect(r).toMatchObject({ name: "my-good-coast" });
    expect(v.files.has(`${SAVES}/coast-1.md`)).toBe(false);
    const text = v.files.get(`${SAVES}/my-good-coast.md`)!;
    expect(text).toMatch(/^name: my-good-coast$/m);
    expect(text).toMatch(/^# my-good-coast$/m);
    expect(text).not.toMatch(/coast-1/);
    // It still loads, whole.
    const back = parseSave(text);
    if ("error" in back) throw new Error(back.error);
    expect(back.save.name).toBe("my-good-coast");
    expect(back.save.cells.size).toBe(COLS * ROWS);
  });

  it("rename keeps a title the user changed, and the generator's own copy", async () => {
    const { v, plugin } = vaultWith(["coast-1"]);
    const path = `${SAVES}/coast-1.md`;
    v.files.set(path, v.files.get(path)!.replace("# coast-1", "# The coast, take one"));
    await renameSave(plugin, fileOf(plugin, path), "coast-2");
    const text = v.files.get(`${SAVES}/coast-2.md`)!;
    expect(text).toMatch(/^# The coast, take one$/m);
    expect(text).toMatch(/^name: alpine-coast$/m); // inside the Generator block
  });

  it("rename refuses a name another save has, or no name", async () => {
    const { v, plugin } = vaultWith(["a", "b"]);
    expect(await renameSave(plugin, fileOf(plugin, `${SAVES}/a.md`), "b")).toEqual({ error: 'There\'s already a save named "b".' });
    expect(await renameSave(plugin, fileOf(plugin, `${SAVES}/a.md`), "!!!")).toMatchObject({ error: expect.stringMatching(/Enter a name/) });
    expect([...v.files.keys()].sort()).toEqual([`${SAVES}/a.md`, `${SAVES}/b.md`]);
  });

  it("rename to its own name does nothing", async () => {
    const { v, plugin } = vaultWith(["a"]);
    const before = v.files.get(`${SAVES}/a.md`);
    await renameSave(plugin, fileOf(plugin, `${SAVES}/a.md`), "A");
    expect(v.files.get(`${SAVES}/a.md`)).toBe(before);
    expect(v.writes).toEqual([]);
  });

  it("delete sends the ticked saves to the trash and leaves the rest", async () => {
    const { v, plugin } = vaultWith(["a", "b", "c"]);
    await deleteSaves(plugin, [fileOf(plugin, `${SAVES}/a.md`), fileOf(plugin, `${SAVES}/c.md`)]);
    expect(v.trashed).toEqual([`${SAVES}/a.md`, `${SAVES}/c.md`]);
    expect(listSaves(plugin).map((s) => s.file.path)).toEqual([`${SAVES}/b.md`]);
  });

  it("lists saves with their generator, seed and size", () => {
    const { plugin } = vaultWith(["a"]);
    expect(listSaves(plugin).map(({ name, generator, seed, size }) => ({ name, generator, seed, size }))).toEqual([
      { name: "a", generator: "alpine-coast", seed: "3947429229", size: "38x25" },
    ]);
  });
});

describe("generator saves: the Saves tab's rows", () => {
  const rows = [
    { path: "s/old.md", name: "old", generator: "valley", seed: "1", size: "30x20", saved: "2026-10-01", mtime: 1 },
    { path: "s/new.md", name: "new", generator: "alpine-coast", seed: "3947429229", size: "38x25", saved: "2026-10-16", mtime: 3 },
    { path: "s/mid.md", name: "mid", generator: "valley", seed: "7", size: "38x25", saved: "2026-10-09", mtime: 2 },
  ];
  it("are newest first", () => {
    expect(saveRows(rows).map((r) => r.name)).toEqual(["new", "mid", "old"]);
  });
  it("filter on every typed word across name, generator, seed, size and date", () => {
    expect(saveRows(rows, "valley 38x25").map((r) => r.name)).toEqual(["mid"]);
    expect(saveRows(rows, "3947").map((r) => r.name)).toEqual(["new"]);
    expect(saveRows(rows, "2026-10-0").map((r) => r.name)).toEqual(["mid", "old"]);
    expect(saveRows(rows, "nothing")).toEqual([]);
  });
});

describe("generator saves: why the saved map is shown", () => {
  const whole = { cells: grid(), cols: COLS, rows: ROWS, version: "2.0.0" };
  it("a cut-off save says how to fill it in", () => {
    const cut = new Map([...grid()].filter(([k]) => !k.includes("-")));
    expect(savedMapWhy({ ...whole, cells: cut }, false, "2.0.0")).toMatch(/part of it was lost: set Connect to/);
  });
  it("a save made beside a map, shown on its own, says so rather than blaming the version", () => {
    const why = savedMapWhy({ ...whole, connect: { anchor: "the-coast", side: "east" } }, false, "2.0.0");
    expect(why).toMatch(/made beside the-coast; shown on its own/);
    expect(why).not.toMatch(/version/);
  });
  it("another version: names it; same version, connected: nothing to add", () => {
    expect(savedMapWhy({ ...whole, version: "1.5.6" }, false, "2.0.0")).toMatch(/from v1\.5\.6/);
    expect(savedMapWhy({ ...whole, connect: { anchor: "the-coast", side: "east" } }, true, "2.0.0")).toBe("");
  });
});
