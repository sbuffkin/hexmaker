import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { TFile } from "obsidian";
import {
	hexNoteMapKey, hexNoteMapName, isMapNoteLink, linkNotePathKey, linkTokenMap, mapNameFromRef, mapNoteLink,
	noteLink, noteRefTarget, renameHexMapKey,
} from "../src/noteFormats";
import { takeBodyFields } from "../src/hexBodyFields";
import { mapDataLines, moveBodyFieldsIntoMapData, planCalloutImport, readMapData, setMapData, shownValues, type HexMapDataView } from "../src/hexMapData";
import { withMapLink } from "../src/maps/mapNote";
import { getTokenDataFromCache, readTokenPlace, setTokenHex, tokenMapValue } from "../src/frontmatter";
import { runNoteFormatUpgrades, runUpgrade } from "../src/migrations/registry";
import type { NoteFormatHost } from "../src/migrations/noteRewrites";
import { MemVault } from "./helpers/memVault";

/**
 * Round-6 note-format changes (NF1 hex notes' `map:` key, NF2 old body
 * lines into Map data, NF3 links for token maps, token notes and workflow
 * templates). Old forms are pinned by tests/fixtures/compat/note-formats.
 */

const fixture = (name: string) =>
	readFileSync(path.join(process.cwd(), "tests", "fixtures", "compat", "note-formats", name), "utf8").replace(/\r\n/g, "\n");

describe("NF1: hex notes link their map note under map:", () => {
	it("reads the old and the new key", () => {
		expect(hexNoteMapName({ "hexmaker-map": "[[_the-coast]]" })).toBe("the-coast");
		expect(hexNoteMapName({ map: "[[_the-coast]]" })).toBe("the-coast");
		expect(hexNoteMapName({ map: "[[hexes/the-coast/_the-coast|The Coast]]" })).toBe("the-coast");
		// A map note's format number isn't a link.
		expect(hexNoteMapName({ "hexmaker-map": 5 })).toBe("");
		// map: of the user's own: the old key still names the map.
		expect(hexNoteMapName({ map: "Sword Coast", "hexmaker-map": "[[_c]]" })).toBe("c");
	});

	it("writes under map:, or under hexmaker-map: when map: is the user's", () => {
		expect(hexNoteMapKey({})).toBe("map");
		expect(hexNoteMapKey({ map: "[[_coast]]" })).toBe("map");
		expect(hexNoteMapKey({ map: "Sword Coast" })).toBe("hexmaker-map");
		expect(hexNoteMapKey({ map: "[[Sword Coast]]" })).toBe("hexmaker-map");
	});

	it("renames only the key, keeping the value, comments and the other keys", () => {
		const old = fixture("hex-note-1.5.6.md");
		const r = renameHexMapKey(old);
		expect(r.status).toBe("renamed");
		expect(r.content).toBe(old.replace('hexmaker-map: "[[_the-coast]]"', 'map: "[[_the-coast]]"'));
		// Idempotent.
		expect(renameHexMapKey(r.content)).toEqual({ content: r.content, status: "none" });
	});

	it("leaves a note whose map: is the user's alone", () => {
		const own = fixture("hex-note-own-map-key.md");
		expect(renameHexMapKey(own)).toEqual({ content: own, status: "conflict" });
	});

	it("drops the old key when map: already holds the same link; keeps CRLF", () => {
		const both = '---\r\nmap: "[[_c]]"\r\nhexmaker-map: "[[_c]]"\r\n---\r\n# Hex\r\n';
		expect(renameHexMapKey(both)).toEqual({ content: '---\r\nmap: "[[_c]]"\r\n---\r\n# Hex\r\n', status: "renamed" });
	});

	it("never touches a map note's format marker", () => {
		const mapNote = "---\nhexmaker-map: 5\npalette: Default\n---\n# Coast\n";
		expect(renameHexMapKey(mapNote).status).toBe("none");
	});

	it("new hex notes get map:, or hexmaker-map: beside a template's own map:", () => {
		expect(withMapLink("---\ntags: [hex]\n---\n# Hex\n", "coast")).toBe('---\nmap: "[[_coast]]"\ntags: [hex]\n---\n# Hex\n');
		expect(withMapLink("---\nmap: Sword Coast\n---\n# Hex\n", "coast")).toBe('---\nhexmaker-map: "[[_coast]]"\nmap: Sword Coast\n---\n# Hex\n');
		// A template copied from a hex note: its old link is replaced, not doubled.
		expect(withMapLink('---\nmap: "[[_old]]"\nhexmaker-map: "[[_old]]"\n---\n# Hex\n', "coast")).toBe('---\nmap: "[[_coast]]"\n---\n# Hex\n');
	});
});

