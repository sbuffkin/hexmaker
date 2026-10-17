import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MODULES } from "../src/modules";
import { MODULE_RUNTIMES } from "../src/modules/runtime";
import { DEFAULT_SETTINGS } from "../src/constants";
// Plain ESM helper shared with esbuild.config.mjs (types inferred from its JS).
import {
	flaggedSlices,
	offClosure,
	readSlices,
	releasedSlices,
	releaseReadme,
	releaseReadmePath,
	resolveSlices,
	sliceBlockText,
	sliceDefines,
	sliceFlags,
	sliceModules,
	slicesFromEnv,
	sliceSpecArg,
	stripSliceMarkers,
} from "../dev/release/slices.mjs";
import { builtSlices } from "../src/modules";
import { everyModule, FLAGGED_SLICES, sliceOn } from "./helpers/slices";
import { readSource } from "./helpers/source";

/** P6: one module is one release slice (release-slices.json); a slice built off leaves no trace. */

type Slice = { define: string | null; modules: string[]; released: boolean; requires: string[]; docs?: boolean };
const slices = readSlices() as Record<string, Slice>;
const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const all = () => flaggedSlices();
/** The slices whose text README.md and help.md mark (`docs: true`). */
const DOCUMENTED = Object.keys(slices).filter((id) => slices[id].define && slices[id].docs);
/** The own strings of a slice's modules, whether it's built on in this run or not (npm run test:slices). */
const owned = (slice: string) => everyModule().filter((m) => m.slice === slice).flatMap((m) => [...(m.owns.strings ?? [])]);

describe("release-slices.json and the modules agree", () => {
	it("every module names a slice that lists it, and every listed module of a slice built on exists", () => {
		for (const m of MODULES) {
			expect(Object.keys(slices)).toContain(m.slice);
			expect(slices[m.slice].modules).toContain(m.id);
		}
		const ids = MODULES.map((m) => m.id);
		for (const [id, s] of Object.entries(slices)) for (const mod of s.modules) expect({ id, mod, built: ids.includes(mod) }).toEqual({ id, mod, built: sliceOn(id) });
		expect(MODULE_RUNTIMES.map((r) => r.id)).toEqual(ids);
	});

	it("every slice says what it requires: flagged slices only, never itself; the released set needs nothing unreleased", () => {
		const released = new Set(releasedSlices());
		for (const [id, s] of Object.entries(slices)) {
			expect({ id, requires: Array.isArray(s.requires) }).toEqual({ id, requires: true });
			for (const need of s.requires) {
				expect({ id, need, known: !!slices[need]?.define }).toEqual({ id, need, known: true });
				expect(need).not.toBe(id);
			}
			if (released.has(id)) for (const need of s.requires) expect({ id, need, released: released.has(need) }).toEqual({ id, need, released: true });
		}
		// So the release build always resolves.
		expect(() => resolveSlices({ spec: "released" })).not.toThrow();
	});

	it("the foundation slice is always built (no flag); the others have one each, read by the module lists", () => {
		expect(slices.foundation.define).toBeNull();
		const index = readSource("src", "modules", "index.ts");
		const runtime = readSource("src", "modules", "runtime.ts");
		const decl = readSource("src", "slices.d.ts");
		for (const [id, s] of Object.entries(slices)) {
			if (!s.define) continue;
			expect({ id, decl: decl.includes(`declare const ${s.define}: boolean;`) }).toEqual({ id, decl: true });
			for (const src of [index, runtime]) expect(src).toMatch(new RegExp(`if \\(${s.define}\\) compiled\\.push\\(`));
		}
	});

	it("tests run with the slices the switch says (every one by default; npm run test:slices varies it)", () => {
		const want = slicesFromEnv(process.env, [], "all");
		for (const [flag, on] of Object.entries(want.flags)) expect({ flag, on: (globalThis as Record<string, unknown>)[flag] }).toEqual({ flag, on });
		expect(builtSlices()).toEqual(want.slices);
		const built = Object.entries(slices).filter(([id]) => sliceOn(id));
		expect(MODULES.length).toBe(built.reduce((n, [, s]) => n + s.modules.length, 0));
		expect(FLAGGED_SLICES).toEqual(flaggedSlices());
	});
});

