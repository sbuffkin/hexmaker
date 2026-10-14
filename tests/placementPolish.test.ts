/**
 * Placement polish (2026-10-11): one menu helper, "Advanced · N set"
 * headers, Copy link to this hex in the hex menu, and the Maps modal's
 * background-image row kept together on the main page.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { countSet, Disclosure, setLabel } from "../src/ui/disclosure";
import { setDebugMode, type LocalStore } from "../src/ui/debugMode";
import { advancedTitle, placedRows, rowIsSet, submenuRows } from "../src/ui/placedMenu";
import { layerOf, PLACEMENT } from "../src/ui/placement";
import { ENGINE_TUNING_IDS, engineTuningIsSet } from "../src/worldgen/engineTuningSet";
import { DEFAULT_SETTINGS } from "../packages/hex-wfc/src";
import { readSurface, readSource } from "./helpers/source";


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

/** Just enough DOM for Disclosure, with setText and events. */
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
  setText(t: string): void {
    this.text = t;
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
  get childElementCount(): number {
    return this.children.length;
  }
  get firstElementChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  get parentElement(): FakeEl | null {
    return this.parent;
  }
  insertBefore(c: FakeEl, ref: FakeEl): FakeEl {
    c.remove();
    c.parent = this;
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, c);
    return c;
  }
}

function page(store: FakeStore, surface = "GenPage") {
  const host = new FakeEl("div");
  host.root = true;
  const d = new Disclosure(store, surface, () => host as unknown as HTMLElement);
  const put = (id: string, isSet?: () => boolean) => {
    const el = host.createDiv({ text: id });
    d.place(id, el as unknown as HTMLElement, isSet);
    return el;
  };
  const header = () => host.find("duckmage-disclosure-summary")[0].text;
  const subHeaders = () => host.find("duckmage-disclosure-sub-summary").map((s) => s.text);
  return { host, d, put, header, subHeaders };
}

// ── Round 10: one item isn't worth a dropdown ───────────────────────────────

describe("one-item Advanced dropdowns and sub-sections show inline (owner, round 10)", () => {
  const settled = () => Promise.resolve(); // settle() runs as a microtask after the surface is built

  it("a dropdown left holding one control shows it inline", async () => {
    const { host, put } = page(new FakeStore(), "HexTable");
    const el = put("HexTable.xMin");
    expect(host.find("duckmage-disclosure")).toHaveLength(1);
    await settled();
    expect(host.find("duckmage-disclosure")).toHaveLength(0);
    expect(el.parent).toBe(host);
  });

  it("two controls keep the dropdown", async () => {
    const { host, put } = page(new FakeStore(), "HexTable");
    put("HexTable.xMin");
    put("HexTable.xMax");
    await settled();
    expect(host.find("duckmage-disclosure")).toHaveLength(1);
  });

  it("a one-control sub-section folds into plain Advanced; the dropdown stays when more is in it", async () => {
    const { host, put } = page(new FakeStore(), "GenPage");
    put("GenPage.clumping"); // Engine tuning
    const seed = put("GenPage.seed"); // Seed (only one)
    put("GenPage.edgeSmoothing"); // Engine tuning
    await settled();
    expect(host.find("duckmage-disclosure")).toHaveLength(1);
    expect(host.find("duckmage-disclosure-sub-summary").map((s) => s.text)).toEqual(["Engine tuning"]);
    expect(seed.parent?.cls).toBe("duckmage-disclosure-body");
  });

  it("with Debug in it (debug mode), a single Advanced control keeps the dropdown", async () => {
    const store = new FakeStore();
    setDebugMode(store, true);
    const { host, put } = page(store, "Settings");
    put("Settings.hexFolder");
    put("Settings.biomesFolder"); // Debug
    await settled();
    expect(host.find("duckmage-disclosure")).toHaveLength(1);
    setDebugMode(store, false);
  });
});

// ── 3. "Advanced · N set" ────────────────────────────────────────────────────

