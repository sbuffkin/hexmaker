import { describe, it, mock } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { getTerrainFromFile, setTerrainInFile, getIconOverrideFromFile, setIconOverrideInFile } from "../src/frontmatter";

/** Build a minimal mock App backed by an in-memory string. */
function makeApp(filePath: string, initialContent: string) {
	let stored = initialContent;

	const file = Object.create(TFile.prototype) as TFile;
	file.path = filePath;

	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === filePath ? file : null),
		},
		fileManager: {
			processFrontMatter: mock.fn(async (_f: unknown, fn: (fm: Record<string, unknown>) => void) => {
				const fmMatch = stored.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
				const fm: Record<string, unknown> = {};
				if (fmMatch) {
					for (const line of fmMatch[1].split("\n")) {
						const m = line.match(/^([\w-]+):\s*(.+)$/);
						if (m) fm[m[1]] = m[2].trim();
					}
				}
				const rest = fmMatch ? stored.slice(fmMatch[0].length) : stored;
				fn(fm);
				const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
				stored = fmLines ? `---\n${fmLines}\n---\n${rest}` : rest;
			}),
		},
		metadataCache: {
			getFileCache: mock.fn(() => null),
		},
	} as unknown as import("obsidian").App;

	return { app, getContent: () => stored };
}

// ── setTerrainInFile ──────────────────────────────────────────────────────────

describe("setTerrainInFile", () => {
	it("returns false when the file does not exist", async () => {
		const { app } = makeApp("world/hexes/1_1.md", "");
		const result = await setTerrainInFile(app, "world/hexes/MISSING.md", "forest");
		expect(result).toBe(false);
	});

	it("adds terrain to existing frontmatter that lacks it", async () => {
		const { app, getContent } = makeApp("hex.md", "---\ntitle: test\n---\n\nContent");
		await setTerrainInFile(app, "hex.md", "forest");
		expect(getContent()).toContain("terrain: forest");
		expect(getContent()).toContain("title: test");
	});

	it("updates an existing terrain field", async () => {
		const { app, getContent } = makeApp("hex.md", "---\nterrain: plains\n---\n\nContent");
		await setTerrainInFile(app, "hex.md", "forest");
		expect(getContent()).toContain("terrain: forest");
		expect(getContent()).not.toContain("terrain: plains");
	});

	it("removes the terrain field when passed null", async () => {
		const { app, getContent } = makeApp("hex.md", "---\nterrain: forest\ntitle: x\n---\n\nContent");
		await setTerrainInFile(app, "hex.md", null);
		expect(getContent()).not.toContain("terrain:");
		expect(getContent()).toContain("title: x");
	});

	it("creates frontmatter when none exists", async () => {
		const { app, getContent } = makeApp("hex.md", "Just content.");
		await setTerrainInFile(app, "hex.md", "desert");
		expect(getContent()).toMatch(/^---\n/);
		expect(getContent()).toContain("terrain: desert");
		expect(getContent()).toContain("Just content.");
	});

	it("returns true and makes no change when removing terrain from a file with no frontmatter", async () => {
		const { app, getContent } = makeApp("hex.md", "No frontmatter.");
		const result = await setTerrainInFile(app, "hex.md", null);
		expect(result).toBe(true);
		expect(getContent()).toBe("No frontmatter.");
	});

	it("preserves content body after the frontmatter", async () => {
		const body = "\n### Towns\n\n[[Town A]]\n";
		const { app, getContent } = makeApp("hex.md", `---\nterrain: plains\n---\n${body}`);
		await setTerrainInFile(app, "hex.md", "forest");
		expect(getContent()).toContain("### Towns");
		expect(getContent()).toContain("[[Town A]]");
	});
});

// ── setIconOverrideInFile ─────────────────────────────────────────────────────

