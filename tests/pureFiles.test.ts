import { describe, it } from "node:test";
import expect from "expect";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, importsOf, listSrcFiles, rel, valueImportGraph } from "./helpers/importGraph";

/**
 * Pure-file ratchet (plan-architecture-refactor, lane L8).
 *
 * tests/fixtures/pureFiles.json lists the src files that, on the day it
 * was made, never reached `obsidian` at run time: neither they nor
 * anything they value-import (transitively) imports it. Type-only
 * imports are fine. Pure files run in tests without the Obsidian mock and
 * keep logic apart from UI, so they must stay pure.
 *
 * A listed file that is renamed or split: update the list. A new pure
 * file may be added (not required).
 */
const listed = JSON.parse(readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "pureFiles.json"), "utf8")) as string[];

const graph = valueImportGraph();
const direct = new Set(listSrcFiles().filter((f) => importsOf(f).some((i) => i.specifier === "obsidian" && !i.typeOnly)).map(rel));

/** The import chain from `file` to a file importing obsidian, or undefined when pure. */
function chainToObsidian(file: string): string[] | undefined {
	const prev = new Map<string, string | null>([[file, null]]);
	const queue = [file];
	while (queue.length) {
		const f = queue.shift()!;
		if (direct.has(f)) {
			const chain: string[] = [];
			for (let at: string | null = f; at; at = prev.get(at) ?? null) chain.unshift(at);
			return chain;
		}
		for (const d of graph.get(f) ?? []) if (!prev.has(d)) { prev.set(d, f); queue.push(d); }
	}
	return undefined;
}

describe("pure files ratchet", () => {
	it("every listed file still exists (update tests/fixtures/pureFiles.json on a rename)", () => {
		const missing = listed.filter((f) => !existsSync(path.join(REPO_ROOT, f)));
		expect({ missing }).toEqual({ missing: [] });
	});

	it("every listed file stays free of obsidian, directly and through its imports", () => {
		const impure = listed
			.filter((f) => graph.has(f))
			.map((f) => [f, chainToObsidian(f)] as const)
			.filter(([, chain]) => chain)
			.map(([f, chain]) => `${f}: ${chain!.join(" -> ")} -> obsidian`);
		expect({ impure }).toEqual({ impure: [] });
	});

	it("the list is sorted with no duplicates", () => {
		expect(listed).toEqual([...new Set(listed)].sort());
	});
});
