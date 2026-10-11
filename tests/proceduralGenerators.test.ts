import { describe, it } from "node:test";
import expect from "expect";
import {
	SPACE_SECTOR_TERRAINS,
	SPACE_SYSTEM_TERRAINS,
} from "../src/palettes/presets";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { starScatter, starScatterFits, starScatterRoles } from "../src/worldgen/procedural/starScatter";
import { orbits, orbitsFits, orbitRoles, orbitsOptions } from "../src/worldgen/procedural/orbits";
import { planetSurface, planetSurfaceFits, planetRoles } from "../src/worldgen/procedural/planetSurface";
import {
	centerHex,
	distance,
	findByType,
	findTerrain,
	ofType,
	weightedPick,
	type ProcGrid,
} from "../src/worldgen/procedural/common";
import { mulberry32 } from "../packages/hex-wfc/src";
import { ZONE_ROLES, roleOdds } from "../src/worldgen/tableRoles";
import { suggestBaseTerrain } from "../src/worldgen/registry";
import type { TerrainColor } from "../src/types";

const grid = (cols: number, rows: number, orientation: "flat" | "pointy" = "flat"): ProcGrid => ({
	cols, rows, offset: { x: 0, y: 0 }, stagger: "odd", orientation,
});

const count = (cells: Map<string, string>, pred: (t: string) => boolean) =>
	[...cells.values()].filter(pred).length;

describe("procedural helpers", () => {
	it("findTerrain matches names case-insensitively (a tie-break only; categories never pick)", () => {
		const t = [{ name: "Void", color: "#000", category: "space" }, { name: "x", color: "#111", category: "space" }];
		expect(findTerrain(t, ["void"])).toBe("Void");
		expect(findTerrain(t, ["nothing"])).toBeUndefined();
	});

	it("weightedPick honours weights and is deterministic per seed", () => {
		const r = mulberry32(1);
		const picks = Array.from({ length: 2000 }, () => weightedPick(r, ["a", "b"], { a: 9, b: 1 }));
		const a = picks.filter((p) => p === "a").length;
		expect(a).toBeGreaterThan(1600);
		expect(weightedPick(mulberry32(5), [], {})).toBeUndefined();
	});

	it("suggests the first void-typed terrain as the base terrain, whatever its name", () => {
		expect(suggestBaseTerrain(SPACE_SYSTEM_TERRAINS)).toBe("void");
		expect(suggestBaseTerrain(SPACE_SECTOR_TERRAINS)).toBe("empty space");
		expect(suggestBaseTerrain(DEFAULT_TERRAIN_PALETTE)).toBeUndefined();
		expect(suggestBaseTerrain([{ name: "The Black", color: "#000", type: "void" }])).toBe("The Black");
		// Named like a background but not typed as one: not a background.
		expect(suggestBaseTerrain([{ name: "void", color: "#000" }])).toBeUndefined();
	});
});

