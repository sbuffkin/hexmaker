/**
 * Biome notes (#50): the note format (round trip, tolerance, a hand-written
 * compat fixture), the store (seeding once, hand edits, rename, delete,
 * update, restore default), the lookups by type, and the form model.
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Notice } from "obsidian";
import {
	buildBiomeNote,
	parseBiomeNote,
	parseShare,
	updateBiomeNote,
	type BiomeNoteFields,
} from "../src/overworld/biomeNote";
import { BIOME_PRESETS } from "../src/overworld/biomePresets";
import { BiomeStore, presetsToSeed } from "../src/overworld/BiomeStore";
import {
	BIOMES,
	ECOTONES,
	allBiomeIds,
	biomeByRef,
	biomeInfo,
	ecotoneBetween,
	isSeaBiome,
	noteBiomeProfiles,
	profileFromMix,
	representableBiomes,
	representativeTerrain,
	setBiomeSource,
} from "../src/overworld/biomes";
import { overworldBiomes } from "../src/overworld/regionWorld";
import {
	fieldsFromForm,
	formFromFields,
	formProblem,
	formTypes,
	previewRegion,
	regionGenerator,
	routeNote,
} from "../src/overworld/biomeForm";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { TerrainColor } from "../src/types";
import type { RegionLayout } from "../src/overworld/layout";
import { MemVault } from "./helpers/memVault";

(globalThis as Record<string, unknown>).window ??= globalThis;

const GLASS: BiomeNoteFields = {
	id: "glass-wastes",
	label: "Glass wastes",
	color: "#c0d8e0",
	mix: [{ type: "desert", weight: 60 }, { type: "badlands", weight: 25 }],
	transitions: [{ next: "Jungle", between: "Savanna" }],
	blend: "wide",
	landShare: 0.4,
	minIslands: 2,
	generator: "world/generators/Glass dunes",
};

// ── the note ─────────────────────────────────────────────────────────────

describe("biome note format", () => {
	it("round-trips every field", () => {
		const { fields, problems } = parseBiomeNote(buildBiomeNote(GLASS), "Glass wastes");
		expect(problems).toEqual([]);
		expect(fields).toEqual(GLASS);
	});

	it("reads minimal notes: name from the file, no frontmatter", () => {
		const { fields } = parseBiomeNote("| Type | Weight |\n| --- | --- |\n| forest | 3 |\n", "Pine Barrens");
		expect(fields).toEqual({ id: "pine-barrens", label: "Pine Barrens", mix: [{ type: "forest", weight: 3 }], transitions: [] });
	});

	it("reads a hand-written note (compat fixture) and reports what it can't read", () => {
		const text = readFileSync(join(__dirname, "fixtures/biome-note-v1.md"), "utf8");
		const { fields, problems } = parseBiomeNote(text, "Glass wastes");
		expect(fields.id).toBe("glass-wastes");
		expect(fields.color).toBe("#c0d8e0");
		expect(fields.landShare).toBe(0.4);
		expect(fields.minIslands).toBe(2);
		expect(fields.blend).toBe("wide");
		expect(fields.generator).toBe("world/generators/Glass dunes");
		expect(fields.mix).toEqual([{ type: "desert", weight: 60 }, { type: "badlands", weight: 25 }, { type: "water", weight: 15 }]);
		expect(fields.transitions).toEqual([{ next: "Jungle", between: "Savanna" }]);
		expect(problems.map((p) => p.where)).toEqual(["Mix", "Transitions"]);
	});

	it("reports bad settings and keeps going", () => {
		const { fields, problems } = parseBiomeNote("---\nblend: huge\nland-share: 140%\nmin-islands: two\n---\n", "X");
		expect(fields.blend).toBeUndefined();
		expect(fields.landShare).toBeUndefined();
		expect(problems).toHaveLength(3);
	});

	it("shares: 60%, 0.6 and 60 all read as 0.6", () => {
		expect(parseShare("60%")).toBe(0.6);
		expect(parseShare("0.6")).toBe(0.6);
		expect(parseShare("60")).toBe(0.6);
		expect(parseShare("x")).toBeNaN();
	});

	it("update keeps the user's prose, extra keys and line endings", () => {
		const text = readFileSync(join(__dirname, "fixtures/biome-note-v1.md"), "utf8").replace(/\r?\n/g, "\r\n");
		const next = updateBiomeNote(text, { ...GLASS, label: "Glass sea", mix: [{ type: "desert", weight: 1 }] });
		expect(next).toContain("Sand fused to glass by an old war. My own notes stay here.");
		expect(next).toContain("More prose after the tables.");
		expect(next).toContain("tags: [desert]");
		expect(next).not.toMatch(/[^\r]\n/);
		const back = parseBiomeNote(next, "Glass wastes").fields;
		expect(back.label).toBe("Glass sea");
		expect(back.mix).toEqual([{ type: "desert", weight: 1 }]);
	});

	it("update with what the note already says changes nothing", () => {
		const text = buildBiomeNote(GLASS);
		expect(updateBiomeNote(text, GLASS)).toBe(text);
		// The user's own spelling of the same value stays.
		const hand = text.replace("land-share: 40%", "land-share: 0.4");
		expect(updateBiomeNote(hand, GLASS)).toBe(hand);
	});

	it("update removes cleared keys and adds missing tables", () => {
		const next = updateBiomeNote("---\nlabel: A\nblend: wide\n---\n\nprose\n", { id: "a", label: "A", mix: [{ type: "forest", weight: 2 }], transitions: [] });
		expect(next).not.toContain("blend:");
		expect(next).toContain("prose");
		expect(parseBiomeNote(next, "A").fields.mix).toEqual([{ type: "forest", weight: 2 }]);
	});
});

// ── presets ──────────────────────────────────────────────────────────────

/** Shipped biomes with no row in the old BIOMES table: their notes are all there is. */
const NOTE_ONLY = ["coast", "custom", "highlands", "volcanic-peaks", "glacier", "canyon", "mesa", "steppe", "desert", "wasteland", "blighted-lands", "reef", "caverns", "underdark", "fungal-forest", "underground-lake", "mines", "magma-caves"];

