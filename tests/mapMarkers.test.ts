import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import {
	BADGE_INFO,
	BADGE_SECTIONS,
	badgeHideClass,
	hexKeyFromBasename,
	linkSectionsFromCache,
	toggleHiddenBadge,
	type LinkCacheLike,
} from "../src/hex-map/linkBadges";
import { legendSize, usedTerrainEntries } from "../src/hex-map/terrainLegend";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";

/** A cache shaped like Obsidian's for a note with `### Heading` sections. */
function cacheOf(md: string): LinkCacheLike {
	const headings: NonNullable<LinkCacheLike["headings"]> = [];
	const links: NonNullable<LinkCacheLike["links"]> = [];
	let offset = 0;
	for (const line of md.split("\n")) {
		const h = /^(#+)\s+(.*)$/.exec(line);
		if (h) headings.push({ heading: h[2], level: h[1].length, position: { start: { offset } } });
		const re = /\[\[[^\]]+\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line))) links.push({ position: { start: { offset: offset + m.index } } });
		offset += line.length + 1;
	}
	return { headings, links };
}

describe("link badges", () => {
	it("finds the link sections that hold links, in badge order", () => {
		const md = [
			"# 3_4",
			"### Description",
			"See [[Somewhere]].",
			"### Quests",
			"- [[Find the ring]]",
			"### Towns",
			"- [[Brindle]]",
			"### Dungeons",
			"### Factions",
			"- [[Red Hand]]",
		].join("\n");
		expect(linkSectionsFromCache(cacheOf(md))).toEqual(["Towns", "Quests", "Factions"]);
	});

	it("ignores links outside the sections and empty sections", () => {
		const md = ["### Description", "[[Brindle]]", "### Towns", "", "### Features", "none yet"].join("\n");
		expect(linkSectionsFromCache(cacheOf(md))).toEqual([]);
	});

	it("ends a section at the next heading of the same or a higher level only", () => {
		const md = ["## Towns", "#### Notes", "[[Brindle]]", "## Quests", "[[Q]]"].join("\n");
		expect(linkSectionsFromCache(cacheOf(md))).toEqual(["Towns", "Quests"]);
	});

	it("handles missing cache data", () => {
		expect(linkSectionsFromCache(null)).toEqual([]);
		expect(linkSectionsFromCache({})).toEqual([]);
	});

	it("does not badge the encounter table section", () => {
		const md = ["### Encounters Table", "[[forest - encounters]]"].join("\n");
		expect(linkSectionsFromCache(cacheOf(md))).toEqual([]);
	});

	it("toggles hidden types in a stable order and drops an empty list", () => {
		let hidden = toggleHiddenBadge(undefined, "Quests");
		expect(hidden).toEqual(["Quests"]);
		hidden = toggleHiddenBadge(hidden, "Towns");
		expect(hidden).toEqual(["Towns", "Quests"]);
		hidden = toggleHiddenBadge(hidden, "Quests");
		hidden = toggleHiddenBadge(hidden, "Towns");
		expect(hidden).toBeUndefined();
	});

	it("only treats x_y basenames as hex notes", () => {
		expect(hexKeyFromBasename("3_4")).toBe("3_4");
		expect(hexKeyFromBasename("-2_10")).toBe("-2_10");
		expect(hexKeyFromBasename("_the-coast")).toBeNull();
		expect(hexKeyFromBasename("Brindle")).toBeNull();
	});

	it("has a CSS hide rule and a colour for every badge type", () => {
		const css = readFileSync("styles.css", "utf8");
		expect(css).toContain(".duckmage-hide-link-badges .duckmage-link-badges-layer");
		for (const s of BADGE_SECTIONS) {
			const cls = `duckmage-link-badge-${BADGE_INFO[s].cls}`;
			expect(css).toContain(`.${badgeHideClass(s)} .${cls}`);
			expect(css).toMatch(new RegExp(`\\.${cls}\\s*\\{\\s*--duckmage-badge-color`));
		}
	});

	it("round-trips the badge toggles through the map note", () => {
		const data = {
			settings: { paletteName: "Default", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, showLinkBadges: false, hiddenLinkBadges: ["Dungeons", "Quests"] },
			hexes: new Map(),
			paths: [],
		};
		const note = buildMapNote("m", data);
		expect(note).toContain("show-link-badges: false");
		expect(note).toContain('hidden-link-badges: ["Dungeons","Quests"]');
		const back = parseMapNote(note)!;
		expect(back.settings.showLinkBadges).toBe(false);
		expect(back.settings.hiddenLinkBadges).toEqual(["Dungeons", "Quests"]);
	});
});

