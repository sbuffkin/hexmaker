import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import fs from "node:fs";
import path from "node:path";
import { TAbstractFile, TFile, TFolder } from "obsidian";
import {
	buildPaletteNote,
	paletteFileName,
	parsePaletteNote,
	serializePaletteTable,
	terrainsEqual,
	updatePaletteNote,
} from "../src/palettes/paletteNote";
import {
	PALETTE_PRESETS,
	SPACE_PATH_TYPES,
	SPACE_SECTOR_PALETTE_NAME,
	presetToPalette,
	uniquePaletteName,
} from "../src/palettes/presets";
import { parsePathTypes } from "../src/palettes/pathTypeTable";
import { PaletteStore } from "../src/palettes/PaletteStore";
import { DEFAULT_SETTINGS } from "../src/constants";
import { iconLabel, iconPack } from "../src/utils";
import type { HexmakerPluginSettings, PathType, TerrainColor } from "../src/types";

// ── paletteNote ──────────────────────────────────────────────────────────────

const SAMPLE: TerrainColor[] = [
	{ name: "ocean", color: "#29507f", category: "sea" },
	{ name: "grass", color: "#69a168", icon: "bw-grassland.png", category: "lowlands" },
	{ name: "ash | cinder", color: "#333333", icon: "bw-volcano.png", iconColor: "#ffffff" },
];

describe("palette notes", () => {
	it("round-trips terrains through a note", () => {
		expect(parsePaletteNote(buildPaletteNote(SAMPLE))).toEqual(SAMPLE);
	});

	it("escapes pipes in cells", () => {
		expect(serializePaletteTable(SAMPLE)).toContain("ash \\| cinder");
	});

	it("returns null when the note has no palette table", () => {
		expect(parsePaletteNote("# Just a note\n\nNo table here.")).toBeNull();
		expect(parsePaletteNote("| A | B |\n| - | - |\n| 1 | 2 |")).toBeNull();
	});

	it("matches columns by header name in any order, with only Terrain and Color required", () => {
		const content = [
			"| Colour | Name |",
			"|:--|--:|",
			"| #111111 | void |",
			"| #222222 | nebula |",
		].join("\n");
		expect(parsePaletteNote(content)).toEqual([
			{ name: "void", color: "#111111" },
			{ name: "nebula", color: "#222222" },
		]);
	});

	it("skips rows without a name and defaults a missing color", () => {
		const content = "| Terrain | Color |\n|---|---|\n|  | #fff |\n| fog |  |";
		expect(parsePaletteNote(content)).toEqual([{ name: "fog", color: "#888888" }]);
	});

	it("handles CRLF notes", () => {
		const crlf = buildPaletteNote(SAMPLE).replace(/\n/g, "\r\n");
		expect(parsePaletteNote(crlf)).toEqual(SAMPLE);
	});

	it("rewrites only the table, keeping the user's prose and frontmatter", () => {
		const original = [
			"---",
			"tags: [space]",
			"---",
			"My notes about this palette.",
			"",
			"| Terrain | Color |",
			"|---|---|",
			"| void | #000000 |",
			"",
			"## Ideas",
			"More prose.",
		].join("\n");
		const updated = updatePaletteNote(original, [{ name: "nebula", color: "#3b2a5c" }]);
		expect(updated).toContain("tags: [space]");
		expect(updated).toContain("My notes about this palette.");
		expect(updated).toContain("## Ideas\nMore prose.");
		expect(updated).not.toContain("| void |");
		expect(parsePaletteNote(updated)).toEqual([{ name: "nebula", color: "#3b2a5c" }]);
	});

	it("adds a table to a note that has none, keeping its text", () => {
		const updated = updatePaletteNote("random text", SAMPLE);
		expect(parsePaletteNote(updated)).toEqual(SAMPLE);
		expect(updated).toContain("random text");
	});

	it("makes palette names safe file names", () => {
		expect(paletteFileName("Space: Sector")).toBe("Space- Sector");
		expect(paletteFileName("a/b\\c*?<>|#^[]")).toBe("a-b-c---------");
		expect(paletteFileName("  ..hidden  ")).toBe("hidden");
		expect(paletteFileName("///")).toBe("---");
		expect(paletteFileName("")).toBe("Palette");
	});

	it("compares terrains structurally, treating missing and empty fields alike", () => {
		expect(terrainsEqual(SAMPLE, SAMPLE.map((t) => ({ ...t })))).toBe(true);
		expect(terrainsEqual([{ name: "a", color: "#000" }], [{ name: "a", color: "#000", icon: "" }])).toBe(true);
		expect(terrainsEqual([{ name: "a", color: "#000" }], [{ name: "a", color: "#001" }])).toBe(false);
	});
});

