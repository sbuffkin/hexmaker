/**
 * The owner's UI worksheet (dev/ui-inventory/inputs-tags-resolved.json),
 * applied to the settings tab, setup wizard, commands & menus and the
 * generator page: every tagged id is where its tier says, the Advanced
 * sub-sections render as nested collapsibles, and dropped controls are gone.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLACEMENT, layerOf, parsePlacement, partitionSections, subSectionOf, type Layer, type Placement } from "../src/ui/placement";
import { Disclosure, DISCLOSURE_OPEN_KEY, disclosureOpen, setDisclosureOpen, subSectionKey } from "../src/ui/disclosure";
import { setDebugMode, type LocalStore } from "../src/ui/debugMode";
import { addPlacedMenuItems, placeCommand } from "../src/ui/commandPlacement";
import { eventPos } from "../src/ui/placedMenu";
import { Menu as ObsidianMenu, type MenuItem as ObsidianMenuItem } from "obsidian";
import { GENERATE_WORLD_DATA_NAME, REPAIR_HINT, withRepairHint } from "../src/ui/repairHint";
import { DEFAULT_SETTINGS } from "../src/constants";
import { HexmakerSettingTab } from "../src/HexmakerSettingTab";
import { wizardOptionId } from "../src/wizardText";
import { parseSave, serializeSave, type GeneratorSave } from "../src/worldgen/saveFormat";

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

class FakeStore implements LocalStore {
  data = new Map<string, unknown>();
  loadLocalStorage(key: string): unknown {
    return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null;
  }
  saveLocalStorage(key: string, value: unknown): void {
    if (value === null || value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
}

// ── The worksheet rows for these surfaces ───────────────────────────────────

interface Row { id: string; group: string; choice: string; twinOf: string; note: string }
const ALL = JSON.parse(read("dev", "ui-inventory", "inputs-tags-resolved.json")) as Row[];
const MINE = new Set(["Settings", "Setup wizard", "Commands & menus", "Generator page"]);
const ROWS = ALL.filter((r) => MINE.has(r.group));
const byId = new Map(ALL.map((r) => [r.id, r]));

/**
 * Where a tag deliberately isn't followed to the letter, and why (each is
 * an owner note or the brief).
 */
const EXCEPTIONS: Record<string, { layer: Layer; why: string }> = {
  "Settings.generateWorldData": { layer: "advanced", why: "overkill, but the README's manual setup uses it and missing-table messages point to it" },
  "Settings.generateFolders": { layer: "advanced", why: "overkill, but the README's manual setup uses it" },
  "Settings.paletteDelete": { layer: "main", why: "owner: custom palettes are simple (note on its legacy twin)" },
  // Owner 2026-10-12: "the current 'advanced' options in hex map setup are actually the standard ones and should be above the fold".
  "Wizard.genOptWater": { layer: "main", why: "owner override 2026-10-12: generator options above the fold" },
  "Wizard.genOptClimate": { layer: "main", why: "owner override 2026-10-12: generator options above the fold" },
  "Wizard.genOptRelief": { layer: "main", why: "owner override 2026-10-12: generator options above the fold" },
  "Wizard.genOptSea": { layer: "main", why: "owner override 2026-10-12: generator options above the fold" },
  "Wizard.genOptOther": { layer: "main", why: "owner override 2026-10-12: generator options above the fold" },
};

/** The layer a worksheet tier asks for on these surfaces. */
function expectedLayer(id: string, tier: string): Layer | "dropped" {
  if (EXCEPTIONS[id]) return EXCEPTIONS[id].layer;
  switch (tier) {
    case "keep":
    case "simple":
      return "main";
    case "advanced":
      return "advanced";
    // Owner: the generator's overkill controls go in its Advanced dropdown, not Debug.
    case "overkill":
      return /^(GenPage|BiomePage)\./.test(id) ? "advanced" : "debug";
    case "drop":
      return "dropped";
    default:
      throw new Error(`unknown tier ${tier} for ${id}`);
  }
}

/** The id that carries a row's placement: a legacy settings twin follows its declarative twin. */
const honouredId = (r: Row) => (r.id.startsWith("Settings.legacy") && r.twinOf ? r.twinOf : r.id);

