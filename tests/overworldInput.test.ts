/**
 * Overworld clicks and the terrain brush (owner reports 2026-10-10): click
 * routing by mode × has-region × button, and the brush that paints the
 * region maps under it live, across seams, redrawing only touched regions.
 */
import { describe, it } from "node:test";
import expect from "expect";
import {
	brushCells,
	FrameThrottle,
	overworldLeftClick,
	overworldMenu,
	paintTargets,
	terrainDiff,
} from "../src/overworld/overworldInput";
import { overworldRefreshFor } from "../src/overworld/overworldChanges";
import { RegionBitmapCache } from "../src/overworld/overworldRender";
import { parentOf, regionCells, type RegionLayout } from "../src/overworld/layout";
import { PLACE_LOCKED_HINT } from "../src/workMode";

const MODES = ["play", "build", "god", undefined] as const;
const m = (mode: string | undefined) => ({ workMode: mode });

describe("overworld click routing (mode × has region × button)", () => {
	it("left click on a hex or brick with a region enters it, in every mode", () => {
		for (const mode of MODES) expect(overworldLeftClick(m(mode), true)).toEqual({ kind: "enter" });
	});

	it("left click on an empty one places a biome in Build and God, and only hints in Play", () => {
		expect(overworldLeftClick(m("build"), false)).toEqual({ kind: "place" });
		expect(overworldLeftClick(m(undefined), false)).toEqual({ kind: "place" });
		expect(overworldLeftClick(m("god"), false)).toEqual({ kind: "place" });
		expect(overworldLeftClick(m("play"), false)).toEqual({ kind: "hint", hint: PLACE_LOCKED_HINT });
	});

	it("right click on a region: Enter region and Edit region… in every mode, no Edit hex (#49)", () => {
		for (const mode of MODES) {
			const items = overworldMenu(m(mode), true);
			expect(items.map((i) => i.id)).toEqual(["enter-region", "edit-region", "center"]);
			expect(items.every((i) => i.enabled)).toBe(true);
			expect(items.find((i) => i.id === "edit-region")!.title).toBe("Edit region…");
			expect(items.some((i) => /edit hex/i.test(i.title))).toBe(false);
		}
	});

	it("right click on an empty hex: Set biome…, disabled in Play; never a hex editor", () => {
		expect(overworldMenu(m("build"), false)).toEqual([
			{ id: "set-biome", title: "Set biome…", enabled: true },
			{ id: "center", title: "Center on this hex", enabled: true },
		]);
		expect(overworldMenu(m("play"), false)[0]).toEqual({ id: "set-biome", title: "Set biome…", enabled: false, hint: PLACE_LOCKED_HINT });
		for (const mode of MODES) expect(overworldMenu(m(mode), false).some((i) => /edit hex/i.test(i.title))).toBe(false);
	});

	it("only region-level items: the hex's Locations when it has any, no per-hex items", () => {
		expect(overworldMenu(m("build"), true, 3).map((i) => i.title)).toEqual(["Enter region", "Edit region…", "Center on this hex", "Locations (3)…"]);
		const titles = overworldMenu(m("god"), true, 1).map((i) => i.title).join(" | ");
		for (const hexItem of ["Open note", "Link table", "Swap hex", "Clear terrain", "New map from this hex"]) expect(titles).not.toContain(hexItem);
	});
});

const LAYOUT: RegionLayout = { footprint: "rect", size: 4, orientation: "flat", parentStagger: "odd", childStagger: "odd" };

