/**
 * The note-folder store lifecycle BiomeStore and WorldTypeStore share
 * (src/stores/NoteFolderStore.ts): which notes are read, how vault events
 * update the store, who hears about it, folder creation and backups.
 * Written as a characterisation test before the base class was extracted,
 * run against both stores so they can't drift apart.
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { Notice, TFile } from "obsidian";
import { MemVault } from "./helpers/memVault";
import { BiomeStore } from "../src/overworld/BiomeStore";
import { buildBiomeNote } from "../src/overworld/biomeNote";
import { BIOME_PRESETS } from "../src/overworld/biomePresets";
import { setBiomeSource } from "../src/overworld/biomes";
import { WorldTypeStore } from "../src/space/WorldTypeStore";
import { DEFAULT_WORLD_TYPES, buildWorldTypes } from "../src/space/worldTypes";
import { DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { ensureFolder, ensureFolderPath } from "../src/vault/ensureFolder";

function file(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.slice(path.lastIndexOf("/") + 1);
	f.basename = f.name.replace(/\.md$/, "");
	f.extension = f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".") + 1) : "";
	return f;
}

interface Store {
	init(): Promise<void>;
	reload(): Promise<void>;
	isReady(): boolean;
	folder(): string;
	onChange(fn: () => void): () => void;
	onCreate(f: TFile): void;
	onModify(f: TFile): void;
	onDelete(f: TFile): void;
	onRename(f: TFile, old: string): void;
	pathOf(name: string): string | undefined;
	restoreDefault(name: string): Promise<boolean>;
}

interface Kind {
	name: string;
	folderKey: string;
	sub: string;
	backupDir: string;
	note(name: string): string;
	/** The name `pathOf` finds a note by. */
	key(name: string): string;
	make(v: MemVault, settings?: Record<string, unknown>): Store;
	/** A note restoreDefault backs up, with its name. */
	defaultNote: { name: string; text: string };
	/** Settings for a store that writes nothing on init. */
	quiet: Record<string, unknown>;
}

const preset = BIOME_PRESETS[0];

const KINDS: Kind[] = [
	{
		name: "BiomeStore",
		folderKey: "biomesFolder",
		sub: "biomes",
		backupDir: "biome-notes-",
		note: (name) => buildBiomeNote({ ...preset, id: name.toLowerCase(), label: name }),
		key: (name) => name.toLowerCase(),
		make: (v, settings = {}) => new BiomeStore(plugin(v, { mapKinds: ["space"], kindContent: ["space"], ...settings }) as never) as unknown as Store,
		defaultNote: { name: preset.label, text: buildBiomeNote(preset) },
		quiet: {},
	},
	{
		name: "WorldTypeStore",
		folderKey: "worldTypesFolder",
		sub: "world-types",
		backupDir: "world-types-",
		note: (name) => buildWorldTypes(name, DEFAULT_WORLD_TYPE_ROWS),
		key: (name) => name,
		make: (v, settings = {}) => new WorldTypeStore(plugin(v, { worldTypesSeeded: true, ...settings }) as never) as unknown as Store,
		defaultNote: { name: DEFAULT_WORLD_TYPES, text: buildWorldTypes(DEFAULT_WORLD_TYPES, DEFAULT_WORLD_TYPE_ROWS) },
		quiet: {},
	},
];

function plugin(vault: MemVault, settings: Record<string, unknown>) {
	return {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", terrainPalettes: [], ...settings } as Record<string, unknown>,
		saveSettings: async () => {},
		tableNotes: { lookup: () => ({}), put: () => {} },
	};
}

