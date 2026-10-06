import { describe, it, mock } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { getTerrainFromFile, setTerrainInFile, getIconOverrideFromFile, setIconOverrideInFile, getSubmapFromFile, setSubmapInFile, terrainFromFm, iconOverrideFromFm, gmIconsFromFm, withFrontmatterField } from "../src/frontmatter";

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

// ── setSubmapInFile ───────────────────────────────────────────────────────────

describe("setSubmapInFile", () => {
	it("returns false when the file does not exist", async () => {
		const { app } = makeApp("hex.md", "");
		const result = await setSubmapInFile(app, "missing.md", "the-coast");
		expect(result).toBe(false);
	});

	it("writes duckmage-submap to a file with no existing frontmatter", async () => {
		const { app, getContent } = makeApp("hex.md", "Body text.");
		await setSubmapInFile(app, "hex.md", "the-coast");
		expect(getContent()).toContain("duckmage-submap: the-coast");
	});

	it("updates an existing duckmage-submap value", async () => {
		const { app, getContent } = makeApp("hex.md", "---\nduckmage-submap: old-map\n---\n");
		await setSubmapInFile(app, "hex.md", "new-map");
		expect(getContent()).toContain("duckmage-submap: new-map");
		expect(getContent()).not.toContain("old-map");
	});

	it("removes duckmage-submap when passed null", async () => {
		const { app, getContent } = makeApp("hex.md", "---\nduckmage-submap: the-coast\nterrain: plains\n---\n");
		await setSubmapInFile(app, "hex.md", null);
		expect(getContent()).not.toContain("duckmage-submap");
		expect(getContent()).toContain("terrain: plains");
	});
});

// ── getSubmapFromFile ─────────────────────────────────────────────────────────

describe("getSubmapFromFile", () => {
	it("returns the submap name when present", () => {
		const { app } = makeAppWithCache("hex.md", { "duckmage-submap": "the-coast" });
		expect(getSubmapFromFile(app, "hex.md")).toBe("the-coast");
	});

	it("returns undefined when the key is absent", () => {
		const { app } = makeAppWithCache("hex.md", { terrain: "plains" });
		expect(getSubmapFromFile(app, "hex.md")).toBeUndefined();
	});

	it("returns undefined when the file does not exist", () => {
		const { app } = makeAppWithCache("hex.md", null);
		expect(getSubmapFromFile(app, "missing.md")).toBeUndefined();
	});

	it("returns undefined when the value is not a string", () => {
		const { app } = makeAppWithCache("hex.md", { "duckmage-submap": 42 });
		expect(getSubmapFromFile(app, "hex.md")).toBeUndefined();
	});
});

// ── updateSubmapReferences ────────────────────────────────────────────────────

describe("updateSubmapReferences", () => {
	function makeMultiFileApp(files: Record<string, { content: string; submap?: string }>) {
		const stored: Record<string, string> = {};
		const tfiles: Record<string, TFile> = {};

		for (const [path, { content }] of Object.entries(files)) {
			stored[path] = content;
			const f = Object.create(TFile.prototype) as TFile;
			f.path = path;
			tfiles[path] = f;
		}

		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => tfiles[p] ?? null,
				getMarkdownFiles: () => Object.values(tfiles),
			},
			fileManager: {
				processFrontMatter: mock.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
					const content = stored[file.path] ?? "";
					const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
					const fm: Record<string, unknown> = {};
					if (fmMatch) {
						for (const line of fmMatch[1].split("\n")) {
							const m = line.match(/^([\w-]+):\s*(.+)$/);
							if (m) fm[m[1]] = m[2].trim();
						}
					}
					const rest = fmMatch ? content.slice(fmMatch[0].length) : content;
					fn(fm);
					const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
					stored[file.path] = fmLines ? `---\n${fmLines}\n---\n${rest}` : rest;
				}),
			},
			metadataCache: {
				getFileCache: mock.fn((file: TFile) => {
					const submap = files[file.path]?.submap;
					return submap ? { frontmatter: { "duckmage-submap": submap } } : null;
				}),
			},
		} as unknown as import("obsidian").App;

		return { app, getContent: (p: string) => stored[p] ?? "" };
	}

	it("updates duckmage-submap in all matching hex notes", async () => {
		const { app, getContent } = makeMultiFileApp({
			"world/hexes/map-a/1_1.md": { content: "---\nduckmage-submap: old-map\n---\n", submap: "old-map" },
			"world/hexes/map-a/2_2.md": { content: "---\nduckmage-submap: old-map\n---\n", submap: "old-map" },
			"world/hexes/map-a/3_3.md": { content: "---\nterrain: plains\n---\n" },
		});

		// Simulate updateSubmapReferences logic directly
		const hexFolder = "world/hexes";
		const files = app.vault.getMarkdownFiles().filter(
			(f: TFile) => f.path.startsWith(hexFolder + "/"),
		);
		for (const file of files) {
			const submap = app.metadataCache.getFileCache(file)?.frontmatter?.["duckmage-submap"];
			if (submap !== "old-map") continue;
			await setSubmapInFile(app, file.path, "new-map");
		}

		expect(getContent("world/hexes/map-a/1_1.md")).toContain("duckmage-submap: new-map");
		expect(getContent("world/hexes/map-a/2_2.md")).toContain("duckmage-submap: new-map");
		expect(getContent("world/hexes/map-a/3_3.md")).not.toContain("duckmage-submap");
	});

	it("does not touch notes whose submap points to a different map", async () => {
		const { app, getContent } = makeMultiFileApp({
			"world/hexes/map-a/1_1.md": { content: "---\nduckmage-submap: other-map\n---\n", submap: "other-map" },
		});

		const files = app.vault.getMarkdownFiles();
		for (const file of files) {
			const submap = app.metadataCache.getFileCache(file)?.frontmatter?.["duckmage-submap"];
			if (submap !== "old-map") continue;
			await setSubmapInFile(app, file.path, "new-map");
		}

		expect(getContent("world/hexes/map-a/1_1.md")).toContain("duckmage-submap: other-map");
	});
});

