/**
 * Owner MG8: maps may be each other's submaps (the-coast ↔ the-north in the
 * owner's 1.5 data). Nothing detects, breaks or warns about it: every walk
 * up the parent links just stops when a map comes round again, so nothing
 * hangs, nothing shows twice, and nothing is reversed.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { mapAncestors, mapRoot } from "../src/hex-map/submapNav";
import { ancestorNeighbourCrumbs, buildMapTree, countMaps } from "../src/maps/mapTree";
import { effectiveArrivalMode } from "../src/arrival/arrival";
import { inheritedRoleTables } from "../src/worldgen/tableSources";
import { EventsService } from "../src/arrival/EventsService";

type M = { name: string; parent?: { map: string; hex: string }; world?: { id: string; cx: number; cy: number } };
const maps: M[] = [
	{ name: "the-coast", parent: { map: "the-north", hex: "1_1" } },
	{ name: "the-north", parent: { map: "the-coast", hex: "2_2" } },
	{ name: "harbour", parent: { map: "the-coast", hex: "3_3" } },
	{ name: "inn", parent: { map: "harbour", hex: "0_0" } },
	{ name: "self", parent: { map: "self", hex: "0_0" } },
	{ name: "world" },
];
const parentOf = (n: string) => maps.find((m) => m.name === n)?.parent?.map;

describe("MG8: maps that are each other's submaps", () => {
	it("breadcrumbs: each map's own parents, root first, each once, never reversed", () => {
		expect(mapAncestors("the-coast", parentOf)).toEqual(["the-north"]);
		expect(mapAncestors("the-north", parentOf)).toEqual(["the-coast"]);
		expect(mapAncestors("inn", parentOf)).toEqual(["the-north", "the-coast", "harbour"]);
		expect(mapAncestors("self", parentOf)).toEqual([]);
		expect(mapAncestors("world", parentOf)).toEqual([]);
	});

	it("the top of a tree: a loop has one shared top, from wherever you start", () => {
		expect(mapRoot("the-coast", parentOf)).toBe("the-coast");
		expect(mapRoot("the-north", parentOf)).toBe("the-coast");
		expect(mapRoot("inn", parentOf)).toBe("the-coast");
		expect(mapRoot("self", parentOf)).toBe("self");
		expect(mapRoot("world", parentOf)).toBe("world");
	});

	it("the Events ledger's world is that shared top (no hang)", () => {
		const svc = new EventsService({
			getMap: (n: string) => maps.find((m) => m.name === n),
			parentOf: (n: string) => maps.find((m) => m.name === n)?.parent,
			mapStore: {},
		} as never);
		expect(svc.rootOf("the-north")).toBe(svc.rootOf("the-coast"));
		expect(svc.rootOf("inn")).toBe("the-coast");
	});

	it("the Maps list shows every map once, and maps below the loop under their parent", () => {
		const tree = buildMapTree(maps);
		expect(countMaps(tree)).toBe(maps.length);
		const roots = tree.map((n) => (n.kind === "map" ? n.name : n.kind));
		expect(roots).toEqual(expect.arrayContaining(["the-coast", "the-north", "self", "world"]));
		const coast = tree.find((n) => n.kind === "map" && n.name === "the-coast")!;
		expect(coast.children.map((c) => (c.kind === "map" ? c.name : c.kind))).toEqual(["harbour"]);
	});

	it("inherited settings walk up and stop: arrival, role tables, neighbour crumbs", () => {
		expect(effectiveArrivalMode("inn", () => undefined, parentOf)).toEqual({ mode: "off" });
		expect(effectiveArrivalMode("inn", (m) => (m === "the-north" ? "make submaps" : undefined), parentOf)).toEqual({ mode: "make", from: "the-north" });
		expect(inheritedRoleTables("the-coast", () => undefined, parentOf)).toEqual({});
		expect(ancestorNeighbourCrumbs("inn", maps, parentOf)).toBeNull();
	});

	it("nothing in the plugin warns about, detects or breaks parent loops", () => {
		for (const f of ["src/HexmakerPlugin.ts", "src/maps/MapStore.ts", "src/maps/submaps.ts", "src/migrations/upgradeNote.ts"]) {
			const t = readFileSync(f, "utf8");
			expect(t).not.toMatch(/parent (loop|cycle)s? (found|detected)|breakCycle|break the (loop|cycle)/i);
		}
	});
});
