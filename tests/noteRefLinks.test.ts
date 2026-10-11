import { describe, it } from "node:test";
import { spaceRuntime } from "../src/modules/space/runtime";
import expect from "expect";
import { gunzipSync } from "node:zlib";
import {
	flowList, linkFrontmatterKey, linkFrontmatterList, pathLink, refBasename, refListItems,
} from "../src/noteFormats";
import { buildMapNote, parseMapNote, updateMapNote, type MapNoteData } from "../src/maps/mapNote";
import { buildPaletteNote, readChildPalette, setChildPalette } from "../src/palettes/paletteNote";
import { generatorMetaLinks, generatorMetaNames } from "../src/worldgen/generatorRefs";
import { modelToMarkdown, parseModelMarkdown, type HexWfcModel } from "../packages/hex-wfc/src";
import { generatorPathOf, parseSave, retargetSave, serializeSave, type GeneratorSave } from "../src/worldgen/saveFormat";
import {
	buildWorldTypes, linkWorldTypePalettes, parseWorldTypes, updateWorldTypes, worldTypeCells, worldTypeCellsLinked, WORLD_TYPE_COLUMNS,
	type WorldTypeRow,
} from "../src/space/worldTypes";
import { runNoteFormatUpgrades, runUpgrade, type NoteFormatHost } from "../src/noteFormatUpgrade";
import { MemVault } from "./helpers/memVault";

/**
 * NF3 follow-up: the remaining plain references (map notes' palette,
 * palettes' child-palette, generators' palette / source-map(s) / blend-of,
 * saves' generator-path, world types' Palette column) are written as links
 * from now on, read in both forms forever, and rewritten once (backed up).
 */

describe("reference helpers", () => {
	it("reads a link or a plain name", () => {
		expect(refBasename("Default")).toBe("Default");
		expect(refBasename("[[world/palettes/Default]]")).toBe("Default");
		expect(refBasename("[[Default|My palette]]")).toBe("Default");
		expect(refBasename("[[world/palettes/Space - Planet.md]]")).toBe("Space - Planet");
		expect(refBasename(undefined)).toBe("");
		expect(pathLink("world/palettes/Default.md")).toBe("[[world/palettes/Default]]");
		expect(pathLink("a|b")).toBeUndefined();
	});

	it("reads lists written inline, block-style (JSON) or joined with +", () => {
		expect(refListItems("a + b")).toEqual(["a", "b"]);
		expect(refListItems('["[[_a]]", "b"]')).toEqual(["[[_a]]", "b"]);
		expect(refListItems(`[ "[[_a]]", 'b, c' ]`)).toEqual(["[[_a]]", "b, c"]);
		expect(refListItems("[[_a]]")).toEqual(["[[_a]]"]);
		expect(flowList(["[[_a]]", "b"])).toBe('["[[_a]]", "b"]');
	});

	it("rewrites one key's plain value, leaving links, unknown names and other lines", () => {
		const text = "---\r\npalette: Default\r\n# mine\r\nother: Default\r\n---\r\nbody\r\n";
		const link = (n: string) => (n === "Default" ? "[[world/palettes/Default]]" : undefined);
		const r = linkFrontmatterKey(text, "palette", link);
		expect(r).toEqual({ content: text.replace("palette: Default", 'palette: "[[world/palettes/Default]]"'), changed: true });
		expect(linkFrontmatterKey(r.content, "palette", link).changed).toBe(false);
		expect(linkFrontmatterKey("---\npalette: Gone\n---\n", "palette", link).changed).toBe(false);
		const list = linkFrontmatterList("---\nsource-maps: a + gone\n---\n", "source-maps", (n) => (n === "a" ? "[[_a]]" : undefined));
		expect(list.content).toBe('---\nsource-maps: ["[[_a]]", "gone"]\n---\n');
		expect(linkFrontmatterList(list.content, "source-maps", () => "[[_x]]").changed).toBe(false);
		expect(linkFrontmatterList("---\nsource-maps: gone + lost\n---\n", "source-maps", () => undefined).changed).toBe(false);
	});
});

