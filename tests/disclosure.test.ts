import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LAYERS, PLACEMENT, idsOn, isShown, layerOf, partition, type Layer } from "../src/ui/placement";
import {
  DEBUG_CONFIRMED_KEY,
  DEBUG_MODE_KEY,
  debugModeConfirmed,
  isDebugMode,
  markDebugModeConfirmed,
  onDebugModeChange,
  setDebugMode,
  type LocalStore,
} from "../src/ui/debugMode";
import { DISCLOSURE_OPEN_KEY, disclosureOpen, setDisclosureOpen } from "../src/ui/disclosure";
import { DEFAULT_SETTINGS } from "../src/constants";
import { HexmakerSettingTab } from "../src/HexmakerSettingTab";

/** Obsidian's per-vault local storage, in memory. */
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

describe("placement map", () => {
  it("unlisted ids are main; listed ones keep their layer", () => {
    expect(layerOf("Settings.hexGap")).toBe("main");
    expect(layerOf("Nowhere.atAll")).toBe("main");
    expect(layerOf("Settings.hexFolder")).toBe("advanced");
    expect(layerOf("Settings.generateWorldData")).toBe("advanced");
    expect(layerOf("Settings.biomesFolder")).toBe("debug");
    expect(layerOf("GenPage.clumping")).toBe("debug");
    expect(layerOf("GenPage.symmetry")).toBe("advanced");
    // Not a prototype key or a bad value.
    expect(layerOf("toString")).toBe("main");
    expect(layerOf("X.y", { "X.y": "sideways" as Layer })).toBe("main");
  });

  it("every listed layer is a real one, and ids look like <Surface>.<control>", () => {
    for (const [id, layer] of Object.entries(PLACEMENT)) {
      expect(LAYERS).toContain(layer);
      expect(id).toMatch(/^[A-Z][A-Za-z]+\.[a-z][A-Za-z0-9]*$/);
    }
  });

  it("moving a control is one entry: a custom map overrides the default", () => {
    expect(layerOf("Settings.hexGap", { "Settings.hexGap": "advanced" })).toBe("advanced");
    expect(layerOf("Settings.hexFolder", {})).toBe("main");
  });

  it("the proof placements: folders and setup tools Advanced, storage plumbing and engine tuning Debug", () => {
    expect(idsOn("advanced").filter((id) => id.startsWith("Settings."))).toContain("Settings.worldFolder");
    // The setup tools are in the README's manual setup, so Advanced, not Debug.
    expect(idsOn("advanced")).toEqual(expect.arrayContaining(["Settings.generateFolders", "Settings.generateWorldData"]));
    expect(idsOn("debug")).toEqual(expect.arrayContaining(["Settings.biomesFolder", "Settings.biomePoolsFolder", "Settings.worldTypesFolder", "GenPage.scatter", "GenPage.mixStrength"]));
    // Customisation is not "advanced" (rule 5): the custom icons folder stays main.
    expect(layerOf("Settings.iconsFolder")).toBe("main");
  });

  it("isShown: hidden never, debug only in debug mode", () => {
    const map = { "A.hid": "hidden", "A.dbg": "debug", "A.adv": "advanced" } as Record<string, Layer>;
    expect(isShown("A.hid", true, map)).toBe(false);
    expect(isShown("A.dbg", false, map)).toBe(false);
    expect(isShown("A.dbg", true, map)).toBe(true);
    expect(isShown("A.adv", false, map)).toBe(true);
    expect(isShown("A.other", false, map)).toBe(true);
  });

  it("partition keeps order within each layer and drops hidden (and debug when off)", () => {
    const map = { "S.b": "advanced", "S.c": "debug", "S.d": "hidden", "S.e": "more", "S.f": "advanced" } as Record<string, Layer>;
    const items = ["a", "b", "c", "d", "e", "f"].map((x) => ({ id: `S.${x}`, item: x }));
    expect(partition(items, true, map)).toEqual({ main: ["a"], more: ["e"], advanced: ["b", "f"], debug: ["c"] });
    expect(partition(items, false, map).debug).toEqual([]);
  });
});

describe("debug mode", () => {
  it("lives in local storage only, off by default, and off removes the key", () => {
    const store = new FakeStore();
    expect(isDebugMode(store)).toBe(false);
    setDebugMode(store, true);
    expect(isDebugMode(store)).toBe(true);
    expect([...store.data.keys()]).toEqual([DEBUG_MODE_KEY]);
    setDebugMode(store, false);
    expect(isDebugMode(store)).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it("is never a data.json setting", () => {
    const keys = Object.keys(DEFAULT_SETTINGS).map((k) => k.toLowerCase());
    expect(keys.filter((k) => k.includes("debug"))).toEqual([]);
    const types = readFileSync(join("src", "types.ts"), "utf8");
    expect(types).not.toMatch(/debug/i);
  });

  it("tells listeners when it changes (not when it's set to what it is)", () => {
    const store = new FakeStore();
    const seen: boolean[] = [];
    const stop = onDebugModeChange((on) => seen.push(on));
    setDebugMode(store, true);
    setDebugMode(store, true);
    setDebugMode(store, false);
    stop();
    setDebugMode(store, true);
    expect(seen).toEqual([true, false]);
  });

  it("the one-time confirmation is remembered per device", () => {
    const store = new FakeStore();
    expect(debugModeConfirmed(store)).toBe(false);
    markDebugModeConfirmed(store);
    expect(debugModeConfirmed(store)).toBe(true);
    expect(store.data.has(DEBUG_CONFIRMED_KEY)).toBe(true);
  });

  it("no command, ribbon or menu turns it on: only the settings tab calls setDebugMode(…, true)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && /setDebugMode\([^)]*,\s*(true|on)\)/.test(readFileSync(p, "utf8"))) hits.push(p.replace(/\\/g, "/"));
      }
    };
    walk("src");
    expect(hits.sort()).toEqual(["src/HexmakerSettingTab.ts"]);
  });
});

