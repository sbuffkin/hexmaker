import { describe, it, expect, vi } from "vitest";
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
			read: vi.fn(async (f: TFile) => files[f.path] ?? ""),
		},
		metadataCache: {
			getFileCache: vi.fn(() => null),
		},
	} as unknown as import("obsidian").App;
}

/** Minimal plugin stub — only what loadData() needs. */
function makePlugin(hexPathFn: (x: number, y: number) => string) {
	return {
		hexPath: vi.fn(hexPathFn),
		settings: {
			terrainPalette: [],
			tablesFolder: "tables",
			hexEditorTerrainCollapsed: false,
			hexEditorFeaturesCollapsed: false,
			hexEditorNotesCollapsed: false,
			hexEditorStartCollapsed: false,
		},
		availableIcons: [],
	} as unknown as import("../src/DuckmagePlugin").default;
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