describe("map notes: palette and region-palette", () => {
	const data: MapNoteData = {
		settings: { paletteName: "Default", regions: { footprint: "hex", size: 3, palette: "Badlands" } },
		hexes: new Map(), paths: [],
	};

	it("writes a link to an installed palette's note, the name otherwise", () => {
		const linked = buildMapNote("coast", data, { paletteNote: "world/palettes/Default", regionPaletteNote: "world/palettes/Badlands" });
		expect(linked).toContain('palette: "[[world/palettes/Default]]"');
		expect(linked).toContain('region-palette: "[[world/palettes/Badlands]]"');
		const plain = buildMapNote("coast", data);
		expect(plain).toMatch(/^palette: Default$/m);
		expect(plain).toMatch(/^region-palette: Badlands$/m);
	});

	it("reads both forms as the palette's name; a rewrite keeps the link", () => {
		const ctx = { paletteNote: "world/palettes/Default", regionPaletteNote: "world/palettes/Badlands" };
		const linked = buildMapNote("coast", data, ctx);
		for (const text of [linked, buildMapNote("coast", data), linked.replace('"[[world/palettes/Default]]"', '"[[Default|The default]]"')]) {
			const back = parseMapNote(text)!;
			expect(back.settings.paletteName).toBe("Default");
			expect(back.settings.regions?.palette).toBe("Badlands");
		}
		expect(updateMapNote(linked, "coast", parseMapNote(linked)!, ctx)).toBe(linked);
	});
});

describe("palette notes: child-palette", () => {
	it("writes a link when the child palette has a note; reads both forms", () => {
		const note = buildPaletteNote([], "Expanded", undefined, "world/palettes/Expanded.md");
		expect(note).toContain('child-palette: "[[world/palettes/Expanded]]"');
		expect(readChildPalette(note)).toBe("Expanded");
		expect(buildPaletteNote([], "Gone")).toContain('child-palette: "Gone"');
		expect(readChildPalette('---\nchild-palette: "[[Space - System|System]]"\n---\n')).toBe("Space - System");
		const changed = setChildPalette(note, "Space - System", "world/palettes/Space - System.md");
		expect(changed).toContain('child-palette: "[[world/palettes/Space - System]]"');
		// Same palette: left as it is (a plain name isn't rewritten on every sync).
		expect(setChildPalette('---\nchild-palette: "Expanded"\n---\n', "Expanded", "world/palettes/Expanded.md")).toBe('---\nchild-palette: "Expanded"\n---\n');
	});
});