describe("Advanced · N set: dropdown headers count the controls that are on", () => {
  it("the label", () => {
    expect(setLabel("Advanced", 0)).toBe("Advanced");
    expect(setLabel("Advanced", 2)).toBe("Advanced · 2 set");
    expect(setLabel("Engine tuning", 1)).toBe("Engine tuning · 1 set");
  });

  it("counts per sub-section and in total; a throwing reporter counts as not set", () => {
    const { total, by } = countSet([
      { where: null, isSet: () => true },
      { where: "Engine tuning", isSet: () => true },
      { where: "Engine tuning", isSet: () => false },
      { where: "Seed", isSet: () => { throw new Error("gone"); } },
    ]);
    expect(total).toBe(2);
    expect(by.get("Engine tuning")).toBe(1);
    expect(by.get("Seed")).toBeUndefined();
  });

  it("the dropdown and each sub-section say how many are set, and update on a change inside", () => {
    const store = new FakeStore();
    const { host, put, header, subHeaders } = page(store);
    let clumping = 4;
    let scatter = DEFAULT_SETTINGS.scatter;
    put("GenPage.clumping", () => clumping !== DEFAULT_SETTINGS.neighbourInfluence);
    put("GenPage.scatter", () => scatter !== DEFAULT_SETTINGS.scatter);
    put("GenPage.seed", () => false);
    put("Settings.generateWorldData"); // reports nothing
    expect(header()).toBe("Advanced · 1 set");
    expect(subHeaders()).toEqual(["Engine tuning · 1 set", "Seed"]);
    // A slider moves: the change bubbles to the dropdown, which re-counts.
    scatter = 5;
    host.find("duckmage-disclosure")[0].fire("change");
    expect(header()).toBe("Advanced · 2 set");
    expect(subHeaders()).toEqual(["Engine tuning · 2 set", "Seed"]);
    clumping = DEFAULT_SETTINGS.neighbourInfluence;
    scatter = DEFAULT_SETTINGS.scatter;
    host.find("duckmage-disclosure")[0].fire("input");
    expect(header()).toBe("Advanced");
    expect(subHeaders()).toEqual(["Engine tuning", "Seed"]);
  });

  it("refreshSet for changes made from outside (a map switch, Clear filters)", () => {
    const store = new FakeStore();
    const { d, put, header } = page(store, "HexTable");
    let on = false;
    put("HexTable.xMin", () => on);
    expect(header()).toBe("Advanced");
    on = true;
    d.refreshSet();
    expect(header()).toBe("Advanced · 1 set");
  });

  it("track counts a control built some other way; main controls and hidden Debug never count", () => {
    const store = new FakeStore();
    const { d, put, header } = page(store, "HexTable");
    put("Nowhere.main", () => true);
    d.track("Nowhere.main", () => true);
    d.track("Settings.biomesFolder", () => true); // Debug, debug mode off
    expect(header).toThrow(); // no dropdown was made at all
    d.track("HexTable.xMin", () => true);
    expect(header()).toBe("Advanced · 1 set");
  });

  it("Debug's title counts its own (debug mode)", () => {
    const store = new FakeStore();
    setDebugMode(store, true);
    const { host, put, header } = page(store, "Settings");
    put("Settings.biomesFolder", () => true);
    expect(header()).toBe("Advanced · 1 set");
    expect(host.find("duckmage-disclosure-debug-title")[0].text).toBe("Debug · 1 set");
    setDebugMode(store, false);
  });

  it("a re-render starts the count again (no stale reporters)", () => {
    const store = new FakeStore();
    const p = page(store, "HexTable");
    p.put("HexTable.xMin", () => true);
    expect(p.header()).toBe("Advanced · 1 set");
    for (const c of [...p.host.children]) c.remove();
    p.put("HexTable.xMin", () => false);
    expect(p.header()).toBe("Advanced");
  });

  it("menus: the Advanced row counts its checked or set rows", () => {
    const noop = () => {};
    expect(rowIsSet({ label: "a", onClick: noop, checked: true })).toBe(true);
    expect(rowIsSet({ label: "a", onClick: noop, checked: true, isSet: false })).toBe(false);
    expect(advancedTitle([{ label: "a", onClick: noop }])).toBe("Advanced ▸");
    expect(advancedTitle([{ label: "a", onClick: noop, isSet: true }, { label: "b", onClick: noop, checked: true }])).toBe("Advanced · 2 set ▸");
  });
});

