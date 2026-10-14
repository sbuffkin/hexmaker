import { describe, it } from "node:test";
import expect from "expect";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Menu, MenuItem } from "obsidian";
import { layerOf, type Layer } from "../src/ui/placement";
import { ADVANCED_SUBMENU, DEBUG_SUBMENU, placedRows, submenuRows } from "../src/ui/placedMenu";
import { painterMenuEntries } from "../src/hex-map/PainterContextMenu";
import { pathMenuItems } from "../src/hex-map/pathTool";
import { ModeMenu } from "../src/hex-map/modeMenu";
import {
  ADD_REGION_LOCKED_HINT,
  GOD_OFFER,
  godOfferText,
  lockedHint,
  lockedSummary,
  MODE_ACTIONS,
  needsGod,
  PLACE_LOCKED_HINT,
  RESHAPE_LOCKED_HINT,
  REROLL_PLACE_LOCKED_HINT,
  WORK_MODES, WORK_MODE_TEXT,
  type WorkMode,
} from "../src/workMode";
import { BIOME_LOCKED_HINT, PAINT_LOCKED_HINT } from "../src/overworld/overworldInput";
import { REGENERATE_LOCKED_HINT } from "../src/overworld/overworldGen";
import { CONFIRM_LOCKED_HINT } from "../src/overworld/overworldPaths";
import { PATH_EDIT_LOCKED_HINT } from "../src/paths/editGate";
import { hexLinkLabel, hexMarkdownLink, mapLinkUri, OPEN_MAP_ACTION, parseMapLinkParams, type MapLinkTarget } from "../src/hexLink";
import type { MapPath } from "../src/types";

/**
 * The owner's UI worksheet (2026-10-11) for the map surfaces: hex map view,
 * hex editor, hex table, map pickers and editors, confirm dialogs. Every
 * resolved tag is honoured by the placement map and by the code.
 */
interface Resolved { id: string; group: string; choice: "keep" | "simple" | "advanced" | "overkill" | "drop" }
const resolved = JSON.parse(readFileSync(join("dev", "ui-inventory", "inputs-tags-resolved.json"), "utf8")) as Resolved[];
const SURFACES = ["Hex map view", "Hex editor", "Hex table", "Map pickers & editors", "Confirm dialogs"];
const mine = resolved.filter((r) => SURFACES.includes(r.group));

