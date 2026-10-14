import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { isStep, markVisited, parseVisited, partyClick, partyFor, partyTokens, unmarkVisited } from "../src/play/partyTravel";
import {
  appendLogEntry,
  formatLogEntry,
  logDayLink,
  logDayName,
  logFolderFor,
  logNotePath,
  logTime,
  newLogNote,
  PLAY_LOG_TARGET,
  rollDefaultSection,
} from "../src/play/playLog";
import { DEFAULT_LINK_SECTION_ICONS, linkSectionIcon, showOnMapOffer } from "../src/play/linkIcons";
import { TOKEN_SIZE_EM, tokenCoordShift } from "../src/hex-map/tokenDefaults";
import { tokenFlag } from "../src/frontmatter";
import { buildMapNote, parseMapNote, type MapNoteData } from "../src/maps/mapNote";
import { ACTION_POLICY, MENU_ACTIONS, COMMAND_ACTIONS } from "../src/workMode";
import { HAND_EDIT_ACTIONS } from "../src/modeGate";
import { layerOf } from "../src/ui/placement";
import { LINK_SECTIONS } from "../src/types";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// ── SF5: the party token ────────────────────────────────────────────────────

describe("party travel: one step at a time (SF5)", () => {
  it("knows a neighbour on a flat-top grid, both column parities", () => {
    // Even column 2: neighbours include (3, 3) and (1, 3) but not (3, 5).
    expect(isStep("2_4", "3_3", "flat")).toBe(true);
    expect(isStep("2_4", "1_3", "flat")).toBe(true);
    expect(isStep("2_4", "2_5", "flat")).toBe(true);
    expect(isStep("2_4", "3_5", "flat")).toBe(false);
    // Odd column 3 is shifted down: (4, 5) is a neighbour, (4, 3) isn't.
    expect(isStep("3_4", "4_5", "flat")).toBe(true);
    expect(isStep("3_4", "4_3", "flat")).toBe(false);
  });

  it("follows pointy-top and the map's stagger", () => {
    expect(isStep("2_1", "3_0", "pointy")).toBe(true); // odd row shifted right
    expect(isStep("2_1", "1_0", "pointy")).toBe(false);
    expect(isStep("2_1", "1_0", "pointy", "even")).toBe(true);
  });

  it("is never a step to the same hex, two hexes away, or from junk", () => {
    expect(isStep("2_4", "2_4", "flat")).toBe(false);
    expect(isStep("2_4", "2_6", "flat")).toBe(false);
    expect(isStep("nowhere", "2_4", "flat")).toBe(false);
    // Hex keys as people write them read too.
    expect(isStep("2, 4", "(2, 5)", "flat")).toBe(true);
  });

  it("a click moves the selected party only onto a neighbour", () => {
    const party = { party: true, hex: "2_4", map: "m", filePath: "p.md" };
    expect(partyClick(party, "2_5", "flat")).toBe("move");
    expect(partyClick(party, "2_4", "flat")).toBe("none");
    expect(partyClick(party, "5_5", "flat")).toBe("none");
    expect(partyClick(undefined, "2_5", "flat")).toBe("none");
  });

  it("finds the party on a hex first, else the map's first party; hidden and other maps' don't count", () => {
    const t = (filePath: string, hex: string, party = true, map = "m", visible = true) => ({ filePath, hex, party, map, visible });
    const tokens = [t("ship.md", "1_1", false), t("a.md", "2_2"), t("b.md", "3_3"), t("c.md", "4_4", true, "other"), t("d.md", "5_5", true, "m", false)];
    expect(partyTokens(tokens, "m").map((p) => p.filePath)).toEqual(["a.md", "b.md"]);
    expect(partyFor(tokens, "m", "3_3")?.filePath).toBe("b.md");
    expect(partyFor(tokens, "m", "9_9")?.filePath).toBe("a.md");
    expect(partyFor(tokens, "other", "9_9")?.filePath).toBe("c.md");
    expect(partyFor([t("x.md", "1_1", false)], "m", "1_1")).toBeUndefined();
  });

  it("the party flag reads forgivingly from the token note", () => {
    for (const yes of [true, "yes", "true", "x", "On", 1]) expect(tokenFlag(yes)).toBe(true);
    for (const no of [false, "no", "", 0, undefined, null, "party"]) expect(tokenFlag(no)).toBe(false);
  });
});

