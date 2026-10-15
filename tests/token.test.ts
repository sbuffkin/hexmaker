import { describe, it, mock } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import {
	getTokenDataFromCache,
	removeTokenFrontmatter,
	setTokenHex,
	setTokenVisible,
	applyTokenFrontmatter,
} from "../src/frontmatter";

/** Build a TFile-like mock with path and basename. */
function makeFile(path: string): TFile {
	const file = Object.create(TFile.prototype) as TFile;
	file.path = path;
	file.basename = path.split("/").pop()!.replace(/\.md$/, "");
	return file;
}

/** App that returns the given frontmatter from the metadata cache for one file. */
function makeAppWithCache(filePath: string, frontmatter: Record<string, unknown> | null) {
	const file = makeFile(filePath);
	const app = {
		vault: { getAbstractFileByPath: (p: string) => (p === filePath ? file : null) },
		metadataCache: { getFileCache: mock.fn(() => (frontmatter !== null ? { frontmatter } : null)) },
	} as unknown as import("obsidian").App;
	return { app, file };
}

/** App backed by an in-memory string that supports processFrontMatter. */
function makeApp(filePath: string, initialContent: string) {
	let stored = initialContent;
	const file = makeFile(filePath);

	const app = {
		vault: { getAbstractFileByPath: (p: string) => (p === filePath ? file : null) },
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
	} as unknown as import("obsidian").App;

	return { app, getContent: () => stored };
}

// ── getTokenDataFromCache ─────────────────────────────────────────────────────

describe("getTokenDataFromCache", () => {
	it("returns null when token field is absent", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", { title: "Hero" });
		expect(getTokenDataFromCache(app, file)).toBeNull();
	});

	it("returns null when token field is false", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", { token: false });
		expect(getTokenDataFromCache(app, file)).toBeNull();
	});

	it("returns null when there is no file cache", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", null);
		expect(getTokenDataFromCache(app, file)).toBeNull();
	});

	it("returns a TokenEntry with defaults when minimal frontmatter is present", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", { token: true });
		const entry = getTokenDataFromCache(app, file);
		expect(entry).not.toBeNull();
		expect(entry!.filePath).toBe("tokens/hero.md");
		expect(entry!.title).toBe("hero");
		expect(entry!.shape).toBe("circle");
		expect(entry!.size).toBe("md");
		expect(entry!.visible).toBe(true);
		expect(entry!.hex).toBe("");
		expect(entry!.map).toBe("");
		expect(entry!.icon).toBeUndefined();
		expect(entry!.color).toBeUndefined();
		expect(entry!.border).toBeUndefined();
		expect(entry!.tokenLink).toBeUndefined();
	});

	it("returns all fields from frontmatter", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", {
			token: true,
			"token-icon": "sword.png",
			"token-hex": "3_4",
			"token-map": "overworld",
			"token-visible": false,
			"token-shape": "hexagon",
			"token-size": "lg",
			"token-color": "#ff0000",
			"token-border": "#ffffff",
		});
		const entry = getTokenDataFromCache(app, file)!;
		expect(entry.icon).toBe("sword.png");
		expect(entry.hex).toBe("3_4");
		expect(entry.map).toBe("overworld");
		expect(entry.visible).toBe(false);
		expect(entry.shape).toBe("hexagon");
		expect(entry.size).toBe("lg");
		expect(entry.color).toBe("#ff0000");
		expect(entry.border).toBe("#ffffff");
	});

	it("falls back to md for an unknown size", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", {
			token: true,
			"token-size": "enormous",
		});
		expect(getTokenDataFromCache(app, file)!.size).toBe("md");
	});

	it("resolves title from linked note when token-link is set", () => {
		const linkedFile = makeFile("world/characters/Gandalf.md");
		const file = makeFile("world/tokens/Gandalf-2.md");
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => {
					if (p === "world/characters/Gandalf.md") return linkedFile;
					return null;
				},
			},
			metadataCache: {
				getFileCache: () => ({
					frontmatter: {
						token: true,
						"token-link": "world/characters/Gandalf.md",
						"token-hex": "1_1",
					},
				}),
			},
		} as unknown as import("obsidian").App;
		const entry = getTokenDataFromCache(app, file)!;
		expect(entry.title).toBe("Gandalf");
		expect(entry.tokenLink).toBe("world/characters/Gandalf.md");
	});

	it("falls back to circle for an unknown shape", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", {
			token: true,
			"token-shape": "triangle",
		});
		expect(getTokenDataFromCache(app, file)!.shape).toBe("circle");
	});

	it("ignores non-string token-icon", () => {
		const { app, file } = makeAppWithCache("tokens/hero.md", {
			token: true,
			"token-icon": 42,
		});
		expect(getTokenDataFromCache(app, file)!.icon).toBeUndefined();
	});
});

// ── setTokenHex ───────────────────────────────────────────────────────────────