describe("star scatter", () => {
	it("fits the sector palette but not fantasy palettes", () => {
		expect(starScatterFits(SPACE_SECTOR_TERRAINS)).toBe(true);
		expect(starScatterFits(LIMITED_TERRAIN_PALETTE)).toBe(false);
		expect(starScatterFits(DEFAULT_TERRAIN_PALETTE)).toBe(false);
	});

	it("resolves roles from the sector preset", () => {
		const roles = starScatterRoles(SPACE_SECTOR_TERRAINS)!;
		expect(roles.background).toBe("empty space");
		expect(roles.worlds).toContain("garden world");
		expect(roles.clouds).toEqual(expect.arrayContaining(["nebula", "dust cloud"]));
		expect(roles.clouds).not.toContain("rift");
		expect(roles.features).not.toContain("star system");
	});

	it("fills every hex, deterministically for a seed", () => {
		const g = grid(8, 10);
		const a = starScatter(SPACE_SECTOR_TERRAINS, g, 42);
		const b = starScatter(SPACE_SECTOR_TERRAINS, g, 42);
		expect(a.cells.size).toBe(80);
		expect([...a.cells]).toEqual([...b.cells]);
		const c = starScatter(SPACE_SECTOR_TERRAINS, g, 43);
		expect([...c.cells]).not.toEqual([...a.cells]);
	});

	it("density changes how many systems roll", () => {
		const g = grid(32, 40);
		const names = new Set(SPACE_SECTOR_TERRAINS.filter((t) => t.category !== "space").map((t) => t.name));
		const systems = (density: string) =>
			count(starScatter(SPACE_SECTOR_TERRAINS, g, 7, { density, clouds: "none" }).cells, (t) => names.has(t));
		const sparse = systems("sparse"), standard = systems("standard"), dense = systems("dense");
		expect(sparse).toBeLessThan(standard);
		expect(standard).toBeLessThan(dense);
		// Standard ≈ half of 1280 hexes.
		expect(standard).toBeGreaterThan(1280 * 0.42);
		expect(standard).toBeLessThan(1280 * 0.58);
	});

	it("only uses palette terrains", () => {
		const names = new Set(SPACE_SECTOR_TERRAINS.map((t) => t.name));
		const r = starScatter(SPACE_SECTOR_TERRAINS, grid(16, 16), 3, { clouds: "many" });
		for (const t of r.cells.values()) expect(names.has(t)).toBe(true);
	});

	it("draws jump routes between systems within range, only when a path type is given", () => {
		const g = grid(16, 16);
		const without = starScatter(SPACE_SECTOR_TERRAINS, g, 9, { routes: "2" });
		expect(without.paths).toEqual([]);
		expect(without.warnings.join(" ")).toMatch(/Path type for routes/);

		const r = starScatter(SPACE_SECTOR_TERRAINS, g, 9, { routes: "2" }, "Jump route");
		expect(r.paths.length).toBeGreaterThan(0);
		for (const p of r.paths) {
			expect(p.type).toBe("Jump route");
			const [a, b] = p.hexes.map((k) => k.split("_").map(Number) as [number, number]);
			expect(distance(a, b, g)).toBeLessThanOrEqual(2);
		}
		const none = starScatter(SPACE_SECTOR_TERRAINS, g, 9, { routes: "none" }, "Jump route");
		expect(none.paths).toEqual([]);
	});

	it("works on a minimal custom palette (renamed terrains, typed)", () => {
		const custom = [
			{ name: "Black", color: "#000", type: "void" },
			{ name: "Haven", color: "#0f0", type: "world" },
		];
		expect(starScatterFits(custom)).toBe(true);
		const r = starScatter(custom, grid(6, 6), 1, { density: "dense" });
		expect(new Set(r.cells.values())).toEqual(new Set(["Black", "Haven"]));
	});

	it("an untyped palette fits nothing, even with the shipped names and categories", () => {
		const untypedSector = SPACE_SECTOR_TERRAINS.map(({ type: _t, ...rest }) => rest);
		expect(starScatterFits(untypedSector)).toBe(false);
	});
});

