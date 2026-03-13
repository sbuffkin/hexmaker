import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { setTerrainInFile, setIconOverrideInFile } from "../src/frontmatter";

/** Build a minimal mock App backed by an in-memory string. */
function makeApp(filePath: string, initialContent: string) {
	let stored = initialContent;

	const file = Object.create(TFile.prototype) as TFile;
	file.path = filePath;

	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === filePath ? file : null),
			read: vi.fn(async () => stored),
			modify: vi.fn(async (_f: unknown, content: string) => { stored = content; }),
		},
		metadataCache: {
			getFileCache: vi.fn(() => null),
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
