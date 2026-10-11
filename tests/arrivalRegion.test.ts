/**
 * Arrival makes regions on overworlds (GM4: "when going to a new planet,
 * new region, etc"): with `on-arrival: make places`, going to an overworld
 * hex with no region makes it from the hex's biome, seeded, with no form,
 * through the same path as the Biome painter (createRegion). Reroll until
 * Lock in any mode, then God only. Off unless the map says so.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { ArrivalService } from "../src/arrival/ArrivalService";
import { EventsService } from "../src/arrival/EventsService";
import { arrivalSeed, effectiveArrivalMode } from "../src/arrival/arrival";
import { representativeTerrain } from "../src/overworld/biomes";
import { setModeMapLookup } from "../src/modeGate";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

type Hex = { terrain?: string; locked?: boolean; onArrival?: string; biome?: string };

function world(opts: { mode?: string; arrival?: string } = {}) {
	const overworld = {
		name: "ow", paletteName: "Default", workMode: opts.mode ?? "play", seed: 4242,
		gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
		regions: { footprint: "rect", size: 4, blend: "normal", worldId: "w1", stagger: "odd" },
		pathChains: [],
		...(opts.arrival ? { arrivalMode: opts.arrival } : {}),
	} as unknown as MapData;
	const maps: MapData[] = [overworld];
	const store = new Map<string, Map<string, Hex>>();
	const hexes = (m: string): Map<string, Hex> => {
		let h = store.get(m);
		if (!h) store.set(m, (h = new Map()));
		return h;
	};
	hexes("ow").set("1_1", { terrain: representativeTerrain("taiga", DEFAULT_TERRAIN_PALETTE)! });
	hexes("ow").set("2_1", { terrain: representativeTerrain("grassland", DEFAULT_TERRAIN_PALETTE)! });
	const notes = new Map<string, string>();
	const made: { name: string; cells?: Map<string, string> }[] = [];
	const writes: string[] = [];
	const plugin = {
		settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
		getMap: (n: string) => maps.find((m) => m.name === n),
		parentOf: (n: string) => maps.find((m) => m.name === n)?.parent,
		getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
		getPaletteOrPresetTerrains: () => DEFAULT_TERRAIN_PALETTE,
		mapLabel: (n: string) => n,
		arrivalModeFor: (n: string) => effectiveArrivalMode(n, (m) => maps.find((x) => x.name === m)?.arrivalMode, (m) => maps.find((x) => x.name === m)?.parent?.map),
		refreshHexMap: () => {},
		mapStore: {
			get: (m: string, k: string) => store.get(m)?.get(k),
			all: (m: string) => hexes(m),
			set: (m: string, k: string, patch: Hex) => {
				writes.push(`${m}|${k}`);
				hexes(m).set(k, { ...hexes(m).get(k), ...patch });
				return true;
			},
			setMany: (m: string, cells: Iterable<[string, Hex]>) => {
				writes.push(m);
				for (const [k, h] of cells) hexes(m).set(k, { ...hexes(m).get(k), ...h });
			},
			flush: async () => {},
			editNoteText: async (m: string, edit: (c: string) => string) => {
				if (!maps.some((x) => x.name === m)) return false;
				const cur = notes.get(m) ?? `# ${m}\n`;
				const next = edit(cur);
				if (next !== cur) { notes.set(m, next); writes.push(`note:${m}`); }
				return true;
			},
		},
		saveSettings: async () => {},
		createNewMap: async (
			name: string, cols: number, rows: number, _palette: string, x: number, y: number, stagger: string,
			_progress: unknown, cells?: Map<string, string>, extra?: { parent?: { map: string; hex: string } },
		) => {
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			maps.push({ name: slug, paletteName: "Default", gridSize: { cols, rows }, gridOffset: { x, y }, staggerOffset: stagger, parent: extra?.parent, pathChains: [] } as unknown as MapData);
			for (const [k, t] of cells ?? []) hexes(slug).set(k, { terrain: t });
			made.push({ name: slug, cells });
			return { name: slug };
		},
		// The first region writes the shipped biome notes (DJ-Q4); nothing to write here.
		ensureOverworldBiomes: async () => {},
		linkRegion: async (_p: string, _x: number, _y: number, child: string) => {
			const c = maps.find((m) => m.name === child)!;
			c.submapKind = "region";
			return true;
		},
	};
	(plugin as Record<string, unknown>).events = new EventsService(plugin as never);
	setModeMapLookup((n) => plugin.getMap(n));
	const service = new ArrivalService(plugin as never);
	return { plugin, service, maps, overworld, store, notes, made, writes };
}

describe("arrival on an overworld (GM4)", () => {
	it("is off unless the map makes places: nothing is made or written", async () => {
		const w = world();
		expect(w.service.canArrive("ow", 2, 1)).toBe(false);
		expect(await w.service.arrive("ow", 2, 1)).toBeNull();
		expect(w.made).toEqual([]);
		expect(w.writes).toEqual([]);
	});

	it("going to a hex with no region makes it from the hex's biome, seeded, in Play, with no form", async () => {
		const w = world({ arrival: "make places" });
		expect(w.service.canArrive("ow", 2, 1)).toBe(true);
		const name = await w.service.arrive("ow", 2, 1);
		expect(name).toBeTruthy();
		const region = w.maps.find((m) => m.name === name)!;
		expect(region).toMatchObject({ parent: { map: "ow", hex: "2_1" }, submapKind: "region", arrival: "open", workMode: "play" });
		expect(region.regionSeed).toBe(arrivalSeed(4242, "2_1", "submap", 0));
		expect(region.world).toEqual({ id: "w1", cx: 2, cy: 1 });
		// Made from the blend field ("match"), as the Biome painter does.
		expect(w.made[0].cells).toBeInstanceOf(Map);
		const note = w.notes.get(name!)!;
		expect(note).toContain("## Arrival");
		expect(note).toMatch(/- Made with the .+ biome on Default/);
		expect(note).toContain("- Not locked yet");
		// A second visit makes nothing new.
		expect(w.service.canArrive("ow", 2, 1)).toBe(false);
	});

	it("is seeded: the same overworld seed makes the same region", async () => {
		const run = async () => {
			const w = world({ arrival: "make places" });
			await w.service.arrive("ow", 2, 1);
			return { seed: w.maps[1].regionSeed, cells: [...(w.made[0].cells ?? [])].join(",") };
		};
		expect(await run()).toEqual(await run());
	});

	it("a hex with no biome, or with a region already, can't be arrived at", async () => {
		const w = world({ arrival: "make places" });
		expect(w.service.blocker("ow", 3, 3)).toBe("This hex has no biome yet.");
		await w.service.arrive("ow", 1, 1);
		expect(w.service.blocker("ow", 1, 1)).toBe("This hex already has a region.");
		expect(w.service.blocker("ow", 9, 9)).toBe("This hex is off the map.");
	});

	it("Play may reroll the new region until it's locked; then only God", async () => {
		const w = world({ arrival: "make places" });
		const name = (await w.service.arrive("ow", 2, 1))!;
		const region = w.maps.find((m) => m.name === name)!;
		expect(await w.service.reroll(name)).toBe(true);
		expect(region.arrivalRerolls).toBe(1);
		expect(region.regionSeed).toBe(arrivalSeed(4242, "2_1", "submap", 1));
		expect(w.notes.get(name)).toContain("- Rerolled once.");
		await w.service.lock(name);
		expect(region.arrival).toBe("locked");
		expect(await w.service.reroll(name)).toBe(false);
		expect(region.regionSeed).toBe(arrivalSeed(4242, "2_1", "submap", 1));
		region.workMode = "god";
		expect(await w.service.reroll(name)).toBe(true);
		expect(region.regionSeed).toBe(arrivalSeed(4242, "2_1", "submap", 2));
	});
});