describe("visited hexes (SF5): first visit first, readable, forgiving", () => {
  it("adds new hexes at the end and keeps the list when nothing is new", () => {
    const one = markVisited(undefined, "2_4");
    expect(one).toEqual(["2_4"]);
    const two = markVisited(one, "2_4", "2, 5");
    expect(two).toEqual(["2_4", "2_5"]);
    expect(markVisited(two, "2_5")).toBe(two);
    expect(markVisited(two, "junk")).toBe(two);
  });

  it("unmarks one hex", () => {
    expect(unmarkVisited(["2_4", "2_5"], "2, 4")).toEqual(["2_5"]);
    expect(unmarkVisited(undefined, "2_4")).toEqual([]);
  });

  it("reads lists, one value, hand-typed forms; drops junk and repeats", () => {
    expect(parseVisited(["3_4", "3, 5", "(4, 4)", "nope", "3_4"])).toEqual(["3_4", "3_5", "4_4"]);
    expect(parseVisited("3_4, 3_5")).toEqual(["3_4", "3_5"]);
    expect(parseVisited("3, 4; 3, 5")).toEqual(["3_4", "3_5"]);
    expect(parseVisited(undefined)).toEqual([]);
    expect(parseVisited(42)).toEqual([]);
  });

  it("round-trips through the map note as a plain `visited:` list of hexes, with its layer switch", () => {
    const data: MapNoteData = {
      settings: { gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, visited: ["1_1", "1_2", "2_2"], showVisited: false } as MapNoteData["settings"],
      hexes: new Map(),
      paths: [],
    };
    const note = buildMapNote("m", data);
    expect(note).toMatch(/^visited: \["1_1", "1_2", "2_2"\]$/m);
    expect(note).toMatch(/^show-visited: false$/m);
    const back = parseMapNote(note)!;
    expect(back.settings.visited).toEqual(["1_1", "1_2", "2_2"]);
    expect(back.settings.showVisited).toBe(false);
  });

  it("a map without visits writes no key", () => {
    const note = buildMapNote("m", { settings: { gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 } } as MapNoteData["settings"], hexes: new Map(), paths: [] });
    expect(note).not.toMatch(/^visited:/m);
  });
});

describe("tokens stay off the hex number (SF5)", () => {
  const em = 16;
  const one = (size: "sm" | "md" | "lg", dy = 0) => [{ dy, size }];

  it("coordinates at the bottom: the token moves up just clear of the label", () => {
    const shift = tokenCoordShift({ placement: "bottom", showCoords: true, emPx: em, tokens: one("md") });
    expect(shift).toBeLessThan(0);
    const tokenBottom = shift + (TOKEN_SIZE_EM.md / 2) * em + 5;
    const labelTop = 1.2 * em - 0.6 * 0.8 * em;
    expect(tokenBottom).toBeLessThanOrEqual(labelTop);
  });

  it("coordinates at the top: down; middle, hidden or no tokens: no move", () => {
    expect(tokenCoordShift({ placement: "top", showCoords: true, emPx: em, tokens: one("md") })).toBeGreaterThan(0);
    expect(tokenCoordShift({ placement: "middle", showCoords: true, emPx: em, tokens: one("md") })).toBe(0);
    expect(tokenCoordShift({ placement: "bottom", showCoords: false, emPx: em, tokens: one("md") })).toBe(0);
    expect(tokenCoordShift({ placement: "bottom", showCoords: true, emPx: em, tokens: [] })).toBe(0);
  });

  it("never moves a token further than the label's own offset (it stays on its hex)", () => {
    const big = tokenCoordShift({ placement: "bottom", showCoords: true, emPx: em, tokens: [{ dy: 0.6 * em, size: "lg" }] });
    expect(big).toBe(-1.2 * em);
  });

  it("a small token already clear of the label stays put", () => {
    expect(tokenCoordShift({ placement: "bottom", showCoords: true, emPx: em, tokens: one("sm", -0.5 * em) })).toBe(0);
  });
});

// ── SF3: the play log ───────────────────────────────────────────────────────

