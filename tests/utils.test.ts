import { describe, it, mock } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { normalizeFolder, makeTableTemplate, getIconUrl, cssUrl, iconPackTabs } from "../src/utils";
import { BUNDLED_ICONS } from "../src/bundledIcons";
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

describe("cssUrl", () => {
  // The quoted string inside url("…") must not end early.
  const inner = (v: string) => v.slice('url("'.length, -'")'.length);

  it("percent-encodes quotes in an inline SVG so the CSS value stays valid", () => {
    const svg = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><path fill="%23000" d="M0 0"/></svg>';
    const v = cssUrl(svg);
    expect(v.startsWith('url("')).toBe(true);
    expect(inner(v)).not.toContain('"');
    expect(decodeURIComponent(inner(v))).toBe(decodeURIComponent(svg.replace(/"/g, "%22")));
  });

  it("leaves base64 data URLs and plain paths alone", () => {
    expect(cssUrl("data:image/png;base64,iVBORw0KGgo=")).toBe('url("data:image/png;base64,iVBORw0KGgo=")');
    expect(cssUrl("app://local/icons/x.png")).toBe('url("app://local/icons/x.png")');
  });

  it("every bundled icon (the space SVGs included) makes a valid url() value", () => {
    expect(BUNDLED_ICONS.size).toBeGreaterThan(0);
    for (const [name, src] of BUNDLED_ICONS) {
      const v = inner(cssUrl(src));
      if (/["\\n\r]/.test(v)) throw new Error(`${name} would break url("…")`);
    }
  });
});

describe("iconPackTabs (round 6 R4: the Paint icon picker had no tabs)", () => {
	it("shows All, Terrain and an empty Custom tab when only terrain icons exist", () => {
		expect(iconPackTabs(new Map([["terrain", 40]]))).toEqual([
			["all", "All", 40],
			["terrain", "Terrain", 40],
			["custom", "Custom", 0],
		]);
	});
	it("adds Space when space icons are enabled, and counts custom icons", () => {
		expect(iconPackTabs(new Map([["terrain", 40], ["space", 30], ["custom", 2]])).map(([k, , n]) => `${k}:${n}`)).toEqual([
			"all:72",
			"terrain:40",
			"space:30",
			"custom:2",
		]);
	});
});