// ── presets ──────────────────────────────────────────────────────────────────

describe("palette presets", () => {
	const iconsDir = path.resolve(__dirname, "..", "icons");

	it("every preset icon is a bundled file", () => {
		for (const preset of PALETTE_PRESETS) {
			for (const t of preset.terrains) {
				if (t.icon) expect({ preset: preset.name, icon: t.icon, exists: fs.existsSync(path.join(iconsDir, t.icon)) })
					.toEqual({ preset: preset.name, icon: t.icon, exists: true });
			}
		}
	});

	it("terrain names are unique within each preset", () => {
		for (const preset of PALETTE_PRESETS) {
			const names = preset.terrains.map((t) => t.name);
			expect(new Set(names).size).toBe(names.length);
		}
	});

	it("preset names survive as file names unchanged", () => {
		for (const preset of PALETTE_PRESETS) expect(paletteFileName(preset.name)).toBe(preset.name);
	});

	it("presetToPalette deep-copies terrains", () => {
		const preset = PALETTE_PRESETS.find((p) => p.name === SPACE_SECTOR_PALETTE_NAME)!;
		const pal = presetToPalette(preset);
		pal.terrains[0].color = "#ffffff";
		expect(preset.terrains[0].color).not.toBe("#ffffff");
	});

	it("uniquePaletteName appends a counter, case-insensitively", () => {
		expect(uniquePaletteName("Space - Sector", [])).toBe("Space - Sector");
		expect(uniquePaletteName("Space - Sector", ["space - sector"])).toBe("Space - Sector 2");
		expect(uniquePaletteName("X", ["X", "X 2"])).toBe("X 3");
	});

	it("an installed preset carries its own path types (a copy), others get Road and River", () => {
		const sector = presetToPalette(PALETTE_PRESETS.find((p) => p.name === SPACE_SECTOR_PALETTE_NAME)!);
		expect(sector.pathTypes!.map((p) => p.name)).toEqual(SPACE_PATH_TYPES.map((p) => p.name));
		sector.pathTypes![0].color = "#000000";
		expect(SPACE_PATH_TYPES[0].color).not.toBe("#000000");
		const plain = presetToPalette(PALETTE_PRESETS.find((p) => !p.pathTypes)!);
		expect(plain.pathTypes!.map((p) => p.name)).toEqual(["Road", "River"]);
	});
});

// ── icon packs ───────────────────────────────────────────────────────────────

describe("icon packs", () => {
	it("groups bundled and custom icons", () => {
		const vault = new Set(["space-mine.png", "dragon.png"]);
		expect(iconPack("bw-hills.png", vault)).toBe("terrain");
		expect(iconPack("space-world.svg", vault)).toBe("space");
		expect(iconPack("space-mine.png", vault)).toBe("custom"); // user's folder wins
		expect(iconPack("dragon.png", vault)).toBe("custom");
	});

	it("labels drop the pack prefix and extension", () => {
		expect(iconLabel("space-ringed-planet.svg")).toBe("ringed planet");
		expect(iconLabel("bw-forest-heavy.png")).toBe("forest heavy");
		expect(iconLabel("My Ship.webp")).toBe("My Ship");
	});
});

// ── PaletteStore against an in-memory vault ──────────────────────────────────

class FakeVault {
	files = new Map<string, string>();
	folders = new Set<string>();
	writes = 0;