describe("engine tuning: which controls are off their default", () => {
  const defaults = { ...DEFAULT_SETTINGS };

  it("nothing is set at the engine's defaults", () => {
    for (const id of ENGINE_TUNING_IDS) expect([id, engineTuningIsSet(id, defaults)]).toEqual([id, false]);
  });

  it("each slider counts once it moves", () => {
    const moved: Record<string, Partial<typeof defaults>> = {
      "GenPage.clumping": { neighbourInfluence: 1 },
      "GenPage.edgeSmoothing": { edgeSmoothing: 0.5 },
      "GenPage.removeSmallPatches": { speckSize: 2 },
      "GenPage.keepRare": { keepRare: 0.05 },
      "GenPage.edgeStrength": { edgeStrength: 0.5 },
      "GenPage.directionalBias": { directionalBias: 0.3 },
      "GenPage.scatter": { scatter: 1 },
      "GenPage.spacing": { spacing: 2 },
      "GenPage.randomness": { randomness: 0.5 },
      "GenPage.near": { near: { forest: { terrain: "hills", within: 2 } } as unknown as typeof defaults.near },
      "GenPage.mixStrength": { frequencyFeedback: 3 },
    };
    expect(Object.keys(moved).sort()).toEqual([...ENGINE_TUNING_IDS].sort());
    for (const [id, patch] of Object.entries(moved)) expect([id, engineTuningIsSet(id, { ...defaults, ...patch })]).toEqual([id, true]);
  });

  it("an old generator's single smoothing value counts as set clean-up", () => {
    expect(engineTuningIsSet("GenPage.removeSmallPatches", { ...defaults, smoothing: 0.6 })).toBe(true);
  });

  it("every id is an Engine tuning control, and an unknown id is never set", () => {
    for (const id of ENGINE_TUNING_IDS) expect(PLACEMENT[id]).toBe("advanced/Engine tuning");
    expect(engineTuningIsSet("GenPage.nope", defaults)).toBe(false);
  });
});

