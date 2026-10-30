/**
 * Owner K2 (2026-10-16): importing a palette whose name this vault has.
 * The same palette (formatting and row order aside) isn't duplicated;
 * a changed one comes in as "Name 2" (then 3…), and the pack's notes that
 * name it follow (src/modules/packs/packPalettes.ts, planImport).
 */
import { it } from "node:test";
import { describeWith } from "./helpers/slices";
import expect from "expect";
import { coreKinds, type PackKind } from "../src/modules/packs/packKinds";
import { loadPack, planImport, resolveSteps, type PackFile } from "../src/modules/packs/packPlan";
import { paletteKey, planPalettes, renamePaletteRefs, type VaultPalette } from "../src/modules/packs/packPalettes";
import { runImport, type PackWriteHost } from "../src/modules/packs/packIO";
import { formatManifest } from "../src/modules/packs/packManifest";
import { buildPaletteNote, parsePaletteNote } from "../src/palettes/paletteNote";
import { setPathTypes } from "../src/palettes/pathTypeTable";
import type { TerrainColor } from "../src/types";

const enc = (s: string) => new TextEncoder().encode(s);
const kinds: PackKind[] = coreKinds({ worldFolder: "world" }, { palettes: "world/palettes", generators: "world/generators" });

const COAST: TerrainColor[] = [
	{ name: "ocean", color: "#29507f", type: "water" },
	{ name: "beach", color: "#e8d9a0", icon: "sand.png" },
	{ name: "hills", color: "#8a9a5b" },
];
const coastNote = (terrains = COAST) => buildPaletteNote(terrains);

/** A vault with these palette notes (name → text), found by name in any case. */
function vaultWith(palettes: Record<string, string>, notes: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(notes));
	for (const [name, text] of Object.entries(palettes)) files.set(`world/palettes/${name}.md`, text);
	const find = async (name: string): Promise<VaultPalette | null> => {
		const hit = Object.keys(palettes).find((n) => n.toLowerCase() === name.toLowerCase());
		return hit ? { path: `world/palettes/${hit}.md`, text: palettes[hit] } : null;
	};
	return { files, find, read: async (p: string) => files.get(p) ?? null };
}

const packOf = (files: Record<string, string>) =>
	loadPack(Object.entries(files).map(([path, t]): PackFile => ({ path, data: enc(t) })), kinds, "Pack");