describe("build flags", () => {
	it("release = the released slices; full = all; HEXMAKER_SLICES_OFF turns slices off on top", () => {
		const release = sliceFlags({});
		for (const s of Object.values(slices)) if (s.define) expect((release.flags as Record<string, boolean>)[s.define]).toBe(s.released);
		const full = sliceFlags({ full: true });
		expect(Object.values(full.flags).every(Boolean)).toBe(true);
		expect(full.channel).toBe("full");
		// sliceFlags is the older form of resolveSlices (kept for callers).
		const noSpace = sliceFlags({ full: true, off: "space" });
		expect((noSpace.flags as Record<string, boolean>).__SLICE_SPACE__).toBe(false);
		expect((noSpace.flags as Record<string, boolean>).__SLICE_WORLDMAPS__).toBe(true);
		expect([...noSpace.off]).toEqual(["space"]);
		expect(sliceModules(noSpace.off)).toEqual(["space"]);
		expect(() => sliceFlags({ off: "nope" })).toThrow(/no slice "nope"/);
		expect(() => sliceFlags({ off: "foundation" })).toThrow(/always built/);
		expect(full.channel).toBe("full");
	});

	it("the switch: released | all | none | a list of ids, +id / -id; ON adds, OFF removes last", () => {
		const all = flaggedSlices();
		expect([...resolveSlices({}).on]).toEqual(releasedSlices());
		expect([...resolveSlices({ base: "all" }).on]).toEqual(all);
		expect([...resolveSlices({ spec: "all" }).on]).toEqual(all);
		expect([...resolveSlices({ spec: "none" }).on]).toEqual([]);
		expect([...resolveSlices({ spec: "none" }).off]).toEqual(all);
		// A list starting with an id is exactly those (in release-slices.json order).
		expect(resolveSlices({ spec: "space, worldmaps" }).slices).toEqual(["worldmaps", "space"]);
		// +/- start from the base; keywords reset the set.
		expect(resolveSlices({ spec: "+play,+hexflower" }).slices).toEqual([...releasedSlices(), "play", "hexflower"]);
		expect(resolveSlices({ spec: "-space", base: "all" }).slices).toEqual(all.filter((id) => id !== "space"));
		expect(resolveSlices({ spec: "all,-space" }).slices).toEqual(all.filter((id) => id !== "space"));
		expect(resolveSlices({ spec: "none,+space" }).slices).toEqual(["space"]);
		// ON on top, then OFF, which wins.
		expect(resolveSlices({ spec: "none", on: "space,genpage,play,hexflower" }).slices).toEqual(["space", "genpage", "play", "hexflower"]);
		expect(resolveSlices({ spec: "all", on: "space", off: "space" }).slices).toEqual(all.filter((id) => id !== "space"));
		// Errors: unknown ids, foundation, an unknown base.
		expect(() => resolveSlices({ spec: "nope" })).toThrow(/no slice "nope"/);
		expect(() => resolveSlices({ on: "nope" })).toThrow(/HEXMAKER_SLICES_ON/);
		expect(() => resolveSlices({ spec: "-foundation" })).toThrow(/always built/);
		expect(() => resolveSlices({ off: "foundation" })).toThrow(/always built/);
		expect(() => resolveSlices({ base: "most" })).toThrow(/base slice set/);
	});

	it("the channel: release, full, or custom with what differs from the release set", () => {
		const fake = {
			foundation: { define: null, modules: ["world"], released: true, requires: [] },
			a: { define: "__SLICE_A__", modules: ["a"], released: true, requires: [] },
			b: { define: "__SLICE_B__", modules: ["b"], released: true, requires: [] },
			c: { define: "__SLICE_C__", modules: ["c"], released: false, requires: [] },
			d: { define: "__SLICE_D__", modules: ["d"], released: false, requires: [] },
		};
		const channel = (spec: string) => resolveSlices({ spec, slices: fake }).channel;
		expect(channel("released")).toBe("release");
		expect(channel("all")).toBe("full");
		expect(channel("+c")).toBe("custom +c");
		expect(channel("-a")).toBe("custom -a");
		expect(channel("+d,-b")).toBe("custom +d -b");
		expect(channel("none")).toBe("custom -a -b");
		// On the real manifest: the release build is "release", every slice on "full" (or "release" when all are released).
		expect(resolveSlices({ spec: "released" }).channel).toBe("release");
		expect(resolveSlices({ spec: "all" }).channel).toBe(all().length === releasedSlices().length ? "release" : "full");
	});

	it("requires: a slice on whose requirement is off is an error naming both; offClosure turns dependents off too", () => {
		const fake = {
			foundation: { define: null, modules: ["world"], released: true, requires: [] },
			play: { define: "__SLICE_PLAY__", modules: ["play"], released: false, requires: [] },
			genpage: { define: "__SLICE_GENPAGE__", modules: ["gen-page"], released: true, requires: [] },
			hexflower: { define: "__SLICE_HEXFLOWER__", modules: ["hex-flower"], released: false, requires: ["play", "genpage"] },
			addon: { define: "__SLICE_ADDON__", modules: ["addon"], released: false, requires: ["hexflower"] },
		};
		expect(resolveSlices({ spec: "all", slices: fake }).slices).toEqual(["play", "genpage", "hexflower", "addon"]);
		expect(() => resolveSlices({ spec: "all", off: "play", slices: fake })).toThrow(/slice "hexflower" is on but needs "play", which is off/);
		expect(() => resolveSlices({ spec: "none,+hexflower", slices: fake })).toThrow(/needs "play"[\s\S]*needs "genpage"[\s\S]*HEXMAKER_SLICES_OFF=hexflower/);
		// The release set here (genpage) needs nothing.
		expect(resolveSlices({ slices: fake }).slices).toEqual(["genpage"]);
		expect(offClosure(["play"], fake)).toEqual(["play", "hexflower", "addon"]);
		expect(offClosure(["genpage"], fake)).toEqual(["genpage", "hexflower", "addon"]);
		expect(offClosure(["addon"], fake)).toEqual(["addon"]);
		expect(resolveSlices({ spec: "all", off: offClosure(["play"], fake).join(","), slices: fake }).slices).toEqual(["genpage"]);
	});

	it("--slices on the command line (--full = all), and the defines a build gets", () => {
		expect(sliceSpecArg(["production", "--slices=none,+space"])).toBe("none,+space");
		expect(sliceSpecArg(["production", "--slices", "all"])).toBe("all");
		expect(sliceSpecArg(["production", "--full"])).toBe("all");
		expect(sliceSpecArg(["production"])).toBeUndefined();
		// The command line beats HEXMAKER_SLICES; ON / OFF still apply.
		const env = { HEXMAKER_SLICES: "none", HEXMAKER_SLICES_OFF: "space" };
		expect(slicesFromEnv(env, ["--full"]).slices).toEqual(flaggedSlices().filter((id) => id !== "space"));
		expect(slicesFromEnv(env, []).slices).toEqual([]);
		expect(slicesFromEnv({}, [], "all").slices).toEqual(flaggedSlices());
		const defs = sliceDefines(resolveSlices({ spec: "none,+space" })) as Record<string, string>;
		expect(defs.__SLICE_SPACE__).toBe("true");
		expect(defs.__SLICE_WORLDMAPS__).toBe("false");
		expect(JSON.parse(JSON.parse(defs.__HEXMAKER_SLICES__) as string)).toEqual(["space"]);
	});

	it("esbuild, the tests and the overworld preview all read the one switch; the banner names the slices", () => {
		const cfg = read("esbuild.config.mjs");
		expect(cfg).toMatch(/slicesFromEnv\(process\.env, args, production \? "released" : "all"\)/);
		expect(cfg).toMatch(/\.\.\.sliceDefines\(resolved\)/);
		expect(cfg).toMatch(/build channel: \$\{channel\}\nslices: \$\{JSON\.stringify\(resolved\.slices\)\}/);
		expect(read("tests", "register.mjs")).toMatch(/slicesFromEnv\(process\.env, \[\], "all"\)/);
		expect(read("dev", "release", "preview-overworld.mjs")).toMatch(/define: sliceDefines\(resolved\)/);
		const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
		expect(pkg.scripts["preview:overworld"]).toBe("node dev/release/preview-overworld.mjs");
		expect(pkg.scripts["test:slices"]).toBe("node dev/release/test-slices.mjs");
		expect(readSource("src", "slices.d.ts")).toContain("declare const __HEXMAKER_SLICES__: string;");
	});

	it("CI runs the contract suite and check:release for every set npm run test:slices knows", async () => {
		const { sliceRuns, contractFiles } = await import("../dev/release/test-slices.mjs");
		const ci = read(".github", "workflows", "ci.yml");
		const matrix = /set: \[([^\]]+)\]/.exec(ci)?.[1] ?? "";
		const sets = [...matrix.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
		expect(sets).toEqual(sliceRuns().map((r: { name: string }) => r.name));
		expect(ci).toContain('node dev/release/test-slices.mjs --only "${{ matrix.set }}" --check-release');
		// Each slice's off set turns off what requires it too.
		for (const r of sliceRuns() as { name: string; env: Record<string, string> }[]) {
			if (r.name.startsWith("off:")) expect(r.env.HEXMAKER_SLICES_OFF).toBe(offClosure([r.name.slice(4)]).join(","));
		}
		const files = contractFiles() as string[];
		for (const f of ["releaseSlices.test.ts", "workModeCoverage.test.ts", "readmeCommands.test.ts", "placementModules.test.ts", "slice-contract.test.ts", "moduleRegistry.test.ts"]) expect(files).toContain(f);
	});

	it("the release build is the default build; build:full and dev build everything", () => {
		const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
		expect(pkg.scripts.build).toMatch(/node esbuild\.config\.mjs production$/);
		expect(pkg.scripts["build:full"]).toMatch(/node esbuild\.config\.mjs production --full$/);
		expect(pkg.scripts["check:release"]).toBe("node dev/release/check-release.mjs");
		expect(pkg.scripts.dev).toBe("node esbuild.config.mjs");
	});
});

