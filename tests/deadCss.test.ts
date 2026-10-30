import { describe, it } from "node:test";
import expect from "expect";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Cleanup P6: every duckmage-* class styles.css styles is used by the code,
 * either written out ("duckmage-hex-map-grid") or built from a prefix
 * (`duckmage-token-${shape}`, "duckmage-badges-" + kind). A rule for a
 * class nothing makes is dead weight and a trap for the next reader.
 */

function srcText(dir = "src"): string {
	let out = "";
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) out += srcText(p);
		else if (/\.(ts|md|json)$/.test(name)) out += readFileSync(p, "utf8") + "\n";
	}
	return out;
}

describe("dead CSS (cleanup P6)", () => {
	it("every duckmage-* class in styles.css is made somewhere in src", () => {
		const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		const classes = [...new Set([...css.matchAll(/\.(duckmage-[A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
		const src = srcText();
		// Prefixes a class is built from at run time.
		const prefixes = new Set([
			...[...src.matchAll(/(duckmage-[A-Za-z0-9_-]*-)\$\{/g)].map((m) => m[1]),
			...[...src.matchAll(/["'`](duckmage-[A-Za-z0-9_-]*-)["'`]\s*\+/g)].map((m) => m[1]),
		]);
		const used = (c: string) =>
			new RegExp(`${c.replace(/[-]/g, "\\-")}(?![A-Za-z0-9_-])`).test(src) || [...prefixes].some((p) => c.startsWith(p));
		const dead = classes.filter((c) => !used(c));
		expect(dead).toEqual([]);
		expect(classes.length).toBeGreaterThan(900);
	});
});