describe("play log (SF3): one dated note per day, plain bullets", () => {
  const at = new Date(2026, 9, 4, 9, 5);

  it("names the day and time in local time, zero-padded", () => {
    expect(logDayName(at)).toBe("2026-10-04");
    expect(logTime(at)).toBe("09:05");
  });

  it("goes to the party's folder, else the setting, else <world>/log", () => {
    expect(logFolderFor({ worldFolder: "Realm", logFolder: "" })).toBe("Realm/log");
    expect(logFolderFor({ worldFolder: "", logFolder: undefined })).toBe("world/log");
    expect(logFolderFor({ worldFolder: "Realm", logFolder: "/Campaign/Days/" })).toBe("Campaign/Days");
    expect(logFolderFor({ logFolder: "Campaign/Days" }, { logFolder: "Party B/log" })).toBe("Party B/log");
    expect(logFolderFor({ logFolder: "Campaign/Days" }, { logFolder: "  " })).toBe("Campaign/Days");
    expect(logNotePath("Realm/log", at)).toBe("Realm/log/2026-10-04.md");
  });

  it("an entry is one bullet: time · hex · party · text, extra lines indented under it", () => {
    expect(formatLogEntry({ time: "09:05", hexLink: "[[h/m/3_4|Vale 3, 4]]", partyLink: "[[Band]]", text: "Wolves on the ridge." }))
      .toBe("- 09:05 · [[h/m/3_4|Vale 3, 4]] · [[Band]] · Wolves on the ridge.");
    expect(formatLogEntry({ time: "09:05", text: "Camp.\nRain all night.\r\n\r\nDawn." }))
      .toBe("- 09:05 · Camp.\n  Rain all night.\n\n  Dawn.");
  });

  it("a new day starts with its heading; entries follow each other in one list", () => {
    const first = appendLogEntry("", "- 09:05 · A", "2026-10-04");
    expect(first).toBe(`${newLogNote("2026-10-04")}- 09:05 · A\n`);
    const second = appendLogEntry(first, "- 10:00 · B", "2026-10-04");
    expect(second).toBe("# 2026-10-04\n\n- 09:05 · A\n- 10:00 · B\n");
  });

  it("keeps what the user wrote, and a blank line after prose", () => {
    const hand = "# 2026-10-04\n\nWe set out at dawn.\n";
    expect(appendLogEntry(hand, "- 10:00 · B", "2026-10-04")).toBe("# 2026-10-04\n\nWe set out at dawn.\n\n- 10:00 · B\n");
    const crlf = "# Day\r\n\r\n- 09:05 · A\r\n";
    expect(appendLogEntry(crlf, "- 10:00 · B\n  more", "x")).toBe("# Day\r\n\r\n- 09:05 · A\r\n- 10:00 · B\r\n  more\r\n");
  });

  it("the hex's back-link names the day", () => {
    expect(logDayLink("Realm/log/2026-10-04.md")).toBe("[[Realm/log/2026-10-04|2026-10-04]]");
  });

  it("Add to this hex points at the log first in Play, at the section rolled from otherwise", () => {
    expect(rollDefaultSection("play", "description")).toBe(PLAY_LOG_TARGET);
    expect(rollDefaultSection("build", "weather")).toBe("weather");
    expect(rollDefaultSection("god", "description")).toBe("description");
  });

  it("the hex editor offers the log among the targets and writes it through the log writer", () => {
    const editor = src("hex-map/HexEditorModal.ts");
    expect(editor).toMatch(/sections: \[\{ key: PLAY_LOG_TARGET, label: "Play log" \}/);
    expect(editor).toMatch(/if \(key === PLAY_LOG_TARGET\) \{ await addToPlayLog\(/);
  });
});

// ── SF4: Show on map ────────────────────────────────────────────────────────

describe("Show on map (SF4): a per-section option, never by name in code", () => {
  it("every link section has an entry (an icon or none)", () => {
    for (const s of LINK_SECTIONS) expect(Object.prototype.hasOwnProperty.call(DEFAULT_LINK_SECTION_ICONS, s)).toBe(true);
  });

  it("the user's choice wins, including none; unset uses the default", () => {
    expect(linkSectionIcon({}, "Towns")).toBe(DEFAULT_LINK_SECTION_ICONS.Towns);
    expect(linkSectionIcon({ linkSectionIcons: { Towns: "" } }, "Towns")).toBeNull();
    expect(linkSectionIcon({ linkSectionIcons: { Quests: "place-tavern-sign.svg" } }, "Quests")).toBe("place-tavern-sign.svg");
    expect(linkSectionIcon({}, "Quests")).toBeNull();
    // A section the plugin doesn't ship (a user's own) works the same way.
    expect(linkSectionIcon({ linkSectionIcons: { Shrines: "place-fire-shrine.svg" } }, "Shrines")).toBe("place-fire-shrine.svg");
    expect(linkSectionIcon({}, "Shrines")).toBeNull();
  });

  it("is offered once the section has a link, the icon exists and the hex doesn't show it yet", () => {
    const has = (i: string) => i === "place-village.svg";
    expect(showOnMapOffer({ icon: "place-village.svg", linkCount: 1, hexIcon: null, available: has })).toBe("place-village.svg");
    expect(showOnMapOffer({ icon: "place-village.svg", linkCount: 0, hexIcon: null, available: has })).toBeNull();
    expect(showOnMapOffer({ icon: "place-village.svg", linkCount: 2, hexIcon: "place-village.svg", available: has })).toBeNull();
    expect(showOnMapOffer({ icon: "gone.svg", linkCount: 1, hexIcon: null, available: has })).toBeNull();
    expect(showOnMapOffer({ icon: null, linkCount: 1, hexIcon: null, available: has })).toBeNull();
  });

  it("works where linking works: every mode, and it counts as the user's own edit", () => {
    expect(ACTION_POLICY["show-place-icon"].modes).toEqual(ACTION_POLICY["link-note"].modes);
    expect(HAND_EDIT_ACTIONS.has("show-place-icon")).toBe(true);
    expect(src("hex-map/HexEditorModal.ts")).toMatch(/setIconOverrideInFile\(this\.app, path, icon, "show-place-icon"\)/);
  });

  it("the editor never picks the icon by section name", () => {
    const editor = src("hex-map/HexEditorModal.ts");
    expect(editor).not.toMatch(/place-(village|dungeon-gate|ancient-ruins)/);
  });
});

// ── Placement, menus, commands ──────────────────────────────────────────────

describe("solo play controls: placement and work modes", () => {
  it("the party switch, the log folder setting and Show on map are above the fold; the rest Advanced", () => {
    expect(layerOf("Token.party")).toBe("main");
    expect(layerOf("Settings.logFolder")).toBe("main");
    expect(layerOf("Settings.linkSectionIcons")).toBe("main");
    expect(layerOf("Token.logFolder")).toBe("advanced");
    expect(layerOf("MapView.hexVisited")).toBe("advanced");
  });

  it("the new menu items and command are classified (Play may use them)", () => {
    expect(MENU_ACTIONS["token.party"]).toBe("token");
    expect(MENU_ACTIONS["hex.visited"]).toBe("token");
    expect(MENU_ACTIONS["hex.log"]).toBe("edit-note");
    expect(COMMAND_ACTIONS["open-play-log"]).toBe("edit-note");
    for (const a of ["token", "edit-note"] as const) expect(ACTION_POLICY[a].modes).toContain("play");
  });

  it("the setup wizard asks for the play log folder with the other folders", () => {
    expect(src("SetupWizardView.ts")).toMatch(/\{ key: "logFolder",\s+label: "Play log",\s+suffix: "log" \}/);
  });

  it("the layers menu's Labels group has the Visited switch", () => {
    expect(src("hex-map/HexSidePanel.ts")).toMatch(/key: "showVisited",\s+label: "Visited",\s+cssClass: "duckmage-hide-visited",\s+inLabels: true/);
  });
});

// ── O8: the hex editor's groups use the shared Fold ─────────────────────────

describe("hex editor groups (O8)", () => {
  it("Terrain, Notes, Linked notes and Icons are Folds, not hand-built collapsibles", () => {
    const editor = src("hex-map/HexEditorModal.ts");
    expect(editor).not.toMatch(/duckmage-editor-collapsible/);
    const body = editor.slice(editor.indexOf("private makeCollapsible("), editor.indexOf("private renderTerrainSection("));
    expect(body).toMatch(/new Fold\(container, \{/);
    expect(body).toMatch(/this\.plugin\.settings\[flag\] = !open;/);
  });
});
