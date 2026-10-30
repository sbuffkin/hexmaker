import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { buildMapNote, parseMapNote, updateMapNote, type MapNoteData } from "../src/maps/mapNote";
import { registry } from "../src/modules";
import {
  moduleCommands,
  moduleGridDecorations,
  moduleHexMenu,
  moduleLogWriters,
  modulePartyClick,
  moduleRollTargets,
  moduleSettings,
  moduleTokenMenu,
  partyTokensOn,
  runPartyEntered,
  runPartyStep,
} from "../src/modules/runtime";
import { folderKeys } from "../src/wizardFolders";
import { partyFields } from "../src/hex-map/TokenModal";
import { isParty, TokenLayer } from "../src/hex-map/view/tokenLayer";
import { markDecorations } from "../src/hex-map/view/gridRenderer";
import { overlayOptions } from "../src/hex-map/HexSidePanel";
import { TableSections } from "../src/hex-map/editor/TableSections";
import { offClosure } from "../dev/release/slices.mjs";
import type { UndoItem } from "../src/hex-map/undoItems";
import { MemVault } from "./helpers/memVault";
import { fakeRoot } from "./helpers/fakeDom";
import { describeWith, describeWithout, SLICES } from "./helpers/slices";

/**
 * Solo play as a slice ("play"): the party token's steps, visited hexes and
 * the play log come only from src/modules/play. Built off, tokens are plain
 * tokens (they still move and drag), nothing is marked visited, nothing is
 * logged, and the map notes and token notes it wrote are left as they are.
 */

const PARTY = "world/tokens/Party.md";
const CLICK = { map: "m", token: PARTY, from: "2_2", to: "2_3", orientation: "flat" as const, stagger: "odd" as const };

/** A map, a vault with a party token on it, and a TokenLayer drawing nothing (no viewport). */
function setup(workMode = "play") {
  const vault = new MemVault({ [PARTY]: "---\ntoken: true\ntoken-hex: 2_2\ntoken-map: m\ntoken-party: true\n---\n# Party\n" });
  const app = vault.app() as unknown as Record<string, unknown> & { metadataCache: Record<string, unknown> };
  app.metadataCache.fileToLinktext = (f: { path: string }) => f.path.replace(/\.md$/, "");
  const map: Record<string, unknown> = { name: "m", workMode, gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 } };
  let saves = 0;
  const plugin = {
    app,
    settings: { worldFolder: "world", logFolder: "Sessions", hexOrientation: "flat", maps: [map] },
    getMap: (n: string) => (n === "m" ? map : undefined),
    saveSettings: async () => { saves++; },
    hexPath: (x: number, y: number) => `world/hexes/m/${x}_${y}.md`,
    createHexNote: async () => null,
    mapLabel: () => "Vale",
    hexLinkAlias: () => "Vale",
  };
  const pushed: UndoItem[] = [];
  let redecorated = 0;
  let renders = 0;
  const host = {
    activeMapName: () => "m",
    viewportEl: () => null,
    controlsEl: () => null,
    drawingMode: () => null,
    pendingTokenNotePath: () => null,
    pendingTokenPlaceData: () => null,
    getActiveMap: () => map,
    getActiveStagger: () => "odd" as const,
    owView: () => null,
    undos: { currentWorkMode: () => map.workMode as never, pushUndo: (it: UndoItem) => pushed.push(it), pushTokenUndo: () => {} },
    zoom: () => 1,
    toolbar: { exitTokenMode: () => {} },
    hexMenu: { modeMenuOptions: () => ({}), addHexMenuItems: () => {}, addOverworldMenuItems: () => {} },
    onHexClick: async () => {},
    centerOnHex: () => {},
    renderGrid: () => { renders++; },
    keepViewStill: () => {},
    redecorate: () => { redecorated++; },
  };
  const layer = new TokenLayer(plugin as never, host as never);
  const party = { filePath: PARTY, title: "Party", hex: "2_2", map: "m", visible: true, party: true, shape: "circle", size: "md" } as never;
  const logged = () => [...vault.files.keys()].some((p) => p.startsWith("Sessions/"));
  return { vault, plugin, map, layer, party, pushed, logged, saves: () => saves, redecorated: () => redecorated, renders: () => renders };
}

/** A map note with Solo play's keys as a play build (or the user) wrote them. */
const NOTE = buildMapNote("m", {
  settings: { paletteName: "P", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 } } as MapNoteData["settings"],
  hexes: new Map(),
  paths: [],
}).replace(/^(hexmaker-map: .*)$/m, `$1\nvisited: ["1_1", "1_2", "2_2"]\nshow-visited: false`);

/** Write it back as the plugin does after painting a hex. */
function repaint(note: string): string {
  const data = parseMapNote(note)!;
  data.hexes.set("3_3", { terrain: "hills" } as never);
  return updateMapNote(note, "m", data);
}