describe("Advanced · N set is wired on the surfaces where it's practical", () => {
  const wired: [string[], RegExp][] = [
    [["src", "hex-map", "HexSidePanel.ts"], /disclosure\.place\("LayersMenu\.regionOverlay", regionRow, \(\) => regionCb\.checked\)/],
    [["src", "hex-map", "TokenModal.ts"], /this\.place\("Token\.description", descSetting\.settingEl, \(\) => !!descInput\?\.value\.trim\(\)\)/],
    // (The hex editor's per-section table source left Advanced: owner SF2
    // made the table choice and "change…" part of the section, tests/tablesSolo.test.ts.)
    [["src", "worldgen", "GeneratorPanel.ts"], /engineTuningIsSet\(id, s\(\)\)/],
    [["src", "export", "MapExportModal.ts"], /disclosure\.track\("MapExport\.showRegionOverlay", \(\) => showRegionOverlay\.checked\)/],
    [["src", "hex-map", "MapModal.ts"], /at\(\["MapModal\.propsTerrainTheme"\], \(\) => !!currentMap\?\.terrainType\)/],
    [["src", "hex-map", "MapModal.ts"], /disclosure\.track\("MapModal\.propsRumoursTable"/],
    [["src", "hex-table", "HexTableView.ts"], /disclosure\.place\(id, wrap, \(\) => input\.value !== ""\)/],
    [["src", "random-tables", "RandomTableEditorModal.ts"], /this\.place\("TableEditor\.excludeEncounters", encFilterRow, \(\) => encFilterCb\.checked\)/],
  ];
  for (const [file, re] of wired) it(file.join("/"), () => expect(readSource(...file)).toMatch(re));

  it("state changed from outside re-counts: the overlay sync and Clear filters", () => {
    expect(readSurface("side-panel")).toMatch(/this\.onRegionOverlayChange\(show\);\n\s*this\.layersDisclosure\?\.refreshSet\(\);/);
    expect(readSurface("hex-table")).toMatch(/this\.toolbarDisclosure\?\.refreshSet\(\);/);
  });
});

// ── 1. One menu helper ───────────────────────────────────────────────────────

describe("one menu helper", () => {
  it("the two old helpers are gone", () => {
    expect(existsSync(join("src", "hex-map", "placedMenu.ts"))).toBe(false);
    expect(existsSync(join("src", "ui", "menuLayers.ts"))).toBe(false);
    expect(existsSync(join("src", "ui", "placedMenu.ts"))).toBe(true);
  });

  it("every placed menu imports it", () => {
    for (const f of [
      ["src", "hex-map", "modeMenu.ts"],
      ["src", "hex-map", "PainterContextMenu.ts"],
      ["src", "hex-map", "pathTool.ts"],
      ["src", "hex-map", "MapModal.ts"],
      ["src", "random-tables", "RandomTableView.ts"],
      ["src", "ui", "commandPlacement.ts"],
    ]) expect([f.join("/"), /from "\.\.?\/(ui\/)?placedMenu"/.test(readSource(...f))]).toEqual([f.join("/"), true]);
  });

  it("no main items: Advanced is shown directly; with others, it stays a submenu", () => {
    const noop = () => {};
    const rows = [{ id: "RTView.folderMenuRollPicker", label: "a", onClick: noop }, { id: "RTView.folderMenuEncounters", label: "b", onClick: noop }, { id: "PathType.carveWidth", label: "dbg", onClick: noop }];
    const alone = placedRows(rows, true);
    expect(alone.shown.map((r) => r.label)).toEqual(["a", "b"]);
    expect(submenuRows(alone, noop).map((r) => r.label)).toEqual(["Debug ▸"]);
    const withOthers = placedRows(rows, false, 2);
    expect(withOthers.shown).toEqual([]);
    expect(submenuRows(withOthers, noop).map((r) => r.label)).toEqual(["Advanced ▸"]);
  });

  it("Debug ▸ sits inside Advanced ▸ when both exist", () => {
    const noop = () => {};
    let opened: string[] = [];
    const split = placedRows([{ id: "RTView.folderMenuRollPicker", label: "a", onClick: noop }, { id: "RTView.folderMenuEncounters", label: "b", onClick: noop }, { id: "PathType.carveWidth", label: "dbg", onClick: noop }], true, 1);
    const top = submenuRows(split, (r) => { opened = r.map((x) => x.label); });
    expect(top.map((r) => r.label)).toEqual(["Advanced ▸"]);
    top[0].onClick();
    expect(opened).toEqual(["a", "b", "Debug ▸"]);
  });
});

// ── 5. Background image row ──────────────────────────────────────────────────

describe("Maps modal: the background image row stays together on the main page", () => {
  const src = readSurface("map-modal");
  const body = src.slice(src.indexOf("private renderBackgroundImage("), src.indexOf("private renderBackgroundImage(") + 2500);

  it("Pick image… is in the row with the drop zone and Clear (no Advanced copy)", () => {
    expect(layerOf("MapProps.backgroundImagePicker")).toBe("main");
    expect(Object.prototype.hasOwnProperty.call(PLACEMENT, "MapProps.backgroundImagePicker")).toBe(false);
    expect(src).not.toMatch(/at\(\["MapProps\.backgroundImagePicker"\]\)/);
    expect(body).toMatch(/private renderBackgroundImage\(el: HTMLElement, currentMap: MapData \| undefined\): void/);
    const pick = body.indexOf('bgRow.createEl("button", { text: "Pick image…" })');
    const clear = body.indexOf('bgRow.createEl("button", { text: "Clear" })');
    const drop = body.indexOf("attachImageDropZone(bgRow");
    expect(pick).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(pick);
    expect(drop).toBeGreaterThan(clear);
    // Opacity and Calibrate follow in the same block.
    expect(body).toMatch(/"Opacity"/);
  });
});
