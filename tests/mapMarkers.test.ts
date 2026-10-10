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
