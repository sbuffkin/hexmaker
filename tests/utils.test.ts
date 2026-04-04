import { describe, it, mock } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { normalizeFolder, makeTableTemplate, getIconUrl } from "../src/utils";
import type HexmakerPlugin from "../src/HexmakerPlugin";

// ── normalizeFolder ───────────────────────────────────────────────────────────

describe("normalizeFolder", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeFolder("")).toBe("");
  });

  it("strips a leading slash", () => {
    expect(normalizeFolder("/tables")).toBe("tables");
  });

  it("strips a trailing slash", () => {
    expect(normalizeFolder("tables/")).toBe("tables");
  });

  it("strips both leading and trailing slashes", () => {
    expect(normalizeFolder("/tables/")).toBe("tables");
  });

  it("strips multiple leading and trailing slashes", () => {
    expect(normalizeFolder("///tables///")).toBe("tables");
  });

  it("leaves interior slashes intact", () => {
    expect(normalizeFolder("world/tables")).toBe("world/tables");
  });

  it("returns empty string for a string that is only slashes", () => {
    expect(normalizeFolder("///")).toBe("");
  });

  it("does not modify a clean path", () => {
    expect(normalizeFolder("tables/terrain")).toBe("tables/terrain");
  });
});

// ── makeTableTemplate ─────────────────────────────────────────────────────────

describe("makeTableTemplate", () => {
	it("includes the dice value in frontmatter", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("dice: 6");
	});

	it("produces valid YAML frontmatter block", () => {
		const t = makeTableTemplate(4);
		expect(t).toMatch(/^---\n/);
		expect(t).toContain("\n---\n");
	});

	it("generates a single blank example row", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("|  | 1 |");
	});

	it("includes the Result/Weight table header", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("| Result | Weight |");
		expect(t).toContain("|--------|--------|");
	});

	it("dice: 0 still produces valid frontmatter", () => {
		const t = makeTableTemplate(0);
		expect(t).toContain("dice: 0");
	});

	it("includes extra frontmatter fields when provided", () => {
		const t = makeTableTemplate(6, { terrain: "forest", category: "monsters" });
		expect(t).toContain("terrain: forest");
		expect(t).toContain("category: monsters");
	});

	it("serialises boolean extra frontmatter values", () => {
		const t = makeTableTemplate(6, { "roll-filter": false });
		expect(t).toContain("roll-filter: false");
	});

	it("serialises number extra frontmatter values", () => {
		const t = makeTableTemplate(6, { level: 3 });
		expect(t).toContain("level: 3");
	});

	it("includes preamble between frontmatter and table", () => {
		const t = makeTableTemplate(6, undefined, "[🎲 Open](obsidian://roll)");
		expect(t).toContain("[🎲 Open](obsidian://roll)");
		const preambleIdx = t.indexOf("[🎲 Open]");
		const tableIdx = t.indexOf("| Result |");
		expect(preambleIdx).toBeLessThan(tableIdx);
	});
});

// ── getIconUrl ────────────────────────────────────────────────────────────────

/** Build a minimal plugin stub for getIconUrl. */
function makePluginForIcon(
  vaultIcons: string[],
  iconsFolder: string,
  manifestDir: string,
): { plugin: HexmakerPlugin; getLastPath: () => string } {
  let lastPath = "";
  const vaultIconSet = new Set(vaultIcons);
  const plugin = {
    vaultIconsSet: vaultIconSet,
    settings: { iconsFolder },
    manifest: { dir: manifestDir },
    app: {
      vault: {
        adapter: {
          getResourcePath: mock.fn((p: string) => { lastPath = p; return `resource://${p}`; }),
        },
        getAbstractFileByPath: mock.fn((path: string) => {
          const filename = path.split("/").pop() ?? "";
          if (vaultIconSet.has(filename)) {
            const f = Object.create(TFile.prototype) as TFile;
            f.path = path;
            return f;
          }
          return null;
        }),
        getResourcePath: mock.fn((f: TFile) => { lastPath = f.path; return `resource://${f.path}`; }),
      },
    },
  } as unknown as HexmakerPlugin;
  return { plugin, getLastPath: () => lastPath };
}

describe("getIconUrl", () => {
  it("uses plugin icons dir when icon is not in vaultIconsSet", () => {
    const { plugin, getLastPath } = makePluginForIcon(
      [],
      "custom",
      "plugins/duckmage-plugin",
    );
    getIconUrl(plugin, "tower.png");
    expect(getLastPath()).toBe("plugins/duckmage-plugin/icons/tower.png");
  });

  it("uses vault iconsFolder when icon is in vaultIconsSet", () => {
    const { plugin, getLastPath } = makePluginForIcon(
      ["village.png"],
      "custom-icons",
      "plugins/duckmage-plugin",
    );
    getIconUrl(plugin, "village.png");
    expect(getLastPath()).toBe("custom-icons/village.png");
  });

  it("uses plugin icons dir for icons not in vaultIconsSet even when others are", () => {
    const { plugin, getLastPath } = makePluginForIcon(
      ["village.png"],
      "custom-icons",
      "plugins/duckmage-plugin",
    );
    getIconUrl(plugin, "castle.png");
    expect(getLastPath()).toBe("plugins/duckmage-plugin/icons/castle.png");
  });

  it("normalises iconsFolder by stripping leading/trailing slashes", () => {
    const { plugin, getLastPath } = makePluginForIcon(
      ["icon.png"],
      "/my-icons/",
      "plugins/duckmage-plugin",
    );
    getIconUrl(plugin, "icon.png");
    expect(getLastPath()).toBe("my-icons/icon.png");
  });

  it("returns a string (the resource path)", () => {
    const { plugin } = makePluginForIcon(
      [],
      "icons",
      "plugins/duckmage-plugin",
    );
    const result = getIconUrl(plugin, "ruins.png");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
