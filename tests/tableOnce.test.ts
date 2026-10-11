/**
 * Phase 5 (SP6, GM8): once-only rows end to end on an in-memory vault.
 * - per world: recorded in the root map's `## Events`, never again anywhere
 *   in that map tree (the Silent Fleet scenario);
 * - per map: recorded in the map's own note, again possible on another map;
 * - deleting a ledger row by hand makes the event possible again;
 * - generation (Star scatter) fires a once-only row at most once, and never
 *   when the ledger holds it;
 * - rerolling a place forgets the events its old landscape fired;
 * - nothing is written when nothing once-only came up (smoke C5).
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { MapStore } from "../src/maps/MapStore";
import { setHexDataSource } from "../src/frontmatter";
import { setModeMapLookup } from "../src/modeGate";
import { ArrivalService } from "../src/arrival/ArrivalService";
import { EventsService } from "../src/arrival/EventsService";
import { OnceTracker, readEvents } from "../src/arrival/eventsLedger";
import { effectiveArrivalMode } from "../src/arrival/arrival";
import { convertWorldTypes } from "../src/space/spaceTables";
import { notesLookup } from "../src/random-tables/resolve";
import { notesTableSource } from "../src/worldgen/tableSources";
import { withOnce } from "../src/worldgen/tableRoles";
import { starScatter } from "../src/worldgen/procedural/starScatter";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { getPreset } from "../src/palettes/presets";
import { slugify } from "../src/utils";
import { MemVault } from "./helpers/memVault";
import { Notice } from "obsidian";
import type { MapData, TerrainColor } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

const SET = convertWorldTypes({ name: "Default space", rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS }, { tablesFolder: "world/tables", shownAs: "star system" });
const MAINWORLDS = SET.files.find((f) => f.path.endsWith("Mainworlds.md"))!.path.replace(/\.md$/, "");

/** Rare finds on arrival: the fleet is almost certain until it's been found. */
const FRONTIER = [
	"---",
	"dice: 0",
	"---",
	"# Frontier",
	"",
	"| Result | Weight | Once |",
	"| --- | ---: | --- |",
	"| [[The Silent Fleet]] | 1000 | per world |",
	"| a sun going out | 1000 | per map |",
	`| [[${MAINWORLDS}]] | 1 |  |`,
].join("\n");
const FLEET = ["---", "dice: 0", "---", "# Fleet", "", "| Result | Weight | Once |", "| --- | ---: | --- |", "| [[The Silent Fleet]] | 1000 | per world |", `| [[${MAINWORLDS}]] | 1 |  |`].join("\n");
const PLAIN = ["---", "dice: 0", "---", "# Plain", "", "| Result | Weight |", "| --- | ---: |", `| [[${MAINWORLDS}]] | 1 |`].join("\n");

const TABLES: Record<string, string> = {
	...Object.fromEntries(SET.files.map((f) => [f.path, f.content])),
	"world/tables/Frontier.md": FRONTIER,
	"world/tables/Plain.md": PLAIN,
	"world/tables/Fleet.md": FLEET,
};

const noteOf = (map: string) => `world/hexes/${map}/_${map}.md`;