describe("slice markers in bundled Markdown", () => {
	it("a slice built off loses its blocks; one built on keeps them without the markers", () => {
		const md = "A<!-- slice:space --> (space)<!-- /slice -->.\n<!-- slice:space -->Whole paragraph.<!-- /slice -->\nB";
		expect(stripSliceMarkers(md, new Set(["space"]))).toBe("A.\n\nB");
		expect(stripSliceMarkers(md, new Set())).toBe("A (space).\nWhole paragraph.\nB");
	});

	it("help.md's markers are balanced and name real slices; every documented slice is marked", () => {
		const help = readSource("src", "hex-map", "help.md");
		const opens = [...help.matchAll(/<!-- slice:([a-z-]+) -->/g)].map((m) => m[1]);
		expect(opens.length).toBe((help.match(/<!-- \/slice -->/g) ?? []).length);
		for (const id of opens) expect(Object.keys(slices)).toContain(id);
		for (const id of DOCUMENTED) expect({ id, marked: opens.includes(id) }).toEqual({ id, marked: true });
	});

	for (const id of DOCUMENTED) {
		it(`help.md stripped of ${id} names none of its modules' own strings`, () => {
			const stripped = stripSliceMarkers(readSource("src", "hex-map", "help.md"), new Set(offClosure([id])));
			for (const s of owned(id)) expect({ id, s, found: stripped.includes(s) }).toEqual({ id, s, found: false });
		});
	}
});

