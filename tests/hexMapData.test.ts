import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { TFile } from "obsidian";
import { hasMapData, mapDataLines, mapDataSyncMessage, planCalloutImport, readMapData, setMapData, shownValues, type HexMapDataView } from "../src/hexMapData";
import { getAllSectionData } from "../src/sections";

const VIEW: HexMapDataView = { map: "the-coast", mapLabel: "The Coast", x: 0, y: 1, terrain: "desert rocky", region: "Dustbowl" };
const TEMPLATE = readFileSync("src/defaultHexTemplate.md", "utf8").replace(/\r\n/g, "\n");

describe("hex note Map data callout", () => {
	it("fills the built-in template's callout with what the map has", () => {
		const note = setMapData(TEMPLATE.replace("{{x}}", "0").replace("{{y}}", "1"), VIEW);
		expect(note).toContain(mapDataLines(VIEW).join("\n"));
		expect(note).toContain("> Map: [[_the-coast|The Coast]], hex 0, 1");
		expect(note).toContain("> Name: —");
		expect(note).not.toContain("Filled in from the map");
	});

	it("updates in place and is a no-op when nothing changed", () => {
		const once = setMapData(TEMPLATE, VIEW);
		expect(setMapData(once, VIEW)).toBe(once);
		const moved = setMapData(once, { ...VIEW, terrain: "dunes" });
		expect(moved).toContain("> Terrain: dunes");
		expect(moved.match(/\[!hexmaker\]/g)).toHaveLength(1);
	});

	it("leaves a note without a callout alone unless asked to add one", () => {
		const old = "---\nhexmaker-map: \"[[_the-coast]]\"\n---\n# Hex 0, 1\n\n**Terrain:** mountain\n\n### description\nCold.\n";
		expect(setMapData(old, VIEW)).toBe(old);
		const added = setMapData(old, VIEW, true);
		expect(added.startsWith("---\nhexmaker-map: \"[[_the-coast]]\"\n---\n# Hex 0, 1\n\n> [!hexmaker] Map data\n")).toBe(true);
		// Everything the user wrote is still there.
		expect(added).toContain("**Terrain:** mountain\n\n### description\nCold.\n");
		expect(hasMapData(added)).toBe(true);
	});

	it("keeps CRLF notes CRLF", () => {
		const crlf = setMapData(TEMPLATE, VIEW).replace(/\n/g, "\r\n");
		const out = setMapData(crlf, { ...VIEW, region: "Basin" });
		expect(out).toContain("> Area: Basin\r\n");
		expect(out.replace(/\r\n/g, "")).not.toContain("\n");
	});

	it("reads values a person typed into it", () => {
		const note = setMapData(TEMPLATE, VIEW).replace("> Name: —", "> Name: [[Old Oak|The Old Oak]]");
		expect(readMapData(note)).toEqual({ terrain: "desert rocky", region: "Dustbowl", name: "The Old Oak" });
		expect(readMapData("no callout")).toBeNull();
	});

	it("isn't read as a section", async () => {
		const note = setMapData(TEMPLATE, VIEW);
		const app = { vault: { getAbstractFileByPath: () => Object.create(TFile.prototype) as TFile, read: async () => note } };
		const { text } = await getAllSectionData(app as never, "h.md", note);
		expect([...text.values()].some((v) => v.includes("Terrain: desert rocky"))).toBe(false);
	});
});

describe("Map data callout: region map and locations", () => {
	it("lists them as links only when the hex has them", () => {
		const base = { map: "m", mapLabel: "M", x: 1, y: 2 };
		expect(mapDataLines(base).join("\n")).not.toMatch(/Region map|Locations/);
		const lines = mapDataLines({ ...base, regionMap: { map: "fen", label: "Fen|marsh" }, locations: [{ map: "inn", label: "The Inn" }, { map: "mine", label: "Mine" }] });
		expect(lines).toContain("> Region map: [[_fen|Fenmarsh]]");
		expect(lines).toContain("> Locations: [[_inn|The Inn]], [[_mine|Mine]]");
	});
});

describe("Map data callout: biome", () => {
	it("shows an overworld hex's biome, linked to its note when it has one", () => {
		const base = { map: "w", mapLabel: "World", x: 0, y: 0 };
		expect(mapDataLines(base).join("\n")).not.toMatch(/Biome/);
		expect(mapDataLines({ ...base, biome: { label: "Swamp" } })).toContain("> Biome: Swamp");
		expect(mapDataLines({ ...base, biome: { label: "Ash|wastes", note: "world/biomes/Ash wastes.md" } })).toContain("> Biome: [[world/biomes/Ash wastes|Ashwastes]]");
	});
});