describe("orbits", () => {
	it("fits the system palette but not the sector or fantasy palettes", () => {
		expect(orbitsFits(SPACE_SYSTEM_TERRAINS)).toBe(true);
		expect(orbitsFits(SPACE_SECTOR_TERRAINS)).toBe(false);
		expect(orbitsFits(LIMITED_TERRAIN_PALETTE)).toBe(false);
	});

	it("resolves roles from the system preset", () => {
		const roles = orbitRoles(SPACE_SYSTEM_TERRAINS)!;
		expect(roles.background).toBe("void");
		expect(roles.stars).toHaveLength(5);
		expect(roles.bodies).not.toContain("moon");
		expect(roles.belt).toBe("asteroid belt");
		expect(roles.jumpPoint).toBe("jump point");
	});

	for (const orientation of ["flat", "pointy"] as const) {
		it(`puts a star at the centre and bodies on rings (${orientation})`, () => {
			const g = grid(13, 13, orientation);
			const r = orbits(SPACE_SYSTEM_TERRAINS, g, 11, { bodies: "crowded" });
			expect(r.cells.size).toBe(169);
			const [cx, cy] = centerHex(g);
			const stars = new Set(orbitRoles(SPACE_SYSTEM_TERRAINS)!.stars);
			expect(stars.has(r.cells.get(`${cx}_${cy}`)!)).toBe(true);
			// Exactly one star.
			expect(count(r.cells, (t) => stars.has(t))).toBe(1);
			// Non-belt planets: at most one per ring.
			const planets = new Set(["terrestrial planet", "ocean planet", "desert planet", "ice planet", "rocky planet", "molten planet", "gas giant", "ice giant"]);
			const ringsUsed = new Map<number, number>();
			for (const [k, t] of r.cells) {
				if (!planets.has(t)) continue;
				const d = distance([cx, cy], k.split("_").map(Number) as [number, number], g);
				ringsUsed.set(d, (ringsUsed.get(d) ?? 0) + 1);
			}
			expect(ringsUsed.size).toBeGreaterThan(1);
			for (const n of ringsUsed.values()) expect(n).toBe(1);
		});
	}

	it("honours a chosen star", () => {
		const g = grid(9, 9);
		const r = orbits(SPACE_SYSTEM_TERRAINS, g, 5, { star: "blue giant" });
		const [cx, cy] = centerHex(g);
		expect(r.cells.get(`${cx}_${cy}`)).toBe("blue giant");
	});

	it("is deterministic and only uses palette terrains", () => {
		const g = grid(13, 13);
		const a = orbits(SPACE_SYSTEM_TERRAINS, g, 77);
		expect([...a.cells]).toEqual([...orbits(SPACE_SYSTEM_TERRAINS, g, 77).cells]);
		const names = new Set(SPACE_SYSTEM_TERRAINS.map((t) => t.name));
		for (const t of a.cells.values()) expect(names.has(t)).toBe(true);
	});

	it("always gives a system with a planet at least one moon, beside a planet (round 7)", () => {
		const roles = orbitRoles(SPACE_SYSTEM_TERRAINS)!;
		const planets = new Set(roles.bodies.filter((b) => !roles.belts.includes(b)));
		let systems = 0;
		for (const size of [7, 9, 13]) {
			const g = grid(size, size);
			for (const bodies of ["few", "normal", "crowded"]) {
				for (let seed = 1; seed <= 150; seed++) {
					const r = orbits(SPACE_SYSTEM_TERRAINS, g, seed, { bodies });
					const planetHexes = [...r.cells].filter(([, t]) => planets.has(t)).map(([k]) => k.split("_").map(Number) as [number, number]);
					if (planetHexes.length === 0) continue;
					systems++;
					const moons = [...r.cells].filter(([, t]) => t === roles.moon).map(([k]) => k.split("_").map(Number) as [number, number]);
					expect({ size, bodies, seed, moons: moons.length >= 1 }).toEqual({ size, bodies, seed, moons: true });
					expect(moons.some((m) => planetHexes.some((p) => distance(m, p, g) === 1))).toBe(true);
				}
			}
		}
		expect(systems).toBeGreaterThan(1000);
	});

	it("draws each occupied orbit as a closed ring of adjacent hexes when given a path type", () => {
		const g = grid(13, 13);
		expect(orbits(SPACE_SYSTEM_TERRAINS, g, 21).paths).toEqual([]);
		const r = orbits(SPACE_SYSTEM_TERRAINS, g, 21, { bodies: "crowded" }, "Orbit");
		expect(r.paths.length).toBeGreaterThan(1);
		const [cx, cy] = centerHex(g);
		for (const p of r.paths) {
			expect(p.type).toBe("Orbit");
			expect(p.hexes[0]).toBe(p.hexes[p.hexes.length - 1]);
			const pts = p.hexes.map((k) => k.split("_").map(Number) as [number, number]);
			const d = distance([cx, cy], pts[0], g);
			expect(pts.length - 1).toBe(6 * d); // a full ring has 6d hexes
			for (let i = 1; i < pts.length; i++) {
				expect(distance(pts[i - 1], pts[i], g)).toBe(1);
				expect(distance([cx, cy], pts[i], g)).toBe(d);
			}
		}
	});

	it("places moons as the moon terrain, each next to a planet (G9)", () => {
		const g = grid(13, 13);
		const roles = orbitRoles(SPACE_SYSTEM_TERRAINS)!;
		expect(roles.moon).toBe("moon");
		const planets = new Set(roles.bodies.filter((b) => !roles.belts.includes(b)));
		let moons = 0;
		let rockyMoons = 0;
		for (let seed = 1; seed <= 40; seed++) {
			const r = orbits(SPACE_SYSTEM_TERRAINS, g, seed, { bodies: "crowded" });
			for (const [k, t] of r.cells) {
				if (t !== "moon") continue;
				moons++;
				const h = k.split("_").map(Number) as [number, number];
				const beside = [...r.cells].filter(([k2, t2]) => planets.has(t2)
					&& distance(h, k2.split("_").map(Number) as [number, number], g) === 1).map(([, t2]) => t2);
				expect(beside.length).toBeGreaterThan(0);
				if (beside.every((b) => !roles.giants.includes(b))) rockyMoons++;
			}
		}
		expect(moons).toBeGreaterThan(20);
		// Not just giants: rocky worlds get moons too.
		expect(rockyMoons).toBeGreaterThan(0);
	});

	it("warns on maps too small for orbits", () => {
		const r = orbits(SPACE_SYSTEM_TERRAINS, grid(3, 3), 1);
		expect(r.warnings.join(" ")).toMatch(/too small/);
	});
});