describe("generator notes: palette, source-map(s), blend-of", () => {
	const notes = {
		palette: (n: string) => (n === "Default" ? "world/palettes/Default.md" : undefined),
		map: (n: string) => n === "the-coast" || n === "the-north",
		generator: (n: string) => (n === "valley" ? "world/generators/valley.md" : undefined),
	};
	const model = (meta: Record<string, string>): HexWfcModel => ({
		name: "g", terrains: [{ name: "grass", weight: 1 }, { name: "hill", weight: 1 }], adjacency: [{ a: "grass", b: "hill", weight: 1 }] as never, meta,
	});

	it("names in memory, links on disk; unknown names stay as typed", () => {
		const meta = { palette: "Default", "source-maps": "the-coast + lost", "blend-of": "valley + preset-thing", created: "2026-10-11" };
		const out = generatorMetaLinks(meta, notes);
		expect(out).toEqual({
			palette: "[[world/palettes/Default]]",
			"source-maps": '["[[_the-coast]]", "lost"]',
			"blend-of": '["[[world/generators/valley]]", "preset-thing"]',
			created: "2026-10-11",
		});
		expect(generatorMetaNames(out)).toEqual(meta);
		expect(generatorMetaLinks({ "source-map": "the-north" }, notes)).toEqual({ "source-map": "[[_the-north]]" });
		expect(generatorMetaNames({ "source-map": "[[_the-north]]" })).toEqual({ "source-map": "the-north" });
		// Older plain files read the same.
		expect(generatorMetaNames({ palette: "Default", "source-maps": "a + b" })).toEqual({ palette: "Default", "source-maps": "a + b" });
	});

	it("round-trips through the file, inline lists and Obsidian's block lists alike", () => {
		const meta = { palette: "Default", "source-maps": "the-coast + the-north" };
		const text = modelToMarkdown(model(generatorMetaLinks(meta, notes)));
		expect(text).toContain('palette: "[[world/palettes/Default]]"');
		expect(text).toContain('source-maps: ["[[_the-coast]]", "[[_the-north]]"]');
		expect(generatorMetaNames(parseModelMarkdown(text).model.meta)).toMatchObject(meta);
		// The Properties panel (processFrontMatter) writes lists as block lists.
		const block = text.replace('source-maps: ["[[_the-coast]]", "[[_the-north]]"]', 'source-maps:\n  - "[[_the-coast]]"\n  - "[[_the-north]]"');
		const back = parseModelMarkdown(block).model;
		expect(generatorMetaNames(back.meta)).toMatchObject(meta);
		expect(back.terrains.map((t) => t.name)).toEqual(["grass", "hill"]);
		expect(modelToMarkdown(back)).toContain('source-maps: ["[[_the-coast]]", "[[_the-north]]"]');
	});
});

describe("generator saves: generator-path", () => {
	const save: GeneratorSave = {
		name: "s", version: "9.9.9", format: 1, created: "2026-10-11", generatorName: "valley", generatorPath: "world/generators/valley.md",
		palette: "Default", seed: 1, cols: 1, rows: 1, stagger: "odd", orientation: "flat", settings: {},
		cells: new Map([["0_0", "grass"]]), paths: [], generatorMarkdown: "",
	};

	it("writes a link; reads a link, a short link or an old plain path", () => {
		const text = serializeSave(save);
		expect(text).toContain('generator-path: "[[world/generators/valley]]"');
		const back = parseSave(text);
		if ("error" in back) throw new Error(back.error);
		expect(back.save.generatorPath).toBe("world/generators/valley.md");
		expect(generatorPathOf("world/generators/valley.md")).toBe("world/generators/valley.md");
		expect(generatorPathOf("[[valley]]")).toBe("valley.md");
		expect(generatorPathOf("'[[world/generators/valley]]'")).toBe("world/generators/valley.md");
	});

	it("follows a rename even when Obsidian already updated the link", () => {
		const text = serializeSave(save);
		const to = { name: "dale", path: "world/generators/dale.md" };
		const from = { name: "valley", path: "world/generators/valley.md" };
		const expected = text.replace("generator: valley", "generator: dale").replace("[[world/generators/valley]]", "[[world/generators/dale]]");
		expect(retargetSave(text, from, to)).toBe(expected);
		// Obsidian rewrote the link first: the name still follows.
		expect(retargetSave(text.replace("[[world/generators/valley]]", "[[world/generators/dale]]"), from, to)).toBe(expected);
		expect(retargetSave(text.replace("[[world/generators/valley]]", "[[dale]]"), from, to)).toBe(expected);
		expect(retargetSave(text, { name: "other", path: "world/generators/other.md" }, to)).toBe(text);
	});
});