describe("shipped biome presets", () => {
	it("cover every built-in biome with the same label (Coast, Custom (blank) and the 2026-10-12 biomes are note-only)", () => {
		expect(BIOME_PRESETS.map((b) => b.id).filter((id) => !NOTE_ONLY.includes(id))).toEqual(BIOMES.map((b) => b.id));
		expect(BIOME_PRESETS.filter((b) => !BIOMES.some((x) => x.id === b.id)).map((b) => b.id).sort()).toEqual([...NOTE_ONLY].sort());
		expect(BIOME_PRESETS.find((p) => p.id === "custom")!.blank).toBe(true);
		for (const b of BIOMES) expect(BIOME_PRESETS.find((p) => p.id === b.id)!.label).toBe(b.label);
		expect(BIOME_PRESETS.find((p) => p.id === "coast")!.shore).toBe(true);
	});

	it("as notes, give the same transitions as the old table", () => {
		setBiomeSource(BIOME_PRESETS);
		try {
			for (const [a, b, e] of ECOTONES) {
				expect(ecotoneBetween(a, b)).toBe(e);
				expect(ecotoneBetween(b, a)).toBe(e);
			}
			expect(ecotoneBetween("tundra", "taiga")).toBeUndefined();
		} finally {
			setBiomeSource(undefined);
		}
	});

	it("carry the islands settings of the built-in table, and the notes drive them", () => {
		for (const b of BIOMES) {
			const p = BIOME_PRESETS.find((x) => x.id === b.id)!;
			expect([p.landShare, p.minIslands]).toEqual([b.landShare, b.minIslands]);
		}
		setBiomeSource(BIOME_PRESETS.map((b) => (b.id === "archipelago" ? { ...b, landShare: 0.5, minIslands: undefined } : b)));
		try {
			expect(biomeInfo("archipelago")?.landShare).toBe(0.5);
			expect(biomeInfo("archipelago")?.minIslands).toBeUndefined();
			const prof = noteBiomeProfiles(DEFAULT_TERRAIN_PALETTE).get("archipelago")!;
			expect(prof.landShare).toBe(0.5);
			expect(noteBiomeProfiles(DEFAULT_TERRAIN_PALETTE).get("open-sea")!.landShare).toBeUndefined();
		} finally {
			setBiomeSource(undefined);
		}
	});

	it("as notes, every built-in still has a terrain on Expanded", () => {
		const before = representableBiomes(DEFAULT_TERRAIN_PALETTE);
		setBiomeSource(BIOME_PRESETS);
		try {
			// The note-only biomes too (all but the blank one: it paints nothing).
			expect(representableBiomes(DEFAULT_TERRAIN_PALETTE)).toEqual(new Set([...before, ...NOTE_ONLY.filter((id) => id !== "custom")]));
		} finally {
			setBiomeSource(undefined);
		}
	});
});