	private node(path: string): TAbstractFile | null {
		const name = path.split("/").pop() ?? path;
		if (this.files.has(path)) {
			const f = new TFile();
			f.path = path;
			f.name = name;
			f.basename = name.replace(/\.md$/, "");
			f.extension = "md";
			return f;
		}
		if (this.folders.has(path)) {
			const d = new TFolder();
			d.path = path;
			d.name = name;
			const prefix = path + "/";
			const kids = new Set<string>();
			for (const p of [...this.files.keys(), ...this.folders]) {
				if (p.startsWith(prefix)) kids.add(prefix + p.slice(prefix.length).split("/")[0]);
			}
			d.children = [...kids].map((k) => this.node(k)).filter((n): n is TAbstractFile => n !== null);
			return d;
		}
		return null;
	}

	getAbstractFileByPath = (path: string) => this.node(path);
	createFolder = async (path: string) => {
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
	};
	create = async (path: string, content: string) => {
		if (this.files.has(path)) throw new Error(`exists: ${path}`);
		this.files.set(path, content);
		this.writes++;
	};
	read = async (f: TFile) => this.files.get(f.path) ?? "";
	cachedRead = async (f: TFile) => this.files.get(f.path) ?? "";
	modify = async (f: TFile, content: string) => {
		this.files.set(f.path, content);
		this.writes++;
	};
	rename(from: string, to: string) {
		const c = this.files.get(from);
		if (c === undefined) throw new Error(`missing: ${from}`);
		this.files.delete(from);
		this.files.set(to, c);
	}
}