describe("setTokenHex", () => {
	it("returns without writing when file does not exist", async () => {
		const { app } = makeApp("tokens/hero.md", "---\ntoken: true\n---\n");
		await setTokenHex(app, "tokens/MISSING.md", "2_3", "overworld");
		expect((app.fileManager as unknown as { processFrontMatter: ReturnType<typeof mock.fn> }).processFrontMatter.mock.calls.length).toBe(0);
	});

	it("sets token-hex and token-map in frontmatter", async () => {
		const { app, getContent } = makeApp("tokens/hero.md", "---\ntoken: true\n---\n");
		await setTokenHex(app, "tokens/hero.md", "5_7", "overworld");
		expect(getContent()).toContain("token-hex: 5_7");
		// NF3: a link to the map note.
		expect(getContent()).toContain("token-map: [[_overworld]]");
	});
});

// ── setTokenVisible ───────────────────────────────────────────────────────────

describe("setTokenVisible", () => {
	it("sets token-visible to false", async () => {
		const { app, getContent } = makeApp("tokens/hero.md", "---\ntoken: true\n---\n");
		await setTokenVisible(app, "tokens/hero.md", false);
		expect(getContent()).toContain("token-visible: false");
	});

	it("sets token-visible to true", async () => {
		const { app, getContent } = makeApp("tokens/hero.md", "---\ntoken: true\ntoken-visible: false\n---\n");
		await setTokenVisible(app, "tokens/hero.md", true);
		expect(getContent()).toContain("token-visible: true");
	});
});

// ── removeTokenFrontmatter ────────────────────────────────────────────────────

describe("removeTokenFrontmatter", () => {
	it("removes all token-* fields", async () => {
		const initial = [
			"---",
			"title: hero",
			"token: true",
			"token-icon: sword.png",
			"token-hex: 3_4",
			"token-map: overworld",
			"token-visible: true",
			"token-shape: hexagon",
			"token-size: lg",
			"token-color: #ff0000",
			"token-border: #ffffff",
			"token-link: world/chars/Gandalf.md",
			"---",
			"",
		].join("\n");
		const { app, getContent } = makeApp("tokens/hero.md", initial);
		await removeTokenFrontmatter(app, "tokens/hero.md");
		const content = getContent();
		expect(content).not.toContain("token:");
		expect(content).not.toContain("token-icon:");
		expect(content).not.toContain("token-hex:");
		expect(content).not.toContain("token-map:");
		expect(content).toContain("title: hero");
	});

	it("does nothing when file does not exist", async () => {
		const { app } = makeApp("tokens/hero.md", "---\ntoken: true\n---\n");
		await removeTokenFrontmatter(app, "tokens/MISSING.md");
		expect((app.fileManager as unknown as { processFrontMatter: ReturnType<typeof mock.fn> }).processFrontMatter.mock.calls.length).toBe(0);
	});
});

// ── applyTokenFrontmatter ─────────────────────────────────────────────────────

describe("applyTokenFrontmatter", () => {
	it("sets token: true and provided fields", async () => {
		const { app, getContent } = makeApp("tokens/hero.md", "---\ntitle: hero\n---\n");
		await applyTokenFrontmatter(app, "tokens/hero.md", {
			icon: "sword.png",
			hex: "2_3",
			map: "overworld",
			visible: true,
			shape: "square",
			size: "lg",
			color: "#ff0000",
			border: "#ffffff",
		});
		const content = getContent();
		expect(content).toContain("token: true");
		expect(content).toContain("token-icon: sword.png");
		expect(content).toContain("token-hex: 2_3");
		expect(content).toContain("token-map: [[_overworld]]");
		expect(content).toContain("token-visible: true");
		expect(content).toContain("token-shape: square");
		expect(content).toContain("token-size: lg");
		expect(content).toContain("token-color: #ff0000");
		expect(content).toContain("token-border: #ffffff");
	});

	it("clears icon when empty string is passed", async () => {
		const { app, getContent } = makeApp("tokens/hero.md", "---\ntoken: true\ntoken-icon: sword.png\n---\n");
		await applyTokenFrontmatter(app, "tokens/hero.md", { icon: "" });
		expect(getContent()).not.toContain("token-icon:");
	});

	it("clears color when empty string is passed", async () => {
		const { app, getContent } = makeApp("tokens/hero.md", "---\ntoken: true\ntoken-color: #ff0000\n---\n");
		await applyTokenFrontmatter(app, "tokens/hero.md", { color: "" });
		expect(getContent()).not.toContain("token-color:");
	});

	it("does not touch fields not included in data", async () => {
		const { app, getContent } = makeApp("tokens/hero.md", "---\ntoken: true\ntoken-hex: 1_1\ntoken-map: overworld\n---\n");
		await applyTokenFrontmatter(app, "tokens/hero.md", { shape: "hexagon" });
		expect(getContent()).toContain("token-hex: 1_1");
		expect(getContent()).toContain("token-map: overworld");
		expect(getContent()).toContain("token-shape: hexagon");
	});
});