describe("NF2: old Terrain / Region lines move into Map data", () => {
	const view: HexMapDataView = { map: "the-coast", mapLabel: "The Coast", x: 0, y: 1, terrain: "desert rocky", region: "Basin" };

	it("takes filled lines, as typed, and leaves placeholders", () => {
		const r = takeBodyFields("# Hex\n\n**Region:** [[Dustbowl]]\n**Terrain:** mountain\n\n### Description\n");
		expect(r.taken).toEqual([{ field: "Region", value: "[[Dustbowl]]" }, { field: "Terrain", value: "mountain" }]);
		expect(r.content).toBe("# Hex\n\n### Description\n");
		const blank = "# Hex\n\n**Terrain:** *(woods / marsh / …)*\n**Region:**\n";
		expect(takeBodyFields(blank)).toEqual({ content: blank, taken: [] });
	});

	it("moves them under the map's own values; the map's values win", () => {
		const r = moveBodyFieldsIntoMapData(fixture("hex-note-1.5.6.md"), view);
		expect(r.moved.length).toBe(2);
		expect(r.content).toContain([
			"# Hex 0, 1",
			"",
			"> [!hexmaker] Map data",
			"> Map: [[_the-coast|The Coast]], hex 0, 1",
			"> Terrain: desert rocky",
			"> Area: Basin",
			"> Name: —",
			"> Old region: [[Dustbowl]]",
			"> Old terrain: mountain",
			"",
			"### Description",
		].join("\n"));
		expect(r.content).not.toContain("**Terrain:**");
		// The moved lines are never read as map edits.
		expect(readMapData(r.content)).toEqual({ terrain: "desert rocky", region: "Basin" });
		const shown = shownValues(mapDataLines(view));
		expect(planCalloutImport(r.content, shown, shown)).toEqual({ apply: {}, notApplied: [], unreadable: [] });
		// Idempotent: a second move changes nothing, and a later refresh keeps the lines.
		expect(moveBodyFieldsIntoMapData(r.content, view)).toEqual({ content: r.content, moved: [] });
		const refreshed = setMapData(r.content, { ...view, terrain: "dunes" });
		expect(refreshed).toContain("> Terrain: dunes\n");
		expect(refreshed).toContain("> Old terrain: mountain\n");
	});

	it("goes into an existing callout, keeping CRLF", () => {
		const note = ["# Hex 0, 1", "", ...mapDataLines(view), "", "**Terrain:** forest", "", "Text."].join("\r\n");
		const r = moveBodyFieldsIntoMapData(note, view);
		expect(r.content).toBe(["# Hex 0, 1", "", ...mapDataLines(view), "> Old terrain: forest", "", "Text."].join("\r\n"));
	});
});