describe("terrain legend", () => {
	const palette = [
		{ name: "ocean", color: "#2255aa" },
		{ name: "forest", color: "#227722", icon: "tree.png" },
		{ name: "hills", color: "#998855" },
	];

	it("lists only the used terrains, in palette order, once each", () => {
		const out = usedTerrainEntries(palette, ["hills", "ocean", "hills", undefined, null, ""]);
		expect(out.map((t) => t.name)).toEqual(["ocean", "hills"]);
		expect(out[0].color).toBe("#2255aa");
	});

	it("keeps icons and lists unknown terrains last in grey", () => {
		const out = usedTerrainEntries(palette, ["zz-old", "forest", "aa-old"]);
		expect(out).toEqual([
			{ name: "forest", color: "#227722", icon: "tree.png", iconColor: undefined },
			{ name: "aa-old", color: "#888888" },
			{ name: "zz-old", color: "#888888" },
		]);
	});

	it("is empty for an unpainted map", () => {
		expect(usedTerrainEntries(palette, [])).toEqual([]);
	});

	it("defaults the size to medium", () => {
		expect(legendSize(undefined)).toBe("m");
		expect(legendSize("x")).toBe("m");
		expect(legendSize("s")).toBe("s");
		expect(legendSize("l")).toBe("l");
	});
});

// ── Round 6 R1/S3: badges are visible and the hover names the links ────────
import { BADGES_PER_COLUMN, linkedNotesText, linksBySection } from "../src/hex-map/linkBadges";

/** z-index of the first CSS rule whose selector is exactly `selector`. */
function zIndexOf(css: string, selector: string): number {
	// The rule that starts a line (not e.g. ".duckmage-hide-x .layer { … }").
	const at = css.search(new RegExp(`^${selector.replace(/[.]/g, "\\.")} \\{`, "m"));
	if (at < 0) throw new Error(`no rule for ${selector}`);
	const body = css.slice(at, css.indexOf("}", at));
	const m = /z-index:\s*(\d+)/.exec(body);
	if (!m) throw new Error(`no z-index in ${selector}`);
	return Number(m[1]);
}

/** Like cacheOf, with each link's target (as Obsidian's cache has it). */
function cacheWithLinks(md: string): LinkCacheLike {
	const headings: NonNullable<LinkCacheLike["headings"]> = [];
	const links: NonNullable<LinkCacheLike["links"]> = [];
	let offset = 0;
	for (const line of md.split("\n")) {
		const h = /^(#+)\s+(.*)$/.exec(line);
		if (h) headings.push({ heading: h[2], level: h[1].length, position: { start: { offset } } });
		const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line))) links.push({ link: m[1], displayText: m[2] ?? m[1], position: { start: { offset: offset + m.index } } });
		offset += line.length + 1;
	}
	return { headings, links };
}

