import { describe, it } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import {
	generatorMapKind,
	isGeneratorShown,
	isSpacePalette,
	resolveMapKinds,
	terrainsForTables,
} from "../src/mapKinds";
import { DEFAULT_SETTINGS, DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS, PALETTE_PRESETS } from "../src/palettes/presets";
import { listGeneratorKinds, visibleKinds, BLANK_ID } from "../src/worldgen/registry";
import { STAR_SCATTER_ID } from "../src/worldgen/procedural/starScatter";
import { ORBITS_ID } from "../src/worldgen/procedural/orbits";
import { OVERLAND_ID, PLANET_SURFACE_ID, REGION_DETAIL_ID } from "../src/worldgen/procedural/planetSurface";
import { learnModel, modelToMarkdown } from "../packages/hex-wfc/src";
import type HexmakerPlugin from "../src/HexmakerPlugin";

const WORLD_ONLY = { mapKinds: ["world"] };
const BOTH = { mapKinds: ["world", "space"] };
const ids = (ks: { id: string }[]) => ks.map((k) => k.id);

describe("generatorMapKind", () => {
	it("maps the map-kind frontmatter to a map type", () => {
		expect(generatorMapKind({ "map-kind": "planet" })).toBe("space");
		expect(generatorMapKind({ "map-kind": "space" })).toBe("space");
		expect(generatorMapKind({ "map-kind": " Planet " })).toBe("space");
		expect(generatorMapKind({ "map-kind": "world" })).toBe("world");
	});

	it("is undefined when unset or unknown", () => {
		expect(generatorMapKind(undefined)).toBeUndefined();
		expect(generatorMapKind({})).toBeUndefined();
		expect(generatorMapKind({ "map-kind": "dungeon" })).toBeUndefined();
	});
});

describe("isSpacePalette", () => {
	it("is true for the space presets, false for the world ones", () => {
		expect(isSpacePalette(SPACE_SECTOR_TERRAINS)).toBe(true);
		expect(isSpacePalette(SPACE_SYSTEM_TERRAINS)).toBe(true);
		expect(isSpacePalette(DEFAULT_TERRAIN_PALETTE)).toBe(false);
		expect(isSpacePalette(LIMITED_TERRAIN_PALETTE)).toBe(false);
		for (const p of PALETTE_PRESETS) expect({ p: p.name, space: isSpacePalette(p.terrains) }).toEqual({ p: p.name, space: p.kind === "space" });
	});

	it("needs a typed space terrain (names alone don't count)", () => {
		expect(isSpacePalette([{ name: "void" } as { name: string; type?: string }])).toBe(false);
		expect(isSpacePalette([{ type: "forest" }, { type: "star" }])).toBe(true);
		expect(isSpacePalette([])).toBe(false);
		expect(isSpacePalette(undefined)).toBe(false);
	});
});

describe("isGeneratorShown", () => {
	it("shows world and untyped generators to world users", () => {
		expect(isGeneratorShown(WORLD_ONLY, undefined)).toBe(true);
		expect(isGeneratorShown(WORLD_ONLY, "world")).toBe(true);
	});

	it("hides space generators from world-only users on a world map", () => {
		expect(isGeneratorShown(WORLD_ONLY, "space")).toBe(false);
		expect(isGeneratorShown(WORLD_ONLY, "space", { spaceContext: false, selected: false })).toBe(false);
	});

	it("shows space generators when space is on, in space, or selected", () => {
		expect(isGeneratorShown(BOTH, "space")).toBe(true);
		expect(isGeneratorShown(WORLD_ONLY, "space", { spaceContext: true })).toBe(true);
		expect(isGeneratorShown(WORLD_ONLY, "space", { selected: true })).toBe(true);
	});

	it("a space context doesn't reveal world generators to space-only users", () => {
		expect(isGeneratorShown({ mapKinds: ["space"] }, "world", { spaceContext: true })).toBe(false);
		expect(isGeneratorShown({ mapKinds: ["space"] }, "world", { selected: true })).toBe(true);
	});
});

