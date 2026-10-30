/** A map made with a slice this build doesn't have (owner R4): marked, not opened, not written, nothing dropped. */
import { afterEach, describe, it } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { markHash as buildHash, readSlices, resolveSlices } from "../dev/release/slices.mjs";
import { hasOffSliceKey, isOffSliceKind, markHash } from "../src/maps/offSliceMaps";
import { canDo, guardWrite, setModeMapLookup, setOffSliceCheck } from "../src/modeGate";
import { MapsService } from "../src/services/MapsService";
import { registry } from "../src/modules";
import { readSurface } from "./helpers/source";

describe("telling a map made with a slice built off", () => {
  it("the build and the plugin hash a mark the same way, and only hashes reach a build", () => {
    for (const k of ["world", "explore-fog", "hex-flower-at", "biome-pool"]) expect(markHash(k)).toBe(buildHash(k));
    const marks = resolveSlices({ spec: "none" }).offMapMarks;
    expect(marks).toContain(markHash("explore-fog"));
    expect(marks.every((m) => typeof m === "number")).toBe(true);
    expect(resolveSlices({ spec: "all" }).offMapMarks).toEqual([]);
  });

  it("only a slice built off marks: a slice built on doesn't", () => {
    const off = resolveSlices({ spec: "all", off: "worldmaps" }).offMapMarks;
    expect(off).toContain(markHash("overworld-view"));
    expect(off).not.toContain(markHash("explore-fog"));
  });

  it("a key of a slice built off marks the note; other keys, and no marks, don't", () => {
    const marks = [markHash("explore-fog"), markHash("world")];
    expect(hasOffSliceKey({ palette: "x", "explore-fog": "on" }, marks)).toBe(true);
    expect(hasOffSliceKey({ palette: "x", cols: 3, parent: "p", "region-shape": "hex", "my-own": 1 }, marks)).toBe(false);
    expect(hasOffSliceKey(undefined, marks)).toBe(false);
    expect(hasOffSliceKey({ world: "w" }, [])).toBe(false);
  });

  it("a palette's map-kind off this build marks; a known, blank or odd one doesn't", () => {
    expect(isOffSliceKind("space", ["world"])).toBe(true);
    expect(isOffSliceKind("World", ["world"])).toBe(false);
    expect(isOffSliceKind(undefined, ["world"])).toBe(false);
    expect(isOffSliceKind("  ", ["world"])).toBe(false);
    expect(isOffSliceKind(3, ["world"])).toBe(false);
  });

  it("every map-note key a module owns is marked by its slice", () => {
    const slices = readSlices() as Record<string, { mapMarks?: string[]; modules: string[] }>;
    for (const [id, s] of Object.entries(slices)) {
      for (const moduleId of s.modules) {
        for (const key of registry.module(moduleId)?.owns.mapNoteKeys ?? []) expect({ id, key, marked: s.mapMarks?.includes(key) }).toEqual({ id, key, marked: true });
      }
    }
  });
});

describe("MapsService.isOffSliceMap", () => {
  function service(mapNote: Record<string, unknown>, paletteNote: Record<string, unknown> = {}) {
    const file = (path: string) => Object.assign(Object.create(TFile.prototype) as TFile, { path });
    const notes: Record<string, unknown> = { "h/m/_m.md": mapNote, "w/palettes/P.md": paletteNote };
    return new MapsService({
      app: {
        vault: { getAbstractFileByPath: (p: string) => (p in notes ? file(p) : null) },
        metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: notes[f.path] }) },
      },
      mapStore: { notePath: () => "h/m/_m.md" },
      getMap: () => ({ paletteName: "P" }),
      paletteStore: { notePathOf: () => "w/palettes/P.md" },
    } as never);
  }

  it("follows the palette's map-kind (no slice names in the check)", () => {
    expect(service({}, { "map-kind": "world" }).isOffSliceMap("m")).toBe(false);
    expect(service({}, { "map-kind": "a-kind-from-a-newer-build" }).isOffSliceMap("m")).toBe(true);
    expect(service({}).isOffSliceMap("m")).toBe(false);
  });
});

describe("the gate and the surfaces", () => {
  afterEach(() => {
    setOffSliceCheck(null);
    setModeMapLookup(null);
  });

  it("nothing writes to such a map, in any mode; other maps go on as before", () => {
    setModeMapLookup(() => ({ workMode: "god" }));
    setOffSliceCheck((name) => name === "newer");
    expect(canDo("newer", "paint-terrain")).toBe(false);
    expect(guardWrite("newer", "map-properties")).toBe(false);
    expect(canDo("mine", "paint-terrain")).toBe(true);
  });

  it("the map list marks it, navigation refuses it, the view shows an empty state", () => {
    expect(readSurface("map-view")).toMatch(/isOffSliceMap\(name\)[\s\S]{0,200}can't be opened here/);
    expect(readSurface("map-view")).toMatch(/const offSlice = this\.plugin\.isOffSliceMap\(name\)/);
  });
});