describe("setIconOverrideInFile", () => {
	it("returns false when the file does not exist", async () => {
		const { app } = makeApp("hex.md", "");
		const result = await setIconOverrideInFile(app, "MISSING.md", "castle.png");
		expect(result).toBe(false);
	});

	it("adds icon to existing frontmatter that lacks it", async () => {
		const { app, getContent } = makeApp("hex.md", "---\nterrain: forest\n---\n\nContent");
		await setIconOverrideInFile(app, "hex.md", "castle.png");
		expect(getContent()).toContain("icon: castle.png");
		expect(getContent()).toContain("terrain: forest");
	});

	it("updates an existing icon field", async () => {
		const { app, getContent } = makeApp("hex.md", "---\nicon: tower.png\n---\n\nContent");
		await setIconOverrideInFile(app, "hex.md", "castle.png");
		expect(getContent()).toContain("icon: castle.png");
		expect(getContent()).not.toContain("icon: tower.png");
	});

	it("removes the icon field when passed null", async () => {
		const { app, getContent } = makeApp("hex.md", "---\nicon: castle.png\nterrain: forest\n---\n\nContent");
		await setIconOverrideInFile(app, "hex.md", null);
		expect(getContent()).not.toContain("icon:");
		expect(getContent()).toContain("terrain: forest");
	});

	it("creates frontmatter when none exists", async () => {
		const { app, getContent } = makeApp("hex.md", "Bare content.");
		await setIconOverrideInFile(app, "hex.md", "ruin.png");
		expect(getContent()).toMatch(/^---\n/);
		expect(getContent()).toContain("icon: ruin.png");
		expect(getContent()).toContain("Bare content.");
	});

	it("returns true and makes no change when removing icon from a file with no frontmatter", async () => {
		const { app, getContent } = makeApp("hex.md", "No frontmatter.");
		const result = await setIconOverrideInFile(app, "hex.md", null);
		expect(result).toBe(true);
		expect(getContent()).toBe("No frontmatter.");
	});
});

// ── helpers for cache-based reads ────────────────────────────────────────────

/** Build a minimal mock App that returns a metadata cache with the given frontmatter. */
function makeAppWithCache(filePath: string, frontmatter: Record<string, unknown> | null) {
	const file = Object.create(TFile.prototype) as TFile;
	file.path = filePath;

	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === filePath ? file : null),
		},
		metadataCache: {
			getFileCache: mock.fn(() => (frontmatter !== null ? { frontmatter } : null)),
		},
	} as unknown as import("obsidian").App;

	return { app };
}

// ── getTerrainFromFile ────────────────────────────────────────────────────────

describe("getTerrainFromFile", () => {
	it("returns null when the file does not exist", () => {
		const { app } = makeAppWithCache("hex.md", { terrain: "forest" });
		expect(getTerrainFromFile(app, "MISSING.md")).toBeNull();
	});

	it("returns the terrain string from the metadata cache", () => {
		const { app } = makeAppWithCache("hex.md", { terrain: "forest" });
		expect(getTerrainFromFile(app, "hex.md")).toBe("forest");
	});

	it("returns null when terrain field is absent from frontmatter", () => {
		const { app } = makeAppWithCache("hex.md", { title: "Test" });
		expect(getTerrainFromFile(app, "hex.md")).toBeNull();
	});

	it("returns null when there is no file cache", () => {
		const { app } = makeAppWithCache("hex.md", null);
		expect(getTerrainFromFile(app, "hex.md")).toBeNull();
	});

	it("returns null when terrain field is not a string (e.g. array)", () => {
		const { app } = makeAppWithCache("hex.md", { terrain: ["forest", "plains"] });
		expect(getTerrainFromFile(app, "hex.md")).toBeNull();
	});

	it("returns null when terrain field is a number", () => {
		const { app } = makeAppWithCache("hex.md", { terrain: 42 });
		expect(getTerrainFromFile(app, "hex.md")).toBeNull();
	});
});

// ── getIconOverrideFromFile ───────────────────────────────────────────────────

describe("getIconOverrideFromFile", () => {
	it("returns null when the file does not exist", () => {
		const { app } = makeAppWithCache("hex.md", { icon: "castle.png" });
		expect(getIconOverrideFromFile(app, "MISSING.md")).toBeNull();
	});

	it("returns the icon string from the metadata cache", () => {
		const { app } = makeAppWithCache("hex.md", { icon: "castle.png" });
		expect(getIconOverrideFromFile(app, "hex.md")).toBe("castle.png");
	});

	it("returns null when icon field is absent from frontmatter", () => {
		const { app } = makeAppWithCache("hex.md", { terrain: "forest" });
		expect(getIconOverrideFromFile(app, "hex.md")).toBeNull();
	});

	it("returns null when there is no file cache", () => {
		const { app } = makeAppWithCache("hex.md", null);
		expect(getIconOverrideFromFile(app, "hex.md")).toBeNull();
	});

	it("returns null when icon field is not a string (e.g. boolean)", () => {
		const { app } = makeAppWithCache("hex.md", { icon: true });
		expect(getIconOverrideFromFile(app, "hex.md")).toBeNull();
	});
});