describe("NF3: links for token maps, token notes and workflow templates", () => {
	it("reads a map as a link or a plain name", () => {
		expect(mapNameFromRef("the-coast")).toBe("the-coast");
		expect(mapNameFromRef("[[_the-coast]]")).toBe("the-coast");
		expect(mapNameFromRef("[[hexes/the-coast/_the-coast|Coast]]")).toBe("the-coast");
		expect(mapNameFromRef(undefined)).toBe("");
		expect(isMapNoteLink("[[_x]]")).toBe(true);
		expect(isMapNoteLink("[[x]]")).toBe(false);
		expect(mapNoteLink("a|b")).toBe("a|b");
		expect(tokenMapValue("")).toBe("");
	});

	it("note paths become links ([[path]] without .md); readers take both", () => {
		expect(noteLink("world/npcs/Ana.md")).toBe("[[world/npcs/Ana]]");
		expect(noteRefTarget('"[[world/npcs/Ana|Ana]]"')).toEqual({ target: "world/npcs/Ana", link: true });
		expect(noteRefTarget("world/npcs/Ana.md")).toEqual({ target: "world/npcs/Ana.md", link: false });
	});

	it("rewrites token-map once; leaves links and non-tokens", () => {
		const old = fixture("token-note-1.5.6.md");
		const r = linkTokenMap(old);
		expect(r.changed).toBe(true);
		expect(r.content).toBe(old.replace("token-map: the-coast", 'token-map: "[[_the-coast]]"'));
		expect(linkTokenMap(r.content)).toEqual({ content: r.content, changed: false });
		const notToken = "---\ntoken: false\ntoken-map: c\n---\n";
		expect(linkTokenMap(notToken).changed).toBe(false);
	});

	it("rewrites token-link and template-file only when they name a note", () => {
		const exists = (p: string) => p === "world/npcs/Ana the smith.md" || p === "world/workflows/templates/npc.md";
		const proxy = fixture("token-proxy-1.5.6.md");
		const r = linkNotePathKey(proxy, "token-link", exists);
		expect(r.content).toBe(proxy.replace("token-link: world/npcs/Ana the smith.md", 'token-link: "[[world/npcs/Ana the smith]]"'));
		expect(linkNotePathKey(r.content, "token-link", exists).changed).toBe(false);
		const wf = fixture("workflow-1.5.6.md");
		expect(linkNotePathKey(wf, "template-file", exists).content).toContain('template-file: "[[world/workflows/templates/npc]]"');
		// A path that names nothing is left as typed.
		expect(linkNotePathKey(wf, "template-file", () => false).changed).toBe(false);
	});

	it("token readers accept the old and new forms; writers write links", async () => {
		const file = Object.assign(new TFile(), { path: "world/tokens/Ana.md", basename: "Ana" });
		const original = Object.assign(new TFile(), { path: "world/npcs/Ana the smith.md", basename: "Ana the smith" });
		const app = (fm: Record<string, unknown>) => ({
			vault: { getAbstractFileByPath: (p: string) => (p === original.path ? original : null) },
			metadataCache: { getFileCache: () => ({ frontmatter: fm }), getFirstLinkpathDest: (t: string) => (t === "Ana the smith" ? original : null) },
		}) as never;
		expect(getTokenDataFromCache(app({ token: true, "token-map": "coast", "token-link": "world/npcs/Ana the smith.md" }), file)).toMatchObject({ map: "coast", tokenLink: original.path, title: "Ana the smith" });
		expect(getTokenDataFromCache(app({ token: true, "token-map": "[[_coast]]", "token-link": "[[world/npcs/Ana the smith]]" }), file)).toMatchObject({ map: "coast", tokenLink: original.path });
		// A short link resolves the way Obsidian does.
		expect(getTokenDataFromCache(app({ token: true, "token-link": "[[Ana the smith]]" }), file)?.tokenLink).toBe(original.path);

		const vault = new MemVault({ "world/tokens/Ana.md": "---\ntoken: true\ntoken-map: coast\n---\n# Ana\n" });
		const a = vault.app();
		expect(await readTokenPlace(a as never, "world/tokens/Ana.md")).toEqual({ hex: "", map: "coast" });
		await setTokenHex(a as never, "world/tokens/Ana.md", "1_2", "coast");
		expect(vault.frontmatter("world/tokens/Ana.md")?.["token-map"]).toBe("[[_coast]]");
		expect(await readTokenPlace(a as never, "world/tokens/Ana.md")).toEqual({ hex: "1_2", map: "coast" });
	});
});

// ── the one-time rewrite, on an in-memory vault ───────────────────────────