function makeHarness(settingsPatch: Partial<HexmakerPluginSettings> = {}) {
	const vault = new FakeVault();
	const trashed: string[] = [];
	const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as HexmakerPluginSettings;
	const settings: HexmakerPluginSettings = {
		...defaults,
		// These tests were written with Limited first (an install from
		// before Expanded became the default, G7b); keep that order.
		terrainPalettes: [...defaults.terrainPalettes].sort((a, b) => (a.name === "Limited" ? -1 : b.name === "Limited" ? 1 : 0)),
		worldFolder: "world",
		...settingsPatch,
	};
	let saves = 0;
	const plugin = {
		settings,
		app: {
			vault,
			fileManager: {
				renameFile: async (f: TFile, to: string) => vault.rename(f.path, to),
				trashFile: async (f: TFile) => {
					trashed.push(f.path);
					vault.files.delete(f.path);
				},
			},
		},
		saveData: async () => {
			saves++;
		},
		refreshHexMap: () => {},
		getPaletteByName: (name: string) => settings.terrainPalettes.find((p) => p.name === name),
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const store = new PaletteStore(plugin as any);
	const file = (p: string) => vault.getAbstractFileByPath(p) as TFile;
	return { vault, settings, store, trashed, file, saves: () => saves };
}

describe("PaletteStore", () => {
	let h: ReturnType<typeof makeHarness>;
	beforeEach(() => {
		h = makeHarness();
	});

	it("migrates every settings palette to a note on first run", async () => {
		h.settings.terrainPalettes.push({ name: "My: Weird/Palette", terrains: [{ name: "goo", color: "#00ff00" }] });
		h.settings.maps[0].paletteName = "My: Weird/Palette";
		await h.store.init();

		expect(h.settings.palettesMigrated).toBe(true);
		expect([...h.vault.files.keys()].sort()).toEqual([
			"world/palettes/Expanded.md",
			"world/palettes/Limited.md",
			"world/palettes/My- Weird-Palette.md",
		]);
		// The unsafe name was cleaned and the map follows it.
		expect(h.settings.terrainPalettes.map((p) => p.name)).toContain("My- Weird-Palette");
		expect(h.settings.maps[0].paletteName).toBe("My- Weird-Palette");
		expect(parsePaletteNote(h.vault.files.get("world/palettes/My- Weird-Palette.md")!)).toEqual([
			{ name: "goo", color: "#00ff00" },
		]);
	});

	it("loads notes as the source of truth after migration", async () => {
		await h.store.init();
		h.vault.files.set("world/palettes/Limited.md", buildPaletteNote([{ name: "lava", color: "#ff0000" }]));
		const limited = h.settings.terrainPalettes.find((p) => p.name === "Limited")!;
		const terrainsRef = limited.terrains;
		await h.store.reload();
		expect(limited.terrains).toEqual([{ name: "lava", color: "#ff0000" }]);
		expect(limited.terrains).toBe(terrainsRef); // identity kept for open views
	});

	it("prefers an existing palette note over the settings copy during migration", async () => {
		await h.vault.createFolder("world/palettes");
		h.vault.files.set("world/palettes/Limited.md", buildPaletteNote([{ name: "synced", color: "#123456" }]));
		await h.store.init();
		const limited = h.settings.terrainPalettes.find((p) => p.name === "Limited")!;
		expect(limited.terrains).toEqual([{ name: "synced", color: "#123456" }]);
	});

	it("does not overwrite an unrelated note that shares a palette's name", async () => {
		await h.vault.createFolder("world/palettes");
		h.vault.files.set("world/palettes/Limited.md", "just a regular note");
		await h.store.init();
		expect(h.vault.files.get("world/palettes/Limited.md")).toBe("just a regular note");
		expect(h.settings.terrainPalettes.map((p) => p.name)).toContain("Limited 2");
		expect(h.vault.files.has("world/palettes/Limited 2.md")).toBe(true);
	});

	it("sync writes in-app edits, renames, additions and deletions", async () => {
		await h.store.init();
		const [limited, expanded] = h.settings.terrainPalettes;

		limited.terrains.push({ name: "swamp", color: "#334433" });
		limited.name = "Overland";
		h.settings.terrainPalettes.push({ name: "Space - Sector", terrains: [{ name: "void", color: "#000000" }] });
		h.settings.terrainPalettes.splice(h.settings.terrainPalettes.indexOf(expanded), 1);
		await h.store.sync();

		expect(h.vault.files.has("world/palettes/Limited.md")).toBe(false);
		expect(parsePaletteNote(h.vault.files.get("world/palettes/Overland.md")!)!.map((t) => t.name)).toContain("swamp");
		expect(h.vault.files.has("world/palettes/Space - Sector.md")).toBe(true);
		expect(h.trashed).toEqual(["world/palettes/Expanded.md"]);
	});

	it("sync is a no-op when nothing changed", async () => {
		await h.store.init();
		const writes = h.vault.writes;
		await h.store.sync();
		await h.store.sync();
		expect(h.vault.writes).toBe(writes);
	});

	it("keeps the user's prose when rewriting a note", async () => {
		await h.store.init();
		const p = "world/palettes/Limited.md";
		h.vault.files.set(p, "My intro.\n\n" + serializePaletteTable(h.settings.terrainPalettes[0].terrains) + "\n\nOutro.");
		h.store.onModify(h.file(p));
		await h.store.sync(); // let the queued note read settle before editing in-app
		h.settings.terrainPalettes[0].terrains[0].color = "#000001";
		await h.store.sync();
		const content = h.vault.files.get(p)!;
		expect(content).toContain("My intro.");
		expect(content).toContain("Outro.");
		expect(content).toContain("#000001");
	});

	it("hand edits to a note flow into the palette; our own writes are ignored", async () => {
		await h.store.init();
		const p = "world/palettes/Limited.md";
		const savesBefore = h.saves();
		h.store.onModify(h.file(p)); // echo of our own write → ignored
		await h.store.sync();
		expect(h.saves()).toBe(savesBefore);

		h.vault.files.set(p, buildPaletteNote([{ name: "tundra", color: "#ddeeff" }]));
		h.store.onModify(h.file(p));
		await h.store.sync();
		expect(h.settings.terrainPalettes.find((x) => x.name === "Limited")!.terrains).toEqual([
			{ name: "tundra", color: "#ddeeff" },
		]);
		expect(h.saves()).toBeGreaterThan(savesBefore);
	});

	it("a note dropped into the folder becomes a new palette", async () => {
		await h.store.init();
		const p = "world/palettes/Shared.md";
		h.vault.files.set(p, buildPaletteNote([{ name: "x", color: "#010101" }]));
		h.store.onModify(h.file(p));
		await h.store.sync();
		expect(h.settings.terrainPalettes.map((x) => x.name)).toContain("Shared");
	});

	it("renaming a note renames the palette and repoints maps", async () => {
		await h.store.init();
		h.settings.maps[0].paletteName = "Limited";
		h.vault.rename("world/palettes/Limited.md", "world/palettes/Overland.md");
		h.store.onRename(h.file("world/palettes/Overland.md"), "world/palettes/Limited.md");
		await h.store.sync();
		expect(h.settings.terrainPalettes.map((x) => x.name)).toContain("Overland");
		expect(h.settings.maps[0].paletteName).toBe("Overland");
		expect(h.vault.files.has("world/palettes/Limited.md")).toBe(false);
	});

	it("deleting a note removes the palette but leaves map references for a restore", async () => {
		await h.store.init();
		h.settings.maps[0].paletteName = "Expanded";
		const f = h.file("world/palettes/Expanded.md");
		h.vault.files.delete(f.path);
		h.store.onDelete(f);
		await h.store.sync();
		expect(h.settings.terrainPalettes.map((x) => x.name)).toEqual(["Limited"]);
		expect(h.settings.maps[0].paletteName).toBe("Expanded");
		expect(h.vault.files.has("world/palettes/Expanded.md")).toBe(false);
	});

	it("never deletes the last palette", async () => {
		h.settings.terrainPalettes.splice(1);
		await h.store.init();
		const f = h.file("world/palettes/Limited.md");
		h.vault.files.delete(f.path);
		h.store.onDelete(f);
		await h.store.sync();
		expect(h.settings.terrainPalettes.map((x) => x.name)).toEqual(["Limited"]);
		expect(h.vault.files.has("world/palettes/Limited.md")).toBe(true); // re-written by sync
	});

	it("rewrites notes when the folder is emptied (safety net)", async () => {
		await h.store.init();
		h.vault.files.clear();
		const fresh = makeHarness({ palettesMigrated: true });
		fresh.settings.terrainPalettes = h.settings.terrainPalettes;
		await fresh.store.init();
		expect([...fresh.vault.files.keys()].sort()).toEqual([
			"world/palettes/Expanded.md",
			"world/palettes/Limited.md",
		]);
	});

	it("round-trips child-palette between notes and palettes", async () => {
		h.settings.terrainPalettes[0].childPalette = "Expanded";
		await h.store.init();
		const p = "world/palettes/Limited.md";
		expect(h.vault.files.get(p)).toContain('child-palette: "Expanded"');

		// In-app change → note.
		h.settings.terrainPalettes[0].childPalette = "Space - System";
		await h.store.sync();
		expect(h.vault.files.get(p)).toContain('child-palette: "Space - System"');

		// Hand edit (only the frontmatter) → palette.
		h.vault.files.set(p, h.vault.files.get(p)!.replace('"Space - System"', "Overland"));
		h.store.onModify(h.file(p));
		await h.store.sync();
		expect(h.settings.terrainPalettes[0].childPalette).toBe("Overland");
	});

	it("seeded terrain types are in the notes when init() resolves (no separately queued write)", async () => {
		// An existing vault: untyped palettes, never seeded. If the note write
		// were queued after init, an unload in between would leave the notes
		// untyped while settings say "seeded" — found on the first live deploy.
		h.settings.terrainPalettes = [{ name: "Mine", terrains: [{ name: "ocean", color: "#000" }, { name: "dark forest", color: "#111" }] }];
		h.settings.maps[0].paletteName = "Mine";
		h.settings.terrainTypesSeeded = false;
		await h.store.init();
		expect(h.settings.terrainTypesSeeded).toBe(true);
		expect(parsePaletteNote(h.vault.files.get("world/palettes/Mine.md")!)!.map((t) => t.type)).toEqual(["water", "forest"]);
	});

	it("honours a custom palettes folder", async () => {
		const c = makeHarness({ palettesFolder: "rpg/pal" });
		await c.store.init();
		expect([...c.vault.files.keys()].every((p) => p.startsWith("rpg/pal/"))).toBe(true);
	});
});

describe("PaletteStore: path types live in palettes", () => {
	it("first load gives every palette ALL the old plugin-wide path types, written as a table in its note", async () => {
		const custom = { name: "Trail", color: "#8b5a2b", width: 2, lineStyle: "dashed" as const, routing: "through" as const };
		const h = makeHarness({ pathTypes: [...DEFAULT_SETTINGS.pathTypes, custom] });
		await h.store.init();
		for (const pal of h.settings.terrainPalettes) {
			expect(pal.pathTypes!.map((x) => x.name)).toEqual(["Road", "River", "Trail"]);
			const note = h.vault.files.get(`world/palettes/${pal.name}.md`)!;
			expect(parsePathTypes(note)!.types.map((x) => x.name)).toEqual(["Road", "River", "Trail"]);
		}
		// Each palette has its own copy.
		h.settings.terrainPalettes[0].pathTypes![0].color = "#000000";
		expect(h.settings.terrainPalettes[1].pathTypes![0].color).not.toBe("#000000");
	});

	it("a hand edit to the Path types table reaches the palette", async () => {
		const h = makeHarness();
		await h.store.init();
		const p = "world/palettes/Limited.md";
		h.vault.files.set(p, h.vault.files.get(p)!.replace("| River | #3b82f6 | 3 |", "| Stream | #3b82f6 | 2 |"));
		h.store.onModify(h.file(p));
		await h.store.sync();
		const pal = h.settings.terrainPalettes.find((x) => x.name === "Limited")!;
		expect(pal.pathTypes!.map((x) => x.name)).toEqual(["Road", "Stream"]);
		expect(pal.pathTypes![1].width).toBe(2);
	});

	it("a slip that removes the Path types table keeps the types and writes the table back", async () => {
		const h = makeHarness();
		await h.store.init();
		const p = "world/palettes/Limited.md";
		h.vault.files.set(p, h.vault.files.get(p)!.replace("| Path | Color |", "| Pathh Colr |"));
		h.store.onModify(h.file(p));
		await h.store.sync();
		const pal = h.settings.terrainPalettes.find((x) => x.name === "Limited")!;
		expect(pal.pathTypes!.map((x) => x.name)).toEqual(["Road", "River"]);
		pal.terrains[0].color = "#000002"; // any in-app edit triggers a rewrite
		await h.store.sync();
		expect(parsePathTypes(h.vault.files.get(p)!)!.types.map((x) => x.name)).toEqual(["Road", "River"]);
	});
});

describe("PaletteStore: hand edits are never overwritten", () => {
	it("a terrain table that stops parsing is left alone until it's fixed", async () => {
		const h = makeHarness();
		await h.store.init();
		const p = "world/palettes/Limited.md";
		const broken = h.vault.files.get(p)!.replace("| Terrain | Color |", "| Terrain | Colour hex |") + "\nMy notes.";
		h.vault.files.set(p, broken);
		h.store.onModify(h.file(p));
		await h.store.sync();
		// An unrelated in-app change syncs every palette: this note must not be rebuilt.
		h.settings.terrainPalettes.find((x) => x.name === "Limited")!.terrains[0].color = "#000003";
		await h.store.sync();
		expect(h.vault.files.get(p)).toBe(broken);
		// Fixed by hand: read again, and in-app edits write again.
		h.vault.files.set(p, broken.replace("Colour hex", "Color"));
		h.store.onModify(h.file(p));
		await h.store.sync();
		h.settings.terrainPalettes.find((x) => x.name === "Limited")!.terrains[0].color = "#000004";
		await h.store.sync();
		expect(h.vault.files.get(p)).toContain("#000004");
		expect(h.vault.files.get(p)).toContain("My notes.");
	});

	it("columns the user adds to the terrain table survive a rewrite", async () => {
		const h = makeHarness();
		await h.store.init();
		const p = "world/palettes/Limited.md";
		const pal = h.settings.terrainPalettes.find((x) => x.name === "Limited")!;
		// Add a "Notes" column by hand, with a note on the first terrain.
		const lines = h.vault.files.get(p)!.split("\n");
		const head = lines.findIndex((l) => l.startsWith("| Terrain |"));
		lines[head] += " Notes |";
		lines[head + 1] += " --- |";
		lines[head + 2] += " windy |";
		for (let i = head + 3; lines[i]?.startsWith("|"); i++) lines[i] += "  |";
		h.vault.files.set(p, lines.join("\n"));
		h.store.onModify(h.file(p));
		await h.store.sync();
		pal.terrains[0].color = "#000005";
		await h.store.sync();
		const out = h.vault.files.get(p)!.split("\n");
		expect(out.find((l) => l.startsWith("| Terrain |"))).toContain("| Notes |");
		const row = out.find((l) => l.startsWith(`| ${pal.terrains[0].name} |`))!;
		expect(row).toContain("#000005");
		expect(row.endsWith("| windy |")).toBe(true);
	});
});
