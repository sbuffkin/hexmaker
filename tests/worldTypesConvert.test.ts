/**
 * Phase 3 (T1, T2, T4): a World types note converts into ordinary random
 * table notes under {tables}/space/<name>/ that give the same odds, the
 * old note is kept (and marked, linking out), and converting is
 * idempotent.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/modules/space/presets";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { buildWorldTypes, parseWorldTypes, type WorldTypeTable } from "../src/space/worldTypes";
import { worldTypesSource } from "../src/space/worldTypesSource";
import { convertWorldTypes, isConverted, markConverted, readRoleTables, tableNoteMarkdown, wholeScale } from "../src/space/spaceTables";
import { notesLookup, resolveOdds } from "../src/random-tables/resolve";
import { parseRandomTableWithReport } from "../src/random-tables/randomTable";
import { ENGINE_ROLES, roleOdds, rollRole, type RoleId } from "../src/worldgen/tableRoles";
import { notesTableSource } from "../src/worldgen/tableSources";
import { starScatter, starScatterRoles } from "../src/space/starScatter";
import { mulberry32 } from "../packages/hex-wfc/src/rng";
import type { OrbitZone } from "../src/space/worldTypes";

const DEFAULT_SPACE: WorldTypeTable = { name: "Default space", rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS };
const names = (ts: { name: string }[]) => ts.map((t) => t.name);

function converted(table = DEFAULT_SPACE, opts: { shownAs?: string; unreadable?: string[] } = {}) {
	const set = convertWorldTypes(table, { tablesFolder: "world/tables", shownAs: opts.shownAs ?? "star system", unreadable: opts.unreadable });
	const notes = Object.fromEntries(set.files.map((f) => [f.path, f.content]));
	return { set, notes, lookup: notesLookup(notes) };
}

const sorted = (o: { terrain: string; odds: number }[]) => [...o].sort((a, b) => a.terrain.localeCompare(b.terrain));
function expectSameOdds(a: { terrain: string; odds: number }[], b: { terrain: string; odds: number }[]) {
	const A = sorted(a), B = sorted(b);
	expect(A.map((x) => x.terrain)).toEqual(B.map((x) => x.terrain));
	A.forEach((x, i) => expect(Math.abs(x.odds - B[i].odds)).toBeLessThan(1e-9));
}

describe("converting a World types note to space tables", () => {
	it("writes a tidy tree under {tables}/space/<name>/ (T1)", () => {
		const { set } = converted();
		expect(set.folder).toBe("world/tables/space/Default space");
		expect(set.files.map((f) => f.path.slice(set.folder.length + 1)).sort()).toEqual([
			"Sector/Charted sector.md", "Sector/Mainworlds.md", "Sector/Uncharted.md", "Sector/Unexplored sector.md",
			"System/Habitable orbits.md", "System/Inner orbits.md", "System/Outer orbits.md", "System/Stars.md",
		]);
		expect(Object.keys(set.roles).sort()).toEqual(ENGINE_ROLES.map((r) => r.id).sort());
	});

	it("every table reads cleanly, with rows: terrain and roll ranges where the die fits", () => {
		const { set } = converted();
		for (const f of set.files) {
			const r = parseRandomTableWithReport(f.content);
			expect({ path: f.path, issues: r.issues.map((i) => i.code) }).toEqual({ path: f.path, issues: [] });
			expect(r.table.rows).toBe("terrain");
			expect(r.table.entries.length).toBeGreaterThan(0);
		}
		// Weights made whole: 1/50, 1/75, 1/150 of a hex and the rest → 3, 2, 1, 144.
		const charted = parseRandomTableWithReport(set.files.find((f) => f.path.endsWith("Charted sector.md"))!.content).table;
		expect(charted.entries.map((e) => e.weight)).toEqual([3, 2, 1, 144]);
		expect(charted.entries[3].isLink).toBe(true);
	});

	it("gives the same odds as the note did, for every role (T4)", () => {
		const { set, lookup } = converted();
		const sector = notesTableSource(set.roles, lookup, names(SPACE_SECTOR_TERRAINS), "t");
		const system = notesTableSource(set.roles, lookup, names(SPACE_SYSTEM_TERRAINS), "t");
		const oldSector = worldTypesSource(DEFAULT_SPACE, SPACE_SECTOR_TERRAINS);
		const oldSystem = worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS);
		const worlds = starScatterRoles(SPACE_SECTOR_TERRAINS)!.worlds;
		expectSameOdds(roleOdds(sector, "sector-hexes", {}, worlds).odds, roleOdds(oldSector, "sector-hexes", {}, worlds).odds);
		const stars = SPACE_SYSTEM_TERRAINS.filter((t) => t.type === "star").map((t) => t.name);
		expectSameOdds(roleOdds(system, "star", {}, stars).odds, roleOdds(oldSystem, "star", {}, stars).odds);
		const bodies = SPACE_SYSTEM_TERRAINS.filter((t) => ["world", "gas-giant", "asteroids"].includes(t.type ?? "")).map((t) => t.name);
		const zoneRole: Record<OrbitZone, RoleId> = { inner: "inner-orbits", habitable: "habitable-orbits", outer: "outer-orbits" };
		for (const zone of ["inner", "habitable", "outer"] as OrbitZone[]) {
			for (const star of ["red dwarf", "yellow star"]) {
				expectSameOdds(roleOdds(system, zoneRole[zone], { zone, star }, bodies).odds, roleOdds(oldSystem, zoneRole[zone], { zone, star }, bodies).odds);
			}
		}
	});

	it("keeps each row's setup (Mainworld, Size, Generator…) as attributes", () => {
		const { set, lookup } = converted();
		const src = notesTableSource(set.roles, lookup, names(SPACE_SECTOR_TERRAINS), "t");
		expect(src.rowAttrs("sector-hexes", "ocean world")).toMatchObject({ Mainworld: "ocean planet", Size: "13×13", Generator: "procedural:orbits", Palette: "Space - System", Base: "void" });
		const sys = notesTableSource(set.roles, lookup, names(SPACE_SYSTEM_TERRAINS), "t");
		expect(sys.rowAttrs("habitable-orbits", "ocean planet")).toMatchObject({ Size: "20×14", Generator: "procedural:planet-surface", Options: "water=85, climate=lush, relief=normal" });
	});

	it("Unexplored sector: half the systems wait for arrival, shown as the star-system terrain or not at all (T5)", () => {
		const { set, lookup } = converted();
		const roles = { ...set.roles, "sector-hexes": set.files.find((f) => f.path.endsWith("Unexplored sector.md"))!.path };
		const src = notesTableSource(roles, lookup, names(SPACE_SECTOR_TERRAINS), "t");
		const worlds = starScatterRoles(SPACE_SECTOR_TERRAINS)!.worlds;
		const counts = { now: 0, known: 0, uncharted: 0 };
		const rand = mulberry32(7);
		for (let i = 0; i < 4000; i++) {
			const p = rollRole(src, "sector-hexes", { rand, deferArrival: true }, worlds)!;
			if (!p.arrival) counts.now++;
			else if (p.terrain === "star system") { counts.known++; expect(p.arrival).toMatch(/Mainworlds$/); }
			else { counts.uncharted++; expect(p.terrain).toBe(""); expect(p.arrival).toMatch(/Uncharted$/); }
		}
		expect(counts.known / 4000).toBeGreaterThan(0.2);
		expect(counts.uncharted / 4000).toBeGreaterThan(0.2);
		expect(counts.now / 4000).toBeGreaterThan(0.45);
		// Rolled through (no deferring), the same table gives only real terrains or nothing.
		const through = resolveOdds(roles["sector-hexes"], lookup, { terrains: names(SPACE_SECTOR_TERRAINS), onlyTerrains: true });
		expect(through.every((o) => o.kind === "terrain" || o.kind === "nothing")).toBe(true);
	});

	it("Star scatter leaves On arrival hexes for the unknown ones", () => {
		const { set, lookup } = converted();
		const roles = { ...set.roles, "sector-hexes": set.files.find((f) => f.path.endsWith("Unexplored sector.md"))!.path };
		const src = notesTableSource(roles, lookup, names(SPACE_SECTOR_TERRAINS), "t");
		const grid = { cols: 12, rows: 12, offset: { x: 0, y: 0 }, stagger: "odd" as const, orientation: "flat" as const };
		const a = starScatter(SPACE_SECTOR_TERRAINS, grid, 3, { density: "dense", clouds: "none", routes: "none" }, undefined, src);
		const b = starScatter(SPACE_SECTOR_TERRAINS, grid, 3, { density: "dense", clouds: "none", routes: "none" }, undefined, src);
		expect(a.arrivals?.size).toBeGreaterThan(0);
		expect([...a.arrivals!]).toEqual([...b.arrivals!]);
		for (const [k, table] of a.arrivals!) {
			expect(table).toMatch(/(Mainworlds|Uncharted)$/);
			// Shown as "star system", or the background when uncharted.
			expect(["star system", "empty space"]).toContain(a.cells.get(k));
		}
		// The charted table leaves none.
		const charted = notesTableSource(set.roles, lookup, names(SPACE_SECTOR_TERRAINS), "t");
		expect(starScatter(SPACE_SECTOR_TERRAINS, grid, 3, { density: "dense", clouds: "none", routes: "none" }, undefined, charted).arrivals).toBeUndefined();
	});

	it("copies rows that couldn't be read into the Mainworlds note", () => {
		const { set } = converted(DEFAULT_SPACE, { unreadable: ["| bad world | lots |"] });
		expect(set.files.find((f) => f.path.endsWith("Mainworlds.md"))!.content).toContain("| bad world | lots |");
	});

	it("never special-cases names: a custom table converts the same way", () => {
		const custom: WorldTypeTable = { name: "Drift", rows: [{ world: "glass world", weight: 2, map: "sector" }, { world: "rust world", weight: 1 }], features: [{ feature: "beacon", chance: 0.1 }] };
		const { set, lookup } = converted(custom, { shownAs: "" });
		const src = notesTableSource(set.roles, lookup, ["void", "glass world", "rust world", "beacon"], "t");
		const odds = roleOdds(src, "sector-hexes", {}, ["glass world", "rust world"]).odds;
		expectSameOdds(odds, [{ terrain: "beacon", odds: 0.1 }, { terrain: "glass world", odds: 0.6 }, { terrain: "rust world", odds: 0.3 }]);
		// No Stars table in the note: no Stars table written, and the role stays unset.
		expect(set.roles.star).toBeUndefined();
		expect(set.files.find((f) => f.path.endsWith("Unexplored sector.md"))!.content).not.toContain("Shown as");
	});
});

describe("the World types note after converting (T2)", () => {
	const note = buildWorldTypes("Default space", DEFAULT_WORLD_TYPE_ROWS, DEFAULT_WORLD_TYPE_EXTRAS);

	it("links out to the tables, embeds them, and is marked converted", () => {
		const { set } = converted();
		const out = markConverted(note, set);
		expect(isConverted(note)).toBe(false);
		expect(isConverted(out)).toBe(true);
		expect(out).toContain('converted-to: "world/tables/space/Default space"');
		expect(out).toContain("## Tables");
		expect(out).toContain("![[world/tables/space/Default space/Sector/Charted sector]]");
		const roles = readRoleTables(out);
		expect(roles["sector-hexes"]).toBe("world/tables/space/Default space/Sector/Charted sector");
		expect(roles["outer-orbits"]).toBe("world/tables/space/Default space/System/Outer orbits");
	});

	it("keeps every old row readable, as before", () => {
		const { set } = converted();
		const before = parseWorldTypes(note);
		const after = parseWorldTypes(markConverted(note, set));
		expect(after.rows).toEqual(before.rows);
		expect(after.stars).toEqual(before.stars);
		expect(after.features).toEqual(before.features);
		expect(after.problems).toEqual(before.problems);
	});

	it("is idempotent: converting again changes nothing", () => {
		const { set } = converted();
		const once = markConverted(note, set);
		expect(markConverted(once, set)).toBe(once);
		// CRLF notes stay CRLF.
		const crlf = markConverted(note.replace(/\n/g, "\r\n"), set);
		expect(crlf.includes("\n") && !/[^\r]\n/.test(crlf)).toBe(true);
	});

	it("a hand edit of the role list is what counts", () => {
		const { set } = converted();
		const out = markConverted(note, set).replace("Sector/Charted sector\\|Charted sector]]", "Sector/Unexplored sector\\|Unexplored sector]]");
		expect(readRoleTables(out)["sector-hexes"]).toBe("world/tables/space/Default space/Sector/Unexplored sector");
	});
});

describe("table notes as written", () => {
	it("scales weights to whole numbers only when that keeps the odds exact", () => {
		expect(wholeScale([1 / 50, 1 / 75, 1 / 150, 144 / 150])).toBe(150);
		expect(wholeScale([3.5, 1.5, 2])).toBe(2);
		expect(wholeScale([Math.PI])).toBe(1);
	});

	it("uses a die only when the weights add up to one", () => {
		const t = tableNoteMarkdown({ title: "T", description: "d", columns: [], entries: [{ result: "a", weight: 3 }, { result: "b", weight: 1 }] });
		expect(t).toContain("dice: 4");
		expect(t).toContain("| d4 | Result | Weight |");
		expect(t).toContain("| 1–3 | a | 3 |");
		const u = tableNoteMarkdown({ title: "T", description: "d", columns: [], entries: [{ result: "a", weight: 3 }, { result: "b", weight: 2 }] });
		expect(u).toContain("dice: 0");
		expect(u).toContain("| Result | Weight |");
	});
});