describe("Map data callout phase 2: hand edits back to the map", () => {
	const view: HexMapDataView = { map: "coast", mapLabel: "Coast", x: 3, y: 4, terrain: "forest", region: "Dustbowl", name: "Old Oak" };
	const shown = shownValues(mapDataLines(view));
	const note = (lines = mapDataLines(view)) => `# Hex 3, 4\n\n${lines.join("\n")}\n\n### Description\nText.\n`;
	const edit = (from: string, to: string) => note().replace(from, to);

	it("finds nothing to do in an untouched callout", () => {
		expect(planCalloutImport(note(), shown, shown)).toEqual({ apply: {}, notApplied: [], unreadable: [] });
		expect(planCalloutImport("no callout", shown, shown)).toBeNull();
	});

	it("applies an edited field when the map still has what the callout showed", () => {
		const r = planCalloutImport(edit("> Terrain: forest", "> terrain :  Swamp "), shown, shown)!;
		expect(r.apply).toEqual({ terrain: "Swamp" });
		expect(planCalloutImport(edit("> Name: Old Oak", "> Name: [[Oak note|The Great Oak]]"), shown, shown)!.apply).toEqual({ name: "The Great Oak" });
	});

	it("reads a dash, 'none' or nothing as clearing the field", () => {
		expect(planCalloutImport(edit("> Area: Dustbowl", "> Area: —"), shown, shown)!.apply).toEqual({ region: null });
		expect(planCalloutImport(edit("> Area: Dustbowl", "> Area:"), shown, shown)!.apply).toEqual({ region: null });
		expect(planCalloutImport(edit("> Name: Old Oak", "> Name: none"), shown, shown)!.apply).toEqual({ name: null });
	});

	it("ignores a change of case or spacing", () => {
		expect(planCalloutImport(edit("> Terrain: forest", "> Terrain:   FOREST"), shown, shown)!.apply).toEqual({});
	});

	it("never writes over a newer map value: the edit is reported instead", () => {
		const now = shownValues(mapDataLines({ ...view, terrain: "hills" }));
		const r = planCalloutImport(edit("> Terrain: forest", "> Terrain: swamp"), shown, now)!;
		expect(r.apply).toEqual({});
		expect(r.notApplied).toEqual(["Terrain: swamp (the map has changed it to hills since)"]);
	});

	it("doesn't count a stale copy as an edit (the map moved on, the callout didn't)", () => {
		const now = shownValues(mapDataLines({ ...view, terrain: "hills" }));
		expect(planCalloutImport(note(), shown, now)).toEqual({ apply: {}, notApplied: [], unreadable: [] });
	});

	it("imports nothing when it doesn't know what the callout showed (the map wins, as before)", () => {
		const r = planCalloutImport(edit("> Terrain: forest", "> Terrain: swamp"), undefined, shown)!;
		expect(r.apply).toEqual({});
		expect(r.notApplied).toEqual([]);
	});

	it("doesn't read back lines the map owns elsewhere", () => {
		const v2 = { ...view, regionMap: { map: "fen", label: "Fen" } };
		const s2 = shownValues(mapDataLines(v2));
		const r = planCalloutImport(note(mapDataLines(v2)).replace("[[_fen|Fen]]", "[[_moor|Moor]]"), s2, s2)!;
		expect(r.apply).toEqual({});
		expect(r.notApplied).toEqual(["Region map: [[_moor|Moor]] (change this on the map)"]);
	});

	it("reports lines it can't read, and skips the template's placeholder and kept lines", () => {
		const text = note([...mapDataLines(view), "> Treasure: 40gp", "> just a thought", ">", "> Filled in from the map by Hexmaker.", "> Not read: older"]);
		const r = planCalloutImport(text, shown, shown)!;
		expect(r.unreadable).toEqual(["Treasure: 40gp", "just a thought"]);
		// A field written twice: the second is unreadable.
		expect(planCalloutImport(note([...mapDataLines(view), "> Terrain: swamp"]), shown, shown)!.unreadable).toEqual(["Terrain: swamp"]);
	});

	it("keeps what wasn't applied in the callout, once", () => {
		const once = setMapData(edit("> Terrain: forest", "> Terrain: swamp"), view, false, ["Not applied: Terrain: swamp (Switch to Build to paint terrain.)", "Not read: Treasure: 40gp"]);
		expect(once).toContain("> Terrain: forest");
		expect(once).toContain("> Not applied: Terrain: swamp (Switch to Build to paint terrain.)");
		expect(once).toContain("> Not read: Treasure: 40gp");
		// Rewriting keeps them, and the same note isn't added twice.
		const twice = setMapData(once, { ...view, terrain: "hills" }, false, ["Not read: Treasure: 40gp"]);
		expect(twice.match(/Not read: Treasure/g)?.length).toBe(1);
		expect(twice).toContain("> Not applied: Terrain: swamp");
		expect(twice).toContain("> Terrain: hills");
		expect(setMapData(twice, { ...view, terrain: "hills" })).toBe(twice);
	});

	it("says what happened in one notice", () => {
		expect(mapDataSyncMessage("Coast 3, 4", { applied: [], notApplied: [], unreadable: [] })).toBeNull();
		expect(mapDataSyncMessage("Coast 3, 4", { applied: ["Terrain: swamp"], notApplied: ["Region: Fen (x)"], unreadable: ["a", "b"] }))
			.toBe(`Coast 3, 4: Put on the map from the note's Map data: Terrain: swamp. Not applied: Region: Fen (x). 2 lines in Map data couldn't be read; marked "Not read:" in the note.`);
	});
});