describeWith("packs", "K2: is it the same palette?", () => {
	it("row order, colour case and table formatting don't count", () => {
		const reordered = buildPaletteNote([COAST[2], { ...COAST[0], color: "#29507F" }, COAST[1]]);
		const spaced = coastNote().replace(/\| /g, "|  ").replace("Hexmap World Creator terrain palette.", "My notes about this palette.");
		expect(paletteKey(reordered)).toBe(paletteKey(coastNote()));
		expect(paletteKey(spaced)).toBe(paletteKey(coastNote()));
	});

	it("a changed colour, icon, an added terrain or path type does", () => {
		const key = paletteKey(coastNote());
		expect(paletteKey(coastNote([{ ...COAST[0], color: "#000000" }, COAST[1], COAST[2]]))).not.toBe(key);
		expect(paletteKey(coastNote([COAST[0], { ...COAST[1], icon: "dune.png" }, COAST[2]]))).not.toBe(key);
		expect(paletteKey(coastNote([...COAST, { name: "reef", color: "#3fa7a0" }]))).not.toBe(key);
		expect(paletteKey(setPathTypes(coastNote(), [{ name: "road", color: "#a0522d", width: 3, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" }]))).not.toBe(key);
	});

	it("a note that isn't a palette has no key", () => {
		expect(paletteKey("# Just prose\n")).toBeNull();
	});
});

describeWith("packs", "K2: planning the pack's palettes", () => {
	it("new, the same (already have), or different → Name 2, then 3 when 2 is taken", async () => {
		const { find } = vaultWith({ Coast: coastNote(), Hills: coastNote(), "Hills 2": coastNote() });
		const changed = coastNote([...COAST, { name: "reef", color: "#3fa7a0" }]);
		const plans = await planPalettes([
			{ target: "world/palettes/Fresh.md", text: coastNote() },
			{ target: "world/palettes/coast.md", text: coastNote() },
			{ target: "world/palettes/Hills.md", text: changed },
		], find, async () => false);
		expect(plans).toEqual([
			{ kind: "new" },
			{ kind: "same", existing: "world/palettes/Coast.md" },
			{ kind: "renamed", from: "Hills", to: "Hills 3", target: "world/palettes/Hills 3.md" },
		]);
	});

	it("a new name never lands on another of the pack's palettes or a note that's there", async () => {
		const { find } = vaultWith({ Coast: coastNote() });
		const changed = coastNote([COAST[0]]);
		const plans = await planPalettes([
			{ target: "world/palettes/Coast.md", text: changed },
			{ target: "world/palettes/Coast 2.md", text: changed },
		], find, async (p) => p === "world/palettes/Coast 3.md");
		expect(plans[0]).toEqual({ kind: "renamed", from: "Coast", to: "Coast 4", target: "world/palettes/Coast 4.md" });
		expect(plans[1]).toEqual({ kind: "new" });
	});
});

describeWith("packs", "K2: references inside the pack follow the new name", () => {
	const renames = new Map([["coast", "Coast 2"]]);

	it("a generator's palette: (link or plain), a child-palette:, a link into the palettes folder", () => {
		expect(renamePaletteRefs('---\npalette: "[[world/palettes/Coast]]"\ncols: 8\n---\nSee [[world/palettes/Coast|the coast]].\n', renames, "world/palettes"))
			.toBe('---\npalette: "[[world/palettes/Coast 2]]"\ncols: 8\n---\nSee [[world/palettes/Coast 2|the coast]].\n');
		expect(renamePaletteRefs("---\npalette: coast\n---\n", renames, "world/palettes")).toBe("---\npalette: Coast 2\n---\n");
		expect(renamePaletteRefs('---\nchild-palette: "Coast"\n---\n', renames, "world/palettes")).toBe('---\nchild-palette: "Coast 2"\n---\n');
	});

	it("keeps a CRLF note's line endings", () => {
		const text = '---\r\npalette: coast\r\ncols: 8\r\n---\r\n';
		expect(renamePaletteRefs(text, renames, "world/palettes")).toBe('---\r\npalette: Coast 2\r\ncols: 8\r\n---\r\n');
	});

	it("leaves other palettes, other keys and body text alone", () => {
		const text = '---\npalette: "[[world/palettes/Coastal]]"\nname: Coast\n---\npalette: Coast\n[[world/tables/Coast]]\n';
		expect(renamePaletteRefs(text, renames, "world/palettes")).toBe(text);
	});
});

describeWith("packs", "K2: importing a pack", () => {
	const changed = coastNote([...COAST, { name: "reef", color: "#3fa7a0" }]);
	const generator = '---\npalette: "[[lore/palettes/Coast]]"\n---\n# Valley\n';
	const manifest = formatManifest({
		format: 1, name: "Coast pack", description: "", madeWith: "", date: "",
		kinds: [
			{ id: "palettes", label: "Palettes", from: "lore/palettes", files: ["palettes/Coast.md"] },
			{ id: "generators", label: "Generators", from: "lore/generators", files: ["generators/Valley.md"] },
		],
	});

	function memHost(files: Map<string, string>): PackWriteHost {
		return {
			exists: (p) => files.has(p),
			read: async (p) => files.get(p)!,
			create: async (p, t) => { if (files.has(p)) throw new Error("exists"); files.set(p, t); },
			modify: async (p, t) => { files.set(p, t); },
			ensureFolderPath: async () => {},
			backup: async () => "backups/x",
		};
	}

	it("the same palette: not duplicated, reported as already have; the generator still names it", async () => {
		const v = vaultWith({ Coast: coastNote().replace(/\n/g, "\r\n") });
		const plan = await planImport(packOf({ "pack.md": manifest, "palettes/Coast.md": coastNote(), "generators/Valley.md": generator }), kinds, v.read, v.find);
		const pal = plan.items.find((i) => i.kindId === "palettes")!;
		expect(pal).toMatchObject({ status: "same", alreadyHave: "world/palettes/Coast.md", target: "world/palettes/Coast.md" });
		const r = await runImport(memHost(v.files), resolveSteps(plan.items, () => "both", (p) => v.files.has(p)), "Coast pack");
		expect(r.skipped).toEqual([{ path: "world/palettes/Coast.md", reason: "already have this palette (world/palettes/Coast.md)" }]);
		expect([...v.files.keys()].filter((p) => p.startsWith("world/palettes/"))).toEqual(["world/palettes/Coast.md"]);
		expect(v.files.get("world/generators/Valley.md")).toContain('palette: "[[world/palettes/Coast]]"');
	});

	it("a changed palette comes in as Name 2; the pack's generator is pointed at it; yours is untouched", async () => {
		const mine = coastNote();
		const v = vaultWith({ Coast: mine });
		const plan = await planImport(packOf({ "pack.md": manifest, "palettes/Coast.md": changed, "generators/Valley.md": generator }), kinds, v.read, v.find);
		const pal = plan.items.find((i) => i.kindId === "palettes")!;
		expect(pal).toMatchObject({ status: "new", renamedFrom: "Coast", target: "world/palettes/Coast 2.md" });
		const gen = plan.items.find((i) => i.kindId === "generators")!;
		expect(gen.text).toBe('---\npalette: "[[world/palettes/Coast 2]]"\n---\n# Valley\n');
		const r = await runImport(memHost(v.files), resolveSteps(plan.items, () => "both", (p) => v.files.has(p)), "Coast pack");
		expect(r.renamed).toEqual([{ from: "Coast", path: "world/palettes/Coast 2.md" }]);
		expect(r.created).toEqual(["world/generators/Valley.md"]);
		expect(v.files.get("world/palettes/Coast.md")).toBe(mine);
		expect(parsePaletteNote(v.files.get("world/palettes/Coast 2.md")!)!.map((t) => t.name)).toEqual(["ocean", "beach", "hills", "reef"]);
	});

	it("importing the same pack again finds its Name 2: no Name 3, the generator isn't duplicated", async () => {
		const v = vaultWith({ Coast: coastNote() });
		// A finder over the live files, so the Coast 2 the first import made is seen.
		const find = async (name: string): Promise<VaultPalette | null> => {
			const path = [...v.files.keys()].find((p) => p.toLowerCase() === `world/palettes/${name.toLowerCase()}.md`);
			return path ? { path, text: v.files.get(path)! } : null;
		};
		const pack = () => packOf({ "pack.md": manifest, "palettes/Coast.md": changed, "generators/Valley.md": generator });
		const first = await planImport(pack(), kinds, v.read, find);
		await runImport(memHost(v.files), resolveSteps(first.items, () => "both", (p) => v.files.has(p)), "Coast pack");
		const again = await planImport(pack(), kinds, v.read, find);
		const pal = again.items.find((i) => i.kindId === "palettes")!;
		expect(pal).toMatchObject({ status: "same", alreadyHave: "world/palettes/Coast 2.md" });
		const gen = again.items.find((i) => i.kindId === "generators")!;
		expect(gen.text).toBe('---\npalette: "[[world/palettes/Coast 2]]"\n---\n# Valley\n');
		expect(gen.status).toBe("same");
		await runImport(memHost(v.files), resolveSteps(again.items, () => "both", (p) => v.files.has(p)), "Coast pack");
		expect([...v.files.keys()].filter((p) => p.startsWith("world/palettes/")).sort()).toEqual(["world/palettes/Coast 2.md", "world/palettes/Coast.md"]);
		expect([...v.files.keys()].filter((p) => p.startsWith("world/generators/"))).toEqual(["world/generators/Valley.md"]);
	});

	it("without a palette finder, palettes are planned like any note (Keep both / Replace)", async () => {
		const v = vaultWith({ Coast: coastNote() });
		const plan = await planImport(packOf({ "palettes/Coast.md": changed }), kinds, v.read);
		expect(plan.items[0]).toMatchObject({ status: "conflict", target: "world/palettes/Coast.md" });
		expect(plan.items[0].renamedFrom).toBeUndefined();
	});
});
