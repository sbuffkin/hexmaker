import { describe, it, mock } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { HexEditorModal } from "../src/hex-map/HexEditorModal";

/** Minimal App backed by a map of path → content strings. */
function makeApp(files: Record<string, string>) {
	const fileObjs = new Map<string, TFile>();
	for (const path of Object.keys(files)) {
		const f = Object.create(TFile.prototype) as TFile;
		f.path = path;
		f.name = path.split("/").pop()!;
		f.basename = f.name.replace(/\.md$/, "");
		fileObjs.set(path, f);
	}

	return {
		vault: {
			getAbstractFileByPath: (p: string) => fileObjs.get(p) ?? null,
			read: mock.fn(async (f: TFile) => files[f.path] ?? ""),
		},
		metadataCache: {
			getFileCache: mock.fn(() => null),
		},
	} as unknown as import("obsidian").App;
}

/** Minimal plugin stub — only what loadData() needs. */
function makePlugin(hexPathFn: (x: number, y: number) => string) {
	return {
		hexPath: mock.fn(hexPathFn),
		settings: {
			terrainPalette: [],
			tablesFolder: "tables",
			hexEditorTerrainCollapsed: false,
			hexEditorFeaturesCollapsed: false,
			hexEditorNotesCollapsed: false,
			hexEditorStartCollapsed: false,
		},
		availableIcons: [],
	} as unknown as import("../src/HexmakerPlugin").default;
}

// ── loadData ──────────────────────────────────────────────────────────────────

describe("HexEditorModal.loadData", () => {
	it("sets hexExists to false when the hex file does not exist", async () => {
		const app = makeApp({});
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).hexExists).toBe(false);
	});

	it("sets hexExists to true when the hex file exists", async () => {
		const app = makeApp({ "hex/1_1.md": "---\nterrain: forest\n---\n\n" });
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).hexExists).toBe(true);
	});

	it("extracts directTerrain from frontmatter", async () => {
		const app = makeApp({ "hex/2_3.md": "---\nterrain: desert\n---\n\nBody." });
		const plugin = makePlugin(() => "hex/2_3.md");
		const modal = new HexEditorModal(app, plugin, 2, 3, "default", () => {});
		await modal.loadData();
		expect((modal as any).directTerrain).toBe("desert");
	});

	it("extracts directIcon from frontmatter", async () => {
		const app = makeApp({ "hex/4_5.md": "---\nterrain: forest\nicon: castle.png\n---\n\n" });
		const plugin = makePlugin(() => "hex/4_5.md");
		const modal = new HexEditorModal(app, plugin, 4, 5, "default", () => {});
		await modal.loadData();
		expect((modal as any).directIcon).toBe("castle.png");
	});

	it("leaves directTerrain null when frontmatter has no terrain field", async () => {
		const app = makeApp({ "hex/1_1.md": "---\ntitle: test\n---\n\n" });
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).directTerrain).toBeNull();
	});

	it("leaves directIcon null when frontmatter has no icon field", async () => {
		const app = makeApp({ "hex/1_1.md": "---\nterrain: forest\n---\n\n" });
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).directIcon).toBeNull();
	});

	it("populates allText from sections", async () => {
		const app = makeApp({
			"hex/3_3.md": "---\nterrain: grass\n---\n\n### Description\n\nA grassy plain.\n\n### Landmark\n\nA tall oak.\n",
		});
		const plugin = makePlugin(() => "hex/3_3.md");
		const modal = new HexEditorModal(app, plugin, 3, 3, "default", () => {});
		await modal.loadData();
		expect((modal as any).allText.get("description")).toBe("A grassy plain.");
		expect((modal as any).allText.get("landmark")).toBe("A tall oak.");
	});

	it("populates allLinks with wiki-links from link sections", async () => {
		const app = makeApp({
			"hex/5_5.md": "---\nterrain: forest\n---\n\n### Encounters Table\n\n[[tables/terrain/forest - encounters]]\n",
		});
		const plugin = makePlugin(() => "hex/5_5.md");
		const modal = new HexEditorModal(app, plugin, 5, 5, "default", () => {});
		await modal.loadData();
		const links = (modal as any).allLinks.get("encounters table") as string[];
		expect(links).toContain("tables/terrain/forest - encounters");
	});
});

// ── GM icon (gm-icon frontmatter) ────────────────────────────────────────────