describe("owner worksheet: every tagged id on these surfaces is honoured", () => {
  it("covers the four surfaces", () => {
    expect(ROWS.length).toBeGreaterThan(200);
    for (const g of MINE) expect(ROWS.some((r) => r.group === g)).toBe(true);
  });

  for (const r of ROWS) {
    const id = honouredId(r);
    const tier = id === r.id ? r.choice : (byId.get(id)?.choice ?? r.choice);
    const want = expectedLayer(id, tier);
    it(`${r.id} (${r.choice}${id !== r.id ? `, twin of ${id}` : ""}) → ${want}`, () => {
      if (want === "dropped") {
        expect(Object.prototype.hasOwnProperty.call(PLACEMENT, r.id)).toBe(false);
        return;
      }
      const got = layerOf(id);
      if (want === "main") expect(["main", "more"]).toContain(got);
      else expect(got).toBe(want);
      // Simple ones are never below the fold either.
      if (tier === "simple" && !EXCEPTIONS[id]) expect(got).toBe("main");
      // Generator-page overkill: in a named Advanced sub-section.
      // (Round 10: the biome page's Seed was a one-item sub-section, so it's plain Advanced.)
      if (tier === "overkill" && /^(GenPage|BiomePage)\./.test(id) && id !== "BiomePage.seed") expect(subSectionOf(id)).toBeTruthy();
    });
  }

  it("legacy settings twins have no ids of their own any more (one entry places both settings paths)", () => {
    const tab = read("src", "HexmakerSettingTab.ts");
    for (const r of ROWS.filter((x) => x.id.startsWith("Settings.legacy"))) {
      expect(tab).not.toContain(r.id);
      expect(Object.prototype.hasOwnProperty.call(PLACEMENT, r.id)).toBe(false);
    }
  });

  it("every placement entry for these surfaces comes from a worksheet row (no stray ids)", () => {
    const known = new Set(ALL.map((r) => r.id));
    // BiomePage.tune.* came from an owner request (2026-10-12), not the worksheet.
    for (const id of Object.keys(PLACEMENT).filter((k) => /^(Settings|Wizard|Plugin|GenPage|BiomePage|GenLib|MakeGen)\./.test(k) && !k.startsWith("BiomePage.tune."))) {
      expect([id, known.has(id)]).toEqual([id, true]);
    }
  });
});

// ── Settings tab: each tagged row is drawn where its placement says ─────────