describe("map kinds on load", () => {
	it("new installs start with world only", () => {
		expect(DEFAULT_SETTINGS.mapKinds).toEqual(["world"]);
		expect(resolveMapKinds(undefined, [{ terrains: DEFAULT_TERRAIN_PALETTE }])).toEqual(["world"]);
	});

	it("upgrades without the setting get space if a palette is already in space", () => {
		const palettes = [{ terrains: DEFAULT_TERRAIN_PALETTE }, { terrains: SPACE_SECTOR_TERRAINS }];
		expect(resolveMapKinds(undefined, palettes)).toEqual(["world", "space"]);
		expect(resolveMapKinds(undefined, [])).toEqual(["world"]);
	});

	it("a saved value always wins (and is a copy)", () => {
		const saved = ["world"];
		const resolved = resolveMapKinds(saved, [{ terrains: SPACE_SECTOR_TERRAINS }]);
		expect(resolved).toEqual(["world"]);
		expect(resolved).not.toBe(saved);
		expect(resolveMapKinds(["space"], [])).toEqual(["space"]);
		expect(resolveMapKinds(["world", "bogus"], [])).toEqual(["world"]);
	});
});

/** Plugin stub with learned generator notes in world/generators. */
function pluginWith(generators: Record<string, Record<string, string>>, mapKinds: string[]): HexmakerPlugin {
	const files = new Map<string, string>();
	const cells = { "0_0": "ocean", "1_0": "ocean", "0_1": "grass", "1_1": "grass" };
	for (const [name, meta] of Object.entries(generators)) {
		const model = learnModel(cells, { name, orientation: "flat", meta });
		files.set(`world/generators/${name}.md`, modelToMarkdown(model));
	}
	const fileObj = (path: string) => {
		const f = Object.create(TFile.prototype) as TFile;
		f.path = path;
		f.basename = path.split("/").pop()!.replace(/\.md$/, "");
		return f;
	};
	return {
		settings: { worldFolder: "world", mapKinds, pathTypes: [], hexOrientation: "flat" },
		app: {
			vault: {
				getMarkdownFiles: () => [...files.keys()].map(fileObj),
				cachedRead: async (f: TFile) => files.get(f.path) ?? "",
			},
		},
	} as unknown as HexmakerPlugin;
}