// ── Pure frontmatter extractors (used by the hex-grid render loop, which
//    fetches frontmatter once per hex and feeds it to all three) ──────────────

describe("terrainFromFm", () => {
	it("returns the terrain string", () => {
		expect(terrainFromFm({ terrain: "forest" } as any)).toBe("forest");
	});
	it("returns null for missing/non-string/nullish frontmatter", () => {
		expect(terrainFromFm({ icon: "x.png" } as any)).toBeNull();
		expect(terrainFromFm({ terrain: 3 } as any)).toBeNull();
		expect(terrainFromFm(null)).toBeNull();
		expect(terrainFromFm(undefined)).toBeNull();
	});
});

describe("iconOverrideFromFm", () => {
	it("returns the icon string", () => {
		expect(iconOverrideFromFm({ icon: "castle.png" } as any)).toBe("castle.png");
	});
	it("returns null for missing/non-string/nullish frontmatter", () => {
		expect(iconOverrideFromFm({ terrain: "forest" } as any)).toBeNull();
		expect(iconOverrideFromFm({ icon: true } as any)).toBeNull();
		expect(iconOverrideFromFm(null)).toBeNull();
	});
});

describe("gmIconsFromFm", () => {
	it("returns the gm-icons array, filtered to strings", () => {
		expect(gmIconsFromFm({ "gm-icons": ["a.png", "b.png"] } as any)).toEqual(["a.png", "b.png"]);
		expect(gmIconsFromFm({ "gm-icons": ["a.png", 2, null, "b.png"] } as any)).toEqual(["a.png", "b.png"]);
	});
	it("falls back to legacy single gm-icon", () => {
		expect(gmIconsFromFm({ "gm-icon": "legacy.png" } as any)).toEqual(["legacy.png"]);
	});
	it("prefers gm-icons array over legacy gm-icon", () => {
		expect(gmIconsFromFm({ "gm-icons": ["a.png"], "gm-icon": "legacy.png" } as any)).toEqual(["a.png"]);
	});
	it("returns [] for missing/nullish frontmatter", () => {
		expect(gmIconsFromFm({} as any)).toEqual([]);
		expect(gmIconsFromFm(null)).toEqual([]);
		expect(gmIconsFromFm(undefined)).toEqual([]);
	});
});

describe("withFrontmatterField", () => {
  it("fills an empty key in the default hex template", () => {
    const out = withFrontmatterField("---\nterrain:\n---\n\n# Hex 1, 2\n", "terrain", "Grass");
    expect(out).toBe("---\nterrain: Grass\n---\n\n# Hex 1, 2\n");
  });

  it("replaces an existing value and keeps other keys", () => {
    const out = withFrontmatterField("---\nicon: a.png\nterrain: Sea\ntags: [x]\n---\nbody", "terrain", "Hills");
    expect(out).toBe("---\nicon: a.png\nterrain: Hills\ntags: [x]\n---\nbody");
  });

  it("adds the key when the frontmatter lacks it", () => {
    expect(withFrontmatterField("---\nicon: a.png\n---\nbody", "terrain", "Hills")).toBe(
      "---\nicon: a.png\nterrain: Hills\n---\nbody",
    );
  });

  it("adds a frontmatter block when there is none", () => {
    expect(withFrontmatterField("# Hex\n", "terrain", "Hills")).toBe("---\nterrain: Hills\n---\n# Hex\n");
  });

  it("quotes values YAML would misread", () => {
    expect(withFrontmatterField("---\nterrain:\n---\n", "terrain", "Sea: deep #1")).toBe(
      '---\nterrain: "Sea: deep #1"\n---\n',
    );
  });

  it("does not match a longer key with the same prefix", () => {
    expect(withFrontmatterField("---\nterrain-note: x\n---\n", "terrain", "Hills")).toBe(
      "---\nterrain-note: x\nterrain: Hills\n---\n",
    );
  });
});