/** A galaxy (the root) with two sectors under it, all set to make places. */
function world() {
	const vault = new MemVault();
	const base = { paletteName: "Space - Sector", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, pathChains: [], baseTerrain: "empty space", workMode: "play" };
	const maps: MapData[] = [
		{ ...base, name: "galaxy", seed: 1, arrivalMode: "make places" } as MapData,
		{ ...base, name: "drift", seed: 2, parent: { map: "galaxy", hex: "1_1" }, submapKind: "location" } as MapData,
		{ ...base, name: "rim", seed: 3, parent: { map: "galaxy", hex: "2_2" }, submapKind: "location" } as MapData,
	];
	const lookup = notesLookup(TABLES);
	const p = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "world/hexes", worldFolder: "world", tablesFolder: "world/tables", maps, hexOrientation: "flat", staggerOffset: "odd", mapKinds: ["space"] } as Record<string, unknown> & { maps: MapData[] },
		mapStore: undefined as unknown as MapStore,
		events: undefined as unknown as EventsService,
		saves: 0,
		getMap: (n: string) => maps.find((m) => m.name === n),
		mapLabel: (n: string) => maps.find((m) => m.name === n)?.displayName ?? n,
		parentOf: (n: string) => maps.find((m) => m.name === n)?.parent,
		hexPath: (x: number, y: number, map: string) => `world/hexes/${map}/${x}_${y}.md`,
		arrivalModeFor: (n: string) => effectiveArrivalMode(n, (m) => maps.find((x) => x.name === m)?.arrivalMode, (m) => maps.find((x) => x.name === m)?.parent?.map),
		tableNotes: { lookup: () => lookup },
		worldTypeStore: {
			sourceFor: (_v: string | undefined, palette: readonly (string | { name: string })[]) => {
				const terrains = palette.map((t) => (typeof t === "string" ? t : t.name));
				return { source: notesTableSource(SET.roles, lookup, terrains, "Tables: Default space") };
			},
			list: () => [],
		},
		paths: { resolvedPathChains: () => [] },
		getMapPalette: (n: string) => getPreset(maps.find((m) => m.name === n)?.paletteName ?? "")?.terrains ?? [],
		getPaletteOrPresetTerrains: (n: string) => getPreset(n)?.terrains ?? [],
		getPaletteOrPresetKind: (n: string) => getPreset(n)?.kind,
		getPaletteByName: () => undefined,
		isSpaceMap: () => true,
		childPaletteFor: (n: string) => getPreset(maps.find((m) => m.name === n)?.paletteName ?? "")?.childPalette ?? "Space - System",
		submapDefaultFor: (n: string, t: string | undefined) => (t ? getPreset(maps.find((m) => m.name === n)?.paletteName ?? "")?.submapDefaults?.[t] : undefined),
		getPathTypes: () => [],
		getMapPathTypes: () => [],
		saveData: async () => {},
		refreshHexMap: () => {},
		saveSettings: async () => { p.saves++; await p.mapStore.sync(); },
		async createNewMap(raw: string, cols: number, rows: number, paletteName: string, ox: number, oy: number, stagger: "odd" | "even", _prog: unknown, cells: Map<string, string> | undefined, extra: { baseTerrain?: string; parent?: { map: string; hex: string }; slug?: string; arrivals?: Map<string, string> }) {
			const name = slugify(extra.slug || raw);
			maps.push({ name, displayName: raw, paletteName, gridSize: { cols, rows }, gridOffset: { x: ox, y: oy }, pathChains: [], staggerOffset: stagger, ...(extra.baseTerrain ? { baseTerrain: extra.baseTerrain } : {}), ...(extra.parent ? { parent: extra.parent } : {}) } as MapData);
			p.mapStore.setMany(name, [...(cells ?? [])].filter(([, t]) => t !== extra.baseTerrain).map(([k, t]) => [k, { terrain: t }]));
			await p.mapStore.flush();
			return { name };
		},
		async linkSubmap() {},
	};
	p.mapStore = new MapStore(p as never);
	p.events = new EventsService(p as never);
	setHexDataSource(p.mapStore);
	setModeMapLookup((n) => p.getMap(n));
	const service = new ArrivalService(p as never);
	return { vault, p, maps, service };
}

async function ready(w: ReturnType<typeof world>, cells: Record<string, [string, { terrain?: string; onArrival?: string }][]>) {
	await w.p.mapStore.init();
	for (const [map, c] of Object.entries(cells)) w.p.mapStore.setMany(map, c);
	// Every map gets its note (the root's too, for the per-world ledger).
	for (const m of ["galaxy", "drift", "rim"]) w.p.mapStore.setMany(m, [["7_7", { terrain: "nebula" }]]);
	await w.p.mapStore.flush();
}

const events = (w: ReturnType<typeof world>, map: string) => readEvents(w.vault.files.get(noteOf(map)) ?? "");