describe("README.md slice markers (the release README artifact)", () => {
	const readme = read("README.md");

	it("markers are balanced, never nested, and name real flagged slices; both slices are marked", () => {
		const tokens = [...readme.matchAll(/<!-- (slice:([a-z-]+)|\/slice) -->/g)];
		let open: string | undefined;
		for (const t of tokens) {
			if (t[2]) {
				expect({ nested: open }).toEqual({ nested: undefined });
				expect(slices[t[2]]?.define).toBeTruthy();
				open = t[2];
			} else {
				expect(open).toBeDefined();
				open = undefined;
			}
		}
		expect(open).toBeUndefined();
		for (const id of DOCUMENTED) expect({ id, lines: sliceBlockText(readme, id).length > 0 }).toEqual({ id, lines: true });
	});

	for (const off of [...DOCUMENTED.map((id) => offClosure([id])), ...(DOCUMENTED.length > 1 ? [offClosure(DOCUMENTED)] : [])]) {
		it(`stripped of ${off.join(" + ")}: none of their owned strings or marked text, no markers`, () => {
			const out = releaseReadme(readme, new Set(off));
			expect(out).not.toMatch(/<!-- \/?slice/);
			for (const id of off) {
				for (const s of owned(id)) expect({ id, s, found: out.includes(s) }).toEqual({ id, s, found: false });
				for (const t of sliceBlockText(readme, id)) expect({ id, t, found: out.includes(t) }).toEqual({ id, t, found: false });
			}
			// Tables stay whole: no blank line between two table rows.
			expect(out).not.toMatch(/\|[ \t]*\r?\n[ \t]*\r?\n\|/);
		});
	}

	it("with every slice on, the README is the source without its markers", () => {
		const out = releaseReadme(readme, new Set());
		expect(out).not.toMatch(/<!-- \/?slice/);
		expect(out).toBe(stripSliceMarkers(readme, new Set()).replace(/(\r?\n)(?:[ \t]*\r?\n){2,}/g, "$1$1"));
		for (const id of DOCUMENTED) for (const t of sliceBlockText(readme, id)) expect(out).toContain(t);
	});

	it("block text leaves out wording shared with the rest; blank lines left by a removed block fold to one", () => {
		const md = "Intro.\n\n<!-- slice:space -->Space only paragraph here.<!-- /slice -->\n\nShared line that repeats.\n\n<!-- slice:space -->Shared line that repeats.<!-- /slice -->\n";
		expect(sliceBlockText(md, "space")).toEqual(["Space only paragraph here."]);
		expect(releaseReadme(md, new Set(["space"]))).toBe("Intro.\n\nShared line that repeats.\n\n");
	});

	it("production builds write it to dist/README.md beside main.js; check:release reads it", () => {
		expect(releaseReadmePath(path.join("tmp", "x", "main.js"))).toBe(path.join("tmp", "x", "dist", "README.md"));
		const cfg = read("esbuild.config.mjs");
		expect(cfg).toMatch(/fs\.writeFileSync\(readmeOut, releaseReadme\(/);
		const check = read("dev", "release", "check-release.mjs");
		expect(check).toContain("releaseReadmePath(outfile)");
		expect(check).toContain("sliceBlockText(README, id)");
		expect(read(".gitignore")).toMatch(/^dist\/\r?$/m);
	});
});

describe("a slice built off writes no data.json keys", () => {
	it("no module's own settings key has a default (written only once set)", () => {
		for (const m of MODULES) {
			for (const k of m.owns.settingsKeys) expect({ module: m.id, k, inDefaults: k in DEFAULT_SETTINGS }).toEqual({ module: m.id, k, inDefaults: false });
		}
	});
});