// ── lookups ──────────────────────────────────────────────────────────────

const PAL: TerrainColor[] = [
	{ name: "sand", color: "#eeddaa", type: "desert" },
	{ name: "dunes", color: "#ddcc99", type: "desert" },
	{ name: "scrub", color: "#aa8855", type: "badlands" },
	{ name: "grass", color: "#66aa66", type: "grassland" },
	{ name: "sea", color: "#225588", type: "water" },
	{ name: "town", color: "#999999", type: "settlement" },
];

describe("biome lookups from notes", () => {
	afterEach(() => setBiomeSource(undefined));

	it("a user's biome is listed, labelled and painted by its heaviest type", () => {
		setBiomeSource([...BIOME_PRESETS, GLASS]);
		expect(allBiomeIds()).toContain("glass-wastes");
		expect(biomeInfo("glass-wastes")?.label).toBe("Glass wastes");
		expect(representativeTerrain("glass-wastes", PAL)).toBe("sand");
		expect(representableBiomes(PAL).has("glass-wastes")).toBe(true);
		expect(isSeaBiome("glass-wastes")).toBe(true); // land share 40%
	});

	it("falls back by type when the palette lacks the heaviest type", () => {
		setBiomeSource([{ id: "x", label: "X", mix: [{ type: "volcanic", weight: 5 }], transitions: [] }]);
		// volcanic → mountains, badlands, hills: badlands is here.
		expect(representativeTerrain("x", PAL)).toBe("scrub");
	});

	it("profiles go by type, spread evenly over that type's terrains", () => {
		const p = profileFromMix("g", [{ type: "desert", weight: 3 }, { type: "water", weight: 1 }, { type: "settlement", weight: 9 }], PAL);
		expect(p.types.get("desert")).toBeCloseTo(0.75);
		expect(p.types.get("water")).toBeCloseTo(0.25);
		expect(p.types.has("settlement")).toBe(false);
		expect([...p.names.get("desert")!]).toEqual([["sand", 0.5], ["dunes", 0.5]]);
	});

	it("never reads terrain names: an untyped terrain named like a type isn't used", () => {
		const p = profileFromMix("g", [{ type: "desert", weight: 1 }], [{ name: "desert", color: "#fff" }]);
		expect(p.types.size).toBe(0);
	});

	it("note profiles exist for every note biome the palette can show", () => {
		setBiomeSource([GLASS, { id: "y", label: "Y", mix: [{ type: "peaks", weight: 1 }], transitions: [] }]);
		const ps = noteBiomeProfiles(PAL);
		expect(ps.has("glass-wastes")).toBe(true);
		expect(ps.has("y")).toBe(false); // peaks → mountains, snow, hills: none here
	});

	it("references resolve by id, label or note name", () => {
		setBiomeSource([GLASS]);
		expect(biomeByRef("glass-wastes")).toBe("glass-wastes");
		expect(biomeByRef("Glass wastes")).toBe("glass-wastes");
		expect(biomeByRef("builtin:biome-tundra")).toBeUndefined();
	});

	it("placed biomes win over the hex's terrain", () => {
		setBiomeSource([...BIOME_PRESETS, GLASS]);
		const terrain = new Map([["0_0", "sand"], ["1_0", "sand"]]);
		const b = overworldBiomes(terrain, DEFAULT_TERRAIN_PALETTE.concat(PAL), "flat", "odd", new Map([["0_0", "glass-wastes"]]));
		expect(b.get("0_0")).toBe("glass-wastes");
		expect(b.get("1_0")).not.toBe("glass-wastes");
	});

	it("without notes, lookups read the built-in table as before", () => {
		expect(allBiomeIds()).toEqual(BIOMES.map((b) => b.id));
		expect(biomeInfo("glass-wastes")).toBeUndefined();
	});
});