describe("once per world (the Silent Fleet)", () => {
	beforeEach(() => { (Notice as unknown as { shown: string[] }).shown = []; });

	it("is found once, written in the root map's Events, and never again anywhere in that world", async () => {
		const w = world();
		await w.p.mapStore.init();
		await ready(w, {
			drift: [["1_1", { onArrival: "Fleet" }], ["2_1", { onArrival: "Fleet" }], ["3_1", { onArrival: "Fleet" }]],
			rim: [["1_1", { onArrival: "Fleet" }]],
		});
		const first = await w.service.resolveHex("drift", 1, 1, "discover");
		const second = await w.service.resolveHex("drift", 2, 1, "discover");
		const third = await w.service.resolveHex("drift", 3, 1, "discover");
		const elsewhere = await w.service.resolveHex("rim", 1, 1, "discover");
		const found = [first, second, third, elsewhere].filter((r) => r?.value === "The Silent Fleet");
		expect(found).toHaveLength(1);
		expect(first?.value).toBe("The Silent Fleet");
		// In the root's note, readably; not in the sector's.
		expect(events(w, "galaxy")).toEqual([{ event: "[[The Silent Fleet]]", where: "[[_drift]] 1, 1", when: expect.any(String), from: "[[Fleet]]" }]);
		expect(events(w, "drift").map((e) => e.event)).not.toContain("[[The Silent Fleet]]");
		expect(w.vault.files.get(noteOf("galaxy"))).toContain("## Events");
	});

	it("deleting the ledger row by hand makes it possible again", async () => {
		const w = world();
		await ready(w, { drift: [["1_1", { onArrival: "Fleet" }], ["2_1", { onArrival: "Fleet" }], ["3_1", { onArrival: "Fleet" }]] });
		expect((await w.service.resolveHex("drift", 1, 1, "discover"))?.value).toBe("The Silent Fleet");
		expect((await w.service.resolveHex("drift", 2, 1, "discover"))?.value).not.toBe("The Silent Fleet");
		const path = noteOf("galaxy");
		w.vault.files.set(path, w.vault.files.get(path)!.split("\n").filter((l) => !l.includes("[[The Silent Fleet]]")).join("\n"));
		expect((await w.service.resolveHex("drift", 3, 1, "discover"))?.value).toBe("The Silent Fleet");
		expect(events(w, "galaxy").filter((e) => e.event === "[[The Silent Fleet]]")).toHaveLength(1);
	});
});

describe("once per map", () => {
	it("is written in the map's own note and can happen again on another map", async () => {
		const w = world();
		await ready(w, {
			drift: [["1_1", { onArrival: "Frontier" }], ["2_1", { onArrival: "Frontier" }], ["3_1", { onArrival: "Frontier" }]],
			rim: [["1_1", { onArrival: "Frontier" }], ["2_1", { onArrival: "Frontier" }]],
		});
		const drift = [];
		for (const x of [1, 2, 3]) drift.push((await w.service.resolveHex("drift", x, 1, "discover"))?.value);
		expect(drift.filter((v) => v === "a sun going out")).toHaveLength(1);
		expect(events(w, "drift").map((e) => e.event)).toEqual(["a sun going out"]);
		const rim = [];
		for (const x of [1, 2]) rim.push((await w.service.resolveHex("rim", x, 1, "discover"))?.value);
		expect(rim).toContain("a sun going out");
		expect(events(w, "rim").map((e) => e.event)).toEqual(["a sun going out"]);
		// Per map never reaches the root's ledger.
		expect(events(w, "galaxy").map((e) => e.event)).toEqual(["[[The Silent Fleet]]"]);
	});
});