describe("HexEditorModal.loadData — gm-icon", () => {
	it("extracts directGmIcon from frontmatter", async () => {
		const app = makeApp({ "hex/1_1.md": "---\nterrain: forest\ngm-icon: skull.png\n---\n\n" });
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).directGmIcon).toBe("skull.png");
	});

	it("leaves directGmIcon null when frontmatter has no gm-icon field", async () => {
		const app = makeApp({ "hex/1_1.md": "---\nterrain: forest\n---\n\n" });
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).directGmIcon).toBeNull();
	});

	it("resets directGmIcon to null when navigating to a hex with no gm-icon", async () => {
		const app = makeApp({
			"hex/1_1.md": "---\nterrain: forest\ngm-icon: skull.png\n---\n\n",
			"hex/2_1.md": "---\nterrain: desert\n---\n\n",
		});
		const plugin = makePlugin((x, y) => `hex/${x}_${y}.md`);
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).directGmIcon).toBe("skull.png");

		(modal as any).x = 2;
		(modal as any).y = 1;
		await modal.loadData();
		expect((modal as any).directGmIcon).toBeNull();
	});

	it("does not confuse icon and gm-icon when both are present", async () => {
		const app = makeApp({
			"hex/3_3.md": "---\nterrain: forest\nicon: tower.png\ngm-icon: skull.png\n---\n\n",
		});
		const plugin = makePlugin(() => "hex/3_3.md");
		const modal = new HexEditorModal(app, plugin, 3, 3, "default", () => {});
		await modal.loadData();
		expect((modal as any).directIcon).toBe("tower.png");
		expect((modal as any).directGmIcon).toBe("skull.png");
	});
});

// ── HexEditorOptions ──────────────────────────────────────────────────────────

describe("HexEditorModal — HexEditorOptions", () => {
	it("stores options.gmLayerActive when provided", () => {
		const app = makeApp({});
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(
			app, plugin, 1, 1, "default", () => {},
			{ gmLayerActive: true },
		);
		expect((modal as any).options.gmLayerActive).toBe(true);
	});

	it("defaults options.gmLayerActive to undefined when no options passed", () => {
		const app = makeApp({});
		const plugin = makePlugin(() => "hex/1_1.md");
		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		expect((modal as any).options.gmLayerActive).toBeUndefined();
	});
});

// ── Section start-collapsed settings (issue #34) ─────────────────────────────

describe("HexEditorModal section start-collapsed settings", () => {
	/** Render the body with DOM-heavy helpers stubbed; return label → startCollapsed. */
	function collapsedStates(notesCollapsed: boolean, gmLayerActive: boolean) {
		const plugin = makePlugin(() => "hex/1_1.md");
		(plugin.settings as any).hexEditorNotesCollapsed = notesCollapsed;
		(plugin as any).getMapPalette = () => [];
		const modal = new HexEditorModal(
			makeApp({}), plugin, 1, 1, "default", () => {}, { gmLayerActive },
		) as any;
		const states = new Map<string, boolean>();
		modal.makeCollapsible = (_c: unknown, label: string, flag: string) => {
			states.set(label, (plugin.settings as any)[flag] ?? false);
			return { body: { addClass: () => {} }, header: { createSpan: () => ({}) } };
		};
		modal.renderTerrainHeader = () => {};
		modal.renderTerrainSection = () => {};
		modal.renderIconSections = () => {};
		modal.renderTextSection = () => {};
		modal.renderDropdownSection = () => {};
		modal.renderBody({ createEl: () => ({}) }, "hex/1_1.md");
		return states;
	}

	it("starts Notes collapsed when the setting is on and the GM layer is active", () => {
		expect(collapsedStates(true, true).get("Notes")).toBe(true);
	});

	it("starts Notes collapsed when the setting is on and the GM layer is off", () => {
		expect(collapsedStates(true, false).get("Notes")).toBe(true);
	});

	it("starts Notes expanded when the setting is off", () => {
		expect(collapsedStates(false, true).get("Notes")).toBe(false);
	});

	it("puts Notes right under Terrain and the long icon grids last (fresh-eyes round 3)", () => {
		expect([...collapsedStates(false, true).keys()]).toEqual(["Terrain", "Notes", "Linked notes", "Icons"]);
	});
});

// ── Navigation: reload on hex change ─────────────────────────────────────────

