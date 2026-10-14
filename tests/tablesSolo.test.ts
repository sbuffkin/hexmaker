import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { TFile } from "obsidian";
import {
  TABLE_KINDS,
  choiceKey,
  choiceSourceLabel,
  classifyLinkedTable,
  initialChoice,
  orderChoices,
  rememberChoice,
  rememberedChoice,
  tableChoices,
  type ChoiceInput,
} from "../src/tableChoice";
import { EMPTY_ROLL_TITLE, tableIsEmpty } from "../src/random-tables/emptyTable";
import { TableChoice } from "../src/random-tables/TableChoice";
import { makeTableTemplate } from "../src/utils";
import { DEFAULT_NOTE_TEMPLATE, LINK_NOTE_TEMPLATES, noteTemplateEntries } from "../src/noteTemplates";
import { isGuidanceLine } from "../src/hexGuidance";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { readSurface, readSource } from "./helpers/source";

/**
 * Owner calls 2026-10-14 (SF1, SF2, SX1): tables ship empty and an empty
 * table can't be rolled (Roll disabled, an empty state opens the editor);
 * one table section per kind that lists the hex's tables, most specific
 * first, and swaps between them; barebones, generic note templates that
 * are easy to find.
 */

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── SF2: the tables a hex can roll on ─────────────────────────────────────

