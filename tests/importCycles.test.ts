import { describe, it } from "node:test";
import expect from "expect";
import { multiFileSccs, valueImportGraph } from "./helpers/importGraph";

/**
 * Import-cycle ratchet (plan-architecture-refactor, lane L8).
 *
 * Every strongly connected component of src/ value imports (type-only
 * imports and dynamic import() don't count) must be on the list below.
 * A cycle may never grow or appear, and when one is cut its entry must be
 * removed, so the list only shrinks.
 *
 * Cut so far: the 25-file cycle through worldgen/registry.ts (it now asks
 * plugin.moduleGenerators instead of importing modules/runtime),
 * PathPickerModal <-> PathTypeEditorModal (buildPathPreviewSvg moved to
 * hex-map/pathPreviewSvg.ts) and BiomeLibraryModal <-> BiomeModals
 * (lockButton moved to ui/lockButton.ts).
 */
const ALLOWED_CYCLES: string[][] = [
	// overworldPaths needs overworldOf/planRegionAt; regionsVault calls
	// applyConfirmedPaths. Cut it when regionsVault.ts is free to edit.
	["src/overworld/overworldPaths.ts", "src/overworld/regionsVault.ts"],
];

const sccs = multiFileSccs(valueImportGraph());
const key = (files: string[]) => [...files].sort().join(" | ");

describe("import cycles ratchet", () => {
	it("no cycle outside the allow-list, and none grew", () => {
		const allowed = ALLOWED_CYCLES.map((c) => new Set(c));
		const bad = sccs.filter((c) => !allowed.some((a) => c.every((f) => a.has(f)))).map(key);
		expect({ newOrGrownCycles: bad }).toEqual({ newOrGrownCycles: [] });
	});

	it("every allowed cycle still exists (remove cut ones from ALLOWED_CYCLES)", () => {
		const now = new Set(sccs.map(key));
		const gone = ALLOWED_CYCLES.map(key).filter((k) => !now.has(k));
		expect({ cutButStillListed: gone }).toEqual({ cutButStillListed: [] });
	});

	it("the cut back edges stay cut", () => {
		const g = valueImportGraph();
		expect(g.get("src/worldgen/registry.ts")).not.toContain("src/modules/runtime.ts");
		expect(g.get("src/hex-map/PathTypeEditorModal.ts")).not.toContain("src/hex-map/PathPickerModal.ts");
		expect(g.get("src/overworld/BiomeLibraryModal.ts")).not.toContain("src/overworld/BiomeModals.ts");
	});
});

describe("import graph helper", () => {
	it("finds cycles and skips singletons", () => {
		const g = new Map<string, string[]>([
			["a", ["b"]],
			["b", ["c"]],
			["c", ["a"]],
			["d", ["d", "a"]],
		]);
		expect(multiFileSccs(g)).toEqual([["a", "b", "c"]]);
	});
});
