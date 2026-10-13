/**
 * Path tool polish (#48): the "Paths on this map" summary, the right-click
 * menu's order and separator, the rename box's Save state, and hex-by-hex
 * press-and-drag drawing (every hex entered is an anchor; one undo step).
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Notice } from "obsidian";
import type { MapData, MapPath, PathType } from "../src/types";
import {
  extendBranch,
  pathListSummary,
  pathMenuItems,
  PathTool,
  stepBack,
  type PathMenuActions,
} from "../src/hex-map/pathTool";
import { painterMenuEntries } from "../src/hex-map/PainterContextMenu";
import { pathNameState } from "../src/hex-map/PathNameModal";
import { resolvePaths } from "../src/paths/resolve";
import type { RouteContext } from "../src/paths/router";
import { PathsService } from "../src/paths/PathsService";

const ROAD: PathType = { name: "Road", color: "#a33", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" };
const ctx: RouteContext = { orientation: "flat", stagger: "odd", bounds: { minX: 0, minY: 0, maxX: 19, maxY: 15 }, blocked: new Set() };

describe('"Paths on this map" summary (#48)', () => {
  it("ends of the main line, forks and distinct routed hexes, from the resolved routes", () => {
    const p: MapPath = { name: "Road 3", typeName: "Road", branches: [{ anchors: ["3_4", "9_4"] }, { anchors: ["6_4", "6_9"] }, { anchors: ["7_4", "7_1"] }] };
    const resolved = resolvePaths([p], ctx);
    const hexes = new Set(resolved.flatMap((r) => r.hexes));
    expect(pathListSummary(p, resolved)).toBe(`3, 4 → 9, 4 · 2 forks · ${hexes.size} hexes`);
  });

  it("one fork, singular; no forks, none mentioned; other paths' routes don't count", () => {
    const a: MapPath = { name: "Road 2", typeName: "Road", branches: [{ anchors: ["0_0", "3_0"] }, { anchors: ["1_0", "1_3"] }] };
    const b: MapPath = { name: "Road 4", typeName: "Road", branches: [{ anchors: ["0_8", "5_8"] }] };
    const resolved = resolvePaths([a, b], ctx);
    expect(pathListSummary(a, resolved)).toMatch(/^0, 0 → 3, 0 · 1 fork · \d+ hexes$/);
    expect(pathListSummary(b, resolved)).toBe("0, 8 → 5, 8 · 6 hexes");
  });

  it("before the routes are resolved: the main line's anchors, no size", () => {
    const p: MapPath = { name: "Road 5", typeName: "Road", branches: [{ anchors: ["2_2", "4_4", "8_1"] }] };
    expect(pathListSummary(p, [])).toBe("2, 2 → 8, 1");
    expect(pathListSummary({ name: "Lone", typeName: "Road", branches: [{ anchors: ["1_1"] }] }, [])).toBe("1, 1");
  });

  it("says what the map note's Route column says, warnings included", () => {
    const p: MapPath = { name: "Old Way", typeName: "Causeway", branches: [{ anchors: ["0_0", "2_0"] }] };
    expect(pathListSummary(p, resolvePaths([p], ctx), ["Road", "River"])).toMatch(/^0, 0 → 2, 0 · 3 hexes · ⚠/);
  });

  it("never renames: the summary is beside the name, not part of it", () => {
    const p: MapPath = { name: "Road 6", typeName: "Road", branches: [{ anchors: ["0_0", "2_0"] }] };
    expect(pathListSummary(p, resolvePaths([p], ctx))).not.toContain("Road 6");
  });
});

describe("right-click menu: path items first, a separator, then the tool's (#48)", () => {
  const noop = () => {};
  const acts: PathMenuActions = { split: noop, deleteBranch: noop, deletePath: noop, rename: noop, changeType: noop, reverse: noop };

  it("path items in order: Rename…, Delete path, Change type…, Delete this fork, then Split here and Reverse (Advanced)", () => {
    const forked: MapPath = { name: "King's Road", typeName: "Road", branches: [{ anchors: ["0_0", "4_0"] }, { anchors: ["2_0", "2_4"] }] };
    expect(pathMenuItems(forked, 1, acts).map((i) => i.label)).toEqual([
      "Rename…", "Delete path: King's Road", "Change type…", "Delete this fork", "Split here", "Reverse",
    ]);
    expect(pathMenuItems(forked, 0, acts)[3].label).toBe("Delete main line");
    const single: MapPath = { name: "Road", typeName: "Road", branches: [{ anchors: ["0_0", "4_0"] }] };
    expect(pathMenuItems(single, 0, acts).map((i) => i.label)).toEqual(["Rename…", "Delete path: Road", "Change type…", "Split here", "Reverse"]);
  });

  it("the tool's items follow a separator; with no path under the pointer there's no separator", () => {
    const lead = [{ label: "Split here", onClick: noop }, { label: "Reverse", onClick: noop }];
    const extra = [{ label: "Erase mode", onClick: noop }];
    const rows = painterMenuEntries(lead, noop, "Switch path type", noop, extra);
    expect(rows.map((r) => ("separator" in r ? "---" : r.label))).toEqual([
      "Split here", "Reverse", "---", "Switch path type", "Exit tool", "Erase mode",
    ]);
    const plain = painterMenuEntries([], null, "Switch", noop, extra);
    expect(plain.map((r) => ("separator" in r ? "---" : r.label))).toEqual(["Exit tool", "Erase mode"]);
  });
});

describe("rename box: Save is disabled with a reason while the name is empty or taken (#48)", () => {
  const taken = (n: string) => (n.toLowerCase() === "road 2" ? `There's already a path called ${n} on this map.` : null);

  it("taken or empty: no name, a reason", () => {
    expect(pathNameState("Road 2", "Road 3", taken)).toEqual({ name: null, problem: "There's already a path called Road 2 on this map." });
    expect(pathNameState("   ", "Road 3", taken)).toEqual({ name: null, problem: "A path needs a name." });
  });

  it("free, or unchanged: the cleaned name, no reason", () => {
    expect(pathNameState("  King's   Road ", "Road 3", taken)).toEqual({ name: "King's Road", problem: null });
    expect(pathNameState("Road 3", "Road 3", taken)).toEqual({ name: "Road 3", problem: null });
  });
});

describe("drawing helpers (pure)", () => {
  const p: MapPath = { name: "R", typeName: "Road", branches: [{ anchors: ["2_2", "3_2"] }] };

  it("extendBranch adds at the tail, or before the head", () => {
    expect(extendBranch(p, 0, "tail", "4_2", ["4_2"]).branches[0].anchors).toEqual(["2_2", "3_2", "4_2"]);
    expect(extendBranch(p, 0, "head", "1_2", ["2_2"]).branches[0].anchors).toEqual(["1_2", "2_2", "3_2"]);
    expect(p.branches[0].anchors).toEqual(["2_2", "3_2"]);
  });

  it("stepBack drops the end only when re-entering the hex before it, and only anchors the drag added", () => {
    expect(stepBack(p, 0, "tail", "2_2", 1)?.branches[0].anchors).toEqual(["2_2"]);
    expect(stepBack(p, 0, "tail", "2_2", 2)).toBeNull();
    expect(stepBack(p, 0, "tail", "5_5", 0)).toBeNull();
    expect(stepBack(p, 0, "head", "3_2", 1)?.branches[0].anchors).toEqual(["3_2"]);
  });
});

describe("anchor handles sit over the icon layers (#48)", () => {
  const root = process.cwd();
  const css = readFileSync(path.join(root, "styles.css"), "utf8").replace(/\r\n/g, "\n");
  const view = readFileSync(path.join(root, "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
  const z = (cls: string) => Number(new RegExp(`\\.${cls} \\{[^}]*z-index: (\\d+)`).exec(css)?.[1]);

  it("their own layer stacks above the paths and the elevated override / GM icon layer", () => {
    expect(z("duckmage-path-handles-svg")).toBeGreaterThan(z("duckmage-path-icons-svg"));
    expect(z("duckmage-path-handles-svg")).toBeGreaterThan(z("duckmage-path-svg"));
    expect(css).toMatch(/\.duckmage-path-handles-svg \{[^}]*pointer-events: none/);
  });

  it("the view draws handles and the active-end dot there, not in the path layer", () => {
    const body = view.slice(view.indexOf("  private renderPathOverlay("), view.indexOf("  private updatePathIcons("));
    const handlesAt = body.indexOf('emSvg("duckmage-path-handles-svg")');
    expect(handlesAt).toBeGreaterThan(body.indexOf('emSvg("duckmage-path-svg")'));
    expect(body.slice(handlesAt)).toMatch(/duckmage-svg-path-handle[\s\S]*if \(dot\)/);
  });

  it("a press the tool takes stops the browser's image drag (a press on a hex icon still drags)", () => {
    const tool = readFileSync(path.join(root, "src", "hex-map", "pathTool.ts"), "utf8").replace(/\r\n/g, "\n");
    const down = tool.slice(tool.indexOf("  pointerDown(e: MouseEvent"), tool.indexOf("  // ── hex-by-hex press-and-drag drawing ──"));
    expect(down.match(/e\.preventDefault\(\);\s*return true;/g)).toHaveLength(2);
  });
});

// ── The controller, against an in-memory map ────────────────────────────────

type Listener = (e: unknown) => void;

function rig() {
  const map = { name: "m", paletteName: "Default", gridSize: { cols: 20, rows: 16 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd", paths: [] as MapPath[] } as unknown as MapData;
  const svc = new PathsService({
    isMapReady: () => true,
    getMap: (n) => (n === "m" ? map : undefined),
    orientation: () => "flat",
    stagger: () => "odd",
    pathTypes: () => [ROAD],
    palette: () => [],
    hexData: () => new Map(),
  });
  const plugin = {
    app: {},
    mapStore: { paths: () => map.paths ?? [], setPaths: (_n: string, ps: MapPath[]) => { map.paths = ps; } },
    paths: svc,
    saveSettings: async () => {},
    getMapPalette: () => [],
  };
  const listeners = new Map<string, Set<Listener>>();
  const doc = {
    addEventListener: (t: string, f: Listener) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f); },
    removeEventListener: (t: string, f: Listener) => { listeners.get(t)?.delete(f); },
  };
  const undo: { before: MapPath[]; after: MapPath[] }[] = [];
  const tool = new PathTool({
    plugin: plugin as never,
    mapName: () => "m",
    pointerLattice: () => null,
    // A hex is 100 px square here: (x, y) ↔ (100x, 100y).
    hexAtPoint: (cx, cy) => `${Math.round(cx / 100)}_${Math.round(cy / 100)}`,
    ownerDocument: () => doc as unknown as Document,
    pushUndo: (_m, before, after) => { undo.push({ before, after }); },
    redraw: () => {},
    refreshBar: () => {},
    setGrabCursor: () => {},
  });
  tool.typeName = "Road";
  const at = (hex: string) => { const [x, y] = hex.split("_").map(Number); return { clientX: x * 100, clientY: y * 100 }; };
  const ev = (hex: string, o: Record<string, unknown> = {}) => ({ button: 0, altKey: false, preventDefault: () => {}, ...at(hex), ...o }) as unknown as MouseEvent;
  const fire = (t: string, e: unknown) => { for (const f of [...(listeners.get(t) ?? [])]) f(e); };
  /** Press at the first hex, move through the rest, release. */
  const drag = (hexes: string[]) => {
    const took = tool.pointerDown(ev(hexes[0]), false);
    for (const h of hexes.slice(1)) fire("mousemove", ev(h));
    fire("mouseup", ev(hexes[hexes.length - 1]));
    flushFrames();
    return took;
  };
  return { map, tool, undo, drag, ev, listeners };
}