describe("one table section per kind (SF2)", () => {
  const folders = { area: "w/tables/regions", terrain: "w/tables/terrain" };
  const files = new Set([
    "w/tables/my weather.md",
    "w/tables/regions/Dark Wood.md",
    "w/tables/terrain/encounters/forest.md",
    "w/tables/coast weather.md",
    "w/tables/weather.md",
    "w/tables/goblins.md",
  ]);
  const base = (over: Partial<ChoiceInput>): ChoiceInput => ({ noteExists: true, noteLinks: [], folders, exists: (p) => files.has(p), ...over });

  it("lists hex > area > map > terrain > default, whatever order the note has them in", () => {
    const items = tableChoices(base({
      noteLinks: [
        { link: "terrain/encounters/forest", path: "w/tables/terrain/encounters/forest.md" },
        { link: "regions/Dark Wood", path: "w/tables/regions/Dark Wood.md" },
        { link: "goblins", path: "w/tables/goblins.md" },
      ],
      map: "w/tables/coast weather.md",
      fallback: "w/tables/weather.md",
    }));
    expect(items.map((i) => [i.source, i.path])).toEqual([
      ["hex", "w/tables/goblins.md"],
      ["area", "w/tables/regions/Dark Wood.md"],
      ["map", "w/tables/coast weather.md"],
      ["terrain", "w/tables/terrain/encounters/forest.md"],
      ["default", "w/tables/weather.md"],
    ]);
    // Links in the note can be removed there; the map's and the default can't.
    expect(items.filter((i) => i.link).map((i) => i.source)).toEqual(["hex", "area", "terrain"]);
  });

  it("the weather table a user made and picked for the hex comes first (F2)", () => {
    const items = tableChoices(base({
      noteLinks: [{ link: "my weather", path: "w/tables/my weather.md" }],
      map: null,
      fallback: "w/tables/weather.md",
    }));
    expect(items[initialChoice(items)].path).toBe("w/tables/my weather.md");
    expect(items.map((i) => i.source)).toEqual(["hex", "default"]);
  });

  it("a hex with no note shows the area and terrain tables its note will get", () => {
    const items = tableChoices(base({ noteExists: false, area: "w/tables/regions/Dark Wood.md", terrain: "w/tables/terrain/encounters/forest.md" }));
    expect(items.map((i) => i.source)).toEqual(["area", "terrain"]);
    // Once the note exists its section is the truth (a removed link stays removed).
    expect(tableChoices(base({ area: "w/tables/regions/Dark Wood.md", terrain: "w/tables/terrain/encounters/forest.md" }))).toEqual([]);
  });

  it("skips tables that aren't there, keeps a broken link visible, lists a table once", () => {
    const items = tableChoices(base({
      noteLinks: [{ link: "gone", path: null }, { link: "weather", path: "w/tables/weather.md" }],
      map: "w/tables/nope.md",
      fallback: "w/tables/weather.md",
    }));
    expect(items).toEqual([
      { path: "gone", source: "hex", link: "gone", missing: true },
      { path: "w/tables/weather.md", source: "hex", link: "weather" },
    ]);
    // A broken link isn't where the section starts.
    expect(initialChoice(items)).toBe(1);
  });

  it("starts on the most specific table, or the one chosen before this session", () => {
    const items = orderChoices([
      { path: "t/terrain.md", source: "terrain" },
      { path: "t/hex.md", source: "hex" },
    ]);
    expect(initialChoice(items)).toBe(0);
    expect(initialChoice(items, "t/terrain.md")).toBe(1);
    expect(initialChoice(items, "t/elsewhere.md")).toBe(0);
    const key = choiceKey("Coast", 3, 4, "weather");
    expect(rememberedChoice(key)).toBeUndefined();
    rememberChoice(key, "t/terrain.md");
    expect(rememberedChoice(key)).toBe("t/terrain.md");
    expect(rememberedChoice(choiceKey("Coast", 3, 5, "weather"))).toBeUndefined();
  });

  it("tells linked tables apart by folder, not by name", () => {
    expect(classifyLinkedTable("w/tables/regions/Basin.md", folders)).toBe("area");
    expect(classifyLinkedTable("W/Tables/Terrain/encounters/grass.md", folders)).toBe("terrain");
    expect(classifyLinkedTable("w/tables/regions.md", folders)).toBe("hex");
    expect(classifyLinkedTable("elsewhere/forest.md", folders)).toBe("hex");
    expect(["hex", "area", "map", "terrain", "default"].map((s) => choiceSourceLabel(s as never))).toEqual(["this hex", "area", "map", "terrain", "default"]);
  });

  it("the kinds are data: encounters, weather, hooks & rumours", () => {
    expect(Object.keys(TABLE_KINDS)).toEqual(["encounters", "weather", "hooks & rumors"]);
    expect(TABLE_KINDS.encounters).toMatchObject({ hexSection: "Encounters Table", areaTables: true, terrainTables: true, rollInto: "description" });
    expect(TABLE_KINDS.weather).toMatchObject({ hexSection: "Weather Table", mapField: "weatherTable", starterFile: "weather.md", rollInto: "weather" });
    expect(TABLE_KINDS["hooks & rumors"]).toMatchObject({ hexSection: "Rumors Table", mapField: "rumorsTable", rollInto: "hooks & rumors" });
    // The section control knows nothing about particular kinds or table names.
    const control = src("src/random-tables/TableChoice.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(control).not.toMatch(/"(weather|rumou?rs?|encounters?)"/i);
  });

  it("the hex editor draws every kind through the one section, and choosing writes nothing", () => {
    const editor = readSurface("hex-editor");
    expect(editor).toContain(`this.renderTableChoice(encCard, path, "encounters")`);
    expect(editor).toContain("this.tables.renderTableChoice(host, path, section)");
    // The old per-source controls are gone.
    expect(editor).not.toContain("renderRolledControls");
    expect(editor).not.toContain("pickSectionTable");
    // Switching only remembers; no gate on the work mode, so it works in Play.
    const body = editor.slice(editor.indexOf("renderTableChoice(host: HTMLElement,"), editor.indexOf("private pickTableFor("));
    expect(body).toContain("onChoose: (item) => rememberChoice(key, item.path)");
    expect(body).not.toMatch(/canDo\(|map-properties/);
  });
});

// ── SF2: the section control ───────────────────────────────────────────────

function fakeApp(notes: Record<string, string>) {
  const files = new Map<string, TFile>();
  for (const path of Object.keys(notes)) {
    const f = new TFile();
    f.path = path;
    f.basename = path.split("/").pop()!.replace(/\.md$/, "");
    files.set(path, f);
  }
  return {
    vault: {
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
      cachedRead: (f: TFile) => Promise.resolve(notes[f.path]),
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const click = (el: FakeEl | undefined) => el?.fire("click", { preventDefault() {} });

describe("the table section control (SF1 + SF2)", () => {
  const full = makeTableTemplate(20, {}, undefined, [["Wolves", 2], ["Bandits", 1]]);
  const empty = makeTableTemplate(20, { "table-type": "encounters" });

  function draw(items: { path: string; source: "hex" | "terrain" | "default"; link?: string }[], notes: Record<string, string>) {
    const { root, el } = fakeRoot();
    const calls: string[] = [];
    const choice = new TableChoice(el, {
      app: fakeApp(notes) as never,
      plugin: {} as never,
      noun: "encounter",
      items,
      start: 0,
      onChoose: (i) => calls.push(`choose ${i.path}`),
      onRoll: (i) => calls.push(`roll ${i.path}`),
      onOpen: (i) => calls.push(`open ${i.path}`),
      onChange: () => calls.push("change"),
      onRemove: (i) => calls.push(`remove ${i.path}`),
    });
    return { root, calls, choice };
  }

  it("several tables: radio buttons, the most specific checked; switching re-draws on the new one", async () => {
    const { root, calls } = draw(
      [{ path: "t/goblins.md", source: "hex", link: "goblins" }, { path: "t/forest.md", source: "terrain", link: "forest" }],
      { "t/goblins.md": full, "t/forest.md": full },
    );
    const radios = root.inputs("radio");
    expect(radios.length).toBe(2);
    expect(radios.map((r) => (r as unknown as { checked: boolean }).checked)).toEqual([true, false]);
    expect(root.all((e) => e.classes.has("duckmage-table-choice-source")).map((e) => e.text)).toEqual(["this hex", "terrain"]);
    await settle();
    const roll = root.find("duckmage-table-choice-roll")!;
    expect(roll.disabled).toBe(false);
    click(roll);
    expect(calls).toEqual(["roll t/goblins.md"]);

    (radios[1] as unknown as { checked: boolean }).checked = true;
    radios[1].fire("change");
    expect(calls).toContain("choose t/forest.md");
    click(root.find("duckmage-table-choice-roll"));
    expect(calls.at(-1)).toBe("roll t/forest.md");
  });

  it("an empty table: Roll is disabled, with the empty state's Add entries (SF1)", async () => {
    const { root, calls } = draw([{ path: "t/forest.md", source: "terrain" }], { "t/forest.md": empty });
    // One table: no radios, just its name.
    expect(root.inputs("radio").length).toBe(0);
    expect(root.find("duckmage-table-choice-name")!.text).toBe("forest");
    await settle();
    const roll = root.find("duckmage-table-choice-roll")!;
    expect(roll.disabled).toBe(true);
    expect(roll.title).toBe(EMPTY_ROLL_TITLE);
    expect(root.find("duckmage-rt-empty-state")).toBeDefined();
    expect(root.find("duckmage-rt-add-entries")!.text).toBe("Add entries");
    expect(calls).toEqual([]);
  });

  it("no table yet: says so, Roll off, change… still offered", async () => {
    const { root, calls } = draw([], {});
    expect(root.find("duckmage-table-choice-none")!.text).toBe("No encounter table yet.");
    expect(root.find("duckmage-table-choice-roll")!.disabled).toBe(true);
    click(root.find("duckmage-table-choice-change"));
    expect(calls).toEqual(["change"]);
  });

  it("the name opens the table; × removes only links stored in the hex note", () => {
    const { root, calls } = draw(
      [{ path: "t/goblins.md", source: "hex", link: "goblins" }, { path: "t/weather.md", source: "default" }],
      { "t/goblins.md": full, "t/weather.md": full },
    );
    click(root.find("duckmage-table-choice-name"));
    const removes = root.all((e) => e.classes.has("duckmage-link-remove-btn"));
    expect(removes.length).toBe(1);
    click(removes[0]);
    expect(calls).toEqual(["open t/goblins.md", "remove t/goblins.md"]);
  });

  it("setItems shows a new list (a table picked with change…)", async () => {
    const { root, choice } = draw([], {});
    choice.setItems([{ path: "t/goblins.md", source: "hex", link: "goblins" }], 0);
    expect(root.find("duckmage-table-choice-name")!.text).toBe("goblins");
    expect(choice.current?.path).toBe("t/goblins.md");
  });
});

// ── SF1: empty tables everywhere a table can be rolled ────────────────────

describe("empty tables can't be rolled (SF1)", () => {
  it("terrain and new tables ship empty; a table with rows isn't", () => {
    expect(tableIsEmpty(makeTableTemplate(100, { "table-type": "encounters" }))).toBe(true);
    expect(tableIsEmpty(makeTableTemplate(0))).toBe(true);
    expect(tableIsEmpty(makeTableTemplate(20, {}, undefined, [["Wolves", 1]]))).toBe(false);
  });

  it("every roll surface uses the shared empty state and disables Roll", () => {
    for (const p of [
      "src/random-tables/RandomTableModal.ts",
      "src/random-tables/RandomTableView.ts",
      "src/random-tables/RollerBlock.ts",
      "src/random-tables/WorkflowWizardModal.ts",
      "src/random-tables/TableChoice.ts",
    ]) {
      const text = readSource(p);
      expect({ p, uses: text.includes("renderEmptyTableState(") }).toEqual({ p, uses: true });
      expect({ p, disables: /setRollEnabled\(/.test(text) }).toEqual({ p, disables: true });
      // No hand-built "Add entries" button outside the helper.
      expect({ p, hand: /text: "Add entries"/.test(text) }).toEqual({ p, hand: false });
    }
  });

  it("terrain encounter tables are still made empty (players fill them)", () => {
    const plugin = readSurface("plugin");
    const body = plugin.slice(plugin.indexOf("private async createTerrainTableFiles("), plugin.indexOf("async backfillTerrainLinks("));
    expect(body).toContain("makeTableTemplate(");
    // No starter rows passed (makeTableTemplate's 4th argument).
    expect(body).not.toMatch(/this\.buildRollerLink\(\),\s*\[/);
  });
});

// ── SX1: barebones, generic templates that are easy to find ───────────────

describe("note templates (SX1)", () => {
  const LEAN = /\b(party|NPCs?|magic|treasure|inhabitants|rooms|reward|dungeon|tavern|gold)\b/i;

  it("every linked-note starter is a heading or two, generic", () => {
    expect(DEFAULT_NOTE_TEMPLATE).toBe("# {{title}}\n\n## Description\n\n## Notes\n");
    for (const [section, t] of Object.entries(LINK_NOTE_TEMPLATES)) {
      expect({ section, headings: (t.starter.match(/^#+ /gm) ?? []).length <= 3 }).toEqual({ section, headings: true });
      expect({ section, lean: LEAN.test(t.starter.replace("{{title}}", "")) }).toEqual({ section, lean: false });
    }
  });

  it("the hex template's prompts are short and lean towards no setting", () => {
    const template = src("src/defaultHexTemplate.md");
    const prompts = template.split("\n").filter((l) => /^\*.+\*$/.test(l.trim()));
    expect(prompts.length).toBe(6);
    for (const p of prompts) {
      expect(isGuidanceLine(p)).toBe(true);
      expect({ p, lean: LEAN.test(p) }).toEqual({ p, lean: false });
      expect(p.length).toBeLessThan(50);
    }
  });

  it("are easy to find: a Note templates setting and an Edit template item in each link field", () => {
    const entries = noteTemplateEntries({ worldFolder: "w" });
    expect(entries.map((e) => e.label)).toEqual(["Hex", "Town", "Dungeon", "Feature", "Quest", "Faction"]);
    expect(entries.map((e) => e.path)).toEqual(["w/templates/hex.md", "w/templates/town.md", "w/templates/dungeon.md", "w/templates/feature.md", "w/templates/quest.md", "w/templates/faction.md"]);
    const tab = readSurface("settings-tab");
    expect(tab).toContain(`T("Settings.noteTemplates"`);
    expect(tab).toContain("this.plugin.openNoteTemplate(t.path)");
    // Main, not tucked into Advanced: not listed in the placement map.
    expect(src("src/ui/placement.ts")).not.toContain("Settings.noteTemplates");
    const editor = readSurface("hex-editor");
    expect(editor).toContain("Edit the ${words.noun} template…");
  });
});
