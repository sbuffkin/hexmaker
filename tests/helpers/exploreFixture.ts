/**
 * An explored map in memory for exploring tests (HF4, HF7): a fake map
 * store, a MemVault with a "Wilds" terrain flower (and any extra flowers),
 * the ExploreService, and an undo / redo that goes through the same
 * prepare / apply helpers as the map view.
 */
import { MemVault } from "./memVault";
import { cellPatch, type UndoDirection } from "../../src/undoBook";
import type { HexData } from "../../src/maps/mapNote";
import type { UndoItem } from "../../src/hex-map/undoItems";
import { applyGroup, applyMapField, prepareGroup } from "../../src/hex-map/view/undoGroup";
import { applyGridUndo, prepareGrid } from "../../src/hex-map/gridChange";
import { applyNoteSection, prepareNoteSection } from "../../src/hex-map/noteUndo";
import { ExploreService } from "../../src/hexflower/ExploreService";
import { FlowerStore } from "../../src/hexflower/FlowerStore";
import { setExplore, setFlowerStore } from "../../src/hexflower/context";
import { emptyFlower } from "../../src/hexflower/flower";
import { buildFlowerNote } from "../../src/hexflower/flowerNote";

export const TERRAINS = ["grassland", "forest", "hills"];

export class FakeStore {
	hexes = new Map<string, Map<string, HexData>>();
	private rec: ((m: string, k: string, b: HexData | undefined) => void) | null = null;
	get(m: string, k: string) { return this.hexes.get(m)?.get(k); }
	all(m: string) { return this.hexes.get(m) ?? new Map<string, HexData>(); }
	set(m: string, k: string, patch: Record<string, unknown>) {
		this.rec?.(m, k, this.get(m, k));
		const t = this.hexes.get(m) ?? new Map<string, HexData>();
		this.hexes.set(m, t);
		const h: Record<string, unknown> = { ...(t.get(k) ?? {}) };
		for (const [f, v] of Object.entries(patch)) { if (v === null || v === undefined || v === "") delete h[f]; else h[f] = v; }
		if (Object.keys(h).length) t.set(k, h as HexData); else t.delete(k);
		return true;
	}
	async record<T>(fn: () => T) {
		const before = new Map<string, { map: string; key: string; before?: HexData }>();
		this.rec = (map, key, b) => { if (!before.has(key)) before.set(key, { map, key, before: b ? { ...b } : undefined }); };
		const result = await fn();
		this.rec = null;
		return { result, cells: [...before.values()].map((c) => ({ ...c, after: this.get(c.map, c.key) ? { ...this.get(c.map, c.key)! } : undefined })) };
	}
}

export function setup(map: Record<string, unknown> = {}, name = "m", files: Record<string, string> = {}) {
	const flower = emptyFlower("Wilds", "P");
	flower.cells = flower.cells.map((_, i) => ({ result: TERRAINS[i % 3] }));
	const vault = new MemVault({ "world/hex flowers/Wilds.md": buildFlowerNote(flower), ...files });
	const store = new FakeStore();
	const mapData = {
		name, paletteName: "P", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [],
		seed: 11, exploreWith: ["[[Wilds]] -> terrain"], ...map,
	} as Record<string, unknown> & { gridSize: { cols: number; rows: number }; gridOffset: { x: number; y: number } };
	const plugin = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [mapData] },
		mapStore: store,
		tableNotes: { lookup: () => ({ table: () => undefined }) },
		getMap: (n: string) => (n === name ? mapData : undefined),
		getPaletteOrPresetTerrains: () => TERRAINS.map((t) => ({ name: t, color: "#000" })),
		hexPath: (x: number, y: number) => `world/hexes/${name}/${x}_${y}.md`,
		saveSettings: async () => {},
		pushUndo: () => {},
		refreshHexMap: () => {},
		// A new hex note: a heading and the sections a step writes into.
		createHexNote: async (x: number, y: number) => {
			const app = vault.app() as unknown as { vault: { create(p: string, c: string): Promise<unknown> } };
			return app.vault.create(`world/hexes/${name}/${x}_${y}.md`, `# ${x}, ${y}\n\n### Features\n\n### Description\n`);
		},
	};
	const flowers = new FlowerStore(plugin as never, () => {});
	setFlowerStore(plugin as never, flowers);
	const notices: string[] = [];
	const ex = new ExploreService(plugin as never, (text) => notices.push(text));
	setExplore(plugin as never, ex);
	return { plugin, store, mapData, flowers, ex, notices };
}

/** Undo / redo a step's group the way the map view does: prepare every part, then apply. */
export async function undoRedo(plugin: ReturnType<typeof setup>["plugin"], items: UndoItem[], dir: UndoDirection, told: string[] = []) {
	const store = plugin.mapStore;
	const prepare = async (it: UndoItem, d: UndoDirection): Promise<UndoItem | null> => {
		if (it.kind === "group") return prepareGroup(it, d, prepare);
		if (it.kind === "grid") return prepareGrid(plugin as never, it, d);
		if (it.kind === "note-section") return prepareNoteSection(plugin.app as never, it, d, (t) => told.push(t));
		return it;
	};
	const apply = async (it: UndoItem, d: UndoDirection): Promise<void> => {
		if (it.kind === "cells") for (const e of it.edits) store.set(e.map, e.key, cellPatch(e, d));
		else if (it.kind === "map-field") applyMapField(plugin as never, it, d);
		else if (it.kind === "grid") applyGridUndo(plugin as never, it, d);
		else if (it.kind === "note-section") await applyNoteSection(plugin.app as never, it, d);
		else if (it.kind === "group") await applyGroup(it, d, apply);
	};
	const ready = await prepare({ kind: "group", items }, dir);
	if (ready) await apply(ready, dir);
}