describe("generator registry visibility", () => {
	const learned = { "planet-ocean": { "map-kind": "planet", palette: "Default" }, "my-coast": {} };

	it("tags built-in and learned generators with their map type", async () => {
		const kinds = await listGeneratorKinds(pluginWith(learned, ["world"]));
		const kindOf = (id: string) => kinds.find((k) => k.id === id)?.mapKind;
		expect(kindOf(BLANK_ID)).toBeUndefined();
		expect(kindOf(STAR_SCATTER_ID)).toBe("space");
		expect(kindOf(ORBITS_ID)).toBe("space");
		expect(kindOf(PLANET_SURFACE_ID)).toBe("space");
		expect(kindOf(REGION_DETAIL_ID)).toBe("world");
		expect(kindOf("wfc:world/generators/planet-ocean.md")).toBe("space");
		expect(kindOf("wfc:world/generators/my-coast.md")).toBeUndefined();
	});

	it("world-only users on a world map don't see space generators", async () => {
		const plugin = pluginWith(learned, ["world"]);
		const shown = ids(visibleKinds(await listGeneratorKinds(plugin), plugin.settings, false));
		expect(shown).toContain(BLANK_ID);
		expect(shown).toContain(REGION_DETAIL_ID);
		// a procedural top-level generator without the space wording
		expect(shown).toContain(OVERLAND_ID);
		expect(shown).toContain("wfc:world/generators/my-coast.md");
		for (const id of [STAR_SCATTER_ID, ORBITS_ID, PLANET_SURFACE_ID, "wfc:world/generators/planet-ocean.md"]) {
			expect(shown).not.toContain(id);
		}
	});

	it("a planet submap of a star system still gets Planet surface and planet generators", async () => {
		const plugin = pluginWith(learned, ["world"]);
		const shown = ids(visibleKinds(await listGeneratorKinds(plugin), plugin.settings, true));
		expect(shown).toContain(PLANET_SURFACE_ID);
		expect(shown).toContain("wfc:world/generators/planet-ocean.md");
	});

	it("Simple shows the starter generators and Space ones, not learned or preset ones", async () => {
		const plugin = pluginWith(learned, ["world", "space"]);
		(plugin.settings as { featureLevel?: string }).featureLevel = "simple";
		const all = await listGeneratorKinds(plugin);
		const world = ids(visibleKinds(all, plugin.settings, false));
		for (const id of [BLANK_ID, OVERLAND_ID, REGION_DETAIL_ID]) expect(world).toContain(id);
		expect(world).not.toContain("wfc:world/generators/my-coast.md");
		const space = ids(visibleKinds(all, plugin.settings, true));
		expect(space).toContain(STAR_SCATTER_ID);
		expect(space).toContain("wfc:world/generators/planet-ocean.md");
		// Turning on just the generators feature brings the rest back.
		(plugin.settings as { advancedFeatures?: string[] }).advancedFeatures = ["generators"];
		expect(ids(visibleKinds(all, plugin.settings, false))).toContain("wfc:world/generators/my-coast.md");
	});

	it("keeps a saved choice visible", async () => {
		const plugin = pluginWith(learned, ["world"]);
		const shown = ids(visibleKinds(await listGeneratorKinds(plugin), plugin.settings, false, PLANET_SURFACE_ID));
		expect(shown).toContain(PLANET_SURFACE_ID);
		expect(shown).not.toContain(ORBITS_ID);
	});

	it("space users see everything", async () => {
		const plugin = pluginWith(learned, ["world", "space"]);
		const all = await listGeneratorKinds(plugin);
		expect(visibleKinds(all, plugin.settings, false)).toHaveLength(all.length);
	});
});

describe("space presets end-to-end (submap defaults)", () => {
	it("every space submap default names a generator a world-only user still sees in that context", async () => {
		const plugin = pluginWith({}, ["world"]);
		const all = await listGeneratorKinds(plugin);
		for (const p of PALETTE_PRESETS.filter((x) => x.kind === "space")) {
			for (const [terrain, d] of Object.entries(p.submapDefaults ?? {})) {
				if (!d.generator) continue;
				// The parent map uses this space palette → space context.
				const shown = ids(visibleKinds(all, plugin.settings, isSpacePalette(p.terrains)));
				expect({ palette: p.name, terrain, ok: shown.includes(d.generator) }).toMatchObject({ ok: true });
			}
		}
	});
});

describe("terrainsForTables (G4: Space-only setups skip fantasy terrain tables)", () => {
	const palettes = [
		{ terrains: DEFAULT_TERRAIN_PALETTE },
		{ terrains: LIMITED_TERRAIN_PALETTE },
		{ terrains: SPACE_SECTOR_TERRAINS },
	];
	it("space only: just the space palettes' terrains", () => {
		const names = terrainsForTables(palettes, ["space"]).map((t) => t.name);
		expect(names).toContain("garden world");
		expect(names).not.toContain("forest");
		expect(names).not.toContain("grass");
	});
	it("with World on: every palette's terrains, once each", () => {
		const names = terrainsForTables(palettes, ["world", "space"]).map((t) => t.name);
		expect(names).toContain("forest");
		expect(names).toContain("garden world");
		expect(new Set(names).size).toBe(names.length);
		expect(terrainsForTables(palettes, ["world"]).map((t) => t.name)).toEqual(names);
	});
});