describe("link badges stay visible (round 6 R1)", () => {
	// The region tester's 6_6 note: a town link under "### Towns", hex names
	// shown. The name label (z 11) sat on the badge (z 9), so the badge
	// never showed, though detection and rendering were fine.
	const css = readFileSync("styles.css", "utf8");

	it("draws the badge layer above the hex names and the coordinates", () => {
		const badges = zIndexOf(css, ".duckmage-link-badges-layer");
		expect(badges).toBeGreaterThan(zIndexOf(css, ".duckmage-hex-names-layer"));
		expect(badges).toBeGreaterThan(zIndexOf(css, ".duckmage-coord-labels-layer"));
	});

	it("centres the badges on the hex's middle row, away from the name and coordinates", () => {
		const at = css.indexOf(".duckmage-link-badges {");
		const rule = css.slice(at, css.indexOf("}", at));
		expect(rule).toMatch(/top:\s*var\(--duckmage-badge-y, 50%\);/);
	});

	it("finds the town link in the tester's note", () => {
		const md = [
			"# Hex 6, 6", "", "---", "### description", "*guidance*", "", "A huddle of shacks.", "", "---",
			"### landmark", "", "---", "", "### Towns", "", "[[Gullmouth]]", "", "---", "### Dungeons", "", "---",
			"### Encounters Table", "", "[[world/tables/terrain/encounters/beach]]",
		].join("\n");
		expect(linkSectionsFromCache(cacheWithLinks(md))).toEqual(["Towns"]);
	});

	it("goes to two columns past BADGES_PER_COLUMN kinds", () => {
		expect(BADGES_PER_COLUMN).toBe(3);
		expect(css).toMatch(/\.duckmage-link-badges\.is-two-col\s*\{/);
	});
});

describe("hover names the linked notes (round 6 S3)", () => {
	it("lists the links per section, by name or alias", () => {
		const by = linksBySection(cacheWithLinks("### Towns\n[[world/towns/Gullmouth]]\n### Dungeons\n[[Abbey|The Drowned Abbey]] [[Crypt.md]]\n"));
		expect([...by]).toEqual([["Towns", ["Gullmouth"]], ["Dungeons", ["The Drowned Abbey", "Crypt"]]]);
	});

	it("words one link singular and several plural", () => {
		const by = linksBySection(cacheWithLinks("### Towns\n[[Gullmouth]]\n### Dungeons\n[[A]] [[B]]\n"));
		expect(linkedNotesText(by)).toBe("Town: Gullmouth · Dungeons: A, B");
		expect(linkedNotesText(new Map())).toBe("");
	});
});

// ── Round 7 R8: badge size (S / M / L) and badges in the live legend ──
import { BADGE_LAYOUT, badgeNameLimit, badgeSize, DEFAULT_BADGE_SIZE, legendBadgeKinds } from "../src/hex-map/linkBadges";
import { layoutHexName } from "../src/hex-map/hexNameLayer";
import { pngBadgeCircles as pngBadges, pngPathWidth } from "../src/export/handoutLabels";

describe("badge size (round 7 R8)", () => {
	it("defaults to S from one constant (MK1)", () => {
		expect(DEFAULT_BADGE_SIZE).toBe("s");
		expect(badgeSize(undefined)).toBe(DEFAULT_BADGE_SIZE);
		expect(badgeSize("junk")).toBe(DEFAULT_BADGE_SIZE);
		expect(badgeSize("s")).toBe("s");
		expect(BADGE_LAYOUT.s.chip).toBe(0.8);
		expect(BADGE_LAYOUT.m.chip).toBeGreaterThan(BADGE_LAYOUT.s.chip);
		expect(BADGE_LAYOUT.l.chip).toBeGreaterThan(BADGE_LAYOUT.m.chip);
	});

	it("keeps hex names clear of the badges, at every size", () => {
		// Hex radius 2.2em, so pngBadgeCircles works in grid em here.
		const measure = (t: string) => t.length * 0.6;
		for (const s of ["s", "m", "l"] as const) {
			for (const flat of [true, false]) {
				for (let n = 1; n <= 5; n++) {
					const chipsLeft = Math.min(...pngBadges(0, 0, 2.2, flat, n, s, "map").map((c) => c.x - c.r));
					const limit = badgeNameLimit(s, flat, n);
					expect(limit).toBeLessThan(chipsLeft);
					for (const name of ["Gullmouth", "The Drowned Abbey", "Hut"]) {
						const l = layoutHexName(name, { measure, hexW: flat ? 4.4 : 3.81, hexH: flat ? 3.81 : 4.4, flat, rightLimit: limit });
						const widest = Math.max(...l.lines.map(measure)) * l.fontEm;
						expect(l.dxEm + widest / 2).toBeLessThanOrEqual(limit + 1e-6);
					}
				}
			}
		}
		expect(badgeNameLimit("m", true, 0)).toBe(Infinity);
	});

	it("draws the PNG badges at the map's size", () => {
		expect(pngBadges(0, 0, 22, true, 1, "s")[0].r).toBeCloseTo(4);
		expect(pngBadges(0, 0, 22, true, 1, "m")[0].r).toBeCloseTo(6);
		expect(pngBadges(0, 0, 22, true, 1)[0].r).toBeCloseTo((BADGE_LAYOUT[DEFAULT_BADGE_SIZE].chip / 2) * 10);
		// M stacks two in a column, then starts a second.
		expect(new Set(pngBadges(0, 0, 22, true, 3, "m").map((c) => c.x.toFixed(2))).size).toBe(2);
	});

	it("saves the size in the map note", () => {
		const data = { settings: { paletteName: "Default", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, linkBadgeSize: "l" }, hexes: new Map(), paths: [] };
		const note = buildMapNote("m", data);
		expect(note).toContain("link-badge-size: l");
		expect(parseMapNote(note)!.settings.linkBadgeSize).toBe("l");
	});

	it("sizes chips from a CSS variable, with a size picker in the layers menu", () => {
		const css = readFileSync("styles.css", "utf8");
		const at = css.indexOf(".duckmage-link-badge {");
		expect(css.slice(at, css.indexOf("}", at))).toMatch(/width:\s*var\(--duckmage-badge-size/);
		const panel = readFileSync("src/hex-map/HexSidePanel.ts", "utf8");
		expect(panel).toMatch(/for \(const s of BADGE_SIZES\)/);
		expect(panel).toContain("map.linkBadgeSize = s;");
	});
});

describe("the live legend lists the badge kinds (round 7 R8)", () => {
	it("lists kinds on the map that are shown, in badge order", () => {
		expect(legendBadgeKinds(["Dungeons", "Towns"], true, undefined)).toEqual(["Towns", "Dungeons"]);
		expect(legendBadgeKinds(["Dungeons", "Towns"], true, ["Dungeons"])).toEqual(["Towns"]);
		expect(legendBadgeKinds(["Dungeons", "Towns"], false, undefined)).toEqual([]);
		expect(legendBadgeKinds([], true, undefined)).toEqual([]);
	});

	it("is wired into the map's legend", () => {
		const view = readFileSync("src/hex-map/HexMapView.ts", "utf8");
		expect(view).toMatch(/legendBadgeKinds\(this\.badgeKindsOnMap/);
		expect(view).toMatch(/renderTerrainLegend\(parent, entries, \{\s*badges,/);
	});
});

describe("paths are bolder in PNG exports (round 7 U18)", () => {
	it("scales the stroke with the image's hex size, never thinner than on screen", () => {
		expect(pngPathWidth(3, 50)).toBeGreaterThan(3 * 1.9);
		expect(pngPathWidth(3, 100)).toBeCloseTo(pngPathWidth(3, 50) * 2);
		expect(pngPathWidth(3, 10)).toBe(3);
	});
});

describe("PNG badges stay inside the hex at every size (round 7 R8)", () => {
	it("keeps a column of chips inside the hex's outline, clear of the PNG name band", () => {
		// Hex radius 2.2 (em units). PNG names sit 0.55 radius above the centre.
		for (const s of ["m", "l"] as const) {
			for (const flat of [true, false]) {
				for (let n = 1; n <= BADGE_LAYOUT[s].perColumn; n++) {
					for (const c of pngBadges(0, 0, 2.2, flat, n, s)) {
						// The chip's point at 45° away from the centre.
						const x = Math.abs(c.x) + c.r * 0.7;
						const y = Math.abs(c.y) + c.r * 0.7;
						const edge = flat ? (x <= 1.1 ? 1.905 : (1.905 * (2.2 - x)) / 1.1) : 2.2 - x / Math.sqrt(3);
						expect(x).toBeLessThanOrEqual(flat ? 2.2 : 1.905);
						expect(y).toBeLessThanOrEqual(edge + 1e-9);
					}
				}
			}
		}
	});
});

// ── MK2: the map legend is small, bottom-left, names cut short, foldable ──
import { MAP_LEGEND_NAME_MAX, shortLegendName } from "../src/hex-map/terrainLegend";

describe("map legend (MK2)", () => {
	it("cuts long names to the limit with an ellipsis; short ones stay", () => {
		expect(MAP_LEGEND_NAME_MAX).toBeGreaterThanOrEqual(6);
		expect(MAP_LEGEND_NAME_MAX).toBeLessThanOrEqual(8);
		expect(shortLegendName("forest", 8)).toBe("forest");
		expect(shortLegendName("mountains", 9)).toBe("mountains");
		expect(shortLegendName("mountain pass", 8)).toBe("mountai…");
		expect([...shortLegendName("deep water", 8)].length).toBeLessThanOrEqual(8);
		// No space left dangling before the ellipsis.
		expect(shortLegendName("deep water", 6)).toBe("deep…");
	});

	it("sits at the view's bottom-left (not over the status bar corner)", () => {
		const css = readFileSync("styles.css", "utf8");
		const at = css.search(/^\.duckmage-terrain-legend-map \{/m);
		expect(at).toBeGreaterThan(-1);
		const body = css.slice(at, css.indexOf("}", at));
		expect(body).toMatch(/left:\s*\d+px/);
		expect(body).toMatch(/bottom:\s*\d+px/);
		expect(body).not.toMatch(/\bright:/);
	});

	it("the map view passes the cut length and the fold state", () => {
		const view = readFileSync("src/hex-map/HexMapView.ts", "utf8");
		expect(view).toContain("maxName: MAP_LEGEND_NAME_MAX");
		expect(view).toContain("collapsed: settings.terrainLegendCollapsed");
	});
});
