import { describe, it } from "node:test";
import expect from "expect";
import { overworldRefreshFor } from "../src/overworld/overworldChanges";
import { blankSlots } from "../src/overworld/overworldLayer";
import { RegionBitmapCache } from "../src/overworld/overworldRender";

const region = { name: "ow-2-2", submapKind: "region", parent: { map: "ow", hex: "2_2" } };

describe("overworld refresh when a map changes", () => {
	it("a region painted while its overworld is open: drop its bitmap and redraw", () => {
		expect(overworldRefreshFor(region, "ow", undefined)).toEqual({ invalidate: "ow-2-2", redrawLayer: true, refreshMinimap: false });
	});

	it("a region painted while the region itself is open: still drop its bitmap (going back up shows it)", () => {
		const r = overworldRefreshFor(region, "ow-2-2", "ow");
		expect(r.invalidate).toBe("ow-2-2");
		expect(r.redrawLayer).toBe(true);
	});

	it("a region painted while another map is open: the bitmap is still dropped", () => {
		const r = overworldRefreshFor(region, "somewhere-else", undefined);
		expect(r.invalidate).toBe("ow-2-2");
		expect(r.redrawLayer).toBe(false);
	});

	it("the overworld's own biomes changed: redraw it, and the minimap and flower of its regions", () => {
		expect(overworldRefreshFor({ name: "ow" }, "ow", undefined)).toEqual({ invalidate: undefined, redrawLayer: true, refreshMinimap: true });
		expect(overworldRefreshFor({ name: "ow" }, "ow-2-2", "ow").refreshMinimap).toBe(true);
	});

	it("a location (not a region) never touches the region bitmaps", () => {
		const r = overworldRefreshFor({ name: "town", submapKind: "location", parent: { map: "ow", hex: "1_1" } }, "ow", undefined);
		expect(r.invalidate).toBeUndefined();
	});

	it("an invalidated bitmap is rebuilt on the next draw, the others are reused", () => {
		const cache = new RegionBitmapCache<number>();
		let builds = 0;
		const get = (n: string) => cache.get(n, "k", () => ++builds);
		get("a");
		get("b");
		cache.invalidate("a");
		get("a");
		get("b");
		expect(builds).toBe(3);
	});
});

describe("blank bricks", () => {
	it("are the overworld hexes with no region, in reading order", () => {
		const map = { gridOffset: { x: 0, y: 0 }, gridSize: { cols: 3, rows: 2 } };
		expect(blankSlots(map, new Set(["1_0", "0_1"]))).toEqual([[0, 0], [2, 0], [1, 1], [2, 1]]);
		expect(blankSlots(map, new Set(["0_0", "1_0", "2_0", "0_1", "1_1", "2_1"]))).toEqual([]);
	});
});