/** TableSections' "Add to this hex" for a roll on hex 1, 2 in mode `mode`. */
function rollTarget(mode: string) {
  const host = {
    app: { vault: { getAbstractFileByPath: () => null }, metadataCache: { getFileCache: () => null } },
    plugin: { hexPath: () => "nowhere.md", getMapPalette: () => [], getMap: () => ({ workMode: mode }) },
    x: 1, y: 2, mapName: "m", options: {},
    textBoxes: new Map(), allText: new Map(), allLinks: new Map(), choiceRefreshers: new Map(), hexExists: false,
    onChanged: () => {},
  };
  return new TableSections(host as never).rollTarget("description");
}

describe("the play slice in release-slices.json", () => {
  it("unreleased for now, documented, and Hex flower needs it (built off together)", () => {
    expect(SLICES.play).toEqual({ docs: true, define: "__SLICE_PLAY__", modules: ["play"], released: false, mapMarks: ["visited", "show-visited"], requires: [] });
    expect(SLICES.hexflower.requires).toContain("play");
    expect(offClosure(["play"])).toEqual(expect.arrayContaining(["play", "hexflower"]));
  });

  it("the core never names the play log, visited marks or the party menu item (only the module does)", () => {
    for (const f of ["src/hex-map/view/tokenLayer.ts", "src/hex-map/view/gridRenderer.ts", "src/hex-map/view/hexContextMenu.ts", "src/hex-map/HexEditorModal.ts", "src/hex-map/editor/TableSections.ts", "src/plugin/commands.ts", "src/HexmakerSettingTab.ts", "src/SetupWizardView.ts"]) {
      const text = readFileSync(f, "utf8");
      expect({ f, hits: text.match(/modules\/play\/|duckmage-hex-visited|"token\.party"|"hex\.visited"|"hex\.log"|open-play-log|addToPlayLog/g) ?? [] }).toEqual({ f, hits: [] });
    }
  });
});

describeWith("play", "play built on: party steps, visited hexes, the play log", () => {
  it("is registered with its map-note keys, setting, command and wizard folder", () => {
    expect(registry.module("play")?.slice).toBe("play");
    expect(registry.mapNoteFields().filter((f) => f.key === "visited" || f.key === "show-visited").map((f) => f.field)).toEqual(["visited", "showVisited"]);
    expect(moduleSettings().find((s) => s.id === "Settings.logFolder")?.control).toEqual({ type: "folder", key: "logFolder", placeholder: "World/log" });
    expect(moduleCommands().map((c) => c.command.id)).toContain("open-play-log");
    const folders = folderKeys().map((f) => f.key);
    expect(folders.indexOf("logFolder")).toBe(folders.indexOf("iconsFolder") - 1);
    expect(overlayOptions().map((o) => o.key)).toContain("showVisited");
  });

  it("a party token is the party; a click on a neighbour is a step", () => {
    expect(partyTokensOn()).toBe(true);
    expect(isParty({ party: true })).toBe(true);
    expect(isParty({ party: false })).toBe(false);
    expect(modulePartyClick({} as never, CLICK)).toBe("move");
    expect(modulePartyClick({} as never, { ...CLICK, to: "4_4" })).toBe("none");
    expect(partyFields(true, true, "Sessions/B")).toEqual({ party: true, partyLog: "Sessions/B" });
  });

  it("a step marks both hexes visited at once (redecorated, no redraw), one undo with the move, and a log line in Play", async () => {
    const s = setup("play");
    s.layer.tokenEntries = [s.party];
    s.layer.selectedParty = PARTY;
    expect(s.layer.activeParty()).toBe(s.party);
    await s.layer.moveParty(s.party, "2_3");
    expect(s.map.visited).toEqual(["2_2", "2_3"]);
    expect(s.redecorated()).toBe(1);
    expect(s.renders()).toBe(0);
    expect(s.pushed).toEqual([{ kind: "group", items: [
      { kind: "token", path: PARTY, before: { hex: "2_2", map: "m" }, after: { hex: "2_3", map: "m" } },
      { kind: "map-field", mapName: "m", field: "visited", before: undefined, after: ["2_2", "2_3"] },
    ] }]);
    expect(s.vault.files.get(PARTY)).toMatch(/^token-hex: 2_3$/m);
    expect(s.logged()).toBe(true);
  });

  it("moved by hand in Build: visited, but no log line (not a step of the game)", async () => {
    const s = setup("build");
    await s.layer.moveParty(s.party, "2_3");
    expect(s.map.visited).toEqual(["2_2", "2_3"]);
    expect(s.logged()).toBe(false);
  });

  it("the grid marks visited hexes; the marks follow the map without a redraw", () => {
    const decorate = moduleGridDecorations({} as never, { name: "m", visited: ["1_1"] } as never);
    expect(decorate("1_1")).toEqual(["duckmage-hex-visited"]);
    expect(decorate("0_0")).toEqual([]);
    const { root } = fakeRoot();
    const hex = root.createDiv({ cls: "duckmage-hex" });
    markDecorations(hex as never, decorate("1_1"));
    expect(hex.classes.has("duckmage-hex-visited")).toBe(true);
    expect(hex.dataset.decorations).toBe("duckmage-hex-visited");
    // Undone: the next refresh takes the mark away again.
    markDecorations(hex as never, moduleGridDecorations({} as never, { name: "m" } as never)("1_1"));
    expect(hex.classes.has("duckmage-hex-visited")).toBe(false);
    expect(hex.dataset.decorations).toBeUndefined();
  });

  it("menus: the token's Party token switch; the hex's Add to play log… and Visited (ticked when visited)", () => {
    const s = setup();
    s.map.visited = ["2_2"];
    expect(moduleTokenMenu(s.plugin as never, { map: "m", hex: "2_2", token: PARTY, party: true }).map((i) => [i.id, i.label, i.checked])).toEqual([["token.party", "Party token", true]]);
    const items = moduleHexMenu(s.plugin as never, "m", "2_2").filter((i) => !i.id.startsWith("hex.explore"));
    expect(items.map((i) => [i.id, i.label, i.checked ?? null, i.placementId ?? null])).toEqual([
      ["hex.log", "Add to play log…", null, null],
      ["hex.visited", "Visited", true, "MapView.hexVisited"],
    ]);
  });

  it("the hex editor: Add to log, and a roll's Add to this hex offers the play log (first in Play)", () => {
    expect(moduleLogWriters().map((w) => w.label)).toEqual(["Add to log"]);
    expect(moduleRollTargets({} as never, { map: "m", x: 1, y: 2, mode: "play" }).map((t) => t.key)).toEqual(["play-log"]);
    const play = rollTarget("play");
    expect(play.sections[0]).toEqual({ key: "play-log", label: "Play log" });
    expect(play.defaultSection).toBe("play-log");
    expect(rollTarget("build").defaultSection).toBe("description");
  });

  it("a map note's visited list reads and writes back unchanged", () => {
    const out = repaint(NOTE);
    expect(parseMapNote(out)!.settings.visited).toEqual(["1_1", "1_2", "2_2"]);
    expect(parseMapNote(out)!.settings.showVisited).toBe(false);
  });
});