const HEX = "hexes";
function vaultHost(files: Record<string, string>, settings: Partial<NoteFormatHost["settings"]> = {}) {
	const vault = new MemVault(files);
	let saves = 0;
	const memory = new Map<string, Record<string, string>>();
	const hexes: Record<string, { terrain?: string; region?: string }> = { "0_1": { terrain: "desert rocky", region: "Basin" } };
	const host: NoteFormatHost = {
		app: vault.app() as never,
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: HEX, workflowsFolder: "world/workflows", maps: [{ name: "the-coast" }], ...settings },
		mapStore: {
			isReady: (m?: string) => m === undefined || m === "the-coast",
			resolve: (p: string) => {
				const m = /^hexes\/([^/]+)\/(-?\d+_-?\d+)\.md$/.exec(p);
				return m ? { map: m[1], key: m[2] } : null;
			},
		},
		hexMapDataView: (map, x, y) => ({ map, mapLabel: "The Coast", x, y, ...(hexes[`${x}_${y}`] ?? {}) }),
		calloutMemory: { set: (p, v) => { memory.set(p, v); } },
		saveSettings: async () => { saves++; },
	};
	return { vault, host, saves: () => saves, memory };
}

const OLD_VAULT = () => ({
	[`${HEX}/the-coast/0_1.md`]: fixture("hex-note-1.5.6.md"),
	[`${HEX}/the-coast/2_2.md`]: fixture("hex-note-own-map-key.md"),
	[`${HEX}/the-coast/_the-coast.md`]: "---\nhexmaker-map: 5\npalette: Default\n---\n# The Coast\n",
	"world/tokens/Ana the smith.md": fixture("token-note-1.5.6.md"),
	"world/tokens/Ana the smith-2.md": fixture("token-proxy-1.5.6.md"),
	"world/npcs/Ana the smith.md": "# Ana\n",
	"world/workflows/npc.md": fixture("workflow-1.5.6.md"),
	"world/workflows/templates/npc.md": "## name\n$name\n",
	"world/workflows/_notes.md": "---\ntemplate-file: x.md\n---\n",
});

function backupNotes(vault: MemVault, id: string): Record<string, string> {
	const entry = [...vault.binaries].find(([p]) => p.includes("/backups/note-formats-") && p.endsWith(`/${id}.json.gz`));
	if (!entry) throw new Error(`no backup for ${id}: ${[...vault.binaries.keys()].join(", ")}`);
	return (JSON.parse(gunzipSync(entry[1]).toString("utf8")) as { notes: Record<string, string> }).notes;
}