// ── the store ────────────────────────────────────────────────────────────

function plugin(vault: MemVault, settings: Record<string, unknown> = {}) {
	const p = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", biomesFolder: "", kindContent: ["world"], mapKinds: ["world"], ...settings } as Record<string, unknown>,
		saves: 0,
		saveSettings: async () => { p.saves++; },
	};
	return p;
}

const FOLDER = "world/biomes";
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Start a store. `overworld`: the vault has made an overworld or region,
 * which is when the shipped biome notes are written (DJ-Q4,
 * HexmakerPlugin.ensureOverworldBiomes); off = a plain start-up.
 */
async function boot(vault: MemVault, settings: Record<string, unknown> = {}, overworld = true) {
	const p = plugin(vault, settings);
	const store = new BiomeStore(p as never);
	await store.init();
	if (overworld) await store.seedShipped(true);
	return { p, store };
}

describe("BiomeStore", () => {
	afterEach(() => { setBiomeSource(undefined); Notice.shown = []; });

	it("presetsToSeed: once, and never over a note", () => {
		const presets = BIOME_PRESETS.slice(0, 3);
		const plan = presetsToSeed(["tundra"], new Set(["taiga"]), (f) => f === "Temperate forest", presets);
		expect(plan.write).toEqual([]);
		expect(plan.done).toEqual(["taiga", "temperate-forest"]);
	});

	it("startup in a space-only setup writes no biome notes; turning World on writes them then (SP3)", async () => {
		const v = new MemVault();
		const { p, store } = await boot(v, { mapKinds: ["space"], kindContent: ["space"] });
		expect([...v.files.keys()].filter((f) => f.startsWith(FOLDER))).toEqual([]);
		expect(store.list()).toEqual([]);
		expect(p.settings.biomesSeeded).toBeUndefined();
		// A fresh install before its setup picks the types: none at start-up.
		const v2 = new MemVault();
		const fresh = await boot(v2, { kindContent: null }, false);
		expect([...v2.files.keys()].filter((f) => f.startsWith(FOLDER))).toEqual([]);
		// ...until the first overworld or region is made (DJ-Q4).
		await fresh.store.seedShipped(true);
		expect(v2.files.has(`${FOLDER}/Tundra.md`)).toBe(true);
		// A world vault that never had biomes and makes no overworld: none at start-up.
		const v3 = new MemVault();
		await boot(v3, { kindContent: ["world"] }, false);
		expect([...v3.files.keys()].filter((f) => f.startsWith(FOLDER))).toEqual([]);
		// World turned on later (an explicit pick).
		p.settings.mapKinds = ["space", "world"];
		p.settings.kindContent = ["space", "world"];
		await store.seedShipped(true);
		expect(v.files.has(`${FOLDER}/Tundra.md`)).toBe(true);
	});

	it("seeds the built-ins into notes once; a deleted one stays deleted", async () => {
		const v = new MemVault();
		const { p, store } = await boot(v);
		expect(store.list().map((b) => b.id).sort()).toEqual(BIOME_PRESETS.map((b) => b.id).sort());
		expect(v.files.has(`${FOLDER}/Tundra.md`)).toBe(true);
		expect(p.settings.biomesSeeded).toHaveLength(BIOME_PRESETS.length);
		expect(allBiomeIds()).toContain("tundra");
		// Delete Tundra; a restart doesn't bring it back.
		v.files.delete(`${FOLDER}/Tundra.md`);
		const again = await boot(v, { biomesSeeded: p.settings.biomesSeeded });
		expect(again.store.get("tundra")).toBeUndefined();
		expect(v.files.has(`${FOLDER}/Tundra.md`)).toBe(false);
	});

	it("never writes over a note that's already there", async () => {
		const mine = "---\nlabel: Tundra\nid: tundra\n---\n\n| Type | Weight |\n| --- | --- |\n| snow | 1 |\n";
		const v = new MemVault({ [`${FOLDER}/Tundra.md`]: mine });
		const { store } = await boot(v);
		expect(v.files.get(`${FOLDER}/Tundra.md`)).toBe(mine);
		expect(store.get("tundra")!.mix).toEqual([{ type: "snow", weight: 1 }]);
	});

	it("imports hand edits live and reports unreadable rows once", async () => {
		const v = new MemVault();
		const { store } = await boot(v);
		const path = `${FOLDER}/Taiga.md`;
		v.files.set(path, v.files.get(path)!.replace(/\| forest \| 63 \|/, "| forest | 90 |").replace("| hills | 13 |", "| hills | lots |"));
		store.onModify(v.app().vault.getAbstractFileByPath(path)!);
		await tick(); await tick();
		expect(store.get("taiga")!.mix.find((r) => r.type === "forest")!.weight).toBe(90);
		expect(store.problemsOf("taiga")).toHaveLength(1);
		expect(Notice.shown.filter((n) => n.msg.includes("Taiga"))).toHaveLength(1);
	});

	it("update writes the note through the writer, keeping prose", async () => {
		const v = new MemVault();
		const { store } = await boot(v);
		const path = `${FOLDER}/Swamp.md`;
		v.files.set(path, v.files.get(path)! + "\nMy swamp notes.\n");
		store.onModify(v.app().vault.getAbstractFileByPath(path)!);
		expect(await store.update("Swamp", { blend: "narrow", mix: [{ type: "wetland", weight: 1 }] })).toBe(true);
		expect(v.files.get(path)).toContain("My swamp notes.");
		expect(v.files.get(path)).toContain("blend: narrow");
		expect(store.get("swamp")!.mix).toEqual([{ type: "wetland", weight: 1 }]);
	});

	it("won't rewrite a table that has unreadable rows", async () => {
		const v = new MemVault();
		const { store } = await boot(v);
		const path = `${FOLDER}/Swamp.md`;
		v.files.set(path, v.files.get(path)!.replace("| wetland | 62 |", "| wetland | ?? |"));
		store.onModify(v.app().vault.getAbstractFileByPath(path)!);
		expect(await store.update("swamp", { mix: [{ type: "forest", weight: 1 }] })).toBe(false);
		expect(v.files.get(path)).toContain("| wetland | ?? |");
	});

	it("restore default rewrites a shipped biome from its preset, with a backup", async () => {
		const v = new MemVault();
		const { store } = await boot(v);
		await store.update("jungle", { label: "Rainforest", mix: [{ type: "jungle", weight: 1 }] });
		expect(store.hasDefault("Rainforest")).toBe(true);
		expect(await store.restoreDefault("Rainforest")).toBe(true);
		expect(store.get("jungle")!.label).toBe("Jungle");
		expect(store.get("jungle")!.mix).toEqual(BIOME_PRESETS.find((b) => b.id === "jungle")!.mix);
		expect([...v.binaries.keys()].some((k) => k.includes("biome-jungle"))).toBe(true);
	});

	it("create writes a new note; user biomes have no default", async () => {
		const v = new MemVault();
		const { store } = await boot(v);
		const res = await store.create({ label: "Glass wastes", mix: [{ type: "desert", weight: 1 }], transitions: [] });
		expect(res).toEqual({ id: "glass-wastes" });
		expect(v.files.has(`${FOLDER}/Glass wastes.md`)).toBe(true);
		expect(store.hasDefault("glass-wastes")).toBe(false);
		expect(allBiomeIds()).toContain("glass-wastes");
		// A second one with the same name gets its own id and file.
		const two = await store.create({ label: "Glass wastes", mix: [{ type: "desert", weight: 1 }], transitions: [] });
		expect(two).toEqual({ id: "glass-wastes-2" });
	});

	it("rename keeps the id (references follow), writing it in when the note had none", async () => {
		const v = new MemVault({ [`${FOLDER}/Ash.md`]: "| Type | Weight |\n| --- | --- |\n| volcanic | 1 |\n" });
		const { store } = await boot(v);
		expect(store.get("ash")).toBeDefined();
		const text = v.files.get(`${FOLDER}/Ash.md`)!;
		v.files.delete(`${FOLDER}/Ash.md`);
		v.files.set(`${FOLDER}/Cinder fields.md`, text);
		store.onRename(v.app().vault.getAbstractFileByPath(`${FOLDER}/Cinder fields.md`)!, `${FOLDER}/Ash.md`);
		await tick(); await tick();
		expect(store.get("ash")!.label).toBe("Cinder fields");
		expect(v.files.get(`${FOLDER}/Cinder fields.md`)).toMatch(/^id: ash$/m);
		expect(biomeByRef("ash")).toBe("ash");
	});

	it("delete drops the biome from the lookups", async () => {
		const v = new MemVault();
		const { store } = await boot(v);
		store.onDelete(v.app().vault.getAbstractFileByPath(`${FOLDER}/Karst.md`)!);
		expect(store.get("karst")).toBeUndefined();
		expect(allBiomeIds()).not.toContain("karst");
	});
});