describe("nothing once-only, nothing written (smoke C5)", () => {
	it("a roll with no Once row adds no Events section; reading the ledgers writes nothing", async () => {
		const w = world();
		await ready(w, { drift: [["1_1", { onArrival: "Plain" }]] });
		const writes = w.vault.writes.length;
		await w.p.events.ledgersFor({ map: "drift" });
		await w.p.events.ledgersFor({ parent: "drift" });
		expect(w.vault.writes.length).toBe(writes);
		expect(await w.p.events.record("drift", [])).toBe(0);
		expect(w.vault.writes.length).toBe(writes);
		const r = await w.service.resolveHex("drift", 1, 1, "discover");
		expect(r?.events).toEqual([]);
		for (const m of ["galaxy", "drift"]) expect(w.vault.files.get(noteOf(m))).not.toContain("## Events");
	});
});

describe("arriving makes the place and lists what it found", () => {
	it("the place's write-up names the once-only find; the root holds the ledger row", async () => {
		const w = world();
		await ready(w, { drift: [["4_5", { terrain: "star system", onArrival: "Frontier" }]] });
		const made = await w.service.arrive("drift", 4, 5);
		expect(made).toBeTruthy();
		expect(w.vault.files.get(noteOf(made!))).toContain("- Found [[The Silent Fleet]] (once per world; in the Events list).");
		expect(events(w, "galaxy").map((e) => e.event)).toEqual(["[[The Silent Fleet]]"]);
	});
});

describe("rerolling a place", () => {
	it("forgets the events its old landscape fired (Where on that map), and only those", async () => {
		const w = world();
		await ready(w, {});
		const hit = { table: "world/tables/Fleet.md", index: 0, result: "The Silent Fleet", link: true };
		expect(await w.p.events.record("drift", [{ ...hit, scope: "world", hex: "3_3" }, { ...hit, scope: "map", result: "a sun going out", link: false }])).toBe(2);
		expect(await w.p.events.record("rim", [{ ...hit, scope: "world", result: "a comet", link: false }])).toBe(1);
		await w.p.events.forgetMap("drift");
		expect(events(w, "galaxy").map((e) => e.event)).toEqual(["a comet"]);
		expect(events(w, "drift")).toEqual([]);
	});
});

describe("generation (Star scatter's Sector hexes)", () => {
	const fleet: TerrainColor = { name: "silent fleet", type: "anomaly", color: "#222222" };
	const terrains: TerrainColor[] = [...(getPreset("Space - Sector")?.terrains ?? []), fleet];
	const sector = [
		"---", "dice: 0", "rows: terrain", "---", "# Fleet sector", "",
		"| Result | Weight | Once |", "| --- | ---: | --- |",
		"| silent fleet | 1000 | per world |",
		"| garden world | 1 |  |",
	].join("\n");
	const lookup = notesLookup({ "world/tables/Fleet sector.md": sector });
	const source = () => notesTableSource({ "sector-hexes": "Fleet sector" }, lookup, terrains.map((t) => t.name), "Fleet");
	const grid = { cols: 12, rows: 12, offset: { x: 0, y: 0 }, stagger: "odd" as const, orientation: "flat" as const };
	const count = (cells: Map<string, string>) => [...cells.values()].filter((t) => t === "silent fleet").length;

	it("places a once-only row at most once per run, and says where", () => {
		const once = new OnceTracker();
		const r = starScatter(terrains, grid, 42, { density: "dense" }, undefined, withOnce(source(), once));
		expect(count(r.cells)).toBe(1);
		expect(once.fired).toHaveLength(1);
		expect(r.cells.get(once.fired[0].hex!)).toBe("silent fleet");
		expect(once.fired[0]).toMatchObject({ scope: "world", result: "silent fleet", link: false });
	});

	it("never places it when the world's ledger holds it", () => {
		const once = new OnceTracker({ world: [{ event: "silent fleet", where: "[[_drift]] 3, 4", when: "2026-10-11", from: "[[Fleet sector]]" }], map: [] });
		for (const seed of [1, 2, 3, 42]) {
			const r = starScatter(terrains, grid, seed, { density: "dense" }, undefined, withOnce(source(), once));
			expect(count(r.cells)).toBe(0);
		}
		expect(once.fired).toHaveLength(0);
	});
});
