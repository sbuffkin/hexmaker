import { describe, it, beforeEach, afterEach } from "node:test";
import expect from "expect";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Notice } from "./__mocks__/obsidian";
import { reportExportFailure } from "../src/export/vaultWrite";
import { sanitiseFilename } from "../src/export/exportNames";
import { readSource } from "./helpers/source";

/** Every .ts file under src/export, repo-relative. */
function exportFiles(dir = "src/export"): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = path.posix.join(dir, name);
		if (statSync(p).isDirectory()) out.push(...exportFiles(p));
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

describe("export failures (cleanup P1)", () => {
	let errors: unknown[][];
	const realError = console.error;
	beforeEach(() => {
		errors = [];
		console.error = (...a: unknown[]) => { errors.push(a); };
		Notice.shown.length = 0;
	});
	afterEach(() => { console.error = realError; });

	it("logs with the plugin prefix and tells the user", () => {
		const err = new Error("disk full");
		reportExportFailure(err);
		expect(errors).toEqual([["Hexmaker: export failed", err]]);
		expect(Notice.shown.map((n) => n.msg)).toEqual(["Export failed: disk full"]);
	});

	it("names what failed, and copes with a thrown string", () => {
		reportExportFailure("no canvas", "Map export");
		expect(errors[0]).toEqual(["Hexmaker: map export failed", "no canvas"]);
		expect(Notice.shown[0].msg).toBe("Map export failed: no canvas");
	});

	it("exporters use it: no raw console calls or hand-written failure notices in src/export", () => {
		for (const f of exportFiles()) {
			const src = readSource(f);
			expect({ f, console: /\bconsole\.(log|warn|error|info)\(/.test(src) }).toEqual({ f, console: false });
			expect({ f, notice: /new Notice\(`(Map )?[Ee]xport failed/.test(src) }).toEqual({ f, notice: false });
		}
	});

	it("one sanitiseFilename, in exportNames", () => {
		const defs = exportFiles().filter((f) => /function sanitiseFilename\b/.test(readSource(f)));
		expect(defs).toEqual(["src/export/exportNames.ts"]);
		expect(sanitiseFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
	});
});