const TIER: Record<Resolved["choice"], Layer> = { keep: "main", simple: "main", advanced: "advanced", overkill: "debug", drop: "hidden" };
/** Owner notes that override a tag: the centre dot now copies a hex link, so it stays (main). */
// God goes back in the mode menu's list (owner 2026-10-12: "don't put god mode in advanced").
// Round 10 (owner 2026-10-12): one-item Advanced sections moved to the basic options.
const ROUND10_MAIN = ["ModeBar.crossImpassable", "PathMenu.splitHere", "PathMenu.reverse", "LayersMenu.regionOverlay", "TerrainFilter.typeRow", "Token.description", "PathPicker.pathsOnMap", "PathType.carves"];
// Owner SF2 (2026-10-14): a section's table choice and "change…" sit in the
// section itself (main); the per-source Advanced items were replaced by it.
const SF2_MAIN = ["HexEditor.weatherSource", "HexEditor.hooksSource", "HexEditor.rolledSetMapTable", "HexEditor.rolledSetHexTable"];
const OVERRIDES: Record<string, Layer> = {
  "HexEditor.neighborCentreDot": "main",
  ...Object.fromEntries(SF2_MAIN.map((id) => [id, "main" as Layer])),
  "WorkModeMenu.god": "main",
  ...Object.fromEntries(ROUND10_MAIN.map((id) => [id, "main" as Layer])),
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const codeText = sources("src")
  .filter((p) => !p.replace(/\\/g, "/").endsWith("src/ui/placement.ts"))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");
const read = (p: string) => readFileSync(p, "utf8");

describe("map surfaces: every resolved tag is honoured", () => {
  it("covers the five surfaces", () => {
    expect(mine.length).toBeGreaterThan(400);
  });

  for (const r of mine) {
    const want = OVERRIDES[r.id] ?? TIER[r.choice];
    it(`${r.id} (${r.choice}) → ${want}`, () => {
      expect(layerOf(r.id)).toBe(want);
      // Advanced and Debug controls are placed by id in the code.
      if (want === "advanced" || want === "debug") expect(codeText).toContain(r.id);
    });
  }
});

describe("dropped controls are gone", () => {
  const view = read("src/hex-map/HexMapView.ts");
  it("PainterMenu.newPath: no New path in the tool's right-click menu (the mode bar keeps it)", () => {
    expect(view).not.toMatch(/extra\.push\(\{ label: "New path"/);
    expect(read("src/hex-map/pathTool.ts")).toMatch(/text: "New path"/);
  });
  it("MapView.dblRightClickExit and dblClickOffGridExit: no double-click exits", () => {
    expect(view).not.toMatch(/lastToolContextMenuAt|isDouble/);
    expect(view).not.toMatch(/registerDomEvent\(contentEl, "dblclick"/);
  });
  it("Locations.openButton: rows open by name, with no Open button", () => {
    expect(read("src/hex-map/LocationsModal.ts")).not.toMatch(/text: "Open"/);
  });
});

describe("menus and toolbars: Advanced ▸ and Debug ▸ submenus", () => {
  const noop = () => {};
  const branchy = { name: "Road", branches: [{}, {}] } as unknown as MapPath;
  const acts = { split: noop, deleteBranch: noop, deletePath: noop, rename: noop, changeType: noop, reverse: noop };

  it("path menu: Split here and Reverse are in the menu itself, no Advanced ▸ (round 10)", () => {
    const rows = painterMenuEntries(pathMenuItems(branchy, 1, acts), noop, "Switch path type", noop, [{ label: "Erase mode", onClick: noop }]);
    const labels = rows.map((r) => ("separator" in r ? "---" : r.label));
    expect(labels).toEqual(expect.arrayContaining(["Rename…", "Split here", "Reverse"]));
    expect(labels).not.toContain(ADVANCED_SUBMENU);
  });

  it("one Advanced row is shown inline; two or more make an Advanced ▸ submenu (round 10)", () => {
    const map = { "T.a": "advanced", "T.b": "advanced" } as const;
    const one = placedRows([{ id: "T.a", label: "a", onClick: noop }, { label: "plain", onClick: noop }], false, 0, map);
    expect(one.shown.map((r) => r.label)).toEqual(["plain", "a"]);
    expect(one.advanced).toEqual([]);
    const two = placedRows([{ id: "T.a", label: "a", onClick: noop }, { id: "T.b", label: "b", onClick: noop }, { label: "plain", onClick: noop }], false, 0, map);
    expect(two.shown.map((r) => r.label)).toEqual(["plain"]);
    let opened: string[] = [];
    submenuRows(two, (sub) => { opened = sub.map((r) => r.label); })[0].onClick();
    expect(opened).toEqual(["a", "b"]);
  });

  it("Debug ▸ exists only in debug mode; hidden rows are left out", () => {
    const rows = [{ id: "PathType.carveWidth", label: "dbg", onClick: noop }, { id: "PainterMenu.newPath", label: "gone", onClick: noop }, { label: "plain", onClick: noop }];
    const off = placedRows(rows, false);
    expect(off.shown.map((r) => r.label)).toEqual(["plain"]);
    expect(submenuRows(off, noop).map((r) => r.label)).toEqual([]);
    const on = placedRows(rows, true);
    expect(submenuRows(on, noop).map((r) => r.label)).toEqual([DEBUG_SUBMENU]);
  });

  it("the mode switch: Play, Build and God in one list, no Advanced ▸ (owner 2026-10-12)", () => {
    Menu.shown = [];
    const menu = new ModeMenu("build");
    for (const m of WORK_MODES) menu.add("mode.switch", m, null, noop, { checked: m === "build", place: `WorkModeMenu.${m}` });
    menu.showAtPosition({ x: 0, y: 0 });
    const titles = (menu.menu as unknown as Menu).items.map((i) => (i === "separator" ? "---" : i.title));
    expect(titles).toEqual(["play", "build", "god"]);
  });

  it("the mode menu's lines are three words each", () => {
    for (const m of WORK_MODES) expect(WORK_MODE_TEXT[m].short.split(/\s+/)).toHaveLength(3);
  });

  it("the path tool's Cross impassable is a plain button on the bar (round 10)", () => {
    const row = { id: "ModeBar.crossImpassable", label: "Cross impassable", onClick: noop };
    const split = placedRows([{ ...row, checked: false }], false, 1);
    expect(split.shown.map((r) => r.label)).toEqual(["Cross impassable"]);
    expect(split.advanced).toEqual([]);
  });

  it("the hex and overworld right-click menus copy a link to the hex, right after Center on this hex", () => {
    const view = read("src/hex-map/HexMapView.ts");
    expect(view).toMatch(/menu\.add\("hex\.center", [^\n]*\n\s*menu\.add\("hex\.copy-link", COPY_HEX_LINK_TITLE, "link-2", \(\) => copyHexLink\(this\.plugin, this\.activeMapName, x, y\)\)/);
    expect(view).toMatch(/menu\.add\("ow\.copy-link", COPY_HEX_LINK_TITLE/);
  });
});

describe("the God offer: only where an action needs God", () => {
  it("every action's locked hint is an offer exactly when God is the only mode that allows it", () => {
    for (const a of MODE_ACTIONS) {
      expect({ a, offer: godOfferText(lockedHint(a)) !== null }).toEqual({ a, offer: needsGod(a) });
    }
    expect(MODE_ACTIONS.filter(needsGod).sort()).toEqual(["delete-map", "reshape", "shrink-map", "swap-hexes"]);
  });

  it("the God hints become offers; the Build hints stay plain", () => {
    for (const h of [RESHAPE_LOCKED_HINT, REGENERATE_LOCKED_HINT, BIOME_LOCKED_HINT, REROLL_PLACE_LOCKED_HINT]) {
      expect(godOfferText(h)).toContain(GOD_OFFER);
    }
    for (const h of [PLACE_LOCKED_HINT, ADD_REGION_LOCKED_HINT, PAINT_LOCKED_HINT, CONFIRM_LOCKED_HINT, PATH_EDIT_LOCKED_HINT, null, undefined, ""]) {
      expect(godOfferText(h)).toBeNull();
    }
    expect(godOfferText(REROLL_PLACE_LOCKED_HINT)).toBe("This submap is locked. Switch to God for this map to reroll it");
  });

  it("a menu offers it only when God is the lowest mode that unlocks what it left out", () => {
    expect(godOfferText(lockedSummary(["swap-hexes"]))).not.toBeNull();
    // Build unlocks the terrain item: the line names Build, no offer.
    expect(godOfferText(lockedSummary(["swap-hexes", "paint-terrain"]))).toBeNull();
  });

  const menuEnd = (mode: WorkMode, ids: Parameters<ModeMenu["add"]>[0][]) => {
    let switched = 0;
    const menu = new ModeMenu(mode, { onGod: () => { switched++; } });
    for (const id of ids) menu.add(id, id, null, () => {});
    menu.showAtPosition({ x: 0, y: 0 });
    const items = (menu.menu as unknown as Menu).items.filter((i): i is MenuItem => i !== "separator");
    return { last: items[items.length - 1], switched: () => switched };
  };

  it("the hex menu in Build: Swap hex left out, and its line switches the map to God", () => {
    const r = menuEnd("build", ["hex.center", "hex.swap"]);
    expect(r.last.title).toBe("Switch to God for this map to swap hexes?");
    expect(r.last.disabled).toBe(false);
    r.last.click?.();
    expect(r.switched()).toBe(1);
  });

  it("in Play (Build unlocks the terrain item): a plain disabled line, no offer", () => {
    const r = menuEnd("play", ["hex.center", "hex.swap", "hex.clear-terrain"]);
    expect(r.last.title).toBe("Switch to Build to paint terrain.");
    expect(r.last.disabled).toBe(true);
  });

  it("in God nothing is left out and nothing is offered", () => {
    const r = menuEnd("god", ["hex.center", "hex.swap"]);
    expect(r.last.title).toBe("hex.swap");
  });
});

describe("hex links round-trip", () => {
  /** What Obsidian hands the protocol handler: the URI's query, decoded. */
  const handlerParams = (uri: string): Record<string, string> => {
    const q = uri.slice(uri.indexOf("?") + 1);
    return Object.fromEntries(new URLSearchParams(q));
  };
  const cases: MapLinkTarget[] = [
    { map: "coast", hex: { x: 3, y: 4 } },
    { map: "World/Sword Coast & Isles", hex: { x: -2, y: 0 } },
    { map: "Ærø #1?", hex: { x: 12, y: 30 } },
    { map: "just a map" },
  ];
  for (const t of cases) {
    it(`${t.map} ${t.hex ? `${t.hex.x}, ${t.hex.y}` : "(no hex)"}`, () => {
      const uri = mapLinkUri("My Vault", t);
      expect(uri.startsWith(`obsidian://${OPEN_MAP_ACTION}?vault=My%20Vault&map=`)).toBe(true);
      const params = handlerParams(uri);
      expect(params["vault"]).toBe("My Vault");
      expect(parseMapLinkParams(params)).toEqual(t);
    });
  }

  it("old map links (no x, y) still open the map; half or bad coordinates are ignored", () => {
    expect(parseMapLinkParams({ vault: "v", map: "m" })).toEqual({ map: "m" });
    expect(parseMapLinkParams({ map: "m", x: "3" })).toEqual({ map: "m" });
    expect(parseMapLinkParams({ map: "m", x: "3.5", y: "1" })).toEqual({ map: "m" });
    expect(parseMapLinkParams({ x: "1", y: "2" })).toBeNull();
  });

  it("the Markdown link a note gets: label (escaped) and the URI", () => {
    expect(hexLinkLabel("Coast", 3, 4)).toBe("Coast 3, 4");
    expect(hexLinkLabel("Coast", 3, 4, " Old Mill ")).toBe("Coast: Old Mill");
    const md = hexMarkdownLink("v", { map: "coast", hex: { x: 3, y: 4 } }, "Coast [north] 3, 4");
    expect(md).toBe("[Coast \\[north\\] 3, 4](obsidian://duckmage-openmap?vault=v&map=coast&x=3&y=4)");
  });

  it("the hex editor's centre dot copies it, and the handler centres the map", () => {
    const editor = read("src/hex-map/HexEditorModal.ts");
    expect(editor).toMatch(/centre\.addEventListener\("click", \(\) => this\.copyHexLink\(\)\)/);
    expect(editor).toMatch(/copyHexLink\(this\.plugin, this\.mapName, this\.x, this\.y\)/);
    expect(read("src/hex-map/copyHexLink.ts")).toMatch(/hexMarkdownLink\(/);
    const plugin = read("src/HexmakerPlugin.ts");
    expect(plugin).toMatch(/registerObsidianProtocolHandler\(OPEN_MAP_ACTION/);
    expect(plugin).toMatch(/view\.goToHex\(target\.map, target\.hex\.x, target\.hex\.y/);
  });
});