describe("world types: Palette column", () => {
	const rows: WorldTypeRow[] = [{ world: "ocean planet", palette: "Space - Planet" }, { world: "gas giant", palette: "Gone" }];
	const links = { paletteNote: (n: string) => (n === "Space - Planet" ? "world/palettes/Space - Planet.md" : undefined) };
	const col = WORLD_TYPE_COLUMNS.indexOf("Palette");

	it("writes links to palettes with notes, reads both forms", () => {
		expect(worldTypeCellsLinked(rows[0], links)[col]).toBe("[[world/palettes/Space - Planet]]");
		expect(worldTypeCellsLinked(rows[1], links)[col]).toBe("Gone");
		expect(worldTypeCells(rows[0])[col]).toBe("Space - Planet");
		const note = buildWorldTypes("T", rows, {}, links);
		expect(note).toContain("| [[world/palettes/Space - Planet]] |");
		expect(parseWorldTypes(note).rows.map((r) => r.palette)).toEqual(["Space - Planet", "Gone"]);
		// Unchanged rows: the table isn't rewritten.
		expect(updateWorldTypes(note, parseWorldTypes(note).rows, {}, links)).toBe(note);
	});

	it("the one-time rewrite links plain cells once", () => {
		const plain = buildWorldTypes("T", rows);
		expect(plain).toContain("| Space - Planet |");
		const linked = linkWorldTypePalettes(plain, links);
		expect(linked).toContain("| [[world/palettes/Space - Planet]] |");
		expect(linked).toContain("| Gone |");
		expect(parseWorldTypes(linked).rows).toEqual(parseWorldTypes(plain).rows);
		expect(linkWorldTypePalettes(linked, links)).toBe(linked);
		expect(linkWorldTypePalettes(plain, {})).toBe(plain);
	});
});

// ── the one-time rewrite, on an in-memory vault ───────────────────────────

const gen = (meta: Record<string, string>, name: string) =>
	modelToMarkdown({ name, terrains: [{ name: "grass", weight: 1 }], adjacency: [], meta });

const VAULT = () => ({
	"hexes/the-coast/_the-coast.md": "---\nhexmaker-map: 5\npalette: Default\nregion-palette: Gone\ncols: 4\nrows: 4\n---\n# The Coast\n",
	"world/palettes/Default.md": "---\nhexmaker-palette: 1\nchild-palette: \"Expanded\"\n---\n\n| Terrain | Color |\n",
	"world/palettes/Expanded.md": "---\nhexmaker-palette: 1\nchild-palette: Gone\n---\n\n| Terrain | Color |\n",
	"world/generators/valley.md": gen({ palette: "Default", "source-maps": "the-coast + lost-map" }, "valley"),
	"world/generators/coastal.md": gen({ palette: "Gone", "source-map": "the-coast" }, "coastal"),
	"world/generators/blend.md": gen({ "blend-of": "valley + preset-thing" }, "blend"),
	"world/generators/saves/s1.md": "---\nhexmaker-save: 1\ngenerator: valley\ngenerator-path: world/generators/valley.md\n---\n",
	"world/generators/saves/s2.md": "---\nhexmaker-save: 1\ngenerator: gone\ngenerator-path: world/generators/gone.md\n---\n",
	"world/world-types/Space.md": buildWorldTypes("Space", [{ world: "ocean planet", palette: "Default" }, { world: "gas giant", palette: "Gone" }]),
	"world/notes/palette.md": "---\npalette: Default\n---\nMy own note.\n",
});

function host(files: Record<string, string>) {
	const vault = new MemVault(files);
	let saves = 0;
	const installed = new Set(["Default", "Expanded"]);
	const h: NoteFormatHost = {
		app: vault.app() as never,
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "hexes", worldFolder: "world", maps: [{ name: "the-coast" }], noteFormatUpgrades: ["hex-map-key", "hex-body-lines", "note-links"] },
		mapStore: {
			isReady: () => true,
			resolve: () => null,
			notePath: (m: string) => `hexes/${m}/_${m}.md`,
		},
		paletteStore: { notePathOf: (n: string) => (installed.has(n) ? `world/palettes/${n}.md` : undefined), folder: () => "world/palettes" },
		moduleRefLinks: spaceRuntime.refLinkers!({ worldTypeStore: { folder: () => "world/world-types" } } as never),
		hexMapDataView: (map, x, y) => ({ map, mapLabel: map, x, y }),
		saveSettings: async () => { saves++; },
	};
	return { vault, host: h, saves: () => saves };
}