describe("settings tab rows follow their placement (both settings paths: one set of definitions)", () => {
  type Item = { name?: string; heading?: string; items?: Item[]; visible?: boolean | (() => boolean) };
  const shown = (v: Item["visible"]) => (v === undefined ? true : typeof v === "function" ? v() : v);

  function tab(store: FakeStore) {
    const plugin = { settings: { ...DEFAULT_SETTINGS, maps: [], terrainPalettes: [] }, missingDefaultPalettes: () => ["Overland"] };
    return new HexmakerSettingTab(store as never, plugin as never);
  }

  /** Row names by id, from the source (T("Settings.x", { name: "…" } / folderText("…"). */
  function rowNames(): Map<string, string> {
    const src = read("src", "HexmakerSettingTab.ts");
    const out = new Map<string, string>();
    for (const m of src.matchAll(/T\("(Settings\.[A-Za-z]+)",\s*(?:\{\s*name:\s*("([^"]+)"|GENERATE_WORLD_DATA_NAME)|folderText\(\s*"([^"]+)")/g)) {
      out.set(m[1], m[3] ?? m[4] ?? (m[2] === "GENERATE_WORLD_DATA_NAME" ? GENERATE_WORLD_DATA_NAME : ""));
    }
    return out;
  }

  it("the display() fallback draws getSettingDefinitions()", () => {
    expect(read("src", "HexmakerSettingTab.ts")).toContain("this.renderDefinitions(containerEl, this.getSettingDefinitions())");
  });

  it("main rows above the fold, Advanced rows in Advanced (sub-sections closed until opened), Debug rows in Debug", () => {
    const names = rowNames();
    expect(names.size).toBeGreaterThan(30);
    const store = new FakeStore();
    const defs = tab(store).getSettingDefinitions() as Item[];
    const advanced = defs.find((d) => d.items?.[0]?.name === "Advanced")!;
    const debug = defs.find((d) => d.heading === "Debug")!;
    const above = defs.filter((d) => d !== advanced && d !== debug).flatMap((d) => d.items ?? [d]);
    const find = (list: Item[], name: string) => list.find((i) => i.name === name);
    for (const [id, name] of names) {
      const layer = layerOf(id);
      if (layer === "main" || layer === "more") {
        expect([id, !!find(above, name)]).toEqual([id, true]);
        expect([id, !!find(advanced.items!, name)]).toEqual([id, false]);
      } else if (layer === "advanced") {
        const row = find(advanced.items!, name)!;
        expect([id, !!row]).toEqual([id, true]);
        const sub = subSectionOf(id);
        // Closed Advanced: hidden. Open: shown, or for a sub-section, once that's open too.
        setDisclosureOpen(store, "Settings", false);
        expect([id, shown(row.visible)]).toEqual([id, false]);
        setDisclosureOpen(store, "Settings", true);
        if (sub) {
          setDisclosureOpen(store, subSectionKey("Settings", sub), false);
          expect([id, shown(row.visible)]).toEqual([id, false]);
          setDisclosureOpen(store, subSectionKey("Settings", sub), true);
        }
        expect([id, shown(row.visible) || id === "Settings.addDefaultPalettes"]).toEqual([id, true]);
      } else if (layer === "debug") {
        expect([id, !!find(debug.items!, name)]).toEqual([id, true]);
      }
    }
  });

  it("palettes come first: the simple palette rows are the top section", () => {
    const defs = tab(new FakeStore()).getSettingDefinitions() as Item[];
    expect(defs[0].heading).toBe("Terrain palettes");
    expect(defs[0].items!.map((i) => i.name)).toEqual(["Palette for new maps", "Your palettes"]);
    // Set-once rows come after the simple sections.
    const headings = defs.map((d) => d.heading).filter(Boolean);
    expect(headings.indexOf("Map look")).toBeLessThan(headings.indexOf("Setup"));
    expect(headings.indexOf("Defaults")).toBeLessThan(headings.indexOf("Setup"));
  });

  it("each Advanced sub-section has one header row, Folders first", () => {
    const store = new FakeStore();
    const defs = tab(store).getSettingDefinitions() as Item[];
    const advanced = defs.find((d) => d.items?.[0]?.name === "Advanced")!;
    const subs = [...new Set(Object.keys(PLACEMENT).filter((id) => id.startsWith("Settings.")).map((id) => subSectionOf(id)).filter(Boolean))];
    const order = advanced.items!.map((i) => i.name);
    for (const s of subs) expect(order.filter((n) => n === s)).toHaveLength(1);
    expect(order.indexOf("Palettes")).toBeGreaterThan(order.indexOf("Folders"));
  });
});

// ── Advanced sub-sections: parsing and rendering ────────────────────────────

describe("Advanced sub-sections", () => {
  it("parse: advanced/<Sub> is Advanced plus a sub-section; bad values are nothing", () => {
    expect(parsePlacement("advanced/Engine tuning")).toEqual({ layer: "advanced", sub: "Engine tuning" });
    expect(parsePlacement("advanced/  Paths ")).toEqual({ layer: "advanced", sub: "Paths" });
    expect(parsePlacement("advanced/")).toEqual({ layer: "advanced" });
    expect(parsePlacement("advanced")).toEqual({ layer: "advanced" });
    expect(parsePlacement("debug")).toEqual({ layer: "debug" });
    // Debug sub-sections (biome tuning, owner 2026-10-12).
    expect(parsePlacement("debug/Engine")).toEqual({ layer: "debug", sub: "Engine" });
    expect(parsePlacement("debug/")).toEqual({ layer: "debug" });
    expect(parsePlacement(3)).toBeNull();
  });

  it("partitionSections groups sub-sections in first-used order, plain Advanced apart", () => {
    const map: Record<string, Placement> = { "S.a": "advanced/Two", "S.b": "advanced", "S.c": "advanced/One", "S.d": "advanced/Two", "S.e": "debug", "S.f": "hidden" };
    const items = ["a", "b", "c", "d", "e", "f", "g"].map((x) => ({ id: `S.${x}`, item: x }));
    expect(partitionSections(items, true, map)).toEqual({
      main: ["g"],
      more: [],
      advanced: ["b"],
      subs: [{ name: "Two", items: ["a", "d"] }, { name: "One", items: ["c"] }],
      debug: ["e"],
    });
    expect(partitionSections(items, false, map).debug).toEqual([]);
  });

  /** Just enough DOM for Disclosure: a tree with parents, classes, text, open and listeners. */
  class FakeEl {
    children: FakeEl[] = [];
    parent: FakeEl | null = null;
    open = false;
    root = false;
    private listeners = new Map<string, (() => void)[]>();
    constructor(public tag: string, public cls = "", public text = "") {}
    get isConnected(): boolean {
      for (let e: FakeEl | null = this; e; e = e.parent) if (e.root) return true;
      return false;
    }
    createEl(tag: string, o: { cls?: string; text?: string } = {}): FakeEl {
      const c = new FakeEl(tag, o.cls ?? "", o.text ?? "");
      c.parent = this;
      this.children.push(c);
      return c;
    }
    createDiv(o: { cls?: string; text?: string } = {}): FakeEl {
      return this.createEl("div", o);
    }
    appendChild(c: FakeEl): FakeEl {
      c.remove();
      c.parent = this;
      this.children.push(c);
      return c;
    }
    remove(): void {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    }
    addEventListener(type: string, f: () => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
    }
    fire(type: string): void {
      for (const f of this.listeners.get(type) ?? []) f();
    }
    find(cls: string): FakeEl[] {
      return this.children.flatMap((c) => [...(c.cls.split(" ").includes(cls) ? [c] : []), ...c.find(cls)]);
    }
  }

  function page(store: FakeStore) {
    const host = new FakeEl("div");
    host.root = true;
    const d = new Disclosure(store, "GenPage", () => host as unknown as HTMLElement);
    const put = (id: string) => {
      const el = host.createDiv({ text: id });
      return { el, shown: d.place(id, el as unknown as HTMLElement) };
    };
    return { host, d, put };
  }

  it("renders plain Advanced controls, then each sub-section as a closed nested collapsible, then Debug", () => {
    const store = new FakeStore();
    setDebugMode(store, true);
    const { host, d, put } = page(store);
    put("Nowhere.main");
    put("GenPage.clumping"); // advanced/Engine tuning
    put("GenPage.routeOn"); // advanced/Paths
    put("Settings.generateWorldData"); // plain advanced
    put("GenPage.scatter"); // advanced/Engine tuning again
    put("Settings.biomesFolder"); // debug
    d.toEnd();
    const details = host.find("duckmage-disclosure")[0];
    expect(host.children[host.children.length - 1]).toBe(details);
    expect(host.children[0].text).toBe("Nowhere.main");
    // details: summary, plain body, sub-sections, Debug — in that order.
    expect(details.children.map((c) => c.cls)).toEqual([
      "duckmage-disclosure-summary",
      "duckmage-disclosure-body",
      "duckmage-disclosure-subs",
      "duckmage-disclosure-debug",
    ]);
    expect(details.children[1].children.map((c) => c.text)).toEqual(["Settings.generateWorldData"]);
    const subs = details.children[2].children;
    expect(subs.map((s) => s.tag)).toEqual(["details", "details"]);
    expect(subs.map((s) => s.children[0].text)).toEqual(["Engine tuning", "Paths"]);
    expect(subs.every((s) => s.open === false)).toBe(true);
    expect(subs[0].children[1].children.map((c) => c.text)).toEqual(["GenPage.clumping", "GenPage.scatter"]);
    expect(subs[1].children[1].children.map((c) => c.text)).toEqual(["GenPage.routeOn"]);
    expect(details.children[3].children.map((c) => c.text)).toEqual(["Debug", "Settings.biomesFolder"]);
    setDebugMode(store, false);
  });

  it("remembers each sub-section's open state per surface", () => {
    const store = new FakeStore();
    const first = page(store);
    first.put("GenPage.clumping");
    const sub = first.host.find("duckmage-disclosure-sub")[0];
    sub.open = true;
    sub.fire("toggle");
    expect(disclosureOpen(store, subSectionKey("GenPage", "Engine tuning"))).toBe(true);
    // The dropdown itself stays closed; another surface's sub-section with the same name too.
    expect(disclosureOpen(store, "GenPage")).toBe(false);
    expect(disclosureOpen(store, subSectionKey("BiomePage", "Engine tuning"))).toBe(false);
    // A re-render opens it again.
    const again = page(store);
    again.put("GenPage.clumping");
    expect(again.host.find("duckmage-disclosure-sub")[0].open).toBe(true);
    sub.open = false;
    sub.fire("toggle");
    expect(store.data.has(DISCLOSURE_OPEN_KEY)).toBe(false);
  });

  it("target builds in place for main, in the sub-section for advanced/<Sub>, nowhere for Debug without debug mode", () => {
    const store = new FakeStore();
    const { host, d } = page(store);
    const here = host.createDiv();
    expect(d.target("Nowhere.main", here as unknown as HTMLElement)).toBe(here);
    const box = d.target("GenPage.seed", here as unknown as HTMLElement) as unknown as FakeEl;
    expect(box.cls).toBe("duckmage-disclosure-sub-body");
    expect(box.parent?.children[0].text).toBe("Seed");
    expect(d.target("Settings.biomesFolder", here as unknown as HTMLElement)).toBeNull();
    // section() accepts a sub-section by name too, and returns the same box.
    expect(d.section("advanced/Seed")).toBe(box as unknown as HTMLElement);
  });
});

// ── Generator page, biome page, wizard: placed in the code by id ────────────

describe("generator page and wizard place their controls by id", () => {
  const panel = read("src", "worldgen", "GeneratorPanel.ts");
  const biome = read("src", "overworld", "BiomePanel.ts");
  const wizard = read("src", "SetupWizardView.ts");
  /** Controls that move inside another placed control (and so share its placement). */
  const CARRIED: Record<string, string> = {
    "GenPage.seedLock": "GenPage.seed",
    "GenPage.pathTypeAvoid": "GenPage.pathTypeFold",
    "GenPage.routeOn": "GenPage.pathTypeFold",
    "GenPage.routeCount": "GenPage.pathTypeFold",
    "GenPage.routeAs": "GenPage.pathTypeFold",
    "GenPage.routeWiggle": "GenPage.pathTypeFold",
    "GenPage.routeLength": "GenPage.pathTypeFold",
    "GenPage.routeFollow": "GenPage.pathTypeFold",
  };

  it("every non-main generator control is placed (or carried by one that is, in the same spot)", () => {
    for (const r of ROWS.filter((x) => /^(GenPage|BiomePage)\./.test(x.id) && layerOf(x.id) !== "main")) {
      const carrier = CARRIED[r.id] ?? r.id;
      expect([r.id, PLACEMENT[r.id]]).toEqual([r.id, PLACEMENT[carrier]]);
      const src = carrier.startsWith("BiomePage.") ? biome : panel;
      expect([r.id, src.includes(`place("${carrier}"`)]).toEqual([r.id, true]);
    }
  });

  it("the generator page's Advanced has Engine tuning, Paths and Seed, and no Debug", () => {
    const subs = new Set(Object.keys(PLACEMENT).filter((id) => id.startsWith("GenPage.")).map((id) => subSectionOf(id)));
    expect([...subs].sort()).toEqual(["Engine tuning", "Paths", "Seed"]);
    // Except the biome view's per-biome tuning, which the owner asked for in Debug (2026-10-12).
    expect(Object.keys(PLACEMENT).filter((id) => /^(GenPage|BiomePage)\./.test(id) && layerOf(id) === "debug" && !id.startsWith("BiomePage.tune."))).toEqual([]);
  });

  it("the earlier proof placements are undone: Symmetry, Edge style and the guarantees are main (keep)", () => {
    for (const id of ["GenPage.symmetry", "GenPage.edgeStyle", "GenPage.guaranteedFeatures", "GenPage.connectedLand"]) expect(layerOf(id)).toBe("main");
  });

  it("the wizard's generator options and per-folder paths go in its Advanced dropdowns", () => {
    expect(wizardOptionId("water")).toBe("Wizard.genOptWater");
    expect(wizardOptionId("climate")).toBe("Wizard.genOptClimate");
    expect(wizardOptionId("relief")).toBe("Wizard.genOptRelief");
    expect(wizardOptionId("sea")).toBe("Wizard.genOptSea");
    expect(wizardOptionId("rivers")).toBe("Wizard.genOptOther");
    for (const k of ["water", "climate", "relief", "sea", "rivers"]) expect(layerOf(wizardOptionId(k))).toBe("main"); // owner override 2026-10-12
    expect(wizard).toContain("optsDisclosure.place(wizardOptionId(opt.key), row)");
    expect(wizard).toContain('disclosure.place("Wizard.configureFoldersIndividually", advRow)');
    expect(wizard).toContain('disclosure.place("Wizard.configureFoldersIndividually", advSection)');
  });
});

describe("dropped controls are gone", () => {
  it("the biome page's typed weight box (BiomePage.weightNumber) is removed; the shared share sliders stay", () => {
    const biome = read("src", "overworld", "BiomePanel.ts");
    expect(biome).not.toContain("weight value");
    expect(biome).toContain("renderShareSliders(el, {");
    expect(read("styles.css")).toMatch(/\.duckmage-biome-page-mix \.duckmage-share-sliders-row \{[^}]*grid-template-columns:/);
  });

  it("no drop-tagged id on these surfaces has a placement entry", () => {
    for (const r of ROWS.filter((x) => x.choice === "drop")) expect(Object.prototype.hasOwnProperty.call(PLACEMENT, r.id)).toBe(false);
  });
});

// ── Commands and menus ──────────────────────────────────────────────────────

describe("commands and menus follow their placement", () => {
  const plugin = read("src", "HexmakerPlugin.ts");

  it("every tagged command is registered through addPlaced with its id", () => {
    // Modules' commands are placed through their placementId (src/modules/<id>/runtime.ts).
    const modules = ["world", "world-maps", "space"].map((m) => { try { return read("src", "modules", m, "runtime.ts"); } catch { return ""; } }).join("\n");
    for (const r of ROWS.filter((x) => x.id.startsWith("Plugin.cmd."))) expect([r.id, plugin.includes(`addPlaced("${r.id}"`) || modules.includes(`placementId: "${r.id}"`)]).toEqual([r.id, true]);
    for (const id of ["Plugin.fileMenuExportPdf", "Plugin.fileMenuExportMarkdown"]) expect(plugin).toContain(`id: "${id}"`);
  });

  it("a Debug command is offered only in debug mode, keeping its own check", () => {
    let debug = false;
    let ran = 0;
    const cmd = placeCommand("Plugin.cmd.checkTables", { id: "check-tables", name: "Check tables", callback: () => void ran++ }, () => debug)!;
    expect(cmd.checkCallback!(true)).toBe(false);
    debug = true;
    expect(cmd.checkCallback!(true)).toBe(true);
    cmd.checkCallback!(false);
    expect(ran).toBe(1);
    // Its own check still applies.
    let ok = false;
    const gated = placeCommand("Plugin.cmd.addMapDataToHexNotes", { id: "x", name: "x", checkCallback: () => ok }, () => true)!;
    expect(gated.checkCallback!(true)).toBe(false);
    ok = true;
    expect(gated.checkCallback!(true)).toBe(true);
  });

  it("main and Advanced commands are registered unchanged", () => {
    const c = { id: "open-hex-map", name: "Open hex map", callback: () => {} };
    expect(placeCommand("Plugin.cmd.openHexMap", c, () => false)).toBe(c);
    const e = { id: "export-current-note-pdf", name: "Export current note to PDF", checkCallback: () => true };
    expect(placeCommand("Plugin.cmd.exportNotePdf", e, () => false)).toBe(e);
  });

  type Item = { title?: string; onClick?: (evt?: unknown) => void };
  class FakeMenu {
    items: Item[] = [];
    addItem(cb: (i: unknown) => unknown): this {
      const it: Item = {};
      const api: Record<string, unknown> = {
        setTitle: (t: string) => ((it.title = t), api),
        setIcon: () => api,
        setSection: () => api,
        onClick: (f: (evt?: unknown) => void) => ((it.onClick = f), api),
      };
      this.items.push(it);
      cb(api);
      return this;
    }
  }
  const items = (log: string[]) => [
    { id: "Plugin.fileMenuExportPdf", title: "Export to PDF", short: "PDF", icon: "file-down", run: () => void log.push("pdf") },
    { id: "Plugin.fileMenuExportMarkdown", title: "Export to Markdown", short: "Markdown", icon: "file-text", run: () => void log.push("md") },
  ];

  it("Advanced file-menu items go behind one item that opens them as a second menu where it was clicked", () => {
    const log: string[] = [];
    const menu = new FakeMenu();
    addPlacedMenuItems(menu as never, "Export note", "file-down", items(log), false);
    expect(menu.items.map((i) => i.title)).toEqual(["Export note ▸"]);
    ObsidianMenu.shown = [];
    menu.items[0].onClick!({ clientX: 40, clientY: 50 });
    const sub = ObsidianMenu.shown[ObsidianMenu.shown.length - 1];
    const subItems = sub.items.filter((i): i is ObsidianMenuItem => i !== "separator");
    expect(subItems.map((i) => i.title)).toEqual(["PDF", "Markdown"]);
    subItems[1].click?.();
    expect(log).toEqual(["md"]);
  });

  it("where a submenu opens: the pointer, else the focused element, else the window", () => {
    const win = { innerWidth: 800, innerHeight: 600 };
    expect(eventPos({ clientX: 10, clientY: 20 } as MouseEvent, win)).toEqual({ x: 10, y: 20 });
    const target = { getBoundingClientRect: () => ({ left: 5, bottom: 9, width: 50, height: 20 }) };
    expect(eventPos({ target } as unknown as KeyboardEvent, win)).toEqual({ x: 5, y: 9 });
    expect(eventPos(undefined, win)).toEqual({ x: 400, y: 200 });
  });

  it("no menu code uses the undocumented MenuItem.setSubmenu", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    for (const f of walk("src")) {
      const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n");
      expect([f, /setSubmenu/.test(code)]).toEqual([f, false]);
    }
  });
});

// ── Repair pointers and seeds ───────────────────────────────────────────────

describe("missing tables point to the repair setting", () => {
  it("names the setting where it lives", () => {
    expect(REPAIR_HINT).toContain(`Advanced → ${GENERATE_WORLD_DATA_NAME}`);
    expect(withRepairHint("Table not found: x")).toBe(`Table not found: x. ${REPAIR_HINT}`);
    expect(withRepairHint("No tables found.")).toBe(`No tables found. ${REPAIR_HINT}`);
  });

  it("the settings row is that setting, and the messages that find a missing table use the pointer", () => {
    expect(read("src", "HexmakerSettingTab.ts")).toContain("name: GENERATE_WORLD_DATA_NAME");
    for (const f of [["src", "random-tables", "RollerBlock.ts"], ["src", "random-tables", "RandomTableModal.ts"], ["src", "random-tables", "WorkflowWizardModal.ts"], ["src", "hex-map", "HexEditorModal.ts"]])
      expect([f.join("/"), read(...f).includes("withRepairHint(")]).toEqual([f.join("/"), true]);
  });
});

describe("seeds are kept with what they made", () => {
  it("a generator save stores its seed and shows it", () => {
    const save: GeneratorSave = {
      name: "Coast", version: "1.6.0", format: 1, created: "2026-10-11", generatorName: "Coast", generatorPath: "world/generators/Coast.md",
      palette: "Overland", seed: 4242, cols: 2, rows: 1, stagger: "odd", orientation: "flat", settings: {}, cells: new Map([["0_0", "sea"], ["1_0", "plains"]]),
      paths: [], generatorMarkdown: "x",
    };
    const text = serializeSave(save);
    expect(text).toContain("seed: 4242");
    expect(text).toContain("seed 4242, 2×1");
    const back = parseSave(text);
    expect("save" in back && back.save.seed).toBe(4242);
    // The saves list shows it.
    expect(read("src", "worldgen", "GeneratorPanel.ts")).toContain("· seed ${sv.seed} ·");
  });

  it("a new overworld keeps its seed on the map (seed: in its note), and Generate overworld starts from it", () => {
    const src = read("src", "overworld", "OverworldModals.ts");
    // Its map-note fields come from newOverworldFields (shared with the Biomes scale), seed included.
    expect(src).toMatch(/finishNewOverworld\(this\.plugin, res\.name, this\.result, \{[\s\S]*?seed: this\.seed,/);
    expect(read("src", "overworld", "overworldGen.ts")).toContain("seed: s.seed,");
    expect(src).toContain('if (typeof regen?.seed === "number") this.seed = regen.seed;');
    expect(src).toContain("if (target) target.seed = this.seed;");
  });
});
