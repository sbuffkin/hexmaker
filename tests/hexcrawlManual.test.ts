import { describe, it } from "node:test";
import expect from "expect";
import { hexNumbering } from "../src/export/manual/hexNumber";
import { PlaceholderFilter, templateHintLines } from "../src/export/manual/placeholders";
import { buildManualHtml, entryTitle, isKeyed, tableResultText } from "../src/export/manual/manualHtml";
import type { ManualData, ManualHex } from "../src/export/manual/manualModel";

/** Pure parts of the hexcrawl manual export (src/export/manual). */

const noLinks = { towns: [], dungeons: [], features: [], quests: [], factions: [] };
const hex = (over: Partial<ManualHex> = {}): ManualHex => ({
  number: "0101", x: 0, y: 0, terrain: "grass",
  landmark: "", description: "", hidden: "", secret: "", weather: "", hooks: "",
  links: { ...noLinks }, ...over,
});

describe("hex numbers", () => {
  it("count from the map's top-left hex as 0101, whatever its coordinates", () => {
    const n = hexNumbering({ x: -7, y: -9 }, { cols: 38, rows: 27 });
    expect(n.number(-7, -9)).toBe("0101");
    expect(n.number(-2, 4)).toBe("0614");
    expect(n.digits).toBe(2);
  });

  it("use three digits per axis past 99", () => {
    const n = hexNumbering({ x: 0, y: 0 }, { cols: 120, rows: 40 });
    expect(n.number(0, 0)).toBe("001001");
    expect(n.number(104, 9)).toBe("105010");
  });
});

describe("placeholder text", () => {
  const filter = new PlaceholderFilter(["### description\nWhat the party sees and feels.\n### hooks\n(Write hooks here)"]);

  it("drops unedited template hints and fill-in prompts", () => {
    expect(filter.clean("What the party sees and feels.")).toBe("");
    expect(filter.clean("(add seeds here)")).toBe("");
    expect(filter.clean("TODO")).toBe("");
    expect(filter.clean("Normal for region, or special (e.g. always pleasant, sandstorms, magic zone effect).")).toBe("");
  });

  it("drops a hint italicised under its heading (template since fresh-eyes r4)", () => {
    expect(new PlaceholderFilter().clean("*Seeds for adventures, things locals might mention, or what finding this hex could lead to.*\n\nA rumour.")).toBe("A rumour.");
  });

  it("keeps real writing, including short lines ending in 'here'", () => {
    expect(filter.clean("The dragon sleeps here.")).toBe("The dragon sleeps here.");
    expect(filter.clean("What the party sees and feels.\nA ruined tower leans over the road.")).toBe("A ruined tower leans over the road.");
    expect(filter.clean("Add salt to the well and it turns red.")).toBe("Add salt to the well and it turns red.");
  });

  it("reads hint lines from a template, skipping headings, rules and {{fields}}", () => {
    expect(templateHintLines("---\nterrain:\n---\n# Hex {{x}}\n---\nHint one.\n### description\n")).toEqual(["Hint one."]);
  });
});

describe("what gets keyed", () => {
  it("needs text or a location link; factions alone don't count", () => {
    expect(isKeyed(hex({ links: { ...noLinks, factions: ["King Guzzard"] } }), false)).toBe(false);
    expect(isKeyed(hex({ description: "<p>Fog.</p>" }), false)).toBe(true);
    expect(isKeyed(hex({ links: { ...noLinks, dungeons: ["Dark Spire"] } }), false)).toBe(true);
  });

  it("player edition doesn't key a hex for hidden or secret text alone", () => {
    expect(isKeyed(hex({ secret: "<p>A cache.</p>" }), false)).toBe(true);
    expect(isKeyed(hex({ secret: "<p>A cache.</p>" }), true)).toBe(false);
  });
});

describe("entry titles", () => {
  it("prefer a named location, then a short landmark, then the terrain", () => {
    expect(entryTitle(hex({ links: { ...noLinks, towns: ["Farwharf"] }, landmark: "<p>A lighthouse</p>" }))).toBe("Farwharf");
    expect(entryTitle(hex({ landmark: "<p>Death Point</p>" }))).toBe("Death Point");
    expect(entryTitle(hex({ landmark: "<p>A crumbling towering pile of stone. It cuts through the forest.</p>" }))).toBe("Grass");
  });
});

describe("table results", () => {
  it("print note links and paths as the note's name", () => {
    expect(tableResultText("[[RPG/world/creatures/Golem]]")).toBe("Golem");
    expect(tableResultText("[[RPG/world/creatures/Golem|the golem]]")).toBe("the golem");
    expect(tableResultText("RPG/duckmage/world/adventures 1/mailman/bandits")).toBe("bandits");
    expect(tableResultText("wolves / bears")).toBe("wolves / bears");
    expect(tableResultText("travellers")).toBe("travellers");
  });
});

describe("manual document", () => {
  const data = (player: boolean): ManualData => ({
    title: "the-coast", version: "1.5.6", date: "2026-10-08", hexCount: 3, keyedCount: 2, player, numberDigits: 2,
    overviewMapUri: "data:image/png;base64,AA", legend: [{ name: "grass", color: "#6a6", hexCount: 3 }], paths: [],
    tables: [{ name: "grass", die: "d6", rows: [{ roll: "1–3", result: "wolves" }], usedBy: 3 }],
    factions: [{ name: "King Guzzard", hexCount: 2, regions: ["Guzzwood"] }], regions: [],
    sections: [{ label: "A1", range: "0101–0302", mapUri: "data:image/png;base64,AA", hexes: [
      hex({ number: "0102", description: "<p>Fog.</p>", secret: player ? "" : "<p>A cache.</p>", links: { ...noLinks, dungeons: ["Dark Spire"] } }),
    ] }],
    index: [{ category: "Dungeons", entries: [{ name: "Dark Spire", hexes: ["0102"] }] }],
  });

  it("has the manual's parts in order", () => {
    const html = buildManualHtml(data(false));
    const order = ["A hexcrawl gazetteer", "Contents", "How to use this book", "Map legend", "Random encounter tables", "Factions and regions", "Hex key", "Index of locations"];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('id="hex-0102"');
    expect(html).toContain("Dark Spire");
  });

  it("marks GM-only text, and the player edition leaves it out", () => {
    expect(buildManualHtml(data(false))).toContain('<span class="hx-gm">GM</span> <b class="hx-label">Secret.</b>');
    const player = buildManualHtml(data(true));
    expect(player).not.toContain("Secret.");
    expect(player).toContain("Player edition");
  });

  it("escapes names", () => {
    const d = data(false);
    d.title = "<b>bad</b>";
    expect(buildManualHtml(d)).not.toContain("<b>bad</b>");
  });
});