describe("Advanced dropdown open state", () => {
  it("is remembered per surface", () => {
    const store = new FakeStore();
    expect(disclosureOpen(store, "Settings")).toBe(false);
    setDisclosureOpen(store, "Settings", true);
    setDisclosureOpen(store, "GenPage", true);
    expect(disclosureOpen(store, "Settings")).toBe(true);
    setDisclosureOpen(store, "Settings", false);
    expect(disclosureOpen(store, "Settings")).toBe(false);
    expect(disclosureOpen(store, "GenPage")).toBe(true);
    setDisclosureOpen(store, "GenPage", false);
    expect(store.data.has(DISCLOSURE_OPEN_KEY)).toBe(false);
  });
});

describe("feature level is gone", () => {
  const RETIRED = ["featureLevel", "advancedFeatures", "dismissedHints", "installedAt", "advancedNudgeAt", "advancedNudgeOff"];

  it("no default, and the modules are deleted", () => {
    for (const k of RETIRED) expect(Object.keys(DEFAULT_SETTINGS)).not.toContain(k);
    expect(existsSync(join("src", "featureLevel.ts"))).toBe(false);
    expect(existsSync(join("src", "advancedHints.ts"))).toBe(false);
  });

  it("nothing in src reads or writes the level, the switches or the hints", () => {
    const pattern = new RegExp(`\\b(${[...RETIRED, "hasFeature", "isAdvanced", "withFeature", "EnableFeatureModal", "AdvancedNudgeModal", "shouldNudge"].join("|")})\\b`);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|md)$/.test(p)) {
          readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
            // HexTableView's "Has Feature" filter is a local variable, not the gate.
            if (pattern.test(line) && !/const hasFeature =|filterHasFeature|dataset\.hasFeature/.test(line)) hits.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });
});

describe("settings definitions (Obsidian 1.13+)", () => {
  type Item = { name?: string; type?: string; heading?: string; items?: Item[]; visible?: boolean | (() => boolean) };

  function tabWith(store: FakeStore) {
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, maps: [], terrainPalettes: [] },
      missingDefaultPalettes: () => [],
    };
    const app = store as unknown;
    return new HexmakerSettingTab(app as never, plugin as never);
  }

  const names = (items: Item[]): string[] => items.flatMap((i) => (i.items ? names(i.items) : [i.name ?? ""]));
  const shown = (v: Item["visible"]) => (v === undefined ? true : typeof v === "function" ? v() : v);

  it("end with the debug-mode switch, after the Advanced dropdown", () => {
    const defs = tabWith(new FakeStore()).getSettingDefinitions() as Item[];
    const last = defs[defs.length - 1];
    expect(last.items?.map((i) => i.name)).toEqual(["Debug mode"]);
    const all = names(defs);
    expect(all[all.length - 1]).toBe("Debug mode");
    expect(all.indexOf("Advanced")).toBeGreaterThan(all.indexOf("Palette for new maps"));
    expect(all).not.toContain("Feature level");
  });

  it("put folders and setup tools in Advanced (collapsed) and storage plumbing in Debug (debug mode only)", () => {
    const store = new FakeStore();
    let defs = tabWith(store).getSettingDefinitions() as Item[];
    const advanced = defs.find((d) => d.items?.[0]?.name === "Advanced")!;
    const folders = advanced.items!.find((i) => i.name === "Hex notes folder")!;
    expect(folders).toBeDefined();
    // Main settings stay above the fold.
    expect(defs.some((d) => d.name === "Hex cell spacing")).toBe(true);
    expect(defs.some((d) => d.name === "Hex notes folder")).toBe(false);
    // Collapsed until opened.
    expect(shown(folders.visible)).toBe(false);
    setDisclosureOpen(store, "Settings", true);
    expect(shown(folders.visible)).toBe(true);
    // Debug: only while debug mode is on (and Advanced is open).
    defs = tabWith(store).getSettingDefinitions() as Item[];
    const debug = defs.find((d) => d.heading === "Debug")!;
    expect(names(debug.items!)).toEqual(expect.arrayContaining(["Biomes folder", "Biome pools folder", "World types folder"]));
    expect(names(advanced.items!)).toEqual(expect.arrayContaining(["Generate terrain tables & hex links", "Set up folders"]));
    expect(shown(debug.visible)).toBe(false);
    setDebugMode(store, true);
    expect(shown(debug.visible)).toBe(true);
    setDebugMode(store, false);
  });
});
