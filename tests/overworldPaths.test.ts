/**
 * Overworld paths confirmed into their regions (owner 2026-10-11): seams
 * that both neighbouring regions agree on, determinism, ownership (user
 * paths untouched, re-confirm replaces, rename kept), undo as one step,
 * terrain carving driven by the path TYPE (locked cells kept), and new or
 * regenerated regions picking confirmed paths up.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { hexNeighbors, type Orientation, type Stagger } from "../packages/hex-wfc/src/grid";
import { inRegion, regionBox, regionCells, type RegionLayout } from "../src/overworld/layout";
import {
	APPLIED_COL,
	carveCells,
	carveTerrainFor,
	carveWrites,
	draftsAfterEdit,
	isApplied,
	mergeOwned,
	OWNER_COL,
	ownerOf,
	projectPath,
	seamCrossing,
	withApplied,
	type OverworldBranch,
} from "../src/overworld/pathProjection";
import {
	applyConfirmedPaths,
	applyProjectionUndo,
	confirmOverworldPath,
	overworldPathsAt,
	prepareProjectionUndo,
	removeOverworldPath,
	type ProjectionUndo,
} from "../src/overworld/overworldPaths";
import { PathsService } from "../src/paths/PathsService";
import { parsePathTypes, serializePathTypes } from "../src/palettes/pathTypeTable";
import { setModeMapLookup } from "../src/modeGate";
import type { HexData } from "../src/maps/mapNote";
import type { MapData, MapPath, PathType, TerrainColor } from "../src/types";

const ORIENTS: Orientation[] = ["flat", "pointy"];
const STAGGERS: Stagger[] = ["odd", "even"];
const xy = (k: string): [number, number] => k.split("_").map(Number) as [number, number];
const adjacent = (l: RegionLayout, a: string, b: string) => hexNeighbors(...xy(a), l.orientation, l.childStagger).some(([x, y]) => `${x}_${y}` === b);

describe("seam crossings", () => {
	it("both regions agree: the cells are neighbours, one in each region, the same either way round", () => {
		for (const orientation of ORIENTS) for (const parentStagger of STAGGERS) for (const childStagger of STAGGERS) for (const size of [3, 4, 8]) {
			const l: RegionLayout = { footprint: "rect", size, orientation, parentStagger, childStagger };
			for (const p of [[1, 1], [2, 1], [2, 2]] as [number, number][]) {
				for (const q of hexNeighbors(p[0], p[1], orientation, parentStagger)) {
					const pq = seamCrossing(l, p, q, "salt");
					const qp = seamCrossing(l, q, p, "salt");
					expect(pq).not.toBeNull();
					expect(qp).toEqual([pq![1], pq![0]]);
					expect(inRegion(l, p[0], p[1], ...xy(pq![0]))).toBe(true);
					expect(inRegion(l, q[0], q[1], ...xy(pq![1]))).toBe(true);
					expect(adjacent(l, pq![0], pq![1])).toBe(true);
				}
			}
		}
	});

	it("is deterministic, and the salt (path name) moves it along the seam", () => {
		const l: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		expect(seamCrossing(l, [1, 1], [2, 1], "a")).toEqual(seamCrossing(l, [1, 1], [2, 1], "a"));
		const seen = new Set(["a", "b", "c", "d", "e", "f"].map((s) => JSON.stringify(seamCrossing(l, [1, 1], [2, 1], s))));
		expect(seen.size).toBeGreaterThan(1);
	});

	it("a projected path runs inside each region and joins at every seam", () => {
		const l: RegionLayout = { footprint: "rect", size: 5, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		const branch: OverworldBranch = { branch: 0, hexes: ["0_1", "1_1", "2_1", "2_2"] };
		const line = (a: string, b: string) => {
			// A plain neighbour walk (any route works for the seam property).
			const out = [a];
			let cur = a;
			for (let guard = 0; cur !== b && guard < 100; guard++) {
				const [bx, by] = xy(b);
				const next = hexNeighbors(...xy(cur), l.orientation, l.childStagger)
					.sort((p, q) => Math.hypot(p[0] - bx, p[1] - by) - Math.hypot(q[0] - bx, q[1] - by))[0];
				cur = `${next[0]}_${next[1]}`;
				out.push(cur);
			}
			return out;
		};
		const out = projectPath(l, "s", [branch], (_r, a, b) => line(a, b), () => true);
		expect([...out.keys()]).toEqual(branch.hexes);
		for (const [r, chains] of out) for (const k of chains[0]) expect(inRegion(l, ...xy(r), ...xy(k))).toBe(true);
		for (let i = 0; i + 1 < branch.hexes.length; i++) {
			const a = out.get(branch.hexes[i])![0], b = out.get(branch.hexes[i + 1])![0];
			expect(adjacent(l, a[a.length - 1], b[0])).toBe(true);
		}
		// Only wanted regions are routed; the rest still line up with them.
		const some = projectPath(l, "s", [branch], (_r, a, b) => line(a, b), (r) => r === "1_1");
		expect(some.get("1_1")).toEqual(out.get("1_1"));
		expect(some.size).toBe(1);
	});

	it("a fork starts on the main line's route in the region it leaves from", () => {
		const l: RegionLayout = { footprint: "rect", size: 5, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		const route = (_r: string, a: string, b: string) => (a === b ? [a] : [a, b]);
		const out = projectPath(l, "s", [
			{ branch: 0, hexes: ["0_1", "1_1", "2_1"] },
			{ branch: 1, hexes: ["1_1", "1_2"], forkFrom: { branch: 0 } },
		], route, () => true);
		const [main, fork] = out.get("1_1")!;
		expect(main.includes(fork[0])).toBe(true);
	});
});

describe("ownership and drafts", () => {
	const owned = (name: string, owner: string, anchors = ["0_0", "1_0"]): MapPath => ({ name, typeName: "River", branches: [{ anchors }], extra: { [OWNER_COL]: owner } });
	const user: MapPath = { name: "Mill Lane", typeName: "Road", branches: [{ anchors: ["0_0", "0_2"] }] };

	it("replaces only the paths of that overworld path, in place, keeping a name the user gave", () => {
		const before = [user, owned("Silver Run", "Great River"), owned("Other", "Other River")];
		const next: MapPath = { name: "Great River", typeName: "River", branches: [{ anchors: ["2_2", "3_3"] }] };
		const after = mergeOwned(before, "Great River", next);
		expect(after.map((p) => p.name)).toEqual(["Mill Lane", "Silver Run", "Other"]);
		expect(after[0]).toBe(user);
		expect(after[1].branches[0].anchors).toEqual(["2_2", "3_3"]);
		expect(ownerOf(after[1])).toBe("Great River");
		expect(mergeOwned(before, "Great River", null).map((p) => p.name)).toEqual(["Mill Lane", "Other"]);
	});

	it("a new projected path gets the overworld name, made unique against user paths", () => {
		const after = mergeOwned([{ ...user, name: "Great River" }], "Great River", { name: "Great River", typeName: "River", branches: [{ anchors: ["1_1", "2_1"] }] });
		expect(after.map((p) => p.name)).toEqual(["Great River", "Great River 2"]);
		expect(ownerOf(after[0])).toBeUndefined();
	});

	it("Applied reads forgivingly and is cleared by a reshape, retype or rename", () => {
		expect(isApplied({ extra: { applied: "Yes" } })).toBe(true);
		expect(isApplied({ extra: { [APPLIED_COL]: "✓" } })).toBe(true);
		expect(isApplied({ extra: { [APPLIED_COL]: "no" } })).toBe(false);
		const p = withApplied({ name: "R", typeName: "River", branches: [{ anchors: ["0_0", "3_0"] }] }, true);
		expect(draftsAfterEdit([p], [p])).toEqual([p]);
		const moved = { ...p, branches: [{ anchors: ["0_0", "3_1"] }] };
		expect(isApplied(draftsAfterEdit([p], [moved])[0])).toBe(false);
		expect(isApplied(draftsAfterEdit([p], [{ ...p, typeName: "Road" }])[0])).toBe(false);
		expect(isApplied(draftsAfterEdit([p], [{ ...p, name: "S" }])[0])).toBe(false);
		// Other columns stay.
		const withNotes = withApplied({ ...p, extra: { ...(p as { extra?: Record<string, string> }).extra, Travel: "3 days" } }, false);
		expect(withNotes.extra).toEqual({ Travel: "3 days" });
	});
});

describe("carving is the path type's, never its name's", () => {
	const palette: TerrainColor[] = [
		{ name: "grass", type: "grassland", color: "#0f0" },
		{ name: "ocean", type: "water", color: "#00f" },
		{ name: "lake", type: "water", color: "#09f" },
	];
	it("a terrain name first, then a terrain type, else nothing", () => {
		expect(carveTerrainFor("Lake", palette)).toBe("lake");
		expect(carveTerrainFor("water", palette)).toBe("ocean");
		expect(carveTerrainFor("lava", palette)).toBeUndefined();
		expect(carveTerrainFor(undefined, palette)).toBeUndefined();
	});
	it("width 1 takes the hexes beside the path; locked and already-carved cells are left", () => {
		const nb = (k: string) => hexNeighbors(...xy(k), "flat", "odd").map(([x, y]) => `${x}_${y}`);
		const inside = (k: string) => { const [x, y] = xy(k); return x >= 0 && y >= 0 && x < 6 && y < 6; };
		expect(carveCells([["2_2", "3_2"]], 0, inside, nb)).toEqual(new Set(["2_2", "3_2"]));
		expect(carveCells([["2_2", "3_2"]], 1, inside, nb).size).toBeGreaterThan(8);
		const now = (k: string) => (k === "2_2" ? { terrain: "grass", locked: true } : k === "3_2" ? { terrain: "lake" } : { terrain: "grass" });
		expect(carveWrites(["2_2", "3_2", "4_2"], "lake", now)).toEqual([["4_2", { terrain: "lake" }]]);
	});
	it("the palette note's Carves columns round-trip, and stay out of tables that don't use them", () => {
		const types: PathType[] = [
			{ name: "Road", color: "#a16207", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" },
			{ name: "Lava flow", color: "#f00", width: 3, lineStyle: "solid", routing: "meander", avoidImpassable: false, autoRoute: "winding", carves: "lava", carveWidth: 1 },
		];
		const table = serializePathTypes(types);
		expect(table).toContain("| Carves | Carve width |");
		expect(table).toContain("| Road | `#a16207` | 4 | solid | through | yes | direct | none | 0 |");
		expect(parsePathTypes(`## Path types\n\n${table}\n`)!.types).toEqual(types);
		expect(serializePathTypes([types[0]])).not.toContain("Carves");
	});
});

// ── the vault part, over a small world ──────────────────────────────────

const PALETTE: TerrainColor[] = [
	{ name: "grass", type: "grassland", color: "#0f0" },
	{ name: "forest", type: "forest", color: "#060" },
	{ name: "ocean", type: "water", color: "#00f", impassable: true },
];
const TYPES: PathType[] = [
	{ name: "River", color: "#3b82f6", width: 3, lineStyle: "solid", routing: "meander", avoidImpassable: false, autoRoute: "winding", carves: "water" },
	{ name: "Road", color: "#a16207", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" },
];
const LAYOUT: RegionLayout = { footprint: "rect", size: 5, orientation: "flat", parentStagger: "odd", childStagger: "odd" };

function world(opts: { skipRegions?: string[]; mode?: string } = {}) {
	const maps: MapData[] = [];
	const hexes = new Map<string, Map<string, HexData>>();
	const table = (m: string) => {
		let t = hexes.get(m);
		if (!t) hexes.set(m, (t = new Map()));
		return t;
	};
	const ow = {
		name: "ow", paletteName: "P", workMode: opts.mode,
		gridSize: { cols: 4, rows: 3 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
		regions: { footprint: "rect", size: 5, blend: "normal", worldId: "w1", stagger: "odd" },
		pathChains: [], paths: [],
	} as unknown as MapData;
	maps.push(ow);
	const addRegion = (px: number, py: number) => {
		const b = regionBox(LAYOUT, px, py);
		const name = `r-${px}-${py}`;
		maps.push({ name, paletteName: "P", submapKind: "region", parent: { map: "ow", hex: `${px}_${py}` }, gridSize: { cols: b.cols, rows: b.rows }, gridOffset: { x: b.x, y: b.y }, staggerOffset: "odd", pathChains: [], paths: [] } as unknown as MapData);
		for (const [x, y] of regionCells(LAYOUT, px, py)) table(name).set(`${x}_${y}`, { terrain: (x + y) % 3 ? "grass" : "forest" });
		return name;
	};
	for (let py = 0; py < 3; py++) for (let px = 0; px < 4; px++) {
		table("ow").set(`${px}_${py}`, { terrain: "grass" });
		if (!opts.skipRegions?.includes(`${px}_${py}`)) addRegion(px, py);
	}
	const getMap = (n: string) => maps.find((m) => m.name === n);
	let recorder: ((m: string, k: string, before: HexData | undefined) => void) | null = null;
	const mapStore = {
		get: (m: string, k: string) => hexes.get(m)?.get(k),
		all: (m: string) => table(m),
		set: (m: string, k: string, patch: Record<string, unknown>) => {
			recorder?.(m, k, table(m).get(k));
			const h: Record<string, unknown> = { ...(table(m).get(k) ?? {}) };
			for (const [f, v] of Object.entries(patch)) {
				if (v === null || v === undefined || v === "" || v === false) delete h[f];
				else h[f] = v;
			}
			table(m).set(k, h as HexData);
			return true;
		},
		setMany: (m: string, cells: Iterable<[string, Partial<HexData>]>) => {
			for (const [k, patch] of cells) {
				recorder?.(m, k, table(m).get(k));
				table(m).set(k, { ...(table(m).get(k) ?? {}), ...patch });
			}
		},
		paths: (m: string) => getMap(m)?.paths ?? [],
		setPaths: (m: string, ps: MapPath[]) => { getMap(m)!.paths = ps; },
		record: async <T>(fn: () => T | Promise<T>) => {
			const before = new Map<string, { map: string; key: string; before?: HexData }>();
			recorder = (map, key, b) => { const id = `${map}|${key}`; if (!before.has(id)) before.set(id, { map, key, before: b ? { ...b } : undefined }); };
			try {
				const result = await fn();
				return { result, cells: [...before.values()].map((c) => ({ ...c, after: table(c.map).get(c.key) ? { ...table(c.map).get(c.key)! } : undefined })) };
			} finally { recorder = null; }
		},
		flush: async () => {},
	};
	const paths = new PathsService({
		isMapReady: () => true,
		getMap,
		orientation: () => "flat",
		stagger: (m) => m.staggerOffset ?? "odd",
		pathTypes: () => TYPES,
		palette: () => PALETTE,
		hexData: (m) => table(m),
	});
	const undo: ProjectionUndo[] = [];
	const plugin = {
		settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
		getMap,
		getMapPalette: () => PALETTE,
		getMapPathTypes: () => TYPES,
		getPaletteOrPresetTerrains: () => PALETTE,
		mapStore,
		paths,
		pushUndo: (_m: string, item: ProjectionUndo) => undo.push(item),
		saveSettings: async () => {},
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { plugin: plugin as any, maps, hexes: table, ow, undo, addRegion, getMap };
}

const routeOf = (w: ReturnType<typeof world>, map: string, path: string) =>
	w.plugin.paths.resolved(map).filter((rb: { path: string }) => rb.path === path) as { hexes: string[]; branch: number }[];

describe("Confirm into regions", () => {
	const river: MapPath = { name: "Great River", typeName: "River", branches: [{ anchors: ["0_1", "3_1"] }] };

	it("routes through every region crossed, joined at each seam, and marks the path Applied", async () => {
		const w = world();
		w.ow.paths = [river];
		const res = await confirmOverworldPath(w.plugin, "ow", "Great River");
		if ("error" in res) throw new Error(res.error);
		const owRoute = routeOf(w, "ow", "Great River")[0].hexes;
		expect(res.regions.length).toBe(owRoute.length);
		for (let i = 0; i + 1 < owRoute.length; i++) {
			const a = routeOf(w, `r-${owRoute[i].replace("_", "-")}`, "Great River")[0].hexes;
			const b = routeOf(w, `r-${owRoute[i + 1].replace("_", "-")}`, "Great River")[0].hexes;
			expect(adjacent(LAYOUT, a[a.length - 1], b[0])).toBe(true);
		}
		expect(isApplied(w.ow.paths![0])).toBe(true);
		const r = w.getMap(`r-${owRoute[1].replace("_", "-")}`)!;
		expect(ownerOf(r.paths![0])).toBe("Great River");
		expect(overworldPathsAt(w.plugin, "ow", owRoute[1])).toEqual([{ name: "Great River", applied: true }]);
	});

	it("is deterministic: confirming again changes nothing", async () => {
		const a = world(), b = world();
		a.ow.paths = [river];
		b.ow.paths = [river];
		await confirmOverworldPath(a.plugin, "ow", "Great River");
		await confirmOverworldPath(b.plugin, "ow", "Great River");
		const snap = (w: ReturnType<typeof world>) => JSON.stringify(w.maps.map((m) => [m.name, m.paths]));
		expect(snap(a)).toBe(snap(b));
		const before = snap(a);
		await confirmOverworldPath(a.plugin, "ow", "Great River");
		expect(snap(a)).toBe(before);
	});

	it("carves the river's type terrain, never a locked hex, and leaves a road's terrain alone", async () => {
		const w = world();
		w.ow.paths = [river, { name: "King's Road", typeName: "Road", branches: [{ anchors: ["0_0", "0_2"] }] }];
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		const owRoute = routeOf(w, "ow", "Great River")[0].hexes;
		const region = `r-${owRoute[1].replace("_", "-")}`;
		const chain = routeOf(w, region, "Great River")[0].hexes;
		for (const k of chain) expect(w.hexes(region).get(k)?.terrain).toBe("ocean");
		// Undo, lock a hex on the route, confirm again: the locked hex stays.
		const item = w.undo.pop()!;
		applyProjectionUndo(w.plugin, item, "undo");
		expect(w.hexes(region).get(chain[2])?.terrain).not.toBe("ocean");
		w.hexes(region).set(chain[2], { terrain: "forest", locked: true });
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		expect(w.hexes(region).get(chain[2])).toEqual({ terrain: "forest", locked: true });
		expect(w.hexes(region).get(chain[3])?.terrain).toBe("ocean");
		// A road (its type carves nothing) changes no terrain.
		const roadRegions = routeOf(w, "ow", "King's Road")[0].hexes.map((h) => `r-${h.replace("_", "-")}`);
		const before = JSON.stringify(roadRegions.map((r) => [...w.hexes(r)]));
		await confirmOverworldPath(w.plugin, "ow", "King's Road");
		expect(JSON.stringify(roadRegions.map((r) => [...w.hexes(r)]))).toBe(before);
		expect(routeOf(w, roadRegions[0], "King's Road").length).toBe(1);
	});

	it("never touches a path drawn in the region; re-confirming after an edit replaces its own copy", async () => {
		const w = world();
		w.ow.paths = [river];
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		const owRoute = routeOf(w, "ow", "Great River")[0].hexes;
		const region = w.getMap(`r-${owRoute[1].replace("_", "-")}`)!;
		const mine: MapPath = { name: "Mill Lane", typeName: "Road", branches: [{ anchors: [`${region.gridOffset.x}_${region.gridOffset.y}`, `${region.gridOffset.x}_${region.gridOffset.y + 2}`] }] };
		region.paths = [mine, { ...region.paths![0], name: "Silver Run" }];
		// The overworld path is reshaped (a draft again), then confirmed again.
		w.ow.paths = draftsAfterEdit(w.ow.paths!, [{ ...w.ow.paths![0], branches: [{ anchors: ["0_1", "3_2"] }] }]);
		expect(isApplied(w.ow.paths[0])).toBe(false);
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		expect(region.paths![0]).toBe(mine);
		const owned = w.maps.flatMap((m) => (m.paths ?? []).filter((p) => ownerOf(p) === "Great River"));
		const newRoute = routeOf(w, "ow", "Great River")[0].hexes;
		expect(owned.length).toBe(newRoute.length);
		if (newRoute.includes(owRoute[1])) expect(region.paths!.map((p) => p.name)).toEqual(["Mill Lane", "Silver Run"]);
	});

	it("undo takes the whole projection back in one step, and redo puts it back", async () => {
		const w = world();
		w.ow.paths = [river];
		const terrainBefore = JSON.stringify(w.maps.map((m) => [...w.hexes(m.name)]));
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		expect(w.undo.length).toBe(1);
		const item = w.undo[0];
		const after = JSON.stringify(w.maps.map((m) => [m.name, m.paths]));
		const prepared = prepareProjectionUndo(w.plugin, item, "undo")!;
		applyProjectionUndo(w.plugin, prepared, "undo");
		expect(w.maps.every((m) => !(m.paths ?? []).some((p) => ownerOf(p)))).toBe(true);
		expect(isApplied(w.ow.paths![0])).toBe(false);
		expect(JSON.stringify(w.maps.map((m) => [...w.hexes(m.name)]))).toBe(terrainBefore);
		applyProjectionUndo(w.plugin, prepareProjectionUndo(w.plugin, item, "redo")!, "redo");
		expect(JSON.stringify(w.maps.map((m) => [m.name, m.paths]))).toBe(after);
	});

	it("Remove from regions takes its copies out and makes it a draft", async () => {
		const w = world();
		w.ow.paths = [river];
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		await removeOverworldPath(w.plugin, "ow", "Great River");
		expect(w.maps.every((m) => !(m.paths ?? []).some((p) => ownerOf(p)))).toBe(true);
		expect(isApplied(w.ow.paths![0])).toBe(false);
	});

	it("is refused in Play", async () => {
		const w = world({ mode: "play" });
		setModeMapLookup((n) => w.getMap(n));
		try {
			w.ow.paths = [river];
			expect(await confirmOverworldPath(w.plugin, "ow", "Great River")).toEqual({ error: "Switch to Build to confirm paths into regions." });
		} finally {
			setModeMapLookup(null);
		}
	});
});

describe("new and regenerated regions keep confirmed paths", () => {
	it("a region made after the confirm gets the path, joined to the regions already there", async () => {
		const river: MapPath = { name: "Great River", typeName: "River", branches: [{ anchors: ["0_1", "3_1"] }] };
		const probe = world();
		probe.ow.paths = [river];
		const owRoute = routeOf(probe, "ow", "Great River")[0].hexes;
		const gap = owRoute[1];
		const w = world({ skipRegions: [gap] });
		w.ow.paths = [river];
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		const name = w.addRegion(...xy(gap));
		expect(applyConfirmedPaths(w.plugin, name)).toBe(1);
		const mid = routeOf(w, name, "Great River")[0].hexes;
		const before = routeOf(w, `r-${owRoute[0].replace("_", "-")}`, "Great River")[0].hexes;
		const after = routeOf(w, `r-${owRoute[2].replace("_", "-")}`, "Great River")[0].hexes;
		expect(adjacent(LAYOUT, before[before.length - 1], mid[0])).toBe(true);
		expect(adjacent(LAYOUT, mid[mid.length - 1], after[0])).toBe(true);
		for (const k of mid) expect(w.hexes(name).get(k)?.terrain).toBe("ocean");
	});

	it("regenerating (new terrain written) re-routes and re-carves it", async () => {
		const w = world();
		w.ow.paths = [{ name: "Great River", typeName: "River", branches: [{ anchors: ["0_1", "3_1"] }] }];
		await confirmOverworldPath(w.plugin, "ow", "Great River");
		const owRoute = routeOf(w, "ow", "Great River")[0].hexes;
		const name = `r-${owRoute[1].replace("_", "-")}`;
		const chain = routeOf(w, name, "Great River")[0].hexes;
		for (const [x, y] of regionCells(LAYOUT, ...xy(owRoute[1]))) w.hexes(name).set(`${x}_${y}`, { terrain: "grass" });
		applyConfirmedPaths(w.plugin, name);
		expect(routeOf(w, name, "Great River")[0].hexes).toEqual(chain);
		for (const k of chain) expect(w.hexes(name).get(k)?.terrain).toBe("ocean");
		expect(w.getMap(name)!.paths!.filter((p) => ownerOf(p)).length).toBe(1);
	});

	it("draft paths are left out of new regions", async () => {
		const w = world({ skipRegions: ["1_1"] });
		w.ow.paths = [{ name: "Great River", typeName: "River", branches: [{ anchors: ["0_1", "3_1"] }] }];
		const name = w.addRegion(1, 1);
		expect(applyConfirmedPaths(w.plugin, name)).toBe(0);
		expect(w.getMap(name)!.paths).toEqual([]);
	});
});
