import { describe, it } from "node:test";
import expect from "expect";
import fs from "node:fs";
import path from "node:path";
import {
	ICON_PACK_LABELS,
	PLACE_ICON_KINDS,
	defaultIconPack,
	iconLabel,
	iconPack,
	iconPackTabs,
	placeIconKind,
	sortIcons,
} from "../src/utils";
import { BUNDLED_ICONS } from "../src/bundledIcons";
import { BUNDLED_PLACE_ICONS } from "../src/bundledPlaceIcons";
import { isIconHiddenByKind } from "../src/mapKinds";

const root = process.cwd();
const placeFiles = fs.readdirSync(path.join(root, "icons")).filter((f) => /^place-.*\.svg$/.test(f)).sort();
const credits = fs.readFileSync(path.join(root, "icons", "CREDITS.md"), "utf8");

describe("Places icon pack (N2b)", () => {
	it("ships all 55 owner picks, each bundled and with a kind", () => {
		expect(placeFiles.length).toBe(55);
		expect(BUNDLED_PLACE_ICONS.map(([f]) => f).sort()).toEqual(placeFiles);
		const kinds = new Set(PLACE_ICON_KINDS.map(([id]) => id));
		for (const f of placeFiles) {
			expect(BUNDLED_ICONS.has(f)).toBe(true);
			expect(kinds.has(placeIconKind(f) ?? "")).toBe(true);
		}
		// Every sub-group has icons in it.
		for (const [id] of PLACE_ICON_KINDS) {
			expect(BUNDLED_PLACE_ICONS.some(([, , k]) => k === id)).toBe(true);
		}
	});

	it("credits every place icon file with its game-icons.net source and author", () => {
		for (const f of placeFiles) {
			const line = credits.split(/\r?\n/).find((l) => l.startsWith(`- \`${f}\``));
			if (!line) throw new Error(`${f} has no line in icons/CREDITS.md`);
			expect(line).toMatch(/https:\/\/game-icons\.net\/1x1\/[a-z-]+\/[a-z0-9-]+\.html/);
			expect(line).toMatch(/— by \S+/);
		}
		expect(credits).toMatch(/Creative Commons Attribution 3\.0/);
	});

	it("is black glyphs with an explicit size, so masks, <img> and PNG export all work", () => {
		for (const f of placeFiles) {
			const svg = fs.readFileSync(path.join(root, "icons", f), "utf8");
			expect(svg).toMatch(/^<svg [^>]*width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/);
			expect(svg).not.toContain("currentColor");
			expect(svg).toContain('fill="#000"');
		}
	});

	it("is its own picker tab, between Terrain and Space", () => {
		expect(iconPack("place-castle.svg", new Set())).toBe("places");
		// A user's own icon with the same name belongs to Custom.
		expect(iconPack("place-castle.svg", new Set(["place-castle.svg"]))).toBe("custom");
		expect(ICON_PACK_LABELS.places).toBe("Places");
		expect(Object.keys(ICON_PACK_LABELS)).toEqual(["terrain", "places", "space", "custom"]);
		expect(iconPackTabs(new Map([["terrain", 37], ["places", 55], ["space", 70]])).map(([k]) => k)).toEqual([
			"all",
			"terrain",
			"places",
			"space",
			"custom",
		]);
	});

	it("labels drop the place- prefix", () => {
		expect(iconLabel("place-castle-ruins.svg")).toBe("castle ruins");
		expect(placeIconKind("place-castle-ruins.svg")).toBe("ruin");
		expect(placeIconKind("space-sun.svg")).toBeUndefined();
	});

	it("belongs to World maps: hidden in a space-only setup, shown otherwise", () => {
		expect(isIconHiddenByKind({ mapKinds: ["space"] }, "place-village.svg")).toBe(true);
		expect(isIconHiddenByKind({ mapKinds: ["world"] }, "place-village.svg")).toBe(false);
		expect(isIconHiddenByKind({ mapKinds: ["world", "space"] }, "place-village.svg")).toBe(false);
		expect(isIconHiddenByKind({}, "place-village.svg")).toBe(false);
		// The space-only picker still opens on Space.
		expect(defaultIconPack({ mapKinds: ["space"] })).toBe("space");
	});

	it("keeps pack order (settlements, castles, towers…) in the default icon order", () => {
		const sorted = sortIcons(["space-sun.svg", "place-tombstone.svg", "bw-hills.png", "place-village.svg", "place-castle.svg", "zz.png"]);
		expect(sorted).toEqual(["bw-hills.png", "place-village.svg", "place-castle.svg", "place-tombstone.svg", "space-sun.svg", "zz.png"]);
	});
});
