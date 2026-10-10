import { describe, it } from "node:test";
import expect from "expect";
import {
	ancestorNeighbourCrumbs,
	buildMapTree,
	countMaps,
	displayNameFor,
	filterMapTree,
	mapLabel,
	neighbourCrumbs,
	treeContains,
	type MapTreeNode,
	type NamedMap,
} from "../src/maps/mapTree";

/** Map names (N6), the map list tree (N4) and sideways crumbs (X3). */

const names = (nodes: MapTreeNode[]): unknown[] =>
	nodes.map((n) => (n.kind === "map" ? (n.children.length ? [n.name, names(n.children)] : n.name) : { world: n.id, of: names(n.children) }));

describe("display names", () => {
	it("show the name as typed, else the slug", () => {
		expect(mapLabel({ name: "barony-of-saltmere", displayName: "Barony of Saltmere" })).toBe("Barony of Saltmere");
		expect(mapLabel({ name: "thornwood" })).toBe("thornwood"); // maps from before display names
		expect(mapLabel({ name: "thornwood", displayName: "  " })).toBe("thornwood");
		expect(mapLabel(undefined, "gone")).toBe("gone");
	});

	it("tolerate a hand-edited number", () => {
		expect(mapLabel({ name: "m", displayName: 1984 as unknown as string })).toBe("1984");
	});

	it("are only stored when they differ from the slug", () => {
		expect(displayNameFor("Barony of Saltmere", "barony-of-saltmere")).toBe("Barony of Saltmere");
		expect(displayNameFor("  Cole's   Ford ", "coles-ford")).toBe("Cole's Ford");
		expect(displayNameFor("thornwood", "thornwood")).toBeUndefined();
		expect(displayNameFor("", "thornwood")).toBeUndefined();
	});
});

describe("map list tree", () => {
	const maps: NamedMap[] = [
		{ name: "sector" },
		{ name: "system-a", parent: { map: "sector", hex: "3_4" } },
		{ name: "moon", parent: { map: "system-a", hex: "1_1" } },
		{ name: "coles-ford", displayName: "Cole's Ford", world: { id: "w", cx: 1, cy: 0 } },
		{ name: "thornwood", world: { id: "w", cx: 0, cy: 0 } },
		{ name: "marsh", world: { id: "w", cx: 0, cy: 1 } },
		{ name: "dungeon", parent: { map: "thornwood", hex: "2_2" } },
		{ name: "lonely", world: { id: "solo", cx: 0, cy: 0 } },
		{ name: "orphan", parent: { map: "deleted", hex: "0_0" } },
	];

	it("puts submaps under their parent and groups each world's regions in reading order", () => {
		expect(names(buildMapTree(maps))).toEqual([
			["sector", [["system-a", ["moon"]]]],
			{ world: "w", of: ["thornwood", "coles-ford", "marsh"].map((n) => (n === "thornwood" ? ["thornwood", ["dungeon"]] : n)) },
			"lonely",
			"orphan",
		]);
		expect(countMaps(buildMapTree(maps))).toBe(maps.length);
	});

	it("labels nodes with display names and names worlds by their regions", () => {
		const tree = buildMapTree(maps);
		const world = tree.find((n) => n.kind === "world")!;
		expect(world.label).toBe("thornwood, Cole's Ford, marsh");
		expect(world.children.map((c) => c.label)).toContain("Cole's Ford");
	});

	it("survives a parent loop without losing maps", () => {
		const loop: NamedMap[] = [
			{ name: "a", parent: { map: "b", hex: "0_0" } },
			{ name: "b", parent: { map: "a", hex: "0_0" } },
			{ name: "c", parent: { map: "a", hex: "0_0" } },
		];
		expect(countMaps(buildMapTree(loop))).toBe(3);
	});

	it("search keeps matches in context, by display name or slug", () => {
		const tree = buildMapTree(maps);
		expect(names(filterMapTree(tree, "moon"))).toEqual([["sector", [["system-a", ["moon"]]]]]);
		expect(names(filterMapTree(tree, "cole's"))).toEqual([{ world: "w", of: ["coles-ford"] }]);
		expect(names(filterMapTree(tree, "COLES-F"))).toEqual([{ world: "w", of: ["coles-ford"] }]);
		expect(filterMapTree(tree, "nothing-here")).toEqual([]);
		expect(filterMapTree(tree, "  ")).toBe(tree);
	});

	it("knows which branch holds the open map", () => {
		const tree = buildMapTree(maps);
		expect(treeContains(tree[0], "moon")).toBe(true);
		expect(treeContains(tree[0], "dungeon")).toBe(false);
	});
});

describe("sideways crumbs", () => {
	const world: NamedMap[] = [
		{ name: "thornwood", world: { id: "w", cx: 0, cy: 0 } },
		{ name: "coles-ford", displayName: "Cole's Ford", world: { id: "w", cx: 1, cy: 0 } },
		{ name: "west-wood", world: { id: "w", cx: -1, cy: 0 } },
		{ name: "marsh", world: { id: "w", cx: 0, cy: 1 } },
		{ name: "elsewhere", world: { id: "x", cx: 1, cy: 0 } },
	];

	it("list each side's neighbour with the side in words, not an arrow", () => {
		expect(neighbourCrumbs(world[0], world)).toEqual([
			{ side: "west", name: "west-wood", text: "West: west-wood" },
			{ side: "south", name: "marsh", text: "South: marsh" },
			{ side: "east", name: "coles-ford", text: "East: Cole's Ford" },
		]);
	});

	it("offer a submap its nearest ancestor's neighbours (round 6 U13)", () => {
		const maps: NamedMap[] = [
			...world,
			{ name: "deep", parent: { map: "thornwood", hex: "4_4" } },
			{ name: "hut", parent: { map: "deep", hex: "6_6" } },
		];
		const thornwoodSides = neighbourCrumbs(world[0], world);
		expect(ancestorNeighbourCrumbs("deep", maps)).toEqual({ via: "thornwood", crumbs: thornwoodSides });
		expect(ancestorNeighbourCrumbs("hut", maps)).toEqual({ via: "thornwood", crumbs: thornwoodSides });
		// A map with neighbours of its own uses those instead.
		expect(ancestorNeighbourCrumbs("thornwood", maps)).toBeNull();
		// No ancestor with neighbours, or a parent cycle: nothing.
		expect(ancestorNeighbourCrumbs("solo", [{ name: "solo" }])).toBeNull();
		const loop: NamedMap[] = [
			{ name: "a", parent: { map: "b", hex: "0_0" } },
			{ name: "b", parent: { map: "a", hex: "0_0" } },
		];
		expect(ancestorNeighbourCrumbs("a", loop)).toBeNull();
	});

	it("are empty for a map outside any world", () => {
		expect(neighbourCrumbs({ name: "solo" }, world)).toEqual([]);
		expect(neighbourCrumbs(undefined, world)).toEqual([]);
	});
});
