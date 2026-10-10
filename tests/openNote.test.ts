import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { leafShowingPath, openNoteFocused } from "../src/openNote";

const leaf = (file: string | null, deferredFile?: string) => ({
	view: file === null ? {} : { file: { path: file } },
	getViewState: () => ({ state: deferredFile ? { file: deferredFile } : {} }),
});

describe("leafShowingPath (fresh-eyes round 4: duplicate note tabs)", () => {
	it("finds the leaf already showing the note", () => {
		const a = leaf("world/hexes/m/1_1.md");
		const b = leaf("world/hexes/m/2_8.md");
		expect(leafShowingPath([a, b], "world/hexes/m/2_8.md")).toBe(b);
	});

	it("finds a background tab that hasn't loaded its view yet", () => {
		const deferred = leaf(null, "world/hexes/m/2_8.md");
		expect(leafShowingPath([leaf(null), deferred], "world/hexes/m/2_8.md")).toBe(deferred);
	});

	it("returns undefined when the note isn't open", () => {
		expect(leafShowingPath([leaf("a.md"), leaf(null)], "b.md")).toBeUndefined();
	});
});

describe("openNoteFocused", () => {
	function fakeApp(openPaths: string[]) {
		const calls: string[] = [];
		const leaves = openPaths.map((p) => leaf(p));
		const app = {
			workspace: {
				iterateAllLeaves: (fn: (l: unknown) => void) => leaves.forEach(fn),
				setActiveLeaf: () => calls.push("focus"),
				revealLeaf: async () => { calls.push("reveal"); },
				getLeaf: (kind: string) => ({ openFile: async (f: { path: string }) => { calls.push(`open:${kind}:${f.path}`); } }),
			},
		};
		return { app, calls };
	}

	it("focuses the open tab instead of opening another", async () => {
		const { app, calls } = fakeApp(["x.md", "2_8.md"]);
		await openNoteFocused(app as never, { path: "2_8.md" } as never);
		expect(calls).toEqual(["focus", "reveal"]);
	});

	it("opens a new tab when the note isn't open", async () => {
		const { app, calls } = fakeApp(["x.md"]);
		await openNoteFocused(app as never, { path: "2_8.md" } as never);
		expect(calls).toEqual(["open:tab:2_8.md"]);
	});

	it("is what every 'Open note' on the map, hex editor and token card uses", () => {
		const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8");
		for (const f of [["src", "hex-map", "HexEditorModal.ts"], ["src", "hex-map", "TokenInfoModal.ts"], ["src", "hex-map", "HexMapView.ts"]]) {
			expect(read(...f)).toMatch(/openNoteFocused\(this\.app, /);
		}
		const view = read("src", "hex-map", "HexMapView.ts").replace(/\r\n/g, "\n");
		const openNoteItems = view.split('.setTitle("Open note")').slice(1).map((s) => s.slice(0, 500));
		expect(openNoteItems.length).toBeGreaterThan(0);
		for (const item of openNoteItems) expect(item).toMatch(/openNoteFocused/);
	});
});