describe("HexEditorModal navigation reload", () => {
	it("reloads data for the new hex after x/y are updated", async () => {
		const app = makeApp({
			"hex/1_1.md": "---\nterrain: forest\n---\n\n",
			"hex/2_2.md": "---\nterrain: desert\n---\n\n",
		});
		const plugin = makePlugin((x, y) => `hex/${x}_${y}.md`);

		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).directTerrain).toBe("forest");

		// Simulate navigation to a neighbour hex
		(modal as any).x = 2;
		(modal as any).y = 2;
		await modal.loadData();
		expect((modal as any).directTerrain).toBe("desert");
	});

	it("clears terrain data when navigating to a hex with no file", async () => {
		const app = makeApp({
			"hex/1_1.md": "---\nterrain: forest\n---\n\n",
		});
		const plugin = makePlugin((x, y) => `hex/${x}_${y}.md`);

		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).hexExists).toBe(true);

		(modal as any).x = 9;
		(modal as any).y = 9;
		await modal.loadData();
		expect((modal as any).hexExists).toBe(false);
		expect((modal as any).directTerrain).toBeNull();
	});

	it("loads correct icon when navigating between hexes with different icons", async () => {
		const app = makeApp({
			"hex/1_1.md": "---\nterrain: forest\nicon: tower.png\n---\n\n",
			"hex/2_1.md": "---\nterrain: desert\nicon: oasis.png\n---\n\n",
		});
		const plugin = makePlugin((x, y) => `hex/${x}_${y}.md`);

		const modal = new HexEditorModal(app, plugin, 1, 1, "default", () => {});
		await modal.loadData();
		expect((modal as any).directIcon).toBe("tower.png");

		(modal as any).x = 2;
		(modal as any).y = 1;
		await modal.loadData();
		expect((modal as any).directIcon).toBe("oasis.png");
	});
});

// ── Fresh-eyes #38 (E1, E5) ─────────────────────────────────────────────────

describe("HexEditorModal reads terrain from the map note (E1)", () => {
	it("loads terrain and icon from the map store even when the hex note doesn't exist", async () => {
		const { setHexDataSource } = await import("../src/frontmatter");
		setHexDataSource({
			isReady: () => true,
			resolve: (p: string) => (p === "hex/3_3.md" ? { map: "m", key: "3_3" } : null),
			get: (_m: string, k: string) => (k === "3_3" ? { terrain: "hill", icon: "tower.png", gmIcons: ["skull.png"] } : undefined),
			set: () => {},
		} as any);
		try {
			const plugin = makePlugin(() => "hex/3_3.md");
			const modal = new HexEditorModal(makeApp({}), plugin, 3, 3, "m", () => {}) as any;
			await modal.loadData();
			expect(modal.hexExists).toBe(false);
			expect(modal.directTerrain).toBe("hill");
			expect(modal.directIcon).toBe("tower.png");
			expect(modal.directGmIcons).toEqual(["skull.png"]);
		} finally {
			setHexDataSource(null);
		}
	});
});

describe("HexEditorModal remembers collapsed groups (E5)", () => {
	/** Just enough of an HTMLElement for makeCollapsible. */
	function fakeEl(): any {
		let shown = true;
		const listeners: Record<string, () => void> = {};
		return {
			textContent: "",
			createDiv: () => fakeEl(),
			createSpan: () => fakeEl(),
			createEl: () => fakeEl(),
			hide: () => { shown = false; },
			show: () => { shown = true; },
			isShown: () => shown,
			addEventListener: (t: string, fn: () => void) => { listeners[t] = fn; },
			fire: (t: string) => listeners[t]?.(),
		};
	}

	it("collapsing a group saves its flag, so the next hex opens the same way", () => {
		const plugin = makePlugin(() => "hex/1_1.md");
		const saveSettings = mock.fn(async () => {});
		(plugin as any).saveSettings = saveSettings;
		const modal = new HexEditorModal(makeApp({}), plugin, 1, 1, "default", () => {}) as any;
		const { body, header } = modal.makeCollapsible(fakeEl(), "Terrain", "hexEditorTerrainCollapsed");
		expect(body.isShown()).toBe(true);
		header.fire("click");
		expect(body.isShown()).toBe(false);
		expect(plugin.settings.hexEditorTerrainCollapsed).toBe(true);
		expect(saveSettings.mock.callCount()).toBe(1);

		const next = new HexEditorModal(makeApp({}), plugin, 2, 2, "default", () => {}) as any;
		const reopened = next.makeCollapsible(fakeEl(), "Terrain", "hexEditorTerrainCollapsed");
		expect(reopened.body.isShown()).toBe(false);
		reopened.header.fire("click");
		expect(plugin.settings.hexEditorTerrainCollapsed).toBe(false);
	});
});