describe("one-time rewrite of the remaining references (ref-links)", () => {
	it("links every reference that names a note, once, backed up first", async () => {
		const before = VAULT();
		const { vault, host: h, saves } = host(before);
		const [r] = await runNoteFormatUpgrades(h);
		expect(r.id).toBe("ref-links");
		expect(r.error).toBeUndefined();
		expect(h.settings.noteFormatUpgrades).toContain("ref-links");
		expect(saves()).toBe(1);
		const f = (p: string) => vault.files.get(p)!;

		expect(f("hexes/the-coast/_the-coast.md")).toBe(before["hexes/the-coast/_the-coast.md"].replace("palette: Default", 'palette: "[[world/palettes/Default]]"'));
		expect(f("world/palettes/Default.md")).toContain('child-palette: "[[world/palettes/Expanded]]"');
		expect(f("world/palettes/Expanded.md")).toBe(before["world/palettes/Expanded.md"]);
		expect(f("world/generators/valley.md")).toContain('palette: "[[world/palettes/Default]]"');
		expect(f("world/generators/valley.md")).toContain('source-maps: ["[[_the-coast]]", "lost-map"]');
		expect(f("world/generators/coastal.md")).toContain("palette: Gone");
		expect(f("world/generators/coastal.md")).toContain('source-map: "[[_the-coast]]"');
		expect(f("world/generators/blend.md")).toContain('blend-of: ["[[world/generators/valley]]", "preset-thing"]');
		expect(f("world/generators/saves/s1.md")).toContain('generator-path: "[[world/generators/valley]]"');
		expect(f("world/generators/saves/s2.md")).toBe(before["world/generators/saves/s2.md"]);
		expect(f("world/world-types/Space.md")).toContain("| [[world/palettes/Default]] |");
		expect(f("world/world-types/Space.md")).toContain("| Gone |");
		// A note that isn't the plugin's keeps its own palette: key.
		expect(f("world/notes/palette.md")).toBe(before["world/notes/palette.md"]);

		// Readers see the same names as before.
		expect(generatorMetaNames(parseModelMarkdown(f("world/generators/valley.md")).model.meta)).toMatchObject({ palette: "Default", "source-maps": "the-coast + lost-map" });
		expect(parseMapNote(f("hexes/the-coast/_the-coast.md"))!.settings.paletteName).toBe("Default");
		expect(parseWorldTypes(f("world/world-types/Space.md")).rows.map((x) => x.palette)).toEqual(["Default", "Gone"]);

		// The backup holds every rewritten note as it was.
		const entry = [...vault.binaries].find(([p]) => p.includes("/backups/note-formats-") && p.endsWith("/ref-links.json.gz"));
		const backed = (JSON.parse(gunzipSync(entry![1]).toString("utf8")) as { notes: Record<string, string> }).notes;
		expect(Object.keys(backed).sort()).toEqual([
			"hexes/the-coast/_the-coast.md", "world/generators/blend.md", "world/generators/coastal.md", "world/generators/saves/s1.md",
			"world/generators/valley.md", "world/palettes/Default.md", "world/world-types/Space.md",
		]);
		for (const [p, text] of Object.entries(backed)) expect(text).toBe(before[p as keyof typeof before]);

		// Once: recorded, and running it again changes nothing.
		const writes = vault.writes.length;
		expect(await runNoteFormatUpgrades(h)).toEqual([]);
		const again = await runUpgrade(h, "ref-links");
		expect(again.changed).toEqual([]);
		expect(vault.writes.length).toBe(writes);
	});

	it("changes nothing when the backup can't be saved, and tries again next time", async () => {
		const before = VAULT();
		const { vault, host: h } = host(before);
		vault.failBinary = true;
		const [r] = await runNoteFormatUpgrades(h);
		expect(r.error).toBeDefined();
		expect(new Map(vault.files)).toEqual(new Map(Object.entries(before)));
		expect(h.settings.noteFormatUpgrades).not.toContain("ref-links");
	});
});