// ── the form ─────────────────────────────────────────────────────────────

const LAYOUT: RegionLayout = { footprint: "rect", size: 4, orientation: "flat", parentStagger: "odd", childStagger: "odd" };

describe("biome form model", () => {
	it("offers the palette's types (no settlements), then the biome's others", () => {
		expect(formTypes(PAL, { mix: [{ type: "snow", weight: 1 }] })).toEqual(["desert", "badlands", "grassland", "water", "snow"]);
	});

	it("round-trips a biome through the form", () => {
		const s = formFromFields(GLASS, formTypes(PAL, GLASS));
		expect(s.landPercent).toBe(40);
		expect(fieldsFromForm(s, GLASS.id)).toEqual(GLASS);
	});

	it("a blank form needs a name and a weight, and a name of its own", () => {
		const s = formFromFields(undefined, formTypes(PAL));
		expect(formProblem(s, [])).toMatch(/name/);
		s.label = "Tundra";
		expect(formProblem(s, [])).toMatch(/weight/);
		s.mix.set("desert", 5);
		expect(formProblem(s, [{ id: "tundra", label: "Tundra" }])).toMatch(/already/);
		expect(formProblem(s, [])).toBeUndefined();
		expect(fieldsFromForm(s)).toEqual({ id: "tundra", label: "Tundra", color: "#7a9a5a", mix: [{ type: "desert", weight: 5 }], transitions: [] });
	});

	it("routes: blend, or the linked generator", () => {
		expect(regionGenerator({})).toEqual({ kind: "blend" });
		expect(regionGenerator(GLASS)).toEqual({ kind: "generator", generator: GLASS.generator, ready: true });
		expect(routeNote(GLASS)).toMatch(/^Made by Glass dunes/);
		expect(routeNote({})).toBeUndefined();
	});

	it("previews one region from the mix with the blend field", () => {
		const plan = previewRegion(LAYOUT, PAL, { ...GLASS, mix: [{ type: "water", weight: 1 }] }, 7);
		expect(plan.cells.size).toBeGreaterThan(0);
		expect(new Set(plan.cells.values())).toEqual(new Set(["sea"]));
	});

	it("the preview makes islands from the form's land share", () => {
		const fields = { ...GLASS, mix: [{ type: "water", weight: 9 }, { type: "grassland", weight: 1 }], landShare: 0.4, minIslands: 2 };
		const plan = previewRegion(LAYOUT, PAL, fields, 7);
		const land = [...plan.cells.values()].filter((t) => t !== "sea").length;
		expect(land / plan.cells.size).toBeGreaterThan(0.2);
	});
});