for (const k of KINDS) {
	const dir = `world/${k.sub}`;
	describe(`${k.name}: the note-folder lifecycle`, () => {
		afterEach(() => { setBiomeSource(undefined); Notice.shown = []; });

		it("reads every note in its folder and subfolders, not `_` notes or other files", async () => {
			const v = new MemVault({
				[`${dir}/Alpha.md`]: k.note("Alpha"),
				[`${dir}/deep/Beta.md`]: k.note("Beta"),
				[`${dir}/_Draft.md`]: k.note("Draft"),
				[`${dir}/notes.txt`]: k.note("Text"),
				[`world/elsewhere/Gamma.md`]: k.note("Gamma"),
			});
			const s = k.make(v);
			expect(s.isReady()).toBe(false);
			await s.init();
			expect(s.isReady()).toBe(true);
			expect(s.folder()).toBe(dir);
			expect(s.pathOf(k.key("Alpha"))).toBe(`${dir}/Alpha.md`);
			expect(s.pathOf(k.key("Beta"))).toBe(`${dir}/deep/Beta.md`);
			expect(s.pathOf(k.key("Draft"))).toBeUndefined();
			expect(s.pathOf(k.key("Gamma"))).toBeUndefined();
		});

		it("vault events: create and modify read a note, unchanged text tells no one, delete and rename-out drop it", async () => {
			const v = new MemVault({ [`${dir}/Alpha.md`]: k.note("Alpha") });
			const s = k.make(v);
			await s.init();
			let calls = 0;
			const off = s.onChange(() => calls++);
			const settle = () => s.reload().then(() => calls--); // reload waits for the queue (and tells once)

			v.files.set(`${dir}/Beta.md`, k.note("Beta"));
			s.onCreate(file(`${dir}/Beta.md`));
			await settle();
			expect(calls).toBe(1);
			expect(s.pathOf(k.key("Beta"))).toBe(`${dir}/Beta.md`);

			// Same text again: nothing changed, no one told.
			s.onModify(file(`${dir}/Beta.md`));
			await settle();
			expect(calls).toBe(1);

			// A file outside the folder, or a `_` note, is ignored.
			v.files.set(`world/other/Delta.md`, k.note("Delta"));
			s.onModify(file(`world/other/Delta.md`));
			v.files.set(`${dir}/_Hidden.md`, k.note("Hidden"));
			s.onModify(file(`${dir}/_Hidden.md`));
			await settle();
			expect(calls).toBe(1);
			expect(s.pathOf(k.key("Delta"))).toBeUndefined();

			// Delete: dropped and told; an unknown file tells no one.
			v.remove(`${dir}/Beta.md`);
			s.onDelete(file(`${dir}/Beta.md`));
			expect(calls).toBe(2);
			expect(s.pathOf(k.key("Beta"))).toBeUndefined();
			s.onDelete(file(`${dir}/Nope.md`));
			expect(calls).toBe(2);

			// Renamed out of the folder: dropped and told at once.
			const text = v.files.get(`${dir}/Alpha.md`)!;
			v.remove(`${dir}/Alpha.md`);
			v.files.set(`world/other/Alpha.md`, text);
			s.onRename(file(`world/other/Alpha.md`), `${dir}/Alpha.md`);
			expect(calls).toBe(3);
			expect(s.pathOf(k.key("Alpha"))).toBeUndefined();

			// Unsubscribed: no more calls.
			off();
			v.files.set(`${dir}/Beta.md`, k.note("Beta"));
			s.onCreate(file(`${dir}/Beta.md`));
			await s.reload();
			expect(calls).toBe(3);
		});

		it("reload re-reads from the folder setting", async () => {
			const v = new MemVault({ [`${dir}/Alpha.md`]: k.note("Alpha"), [`lib/Beta.md`]: k.note("Beta") });
			const settings: Record<string, unknown> = {};
			const s = k.make(v, settings);
			await s.init();
			(s as unknown as { plugin: { settings: Record<string, unknown> } }).plugin.settings[k.folderKey] = "lib";
			await s.reload();
			expect(s.folder()).toBe("lib");
			expect(s.pathOf(k.key("Alpha"))).toBeUndefined();
			expect(s.pathOf(k.key("Beta"))).toBe("lib/Beta.md");
		});

		it("restoreDefault backs the note up under backups/<kind>-<date>/", async () => {
			const v = new MemVault({ [`${dir}/${k.defaultNote.name}.md`]: k.defaultNote.text });
			const s = k.make(v);
			await s.init();
			expect(await s.restoreDefault(k.key(k.defaultNote.name))).toBe(true);
			const saved = [...v.binaries.keys(), ...[...v.files.keys()].filter((p) => p.includes("/backups/"))];
			expect(saved.length).toBe(1);
			expect(saved[0].startsWith(`.obsidian/plugins/hexmaker/backups/${k.backupDir}${new Date().toISOString().slice(0, 10)}/`)).toBe(true);
		});
	});
}

describe("ensureFolder / ensureFolderPath (src/vault/ensureFolder.ts)", () => {
	it("ensureFolderPath creates every missing level; ensureFolder makes one createFolder call", async () => {
		const v = new MemVault();
		const calls: string[] = [];
		const app = v.app();
		const vault = { getAbstractFileByPath: app.vault.getAbstractFileByPath, createFolder: async (p: string) => { calls.push(p); await app.vault.createFolder(p); } };
		await ensureFolderPath(vault, "a/b/c");
		expect(calls).toEqual(["a", "a/b", "a/b/c"]);
		await ensureFolderPath(vault, "a/b/d");
		expect(calls).toEqual(["a", "a/b", "a/b/c", "a/b/d"]);
		calls.length = 0;
		await ensureFolder(vault, "x/y");
		await ensureFolder(vault, "x/y");
		expect(calls).toEqual(["x/y"]);
	});

	it("a folder made meanwhile (createFolder throws) is not an error", async () => {
		const vault = { getAbstractFileByPath: () => null, createFolder: async () => { throw new Error("Folder already exists."); } };
		await ensureFolder(vault, "a");
		await ensureFolderPath(vault, "a/b");
	});
});