describe("one-time note-format rewrite", () => {
	it("rewrites each old form once, backed up first, and records it", async () => {
		const before = OLD_VAULT();
		const { vault, host, saves, memory } = vaultHost(before);
		const results = await runNoteFormatUpgrades(host);
		expect(results.map((r) => [r.id, r.changed.length, r.error])).toEqual([
			["hex-map-key", 1, undefined], ["hex-body-lines", 1, undefined], ["note-links", 3, undefined], ["ref-links", 0, undefined], ["area-line", 0, undefined],
		]);
		expect(host.settings.noteFormatUpgrades).toEqual(["hex-map-key", "hex-body-lines", "note-links", "ref-links", "area-line"]);
		expect(saves()).toBe(1);

		const hex = vault.files.get(`${HEX}/the-coast/0_1.md`)!;
		expect(hex).toContain('map: "[[_the-coast]]"');
		expect(hex).not.toContain("hexmaker-map");
		expect(hex).toContain("> Old terrain: mountain");
		expect(hex).toContain("> Old region: [[Dustbowl]]");
		expect(hex).toContain("tags: [hex]  # my tag");
		expect(memory.get(`${HEX}/the-coast/0_1.md`)?.terrain).toBe("desert rocky");
		// The note with its own map: key is left as it was, and reported.
		expect(vault.files.get(`${HEX}/the-coast/2_2.md`)).toBe(before[`${HEX}/the-coast/2_2.md`]);
		expect(results[0].skipped.map((s) => s.path)).toEqual([`${HEX}/the-coast/2_2.md`]);
		// Map notes and "_" notes are never touched.
		expect(vault.files.get(`${HEX}/the-coast/_the-coast.md`)).toBe(before[`${HEX}/the-coast/_the-coast.md`]);
		expect(vault.files.get("world/workflows/_notes.md")).toBe(before["world/workflows/_notes.md"]);
		expect(vault.files.get("world/tokens/Ana the smith.md")).toContain('token-map: "[[_the-coast]]"');
		expect(vault.files.get("world/tokens/Ana the smith-2.md")).toContain('token-link: "[[world/npcs/Ana the smith]]"');
		expect(vault.files.get("world/workflows/npc.md")).toContain('template-file: "[[world/workflows/templates/npc]]"');

		// Backups hold every rewritten note exactly as it was.
		expect(backupNotes(vault, "hex-map-key")).toEqual({ [`${HEX}/the-coast/0_1.md`]: before[`${HEX}/the-coast/0_1.md`] });
		expect(Object.keys(backupNotes(vault, "hex-body-lines"))).toEqual([`${HEX}/the-coast/0_1.md`]);
		const links = backupNotes(vault, "note-links");
		expect(Object.keys(links).sort()).toEqual(["world/tokens/Ana the smith-2.md", "world/tokens/Ana the smith.md", "world/workflows/npc.md"]);
		expect(links["world/workflows/npc.md"]).toBe(before["world/workflows/npc.md"]);

		// Recorded: the next start does nothing at all.
		const writes = vault.writes.length;
		const binaries = vault.binaries.size;
		expect(await runNoteFormatUpgrades(host)).toEqual([]);
		expect(vault.writes.length).toBe(writes);
		expect(vault.binaries.size).toBe(binaries);
		expect(saves()).toBe(1);
	});

	it("is idempotent even when run again unrecorded: nothing changes, no backup", async () => {
		const { vault, host } = vaultHost(OLD_VAULT());
		await runNoteFormatUpgrades(host);
		const snapshot = new Map(vault.files);
		const writes = vault.writes.length;
		const binaries = vault.binaries.size;
		for (const id of ["hex-map-key", "hex-body-lines", "note-links", "ref-links"] as const) {
			const r = await runUpgrade(host, id);
			expect(r.changed).toEqual([]);
			expect(r.backup).toBeUndefined();
		}
		expect(vault.writes.length).toBe(writes);
		expect(vault.binaries.size).toBe(binaries);
		expect(new Map(vault.files)).toEqual(snapshot);
	});

	it("writes no note and no backup in a vault with nothing to change (records once)", async () => {
		const { vault, host, saves } = vaultHost({
			[`${HEX}/the-coast/0_1.md`]: '---\nmap: "[[_the-coast]]"\n---\n# Hex 0, 1\n',
			"world/tokens/T.md": '---\ntoken: true\ntoken-map: "[[_the-coast]]"\n---\n',
		});
		await runNoteFormatUpgrades(host);
		expect(vault.writes).toEqual([]);
		expect(vault.binaries.size).toBe(0);
		expect(saves()).toBe(1);
		await runNoteFormatUpgrades(host);
		expect(saves()).toBe(1);
	});

	it("changes nothing and records nothing when the backup can't be saved", async () => {
		const before = OLD_VAULT();
		const { vault, host, saves } = vaultHost(before);
		vault.failBinary = true;
		const results = await runNoteFormatUpgrades(host);
		expect(results.every((r) => r.changed.length === 0)).toBe(true);
		expect(results.filter((r) => r.error).map((r) => r.id)).toEqual(["hex-map-key", "hex-body-lines", "note-links"]);
		expect(new Map(vault.files)).toEqual(new Map(Object.entries(before)));
		// Only the upgrades with nothing to change here (no palettes; Map data boxes already say Area) are recorded.
		expect(host.settings.noteFormatUpgrades).toEqual(["ref-links", "area-line"]);
		expect(saves()).toBe(1);
	});

	it("leaves a map that isn't loaded for later, and keeps ids it doesn't know", async () => {
		const { vault, host } = vaultHost(OLD_VAULT(), { noteFormatUpgrades: ["from-a-newer-build", "hex-map-key", "note-links"] });
		host.mapStore.isReady = () => false;
		const [r] = await runNoteFormatUpgrades(host);
		expect(r.id).toBe("hex-body-lines");
		expect(r.changed).toEqual([]);
		expect(r.skipped.map((s) => s.path)).toEqual([`${HEX}/the-coast/0_1.md`]);
		expect(vault.files.get(`${HEX}/the-coast/0_1.md`)).toContain("**Terrain:** mountain");
		expect(host.settings.noteFormatUpgrades).toEqual(["from-a-newer-build", "hex-map-key", "note-links", "hex-body-lines", "ref-links", "area-line"]);
	});
});
