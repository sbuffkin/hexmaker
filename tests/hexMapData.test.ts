import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { TFile } from "obsidian";
import { hasMapData, mapDataLines, readMapData, setMapData, type HexMapDataView } from "../src/hexMapData";
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
		expect(out).toContain("> Region: Basin\r\n");
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