describe("terrain types", () => {
	const t = (name: string, type?: string, category?: string): TerrainColor => ({ name, color: "#000", type, category });

	describe("helpers", () => {
		const pal = [t("Forest heavy", "forest"), t("forest", "forest"), t("Pinewood", "forest"), t("ocean", "desert"), t("sea")];

		it("ofType lists terrains of the given types in palette order; unknown types count as untyped", () => {
			expect(ofType(pal, ["forest"])).toEqual(["Forest heavy", "forest", "Pinewood"]);
			expect(ofType([t("x", "bogus")], ["bogus"])).toEqual([]);
		});

		it("findByType prefers name hints within the type, then palette order, then later types", () => {
			expect(findByType(pal, ["forest"], ["forest"])).toBe("forest");
			expect(findByType(pal, ["forest"])).toBe("Forest heavy");
			expect(findByType(pal, ["jungle", "forest"], ["jungle"])).toBe("Forest heavy");
			// The name hint only counts inside the type.
			expect(findByType(pal, ["water"], ["ocean"])).toBeUndefined();
		});

		it("an untyped terrain fills no role, even named like one", () => {
			expect(findByType(pal, ["water"], ["ocean", "sea"])).toBeUndefined();
			expect(findByType([t("ocean", "desert")], ["water"], ["ocean"])).toBeUndefined();
		});
	});

	describe("star scatter", () => {
		const custom = [
			t("Abyssal Drift", "void"),
			t("Hearthworld", "world"),
			t("Cinder", "world"),
			t("Big Blue", "gas-giant"),
			t("Shards", "asteroids"),
			t("Halley", "asteroids"),
			t("Veil", "nebula"),
			t("Waystation", "station"),
			t("The Maw", "anomaly"),
		];

		it("resolves roles from types on a custom-named palette", () => {
			const r = starScatterRoles(custom)!;
			expect(r.background).toBe("Abyssal Drift");
			expect(r.worlds).toEqual(["Hearthworld", "Cinder", "Big Blue", "Shards", "Halley"]);
			expect(r.clouds).toEqual(["Veil"]);
			expect(r.features).toEqual(["Waystation", "The Maw"]);
		});

		it("generates only palette terrains, deterministically", () => {
			const a = starScatter(custom, grid(16, 16), 4, { clouds: "many" });
			expect([...a.cells]).toEqual([...starScatter(custom, grid(16, 16), 4, { clouds: "many" }).cells]);
			const names = new Set(custom.map((x) => x.name));
			for (const v of a.cells.values()) expect(names.has(v)).toBe(true);
			expect(count(a.cells, (v) => v === "Hearthworld")).toBeGreaterThan(0);
		});

		it("a void-typed terrain named like a world is background, not a world", () => {
			const r = starScatterRoles([t("garden world", "void"), t("Eden", "world")])!;
			expect(r.background).toBe("garden world");
			expect(r.worlds).toEqual(["Eden"]);
		});
	});

	describe("orbits", () => {
		const custom = [
			t("Abyssal Drift", "void"),
			t("Edge", "void"),
			t("Embers", "star"),
			t("Hearthworld", "world"),
			t("Cinderball", "world"),
			t("Frostbite", "world"),
			t("Big Blue", "gas-giant"),
			t("Rubble ring", "asteroids"),
			t("Luna", "world"),
			t("Pale moon", "moon"),
			t("Iceball comet", "comet"),
			t("Highport", "starport"),
			t("Gateway", "jump-point"),
			t("Outpost", "station"),
		];

		it("resolves every role from types alone", () => {
			const r = orbitRoles(custom)!;
			expect(r.background).toBe("Abyssal Drift");
			expect(r.stars).toEqual(["Embers"]);
			expect(r.bodies).toEqual(["Hearthworld", "Cinderball", "Frostbite", "Big Blue", "Rubble ring", "Luna"]);
			expect(r.moon).toBe("Pale moon");
			expect(r.comet).toBe("Iceball comet");
			expect(r.belt).toBe("Rubble ring");
			expect(r.giants).toEqual(["Big Blue"]);
			expect(r.starport).toBe("Highport");
			expect(r.jumpPoint).toBe("Gateway");
			expect(r.station).toBe("Outpost");
		});

		it("no name rules: without a table every body has the same odds in every zone, and the warnings say so", () => {
			const roles = orbitRoles(custom)!;
			for (const zone of ["inner", "habitable", "outer"] as const) {
				const o = roleOdds(undefined, ZONE_ROLES[zone], { zone }, roles.bodies);
				expect(o.odds.map((x) => x.odds)).toEqual(roles.bodies.map(() => 1 / roles.bodies.length));
				expect(o.from).toBe("equal odds");
			}
			expect(orbits(custom, grid(13, 13), 1, {}).warnings.join(" ")).toMatch(/no table, so equal odds/);
		});

		it("puts the typed star at the centre, sweeps asteroid-type belts, uses only palette terrains", () => {
			const g = grid(13, 13);
			const names = new Set(custom.map((x) => x.name));
			let belts = 0;
			for (let seed = 1; seed <= 20; seed++) {
				const r = orbits(custom, g, seed, { bodies: "crowded" });
				const [cx, cy] = centerHex(g);
				expect(r.cells.get(`${cx}_${cy}`)).toBe("Embers");
				for (const v of r.cells.values()) expect(names.has(v)).toBe(true);
				const n = count(r.cells, (v) => v === "Rubble ring");
				if (n > 0) { expect(n).toBeGreaterThan(1); belts++; }
			}
			expect(belts).toBeGreaterThan(0);
		});

		it("does not take a sector's star-system marker for a star", () => {
			expect(orbitRoles([t("void", "void"), t("star system", "star-system"), t("Eden", "world")])).toBeUndefined();
		});

		it("names play no part: a moon named like a planet is a moon, a planet named Moonbase is a planet", () => {
			const r = orbitRoles([t("Edge", "void"), t("Sol", "star"), t("Moonbase", "world"), t("Terra Minor", "moon")])!;
			expect(r.bodies).toEqual(["Moonbase"]);
			expect(r.moon).toBe("Terra Minor");
		});

		it("the Star option lists the palette's own stars", () => {
			const star = orbitsOptions(custom).find((o) => o.key === "star")!;
			expect(star.choices).toEqual([{ value: "random", label: "Random" }, { value: "embers", label: "Embers" }]);
			const shipped = orbitsOptions(SPACE_SYSTEM_TERRAINS).find((o) => o.key === "star")!;
			expect(shipped.choices.map((c) => c.value)).toEqual(["random", "yellow star", "red dwarf", "blue giant", "white dwarf", "brown dwarf"]);
			const r = orbits(custom, grid(13, 13), 3, { star: "embers" });
			expect([...r.cells.values()]).toContain("Embers");
		});

		it("the shipped System palette, renamed, fills every role the same way", () => {
			const renamed = SPACE_SYSTEM_TERRAINS.map((x, i) => ({ ...x, name: `Body ${i}` }));
			const rename = (n: string | undefined) => (n === undefined ? undefined : renamed[SPACE_SYSTEM_TERRAINS.findIndex((x) => x.name === n)].name);
			const a = orbitRoles(SPACE_SYSTEM_TERRAINS)!;
			const b = orbitRoles(renamed)!;
			for (const k of ["background", "moon", "comet", "station", "starport", "jumpPoint", "jumpLimit", "belt"] as const) expect(b[k]).toBe(rename(a[k]));
			for (const k of ["stars", "bodies", "belts", "giants"] as const) expect(b[k]).toEqual(a[k].map(rename));
			for (let seed = 1; seed <= 5; seed++) {
				const cells = orbits(renamed, grid(13, 13), seed, {}).cells;
				const [cx, cy] = centerHex(grid(13, 13));
				expect(b.stars).toContain(cells.get(`${cx}_${cy}`));
			}
		});
	});

	describe("planet surface", () => {
		const g = { cols: 20, rows: 14, offset: { x: 0, y: 0 }, stagger: "odd" as const, orientation: "flat" as const };
		const custom = [
			t("Kelp sea", "water"),
			t("Brine deep", "deep-water"),
			t("Tidepools", "shallows"),
			t("Strand", "coast"),
			t("Steppe-ish", "grassland"),
			t("Pinewood", "forest"),
			t("Fernwood", "forest"),
			t("Old Fernwood dense", "forest"),
			t("Crags", "mountains"),
			t("Knolls", "hills"),
			t("Glare", "snow"),
			t("Saltpan", "desert"),
		];

		it("resolves every role by type on a custom-named palette", () => {
			const r = planetRoles(custom)!;
			expect(r).toMatchObject({
				sea: "Kelp sea", deep: "Brine deep", shallows: "Tidepools", beach: "Strand",
				plains: "Steppe-ish", mountain: "Crags", hills: "Knolls", snow: "Glare", desert: "Saltpan",
			});
			expect(r.forest).toBe("Pinewood");
			expect(r.variants.forest.conifer).toEqual(["Pinewood", undefined]);
			expect(r.variants.forest.broadleaf).toEqual(["Fernwood", "Old Fernwood dense"]);
		});

		it("generates from types alone, deterministically, with the forest variants", () => {
			const a = planetSurface(custom, g, 5, { water: "30" });
			expect([...a.cells]).toEqual([...planetSurface(custom, g, 5, { water: "30" }).cells]);
			const names = new Set(custom.map((x) => x.name));
			for (const v of a.cells.values()) expect(names.has(v)).toBe(true);
			const used = new Set<string>();
			for (let seed = 1; seed <= 10; seed++) for (const v of planetSurface(custom, g, seed, { water: "30" }).cells.values()) used.add(v);
			for (const n of ["Kelp sea", "Steppe-ish", "Pinewood", "Fernwood", "Old Fernwood dense"]) expect(used.has(n)).toBe(true);
		});

		it("type wins over a misleading name: an \"ocean\" typed desert is never sea", () => {
			const pal = [t("ocean", "desert"), t("Brine", "water"), t("grass", "grassland")];
			expect(planetRoles(pal)!.sea).toBe("Brine");
			expect(planetRoles(pal)!.desert).toBe("ocean");
			expect(planetSurfaceFits([t("ocean", "desert"), t("grass", "grassland")])).toBe(false);
		});

		it("untyped palettes fit nothing, even with the shipped names and categories", () => {
			const pal = [t("ocean"), t("Lowland", undefined, "lowlands"), t("forest"), t("hills")];
			expect(planetRoles(pal)).toBeUndefined();
			expect(planetSurfaceFits(DEFAULT_TERRAIN_PALETTE.map(({ type: _t, ...rest }) => rest))).toBe(false);
		});

		it("the shipped Expanded palette, renamed, fills the same roles", () => {
			const renamed = DEFAULT_TERRAIN_PALETTE.map((x, i) => ({ ...x, name: `T${i}` }));
			const a = planetRoles(DEFAULT_TERRAIN_PALETTE)!;
			const b = planetRoles(renamed)!;
			const idx = (r: typeof a) => (n: string | undefined) => n === undefined ? -1 : (r === a ? DEFAULT_TERRAIN_PALETTE : renamed).findIndex((x) => x.name === n);
			// Same type for every base role (which one of several same-typed
			// terrains is a tie-break; see findByType).
			for (const k of ["sea", "plains", "deep", "shallows", "beach", "forest", "jungle", "swamp", "hills", "mountain", "peak", "snow", "desert", "badlands", "volcano"] as const) {
				const ia = idx(a)(a[k]), ib = idx(b)(b[k]);
				expect(ib >= 0 ? renamed[ib].type : undefined).toBe(ia >= 0 ? DEFAULT_TERRAIN_PALETTE[ia].type : undefined);
			}
		});

		it("spreads the Expanded palette's woodland variants by climate", () => {
			const used = new Set<string>();
			for (let seed = 1; seed <= 10; seed++) {
				for (const v of planetSurface(DEFAULT_TERRAIN_PALETTE, g, seed, { water: "30", climate: "temperate" }).cells.values()) used.add(v);
			}
			for (const n of ["forest", "forest heavy", "evergreen", "mixed forest"]) expect(used.has(n)).toBe(true);
			// The base hills role is the bare one, not a wooded variant.
			expect(planetRoles(DEFAULT_TERRAIN_PALETTE)!.hills).toBe("hills");
			expect(planetRoles(DEFAULT_TERRAIN_PALETTE)!.variants.hills.conifer).toBe("evergreen hills");
		});
	});

	describe("untyped space palettes", () => {
		it("orbits needs types: shipped names and categories alone don't fit", () => {
			const pal = [
				t("void", undefined, "space"), t("Sol", undefined, "stars"),
				t("Terra", undefined, "bodies"), t("moon", undefined, "bodies"), t("jump point"),
			];
			expect(orbitRoles(pal)).toBeUndefined();
			expect(orbitsFits(SPACE_SYSTEM_TERRAINS.map(({ type: _t, ...rest }) => rest))).toBe(false);
		});

		it("with everything deleted, no space generator fits and nothing throws", () => {
			expect(orbitRoles([])).toBeUndefined();
			expect(starScatterRoles([])).toBeUndefined();
			expect(planetRoles([])).toBeUndefined();
			expect(orbits([], grid(5, 5), 1).cells.size).toBe(0);
			expect(starScatter([], grid(5, 5), 1).cells.size).toBe(0);
			expect(planetSurface([], grid(5, 5), 1).cells.size).toBe(0);
			expect(suggestBaseTerrain([])).toBeUndefined();
		});
	});
});

describe("Star scatter offering (owner decision 2026-10-09: sectors only)", () => {
	it("is offered on the sector palette but not on the system palette", async () => {
		const { starScatterOffered } = await import("../src/worldgen/procedural/starScatter");
		const { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } = await import("../src/palettes/presets");
		expect(starScatterOffered(SPACE_SECTOR_TERRAINS)).toBe(true);
		expect(starScatterOffered(SPACE_SYSTEM_TERRAINS)).toBe(false);
	});
});
