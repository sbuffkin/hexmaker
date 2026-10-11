import { describe, it } from "node:test";
import expect from "expect";
import { planKindContent, resolveKindContent, shippedContentOn } from "../src/kindContent";
import { DEFAULT_SETTINGS, DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import {
	PALETTE_PRESETS,
	SPACE_PLANET_PALETTE_NAME,
	SPACE_PLANET_TERRAINS,
	presetToPalette,
	getPreset,
} from "../src/palettes/presets";
import { buildPaletteNote, parsePaletteNote, readPaletteKind, setPaletteKind } from "../src/palettes/paletteNote";
import { isSpacePalette, paletteKind, terrainsForTables } from "../src/mapKinds";
import { isTerrainType } from "../src/terrainTypes";
import { planetRoles, planetSurface, planetSurfaceFits } from "../src/worldgen/procedural/planetSurface";
import { BUNDLED_ICONS } from "../src/bundledIcons";
import { defaultPaletteFor } from "../src/palettes/paletteOptions";
import { DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { BIOME_PRESETS } from "../src/overworld/biomePresets";
import { IMPORT_LIST_EXTENSIONS, contentFolder, inAnyFolder, pickerFolders } from "../src/notePickers";
import { isLinkableNotePath, templateNoteRules } from "../src/templateNotes";
import { isTokenNoteCandidate } from "../src/hex-map/tokenDefaults";

/** A fresh install's palettes (what DEFAULT_SETTINGS ships). */
const fresh = () => DEFAULT_SETTINGS.terrainPalettes.map((p) => ({ ...p, terrains: p.terrains.map((t) => ({ ...t })) }));
const SPACE_PRESETS = PALETTE_PRESETS.filter((p) => p.kind === "space").map((p) => p.name);

describe("what a setup installs follows the map types picked (SP3)", () => {
	it("space only: no fantasy palettes, the space ones, Palette for new maps on Space - Sector", () => {
		const plan = planKindContent({ kinds: ["space"], done: undefined, firstSetup: true, palettes: fresh(), inUse: new Set(), defaultPalette: "Expanded" });
		expect(plan.remove).toEqual(["Expanded", "Limited"]);
		expect(plan.install).toEqual(["Space - Sector", "Space - System", "Space - Planet"]);
		expect(plan.newKinds).toEqual(["space"]);
		expect(plan.defaultPalette).toBe("Space - Sector");
		expect(plan.done).toEqual(["space"]);
	});

	it("fantasy only: unchanged (keeps Expanded and Limited, installs nothing, default stays)", () => {
		const plan = planKindContent({ kinds: ["world"], done: undefined, firstSetup: true, palettes: fresh(), inUse: new Set(), defaultPalette: "Expanded" });
		expect(plan).toEqual({ install: [], remove: [], newKinds: ["world"], done: ["world"] });
	});

	it("both: keeps the fantasy palettes and installs the space ones", () => {
		const plan = planKindContent({ kinds: ["world", "space"], done: undefined, firstSetup: true, palettes: fresh(), inUse: new Set(), defaultPalette: "Expanded" });
		expect(plan.remove).toEqual([]);
		expect(plan.install).toEqual(SPACE_PRESETS);
		expect(plan.defaultPalette).toBeUndefined();
		expect(plan.done).toEqual(["world", "space"]);
	});

	it("turning World on later installs its palettes then, once", () => {
		const space = SPACE_PRESETS.map((n) => presetToPalette(getPreset(n)!));
		const plan = planKindContent({ kinds: ["world", "space"], done: ["space"], firstSetup: false, palettes: space, inUse: new Set(), defaultPalette: "Space - Sector" });
		expect(plan.install).toEqual(["Expanded", "Limited"]);
		expect(plan.newKinds).toEqual(["world"]);
		expect(plan.defaultPalette).toBeUndefined();
		// Already done: a deleted palette isn't brought back.
		const again = planKindContent({ kinds: ["world", "space"], done: ["world", "space"], firstSetup: false, palettes: space, inUse: new Set(), defaultPalette: "Space - Sector" });
		expect(again.install).toEqual([]);
		expect(again.newKinds).toEqual([]);
	});

	it("never drops a palette a map uses, one the user changed, or any outside the first setup", () => {
		const pals = fresh();
		pals[1].terrains[0].color = "#123456"; // Limited edited
		const plan = planKindContent({ kinds: ["space"], done: undefined, firstSetup: true, palettes: pals, inUse: new Set(["Expanded"]), defaultPalette: "Expanded" });
		expect(plan.remove).toEqual([]);
		const later = planKindContent({ kinds: ["space"], done: ["world"], firstSetup: false, palettes: fresh(), inUse: new Set(), defaultPalette: "Expanded" });
		expect(later.remove).toEqual([]);
	});

	it("keeps a Palette for new maps the user set to a type that's on", () => {
		const pals = [...fresh(), { name: "My moon", kind: "space", terrains: [{ name: "dust", color: "#999", type: "badlands" }] }];
		const plan = planKindContent({ kinds: ["space"], done: undefined, firstSetup: true, palettes: pals, inUse: new Set(), defaultPalette: "My moon" });
		expect(plan.defaultPalette).toBeUndefined();
	});

	it("a palette's type is data on it, not its name", () => {
		const renamed = { name: "Expanded", kind: "space", terrains: SPACE_PLANET_TERRAINS };
		expect(paletteKind(renamed)).toBe("space");
		const plan = planKindContent({ kinds: ["space"], done: undefined, firstSetup: true, palettes: [renamed], inUse: new Set(), defaultPalette: "Expanded" });
		expect(plan.remove).toEqual([]);
	});

	it("shipped notes wait until the setup picks the types; updates count as done", () => {
		expect(shippedContentOn({ mapKinds: ["world"] }, "world")).toBe(false);
		expect(shippedContentOn({ mapKinds: ["space"], kindContent: ["space"] }, "world")).toBe(false);
		expect(shippedContentOn({ mapKinds: ["world"], kindContent: ["world"] }, "world")).toBe(true);
		expect(resolveKindContent(null, ["world"])).toBeNull();
		expect(resolveKindContent({}, ["world"])).toBeNull();
		// A fresh install's first save keeps it undecided across a restart.
		expect(resolveKindContent({ featureLevel: "simple", kindContent: null }, ["world"])).toBeNull();
		expect(resolveKindContent({ maps: [] }, ["world", "space"])).toEqual(["world", "space"]);
		expect(resolveKindContent({ kindContent: ["space"] }, ["world"])).toEqual(["space"]);
	});

	it("every shipped biome declares its map type (World)", () => {
		for (const b of BIOME_PRESETS) expect({ id: b.id, kind: b.kind }).toEqual({ id: b.id, kind: "world" });
	});
});

describe("Space - Planet palette", () => {
	const preset = getPreset(SPACE_PLANET_PALETTE_NAME)!;

	it("is a space preset made of typed land terrains", () => {
		expect(preset.kind).toBe("space");
		expect(isSpacePalette(preset.terrains)).toBe(false);
		expect(paletteKind(presetToPalette(preset))).toBe("space");
		for (const t of preset.terrains) expect({ t: t.name, typed: isTerrainType(t.type) }).toEqual({ t: t.name, typed: true });
	});

	it("parses from its note, map-kind included", () => {
		const note = buildPaletteNote(preset.terrains, undefined, "space");
		expect(parsePaletteNote(note)).toEqual(preset.terrains);
		expect(readPaletteKind(note)).toBe("space");
		expect(readPaletteKind(setPaletteKind(note, undefined))).toBeUndefined();
		expect(readPaletteKind(setPaletteKind("---\nhexmaker-palette: 1\n---\nx", "world"))).toBe("world");
		expect(readPaletteKind("---\nmap-kind: fantasy\n---\n")).toBeUndefined();
	});

	it("uses only bundled icons", () => {
		for (const t of preset.terrains) if (t.icon) expect({ icon: t.icon, ok: BUNDLED_ICONS.has(t.icon) }).toEqual({ icon: t.icon, ok: true });
	});

	it("drives the Planet surface generator (every climate)", () => {
		expect(planetSurfaceFits(preset.terrains)).toBe(true);
		const r = planetRoles(preset.terrains)!;
		expect([r.sea, r.plains, r.desert, r.badlands, r.snow, r.volcano]).toEqual(["ocean", "plains", "dunes", "regolith", "ice", "lava field"]);
		const grid = { cols: 20, rows: 14, offset: { x: 0, y: 0 }, stagger: "odd" as const, orientation: "flat" as const };
		for (const climate of ["temperate", "lush", "arid", "frozen", "volcanic"]) {
			const out = planetSurface(preset.terrains, grid, 3, { water: "30", climate });
			expect(out.cells.size).toBe(280);
		}
	});

	it("planets open on it (system submap defaults and the shipped world types), with base terrains it has", () => {
		const names = new Set(preset.terrains.map((t) => t.name));
		const system = getPreset("Space - System")!;
		for (const [terrain, d] of Object.entries(system.submapDefaults ?? {})) {
			if (d.generator !== "procedural:planet-surface") continue;
			expect({ terrain, palette: d.palette, base: names.has(d.baseTerrain!) }).toEqual({ terrain, palette: SPACE_PLANET_PALETTE_NAME, base: true });
		}
		const surfaces = DEFAULT_WORLD_TYPE_ROWS.filter((r) => r.generator?.id === "procedural:planet-surface");
		expect(surfaces.length).toBeGreaterThan(0);
		for (const r of surfaces) expect({ world: r.world, palette: r.palette, base: names.has(r.baseTerrain!) }).toEqual({ world: r.world, palette: SPACE_PLANET_PALETTE_NAME, base: true });
	});

	it("gets terrain tables in a space-only setup; Palette for new maps skips it for Space - Sector", () => {
		const pals = SPACE_PRESETS.map((n) => presetToPalette(getPreset(n)!));
		const tables = terrainsForTables(pals, ["space"]).map((t) => t.name);
		expect(tables).toContain("regolith");
		expect(defaultPaletteFor({ mapKinds: ["space"], terrainPalettes: pals, defaultPalette: "" })).toBe("Space - Sector");
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [...pals, { name: "Limited", kind: "world", terrains: LIMITED_TERRAIN_PALETTE }] })).toBe("Limited");
		expect(planetSurfaceFits(DEFAULT_TERRAIN_PALETTE)).toBe(true);
	});
});

