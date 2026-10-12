/**
 * Colours in palette notes that can't be read (#43): reported like other
 * palette problems, kept as typed, and fixed only when there's exactly
 * one safe reading.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { Notice, TFile } from "obsidian";
import { colorCell, colorUnreadable, isCssColor, parseColorCell, safeColorFix } from "../src/palettes/colorCell";
import { buildPaletteNote, colorIssuesText, paletteColorIssues, parsePaletteNote, updatePaletteNote, wrapPaletteColors } from "../src/palettes/paletteNote";
import { PaletteStore } from "../src/palettes/PaletteStore";
import { parsePathTypes, setPathTypes } from "../src/palettes/pathTypeTable";
import { DEFAULT_SETTINGS } from "../src/constants";
import type { HexmakerPluginSettings } from "../src/types";
import { MemVault } from "./helpers/memVault";

(globalThis as Record<string, unknown>).window ??= globalThis;

describe("colour cells: what counts as a colour", () => {
  it("hex, functions and CSS names are colours", () => {
    for (const c of ["#abc", "#abcd", "#29507f", "#29507f80", "rgb(1, 2, 3)", "hsl(120 50% 50%)", "oklch(0.7 0.1 200)", "violet", "Violet", "transparent", "rebeccapurple"]) {
      expect(isCssColor(c)).toBe(true);
    }
  });

  it("anything else isn't", () => {
    for (const c of ["blu", "#12345", "#12g456", "rgb()", "rgb 1 2 3", "forest green-ish", "#"]) {
      expect(isCssColor(c)).toBe(false);
    }
  });

  it("fixes slips with one reading", () => {
    expect(safeColorFix("'#29507F'")).toBe("#29507f");
    expect(safeColorFix("#29507f;")).toBe("#29507f");
    expect(safeColorFix("0x29507f")).toBe("#29507f");
    expect(safeColorFix("##29507f")).toBe("#29507f");
    expect(safeColorFix("# 29 50 7f")).toBe("#29507f");
    expect(safeColorFix("rgb(1, 2, 3")).toBe("rgb(1, 2, 3)");
    expect(safeColorFix("Dark Green")).toBe("darkgreen");
    expect(safeColorFix("dark-slate-blue")).toBe("darkslateblue");
    expect(safeColorFix('"29507f"')).toBe("#29507f");
  });

  it("never guesses: no safe reading, no fix", () => {
    for (const c of ["blu", "#12345", "#12g456", "greenish", "rgb(1, 2", "dark grene"]) {
      expect(safeColorFix(c)).toBeNull();
    }
  });

  it("an unreadable colour is kept exactly as typed (only put in inline code)", () => {
    expect(parseColorCell("blu")).toBe("blu");
    expect(colorCell("blu")).toBe("`blu`");
    expect(colorUnreadable("blu")).toBe(true);
    expect(colorUnreadable("`#29507f`")).toBe(false);
    expect(colorUnreadable("")).toBe(false);
    expect(parseColorCell("# 29507f")).toBe("#29507f");
  });
});

const NOTE = (rows: string[], paths: string[] = []) => [
  "---", "hexmaker-palette: 1", "---", "",
  "| Terrain | Color | Icon | Icon color |",
  "| --- | --- | --- | --- |",
  ...rows,
  ...(paths.length ? ["", "## Path types", "", "| Path | Color | Width | Style |", "| --- | --- | --- | --- |", ...paths] : []),
  "",
].join("\n");

describe("palette notes: colour problems", () => {
  it("an unreadable path type colour is drawn grey and kept as typed too", () => {
    const note = NOTE(["| sea | `#29507f` |  |  |"], ["| Road | #12g | 3 | solid |"]);
    const types = parsePathTypes(note)!.types;
    expect(types[0]).toMatchObject({ color: "#888888", unreadColor: "#12g" });
    expect(setPathTypes(note, types)).toContain("| Road | `#12g` |");
    // changed in the app: the new colour is written, the old text goes
    expect(setPathTypes(note, [{ ...types[0], color: "#123456" }])).toContain("| Road | `#123456` |");
  });

  it("lists unreadable and fixed colours in the terrain and path type tables", () => {
    const note = NOTE(
      ["| forest | blu |  |  |", "| sea | `#29507f` |  | white |", "| hills | # 69a168 |  | 0xffffff |", "| dunes | `ddcc88` |  |  |"],
      ["| Road | #12g | 3 | solid |", "| River | `#3b82f6` | 3 | solid |"],
    );
    expect(paletteColorIssues(note)).toEqual([
      { row: "forest", column: "Color", text: "blu" },
      { row: "hills", column: "Color", text: "# 69a168", fixed: "#69a168" },
      { row: "hills", column: "Icon color", text: "0xffffff", fixed: "#ffffff" },
      { row: "Road", column: "Color", text: "#12g" },
    ]);
    expect(colorIssuesText(paletteColorIssues(note).slice(0, 3))).toBe('forest: "blu"; hills: "# 69a168" → #69a168; hills (icon): "0xffffff" → #ffffff');
  });

  it("a clean note has none", () => {
    expect(paletteColorIssues(buildPaletteNote([{ name: "sea", color: "#29507f" }, { name: "x", color: "violet" }]))).toEqual([]);
  });

  it("the user's text survives a rewrite of the table; a safe fix is written back", () => {
    const note = NOTE(["| forest | blu |  |  |", "| hills | # 69a168 |  |  |"]);
    const terrains = parsePaletteNote(note)!;
    // drawn grey, the text kept
    expect(terrains.map((t) => [t.color, t.unreadColor])).toEqual([["#888888", "blu"], ["#69a168", undefined]]);
    const out = updatePaletteNote(note, terrains);
    expect(out).toContain("| forest | `blu` |");
    expect(out).toContain("| hills | `#69a168` |");
    // the colour pass (load / leaving the note) does the same, cell by cell
    const wrapped = wrapPaletteColors(note);
    expect(wrapped).toContain("| forest | `blu` |");
    expect(wrapped).toContain("| hills | `#69a168` |");
  });
});

// ── PaletteStore: the notice ─────────────────────────────────────────────

function harness() {
  const vault = new MemVault();
  const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as HexmakerPluginSettings;
  const settings: HexmakerPluginSettings = { ...defaults, worldFolder: "world" };
  const plugin = {
    settings,
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    app: vault.app(),
    saveData: async () => {},
    refreshHexMap: () => {},
    refreshPaletteEditors: () => {},
    ensureTablesForNewTerrains: async () => {},
    getPaletteByName: (name: string) => settings.terrainPalettes.find((p) => p.name === name),
    mapsOnPalette: () => [],
    mapStore: { all: () => new Map() },
    terrainTableFiles: () => [],
    renameTerrainEverywhere: async () => null,
  };
  const store = new PaletteStore(plugin as never);
  const file = (p: string) => plugin.app.vault.getAbstractFileByPath(p) as TFile;
  return { vault, settings, store, file };
}

describe("PaletteStore: colours it can't read", () => {
  beforeEach(() => { Notice.shown = []; });

  it("a hand edit with a bad colour: one notice naming it, the text kept, the terrain drawn grey", async () => {
    const h = harness();
    await h.store.init();
    const path = h.store.notePathOf(h.settings.terrainPalettes[0].name)!;
    const name = h.settings.terrainPalettes[0].name;
    const first = h.settings.terrainPalettes[0].terrains[0].name;
    const text = h.vault.files.get(path)!;
    const row = text.split("\n").find((l) => l.startsWith(`| ${first} |`))!;
    const edited = text.replace(row, row.replace(/`#[0-9a-f]+`/, "blu"));
    h.vault.files.set(path, edited);
    Notice.shown = [];
    h.store.onModify(h.file(path));
    await h.store.sync();
    const said = Notice.shown.filter((n) => n.msg.includes("can't read"));
    expect(said).toHaveLength(1);
    expect(said[0].msg).toContain(`palette "${name}"`);
    expect(said[0].msg).toContain(`${first}: "blu"`);
    expect(h.settings.terrainPalettes[0].terrains[0]).toMatchObject({ color: "#888888", unreadColor: "blu" });
    // kept as typed (in inline code) through the plugin's own rewrites
    h.settings.terrainPalettes[0].terrains[1].color = "#000001";
    await h.store.sync();
    expect(h.vault.files.get(path)).toContain(`| ${first} | \`blu\` |`);
    // said once: the same problem isn't repeated on the next edit
    Notice.shown = [];
    h.vault.files.set(path, h.vault.files.get(path)! + "\nMy notes.\n");
    h.store.onModify(h.file(path));
    await h.store.sync();
    expect(Notice.shown.filter((n) => n.msg.includes("can't read"))).toHaveLength(0);
  });

  it("a restart with the same unreadable colour stays quiet (remembered per device, never in data.json)", async () => {
    const h = harness();
    const local = new Map<string, unknown>();
    const app = h.store["plugin"].app as Record<string, unknown>;
    app.loadLocalStorage = (k: string) => local.get(k) ?? null;
    app.saveLocalStorage = (k: string, v: unknown) => { local.set(k, v); };
    await h.store.init();
    const path = h.store.notePathOf(h.settings.terrainPalettes[0].name)!;
    const first = h.settings.terrainPalettes[0].terrains[0].name;
    const text = h.vault.files.get(path)!;
    const row = text.split("\n").find((l) => l.startsWith(`| ${first} |`))!;
    h.vault.files.set(path, text.replace(row, row.replace(/`#[0-9a-f]+`/, "blu")));
    Notice.shown = [];
    h.store.onModify(h.file(path));
    await h.store.sync();
    expect(Notice.shown.filter((n) => n.msg.includes("can't read"))).toHaveLength(1);
    // A new store on the same device and vault (a restart): nothing new to say.
    const again = new PaletteStore(h.store["plugin"] as never);
    Notice.shown = [];
    await again.init();
    expect(Notice.shown.filter((n) => n.msg.includes("can't read"))).toHaveLength(0);
    expect(JSON.stringify(h.settings)).not.toContain("colors-reported");
  });

  it("a safe fix is said and written back", async () => {
    const h = harness();
    await h.store.init();
    const path = h.store.notePathOf(h.settings.terrainPalettes[0].name)!;
    const first = h.settings.terrainPalettes[0].terrains[0].name;
    const text = h.vault.files.get(path)!;
    const row = text.split("\n").find((l) => l.startsWith(`| ${first} |`))!;
    h.vault.files.set(path, text.replace(row, row.replace(/`#([0-9a-f]+)`/, "0x$1")));
    Notice.shown = [];
    h.store.onModify(h.file(path));
    await h.store.sync();
    expect(Notice.shown.some((n) => n.msg.includes(`read ${first}: "0x`))).toBe(true);
    expect(h.vault.files.get(path)!.split("\n").find((l) => l.startsWith(`| ${first} |`))).toMatch(/^\| [^|]+ \| `#[0-9a-f]{6}` \|/);
  });

  it("bad colours already in a note are said on load", async () => {
    const h = harness();
    await h.store.init();
    const path = h.store.notePathOf(h.settings.terrainPalettes[0].name)!;
    const first = h.settings.terrainPalettes[0].terrains[0].name;
    const text = h.vault.files.get(path)!;
    const row = text.split("\n").find((l) => l.startsWith(`| ${first} |`))!;
    h.vault.files.set(path, text.replace(row, row.replace(/`#[0-9a-f]+`/, "greenish")));
    Notice.shown = [];
    const again = new PaletteStore((h.store as unknown as { plugin: never }).plugin);
    await again.init();
    expect(Notice.shown.some((n) => n.msg.includes(`${first}: "greenish"`))).toBe(true);
  });
});