const frames: (() => void)[] = [];
function flushFrames() { while (frames.length) frames.shift()!(); }
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.requestAnimationFrame = (cb: () => void) => { frames.push(cb); return frames.length; };
g.cancelAnimationFrame = () => {};

describe("hex-by-hex press-and-drag (#48)", () => {
  beforeEach(() => { Notice.shown = []; });

  it("every hex entered becomes an anchor, and the whole drag is one undo step", () => {
    const { map, tool, undo, drag } = rig();
    expect(drag(["2_2", "3_2", "4_2", "5_2", "6_2"])).toBe(true);
    expect(map.paths).toEqual([{ name: "Road", typeName: "Road", branches: [{ anchors: ["2_2", "3_2", "4_2", "5_2", "6_2"] }] }]);
    expect(undo).toHaveLength(1);
    expect(undo[0].before).toEqual([]);
    expect(undo[0].after).toEqual(map.paths);
    expect(tool.selected).toBe("Road");
    expect(tool.active).toEqual({ branch: 0, end: "tail" });
    expect(Notice.shown).toEqual([]);
  });

  it("the click that ends a drag doesn't add another anchor", () => {
    const { map, tool, undo, drag, ev } = rig();
    drag(["2_2", "3_2", "4_2"]);
    tool.click(4, 2, ev("4_2"), false);
    expect(map.paths![0].branches[0].anchors).toEqual(["2_2", "3_2", "4_2"]);
    expect(undo).toHaveLength(1);
  });

  it("dragging on from the active end extends the branch, one more undo step", () => {
    const { map, undo, drag } = rig();
    drag(["2_2", "3_2", "4_2"]);
    drag(["4_2", "5_2", "6_2"]);
    expect(map.paths![0].branches[0].anchors).toEqual(["2_2", "3_2", "4_2", "5_2", "6_2"]);
    expect(undo).toHaveLength(2);
  });

  it("stepping back into the previous hex takes the last anchor away again", () => {
    const { map, drag } = rig();
    drag(["2_2", "3_2", "4_2", "5_2", "4_2"]);
    expect(map.paths![0].branches[0].anchors).toEqual(["2_2", "3_2", "4_2"]);
  });

  it("a press without leaving the hex is a click (nothing is committed by the drag)", () => {
    const { map, undo, drag } = rig();
    drag(["2_2"]);
    expect(map.paths).toEqual([]);
    expect(undo).toHaveLength(0);
  });

  it("auto-route mode doesn't drag-draw (dragging reshapes a selected path, as before)", () => {
    const { map, tool, undo, drag } = rig();
    tool.setAutoRoute(true);
    expect(drag(["2_2", "3_2", "4_2"])).toBe(false);
    expect(map.paths).toEqual([]);
    expect(undo).toHaveLength(0);
  });

  it("Esc mid-drag cancels it: nothing is saved", () => {
    const { map, tool, ev, listeners } = rig();
    tool.pointerDown(ev("2_2"), false);
    for (const f of [...(listeners.get("mousemove") ?? [])]) f(ev("3_2"));
    expect(tool.escape()).toBe(true);
    expect(map.paths).toEqual([]);
    expect(listeners.get("mousemove")?.size ?? 0).toBe(0);
  });

  it("Esc with no drag leaves the tool, mid-branch or after Done; the points stay (fresh-eyes F13)", () => {
    const { map, tool, drag } = rig();
    drag(["2_2", "3_2", "4_2"]);
    expect(tool.isDrawing()).toBe(true);
    expect(tool.escape()).toBe(false);
    tool.done();
    expect(tool.selected).toBe("Road");
    expect(tool.escape()).toBe(false);
    expect(map.paths![0].branches[0].anchors).toEqual(["2_2", "3_2", "4_2"]);
  });

  it("the map view leaves any tool on Esc once the path tool says there's no drag to cancel", () => {
    const src = readFileSync(path.join(process.cwd(), "src/hex-map/HexMapView.ts"), "utf8");
    const esc = src.slice(src.indexOf('this.scope.register([], "Escape"'), src.indexOf('for (const key of ["Backspace", "Delete"])'));
    expect(esc).toContain("this.pathTool.escape()");
    expect(esc).toContain("this.exitCurrentMode();");
  });
});