describeWithout("play", "play built off: plain tokens, no marks, no log, its notes left alone", () => {
  it("nothing of it is registered", () => {
    expect(registry.module("play")).toBeUndefined();
    expect(registry.mapNoteFields().map((f) => f.key)).not.toContain("visited");
    expect(moduleSettings().map((s) => s.id)).not.toContain("Settings.logFolder");
    expect(moduleCommands().map((c) => c.command.id)).not.toContain("open-play-log");
    expect(folderKeys().map((f) => f.key)).not.toContain("logFolder");
    expect(overlayOptions().map((o) => o.key)).not.toContain("showVisited");
  });

  it("a token marked as the party is a plain token: never the party, no step clicks, the form leaves its keys", () => {
    expect(partyTokensOn()).toBe(false);
    expect(isParty({ party: true })).toBe(false);
    expect(modulePartyClick({} as never, CLICK)).toBe("none");
    expect(partyFields(false, true, "Sessions/B")).toEqual({});
    const s = setup();
    s.layer.tokenEntries = [s.party];
    s.layer.selectedParty = PARTY;
    expect(s.layer.activeParty()).toBeUndefined();
  });

  it("a token still moves (one undo), with no visited marks and no log line", async () => {
    const s = setup("play");
    await s.layer.moveParty(s.party, "2_3");
    expect(s.vault.files.get(PARTY)).toMatch(/^token-hex: 2_3$/m);
    expect(s.vault.files.get(PARTY)).toMatch(/^token-party: true$/m);
    expect(s.pushed).toEqual([{ kind: "token", path: PARTY, before: { hex: "2_2", map: "m" }, after: { hex: "2_3", map: "m" } }]);
    expect(s.map.visited).toBeUndefined();
    expect(s.saves()).toBe(0);
    expect(s.redecorated()).toBe(0);
    expect(s.logged()).toBe(false);
    expect(runPartyStep(s.plugin as never, { map: "m", from: "2_3", to: "2_4" })).toEqual([]);
    expect(await runPartyEntered(s.plugin as never, { map: "m", from: "2_3", to: "2_4" })).toEqual([]);
  });

  it("no visited marks, no party or hex menu items, no log targets", () => {
    expect(moduleGridDecorations({} as never, { name: "m", visited: ["1_1"] } as never)("1_1")).toEqual([]);
    const s = setup();
    s.map.visited = ["2_2"];
    expect(moduleTokenMenu(s.plugin as never, { map: "m", hex: "2_2", token: PARTY, party: true })).toEqual([]);
    expect(moduleHexMenu(s.plugin as never, "m", "2_2")).toEqual([]);
    expect(moduleLogWriters()).toEqual([]);
    expect(moduleRollTargets({} as never, { map: "m", x: 1, y: 2, mode: "play" })).toEqual([]);
    const play = rollTarget("play");
    expect(play.sections.map((x) => x.key)).not.toContain("play-log");
    expect(play.defaultSection).toBe("description");
  });

  it("a map note with visited round-trips byte-identical (its lines kept as the user's)", () => {
    const out = repaint(repaint(NOTE));
    expect(out).toContain('\nvisited: ["1_1", "1_2", "2_2"]\n');
    expect(out).toContain("\nshow-visited: false\n");
    expect(out).toMatch(/^\| 3_3 \|[^\n]*\| hills \|/m);
  });
});
