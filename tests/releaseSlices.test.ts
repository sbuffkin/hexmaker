import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MODULES } from "../src/modules";
import { MODULE_RUNTIMES } from "../src/modules/runtime";
import { DEFAULT_SETTINGS } from "../src/constants";
// @ts-expect-error: plain ESM helper shared with esbuild.config.mjs (no types)
import { readSlices, releaseReadme, releaseReadmePath, sliceBlockText, sliceFlags, sliceModules, stripSliceMarkers } from "../dev/release/slices.mjs";

/** P6: one module is one release slice (release-slices.json); a slice built off leaves no trace. */

type Slice = { define: string | null; modules: string[]; released: boolean };
const slices = readSlices() as Record<string, Slice>;
const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8");

describe("release-slices.json and the modules agree", () => {
	it("every module names a slice that lists it, and every listed module exists", () => {
		for (const m of MODULES) {
			expect(Object.keys(slices)).toContain(m.slice);
			expect(slices[m.slice].modules).toContain(m.id);
		}
		const ids = MODULES.map((m) => m.id);
		for (const s of Object.values(slices)) for (const id of s.modules) expect(ids).toContain(id);
		expect(MODULE_RUNTIMES.map((r) => r.id)).toEqual(ids);
	});

	it("the foundation slice is always built (no flag); the others have one each, read by the module lists", () => {
		expect(slices.foundation.define).toBeNull();
		const index = read("src", "modules", "index.ts");
		const runtime = read("src", "modules", "runtime.ts");
		const decl = read("src", "slices.d.ts");
		for (const [id, s] of Object.entries(slices)) {
			if (!s.define) continue;
			expect({ id, decl: decl.includes(`declare const ${s.define}: boolean;`) }).toEqual({ id, decl: true });
			for (const src of [index, runtime]) expect(src).toMatch(new RegExp(`if \\(${s.define}\\) compiled\\.push\\(`));
		}
	});

	it("tests run with every slice on", () => {
		for (const s of Object.values(slices)) if (s.define) expect((globalThis as Record<string, unknown>)[s.define]).toBe(true);
		expect(MODULES.length).toBe(Object.values(slices).reduce((n, s) => n + s.modules.length, 0));
	});
});

describe("build flags", () => {
	it("release = the released slices; full = all; HEXMAKER_SLICES_OFF turns slices off on top", () => {
		const release = sliceFlags({});
		for (const s of Object.values(slices)) if (s.define) expect(release.flags[s.define]).toBe(s.released);
		const full = sliceFlags({ full: true });
		expect(Object.values(full.flags).every(Boolean)).toBe(true);
		expect(full.channel).toBe("full");
		const noSpace = sliceFlags({ full: true, off: "space" });
		expect(noSpace.flags.__SLICE_SPACE__).toBe(false);
		expect(noSpace.flags.__SLICE_WORLDMAPS__).toBe(true);
		expect([...noSpace.off]).toEqual(["space"]);
		expect(sliceModules(noSpace.off)).toEqual(["space"]);
		expect(() => sliceFlags({ off: "nope" })).toThrow(/no slice "nope"/);
		expect(() => sliceFlags({ off: "foundation" })).toThrow(/always built/);
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

	it("help.md's markers are balanced and name real slices; stripped of Space it names none of Space's text", () => {
		const help = read("src", "hex-map", "help.md");
		const opens = [...help.matchAll(/<!-- slice:([a-z-]+) -->/g)].map((m) => m[1]);
		expect(opens.length).toBe((help.match(/<!-- \/slice -->/g) ?? []).length);
		for (const id of opens) expect(Object.keys(slices)).toContain(id);
		const stripped = stripSliceMarkers(help, new Set(["space"]));
		const space = MODULES.find((m) => m.id === "space")!;
		for (const s of space.owns.strings ?? []) expect({ s, found: stripped.includes(s) }).toEqual({ s, found: false });
	});
});

describe("README.md slice markers (the release README artifact)", () => {
	const readme = read("README.md");
	const owned = (slice: string) => MODULES.filter((m) => m.slice === slice).flatMap((m) => [...(m.owns.strings ?? [])]);

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
		for (const id of ["worldmaps", "space"]) expect(sliceBlockText(readme, id).length).toBeGreaterThan(10);
	});

	for (const off of [["worldmaps"], ["space"], ["worldmaps", "space"]]) {
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
		for (const id of ["worldmaps", "space"]) for (const t of sliceBlockText(readme, id)) expect(out).toContain(t);
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