describe("the terrain brush on an overworld", () => {
	it("brush sizes 1, 3 and 7 cover that many cells", () => {
		expect(brushCells(LAYOUT, 5, 5, 1)).toEqual([[5, 5]]);
		expect(brushCells(LAYOUT, 5, 5, 3)).toHaveLength(3);
		expect(brushCells(LAYOUT, 5, 5, 7)).toHaveLength(7);
	});

	it("a wide brush on a seam writes into both regions", () => {
		// A cell on the right edge of region 0_0's block: its neighbours east are in the next region.
		const cells = regionCells(LAYOUT, 0, 0);
		const edge = cells.find(([x, y]) => brushCells(LAYOUT, x, y, 7).some(([a, b]) => parentOf(LAYOUT, a, b).join("_") !== "0_0"))!;
		const regions = new Map([["0_0", "r00"], ["1_0", "r10"], ["1_1", "r11"], ["0_1", "r01"], ["1_-1", "r1m"], ["0_-1", "r0m"]]);
		const { targets, missed } = paintTargets(LAYOUT, brushCells(LAYOUT, edge[0], edge[1], 7), (h) => regions.get(h));
		expect(targets.length + missed).toBe(7);
		expect(new Set(targets.map((t) => t.map)).size).toBeGreaterThan(1);
		for (const t of targets) {
			const [x, y] = t.key.split("_").map(Number);
			expect(regions.get(parentOf(LAYOUT, x, y).join("_"))).toBe(t.map);
		}
	});

	it("cells over a slot with no region are skipped and counted (the caller hints once)", () => {
		const { targets, missed } = paintTargets(LAYOUT, brushCells(LAYOUT, 1, 1, 7), () => undefined);
		expect(targets).toEqual([]);
		expect(missed).toBe(7);
	});

	it("a view showing a region repaints only the hexes that changed", () => {
		const shown = new Map<string, string | null>([["0_0", "grass"], ["1_0", "grass"], ["2_0", null]]);
		const now = new Map([["0_0", "grass"], ["1_0", "volcano"], ["2_0", "volcano"]]);
		expect(terrainDiff(shown, (k) => now.get(k))).toEqual([["1_0", "volcano"], ["2_0", "volcano"]]);
		expect(terrainDiff(new Map([["0_0", "grass"]]), () => undefined)).toEqual([["0_0", null]]);
	});

	it("frame throttle: many requests in a frame run once, and it keeps firing during a stroke", () => {
		const frames: (() => void)[] = [];
		const t = new FrameThrottle((cb) => frames.push(cb));
		let runs = 0;
		for (let i = 0; i < 5; i++) t.request(() => runs++);
		expect(frames).toHaveLength(1);
		frames.shift()!();
		expect(runs).toBe(1);
		t.request(() => runs++);
		frames.shift()!();
		expect(runs).toBe(2);
	});
});

describe("live write + invalidation during a stroke", () => {
	/**
	 * The view's path, with its real pieces: each painted cell is written to
	 * its region map at once; the store's change event says which bitmap to
	 * drop (overworldRefreshFor); redraws come once per frame and rebuild
	 * only the dropped bitmaps.
	 */
	it("writes each cell as it's painted and rebuilds only the touched regions, frame by frame", () => {
		const regions = new Map([["0_0", "r00"], ["1_0", "r10"], ["2_0", "r20"]]);
		const store = new Map<string, Map<string, string>>([...regions.values()].map((n) => [n, new Map()]));
		const cache = new RegionBitmapCache<number>();
		const built: string[] = [];
		const draw = () => { for (const n of regions.values()) cache.get(n, "zoom1", () => { built.push(n); return 1; }); };
		draw(); // first draw: every region
		built.length = 0;
		const frames: (() => void)[] = [];
		const redraws = new FrameThrottle((cb) => frames.push(cb));
		const onChange = (map: string) => {
			const r = overworldRefreshFor({ name: map, submapKind: "region", parent: { map: "ow", hex: [...regions].find(([, n]) => n === map)![0] } }, "ow", undefined);
			if (r.invalidate) cache.invalidate(r.invalidate);
			if (r.redrawLayer) redraws.request(draw);
		};
		const paint = (x: number, y: number) => {
			for (const t of paintTargets(LAYOUT, brushCells(LAYOUT, x, y, 1), (h) => regions.get(h)).targets) {
				store.get(t.map)!.set(t.key, "volcano");
				onChange(t.map);
			}
		};
		// Two cells of region 0_0 in one frame: written at once, one rebuild.
		const [a, b] = regionCells(LAYOUT, 0, 0);
		paint(...a);
		paint(...b);
		expect(store.get("r00")!.size).toBe(2);
		expect(frames).toHaveLength(1);
		frames.shift()!();
		expect(built).toEqual(["r00"]);
		// The stroke moves on into region 1_0 (mid-stroke, next frame).
		paint(...regionCells(LAYOUT, 1, 0)[0]);
		frames.shift()!();
		expect(built).toEqual(["r00", "r10"]);
		expect(store.get("r20")!.size).toBe(0);
		expect(cache.builds).toBe(5);
	});
});
