/**
 * Phase 4 end to end, on an in-memory vault (SP4, SP5, GM4, T5):
 * - going into an unknown sector hex in Play rolls its On arrival table
 *   once, with the map's seed, writes what it was onto the sector hex,
 *   and makes the system with no form;
 * - the same seed gives the same place; a second visit rolls nothing;
 * - the place can be rerolled in Play until it's locked, then only in God;
 * - a world not set to make places writes nothing.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { MapStore } from "../src/maps/MapStore";
import { parseMapNote } from "../src/maps/mapNote";
import { addLocationPatch } from "../src/maps/submaps";
import { setHexDataSource } from "../src/frontmatter";
import { setModeMapLookup } from "../src/modeGate";
import { ArrivalService } from "../src/arrival/ArrivalService";
import { EventsService } from "../src/arrival/EventsService";
import { effectiveArrivalMode } from "../src/arrival/arrival";
import { convertWorldTypes } from "../src/space/spaceTables";
import { notesLookup } from "../src/random-tables/resolve";
import { inheritedRoleTables, layeredSource, notesTableSource } from "../src/worldgen/tableSources";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { getPreset } from "../src/palettes/presets";
import { slugify } from "../src/utils";
import { MemVault } from "./helpers/memVault";
import { moduleGenerators as runtimeGenerators } from "../src/modules/runtime";
import type { GeneratorHelpers } from "../src/modules/types";
import { Notice } from "obsidian";
import type { MapData } from "../src/types";
import type { RoleId } from "../src/worldgen/tableRoles";
import type { NewMapOptions } from "../src/services/MapsService";

(globalThis as Record<string, unknown>).window ??= globalThis;

const SET = convertWorldTypes({ name: "Default space", rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS }, { tablesFolder: "world/tables", shownAs: "star system" });
const TABLES = Object.fromEntries(SET.files.map((f) => [f.path, f.content]));
const MAINWORLDS = SET.files.find((f) => f.path.endsWith("Mainworlds.md"))!.path.replace(/\.md$/, "");
const UNCHARTED = SET.files.find((f) => f.path.endsWith("Uncharted.md"))!.path.replace(/\.md$/, "");
const SECTOR_NOTE = "world/hexes/drift/_drift.md";

function world(opts: { arrival?: string; seed?: number; mode?: string } = {}) {
	const vault = new MemVault();
	const maps: MapData[] = [{
		name: "drift", paletteName: "Space - Sector", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, pathChains: [],
		baseTerrain: "empty space", seed: opts.seed ?? 777, workMode: opts.mode ?? "play",
		...(opts.arrival ? { arrivalMode: opts.arrival } : {}),
	} as MapData];
	const lookup = notesLookup(TABLES);
	const p = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "world/hexes", worldFolder: "world", tablesFolder: "world/tables", maps, hexOrientation: "flat", staggerOffset: "odd", mapKinds: ["space"] } as Record<string, unknown> & { maps: MapData[] },
		mapStore: undefined as unknown as MapStore,
		saves: 0,
		moduleGenerators(h: GeneratorHelpers) { return runtimeGenerators(this as never, h); },
		getMap: (n: string) => maps.find((m) => m.name === n),

		rolledMapName: () => undefined,
		mapLabel: (n: string) => maps.find((m) => m.name === n)?.displayName ?? n,
		parentOf: (n: string) => maps.find((m) => m.name === n)?.parent,
		hexPath: (x: number, y: number, map: string) => `world/hexes/${map}/${x}_${y}.md`,
		arrivalModeFor: (n: string) => effectiveArrivalMode(n, (m) => maps.find((x) => x.name === m)?.arrivalMode, (m) => maps.find((x) => x.name === m)?.parent?.map),
		roleTablesFor: (n: string) => inheritedRoleTables(n, (m) => maps.find((x) => x.name === m)?.roleTables, (m) => maps.find((x) => x.name === m)?.parent?.map),
		tableNotes: { lookup: () => lookup },
		worldTypeStore: {
			sourceFor: (_v: string | undefined, palette: readonly (string | { name: string })[], mapName?: string) => {
				const terrains = palette.map((t) => (typeof t === "string" ? t : t.name));
				const base = notesTableSource(SET.roles, lookup, terrains, "Tables: Default space");
				const own = mapName ? p.roleTablesFor(mapName) : {};
				const overrides = Object.fromEntries(Object.entries(own).map(([r, v]) => [r, v!.link])) as Partial<Record<RoleId, string>>;
				return { source: layeredSource(base, overrides, lookup, terrains) };
			},
			list: () => [],
		},
		paths: { resolvedPathChains: () => [] },
		getMapPalette: (n: string) => getPreset(maps.find((m) => m.name === n)?.paletteName ?? "")?.terrains ?? [],
		getPaletteOrPresetTerrains: (n: string) => getPreset(n)?.terrains ?? [],
		getPaletteOrPresetKind: (n: string) => getPreset(n)?.kind,
		getPaletteByName: () => undefined,
		contextKinds: () => new Set(["space"]),
		childPaletteFor: (n: string) => getPreset(maps.find((m) => m.name === n)?.paletteName ?? "")?.childPalette ?? "Space - System",
		submapDefaultFor: (n: string, t: string | undefined) => (t ? getPreset(maps.find((m) => m.name === n)?.paletteName ?? "")?.submapDefaults?.[t] : undefined),
		getPathTypes: () => [],
		getMapPathTypes: () => [],
		saveData: async () => {},
		refreshHexMap: () => {},
		saveSettings: async () => { p.saves++; await p.mapStore.sync(); },
		async createNewMap(extra: NewMapOptions) {
			const { name: raw, cols, rows, palette: paletteName, stagger, terrain: cells } = extra;
			const ox = extra.offset?.x ?? 0, oy = extra.offset?.y ?? 0;
			const name = slugify(extra.slug || raw);
			maps.push({ name, displayName: raw, paletteName, gridSize: { cols, rows }, gridOffset: { x: ox, y: oy }, pathChains: [], staggerOffset: stagger, ...(extra.baseTerrain ? { baseTerrain: extra.baseTerrain } : {}), ...(extra.parent ? { parent: extra.parent } : {}) } as MapData);
			p.mapStore.setMany(name, [...(cells ?? [])].filter(([, t]) => t !== extra.baseTerrain).map(([k, t]) => [k, { terrain: t }]));
			if (extra.arrivals) p.mapStore.setMany(name, [...extra.arrivals].map(([k, t]) => [k, { onArrival: t }]));
			await p.mapStore.flush();
			return { name };
		},
		async linkSubmap(parent: string, x: number, y: number, child: string, action: string) {
			const key = `${x}_${y}`;
			p.mapStore.set(parent, key, addLocationPatch(p.mapStore.get(parent, key), child), action as never);
		},
	};
	p.mapStore = new MapStore(p as never);
	(p as Record<string, unknown>).events = new EventsService(p as never);
	setHexDataSource(p.mapStore);
	setModeMapLookup((n) => p.getMap(n));
	const service = new ArrivalService(p as never);
	return { vault, p, maps, service };
}

async function sectorWith(w: ReturnType<typeof world>, cells: [string, { terrain?: string; onArrival?: string }][]) {
	await w.p.mapStore.init();
	w.p.mapStore.setMany("drift", cells);
	await w.p.mapStore.flush();
}

describe("arriving at an unknown sector hex (T5, SP4)", () => {
	beforeEach(() => { (Notice as unknown as { shown: string[] }).shown = []; });

	it("rolls its On arrival table once, writes the result onto the sector hex, and makes the system with no form", async () => {
		const w = world({ arrival: "make places" });
		await sectorWith(w, [["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
		const made = await w.service.arrive("drift", 4, 5);
		expect(made).toBeTruthy();
		const hex = w.p.mapStore.get("drift", "4_5")!;
		// Discovery is raised to the parent: the sector now knows the world type.
		expect(hex.onArrival).toBeUndefined();
		expect(hex.terrain).not.toBe("star system");
		expect(DEFAULT_WORLD_TYPE_ROWS.some((r) => r.map === "sector" && r.world === hex.terrain)).toBe(true);
		expect(hex.locations).toEqual([made]);
		// The system: made from the row (Orbits on Space - System, 13×13), in the player's mode, open for rerolls.
		const sys = w.p.getMap(made!)!;
		expect(sys).toMatchObject({ paletteName: "Space - System", gridSize: { cols: 13, rows: 13 }, parent: { map: "drift", hex: "4_5" }, arrival: "open", workMode: "play" });
		expect(typeof sys.seed).toBe("number");
		expect(w.p.mapStore.all(made!).size).toBeGreaterThan(3);
		// The write-up, as plain text in the new map's note.
		const note = w.vault.files.get(`world/hexes/${made}/_${made}.md`)!;
		expect(note).toContain("## Arrival");
		expect(note).toMatch(/- Rolled on \[\[.*Mainworlds\]\]: /);
		expect(note).toContain("- Made with Orbits on Space - System, 13×13");
		expect(parseMapNote(note)!.settings.arrival).toBe("open");
		// The sector's note says it too, readably.
		expect(parseMapNote(w.vault.files.get(SECTOR_NOTE)!)!.hexes.get("4_5")?.terrain).toBe(hex.terrain);
	});

	it("is seeded: the same world seed gives the same result and the same place", async () => {
		const run = async () => {
			const w = world({ arrival: "make places", seed: 4242 });
			await sectorWith(w, [["2_3", { terrain: "star system", onArrival: UNCHARTED }], ["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
			const a = await w.service.arrive("drift", 4, 5);
			return { terrain: w.p.mapStore.get("drift", "4_5")?.terrain, cells: [...w.p.mapStore.all(a!)].map(([k, h]) => `${k}=${h.terrain ?? ""}`).join(",") };
		};
		const one = await run();
		const two = await run();
		expect(two).toEqual(one);
		// Another seed, (very likely) another place.
		const w = world({ arrival: "make places", seed: 1 });
		await sectorWith(w, [["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
		const other = await w.service.arrive("drift", 4, 5);
		expect([...w.p.mapStore.all(other!)].map(([k, h]) => `${k}=${h.terrain ?? ""}`).join(",")).not.toBe(one.cells);
	});

	it("a second visit never rolls again", async () => {
		const w = world({ arrival: "make places" });
		await sectorWith(w, [["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
		const made = await w.service.arrive("drift", 4, 5);
		const after = { ...w.p.mapStore.get("drift", "4_5") };
		const mapsBefore = w.maps.length;
		const writes = w.vault.writes.length;
		expect(w.service.canArrive("drift", 4, 5)).toBe(false);
		expect(await w.service.arrive("drift", 4, 5)).toBeNull();
		expect(await w.service.resolveHex("drift", 4, 5, "discover")).toBeNull();
		expect(w.p.mapStore.get("drift", "4_5")).toEqual(after);
		expect(w.maps.length).toBe(mapsBefore);
		expect(w.vault.writes.length).toBe(writes);
		expect(w.p.getMap(made!)!.arrivalRerolls).toBeUndefined();
	});

	it("an uncharted hex can turn out to be nothing: no place, the hex shows empty space", async () => {
		// Find a seed where Uncharted rolls (nothing).
		for (let seed = 1; seed < 400; seed++) {
			const w = world({ arrival: "make places", seed });
			await sectorWith(w, [["1_1", { onArrival: UNCHARTED }]]);
			const r = await w.service.resolveHex("drift", 1, 1, "discover");
			if (r?.kind !== "nothing") continue;
			expect(w.p.mapStore.get("drift", "1_1")).toBeUndefined();
			return;
		}
		throw new Error("no seed rolled (nothing)");
	});

	it("a world not set to make places changes nothing (generator features stay optional)", async () => {
		const w = world();
		await sectorWith(w, [["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
		const writes = w.vault.writes.length;
		expect(w.service.canArrive("drift", 4, 5)).toBe(false);
		expect(await w.service.arrive("drift", 4, 5)).toBeNull();
		expect(w.p.mapStore.get("drift", "4_5")).toEqual({ terrain: "star system", onArrival: MAINWORLDS });
		expect(w.maps).toHaveLength(1);
		expect(w.vault.writes.length).toBe(writes);
		expect(w.p.saves).toBe(0);
	});

	it("never arrives into a locked hex", async () => {
		const w = world({ arrival: "make places" });
		await sectorWith(w, [["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
		w.p.mapStore.set("drift", "4_5", { locked: true });
		expect(w.service.canArrive("drift", 4, 5)).toBe(false);
		expect(await w.service.arrive("drift", 4, 5)).toBeNull();
		expect(w.p.mapStore.get("drift", "4_5")?.onArrival).toBe(MAINWORLDS);
	});
});

describe("reroll until locked (GM4)", () => {
	it("Play may reroll a new place; after Lock only God may", async () => {
		const w = world({ arrival: "make places" });
		await sectorWith(w, [["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
		const made = (await w.service.arrive("drift", 4, 5))!;
		const sys = w.p.getMap(made)!;
		const snapshot = () => [...w.p.mapStore.all(made)].map(([k, h]) => `${k}=${h.terrain ?? ""}`).join(",");
		const first = snapshot();
		const parentTerrain = w.p.mapStore.get("drift", "4_5")?.terrain;

		expect(await w.service.reroll(made)).toBe(true);
		expect(sys.arrivalRerolls).toBe(1);
		expect(snapshot()).not.toBe(first);
		// The landscape is made again; what the hex is stays (it's known now).
		expect(w.p.mapStore.get("drift", "4_5")?.terrain).toBe(parentTerrain);
		expect(sys.gridSize).toEqual({ cols: 13, rows: 13 });
		const note = () => w.vault.files.get(`world/hexes/${made}/_${made}.md`)!;
		expect(note()).toContain("- Rerolled once.");

		await w.service.lock(made);
		expect(sys.arrival).toBe("locked");
		expect(parseMapNote(note())!.settings.arrival).toBe("locked");
		expect(note()).toContain("- Locked: rerolling it now needs God mode.");
		const locked = snapshot();
		expect(await w.service.reroll(made)).toBe(false);
		expect(snapshot()).toBe(locked);

		sys.workMode = "god";
		expect(await w.service.reroll(made)).toBe(true);
		expect(sys.arrivalRerolls).toBe(2);
		expect(sys.arrival).toBe("locked");
	});

	it("rerolling is seeded too: the same reroll count gives the same place", async () => {
		const run = async () => {
			const w = world({ arrival: "make places", seed: 99 });
			await sectorWith(w, [["4_5", { terrain: "star system", onArrival: MAINWORLDS }]]);
			const made = (await w.service.arrive("drift", 4, 5))!;
			await w.service.reroll(made);
			return [...w.p.mapStore.all(made)].map(([k, h]) => `${k}=${h.terrain ?? ""}`).join(",");
		};
		expect(await run()).toBe(await run());
	});
});