describe("pickers list what they're for (SP3)", () => {
	const settings = { worldFolder: "world", townsFolder: "", dungeonsFolder: "places/dungeons", tablesFolder: "", workflowsFolder: "" };

	it("a blank folder setting is its usual place under the world folder, never the vault", () => {
		expect(contentFolder(settings, "townsFolder")).toBe("world/towns");
		expect(contentFolder(settings, "dungeonsFolder")).toBe("places/dungeons");
		expect(contentFolder(settings, "workflowsFolder")).toBe("world/workflows");
		expect(contentFolder({}, "tablesFolder")).toBe("world/tables");
	});

	it("the token Note picker lists characters, ships, factions and places only", () => {
		const include = pickerFolders(settings, "token");
		const ok = (p: string) => isTokenNoteCandidate(p, p.split("/").pop()!.replace(/\.md$/, ""), include, []);
		expect(ok("world/tokens/Far Horizon.md")).toBe(true);
		expect(ok("world/towns/Ashby.md")).toBe(true);
		expect(ok("places/dungeons/Barrow.md")).toBe(true);
		expect(ok("world/factions/Guild.md")).toBe(true);
		expect(ok("world/regions/Marches.md")).toBe(true);
		for (const internal of ["world/biomes/Alpine.md", "world/biome-pools/All biomes.md", "world/palettes/Expanded.md", "world/world-types/Default space.md", "world/generators/forest.md", "world/tables/terrain/encounters/ocean.md", "world/hexes/default/1_1.md", "world/templates/hex.md", "world/workflows/npc.md"]) {
			expect({ internal, listed: ok(internal) }).toEqual({ internal, listed: false });
		}
	});

	it("table and workflow pickers list their own folders", () => {
		expect(pickerFolders(settings, "table")).toEqual(["world/tables"]);
		expect(pickerFolders(settings, "workflow")).toEqual(["world/workflows"]);
		expect(inAnyFolder("world/tables/weather.md", pickerFolders(settings, "table"))).toBe(true);
		expect(inAnyFolder("world/biomes/Alpine.md", pickerFolders(settings, "table"))).toBe(false);
	});

	it("plugin data notes are never offered by any note picker", () => {
		const rules = templateNoteRules({ worldFolder: "world" }, [], ["world/palettes", "world/biomes", "world/biome-pools", "world/world-types", "world/generators"]);
		expect(isLinkableNotePath("world/biomes/Alpine.md", "Alpine", rules)).toBe(false);
		expect(isLinkableNotePath("world/palettes/Expanded.md", "Expanded", rules)).toBe(false);
		expect(isLinkableNotePath("world/towns/Ashby.md", "Ashby", rules)).toBe(true);
	});

	it("Import… offers text it can read, not images or PDFs", () => {
		expect(IMPORT_LIST_EXTENSIONS).toEqual(expect.arrayContaining(["md", "txt", "csv"]));
		for (const ext of ["png", "jpg", "pdf", "svg"]) expect(IMPORT_LIST_EXTENSIONS).not.toContain(ext);
	});
});
