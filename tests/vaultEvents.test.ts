/**
 * src/plugin/vaultEvents.ts: one handler per event, its steps in the order
 * the separate handlers used to run (hex-note properties first, then the
 * stores, then the tables), and one step throwing doesn't stop the rest.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { registerVaultEvents } from "../src/plugin/vaultEvents";

type Handler = (...args: unknown[]) => unknown;

function fakePlugin(opts: { throwIn?: string } = {}) {
	const log: string[] = [];
	const handlers = new Map<string, Handler[]>();
	const on = (scope: string) => (name: string, fn: Handler) => {
		const key = `${scope}:${name}`;
		handlers.set(key, [...(handlers.get(key) ?? []), fn]);
		return {};
	};
	const rec = (name: string) => () => {
		log.push(name);
		if (opts.throwIn === name) throw new Error(name);
	};
	const plugin = {
		app: {
			vault: { on: on("vault"), getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
			metadataCache: { on: on("meta") },
			workspace: { on: on("ws") },
		},
		settings: { iconsFolder: "icons", tablesFolder: "tables", workflowsFolder: "workflows", regionsFolder: "" },
		registerEvent: () => {},
		hexProps: { onMetadataChanged: rec("hexProps.changed"), onFileOpen: rec("hexProps.open"), onRename: rec("hexProps.rename"), onDelete: rec("hexProps.delete") },
		loadAvailableIcons: rec("icons"),
		paletteStore: { onModify: rec("palette.modify"), onDelete: rec("palette.delete"), onRename: rec("palette.rename"), flushPendingDerived: rec("palette.flush") },
		moduleStores: [{ onCreate: rec("module.create"), onModify: rec("module.modify"), onDelete: rec("module.delete"), onRename: rec("module.rename") }],
		mapStore: { onCreate: rec("map.create"), onModify: rec("map.modify"), onDelete: rec("map.delete"), isReady: () => false, resolve: () => null },
		calloutMemory: { forget: rec("callout.forget"), rename: rec("callout.rename") },
		regionOrFactionKind: () => null,
	};
	registerVaultEvents(plugin as never);
	const fire = (key: string, ...args: unknown[]) => {
		const hs = handlers.get(key) ?? [];
		expect(hs).toHaveLength(1);
		for (const h of hs) void h(...args);
	};
	return { log, fire, handlers };
}

const file = (path: string) => Object.assign(new TFile(), { path, name: path.split("/").pop()!, basename: path.split("/").pop()!.replace(/\.\w+$/, "") });

describe("vault events: one dispatcher per event, order kept", () => {
	it("registers exactly one handler per event", () => {
		const { handlers } = fakePlugin();
		expect([...handlers.keys()].sort()).toEqual(["meta:changed", "vault:create", "vault:delete", "vault:modify", "vault:rename", "ws:active-leaf-change", "ws:file-open"]);
		for (const hs of handlers.values()) expect(hs).toHaveLength(1);
	});

	it("create, modify, delete and rename run their steps in the old order", () => {
		const { log, fire } = fakePlugin();
		const icon = file("icons/a.png");
		fire("vault:create", icon);
		expect(log.splice(0)).toEqual(["icons", "palette.modify", "module.create", "map.create"]);
		fire("vault:modify", icon);
		expect(log.splice(0)).toEqual(["palette.modify", "module.modify", "map.modify"]);
		fire("vault:delete", icon);
		expect(log.splice(0)).toEqual(["hexProps.delete", "icons", "map.delete", "palette.delete", "module.delete", "callout.forget"]);
		fire("vault:rename", icon, "icons/b.png");
		expect(log.splice(0)).toEqual(["hexProps.rename", "icons", "palette.rename", "module.rename", "callout.rename"]);
		fire("meta:changed", icon, "", {});
		expect(log.splice(0)).toEqual(["hexProps.changed"]);
		fire("ws:file-open", icon);
		expect(log.splice(0)).toEqual(["hexProps.open"]);
		fire("ws:active-leaf-change");
		expect(log.splice(0)).toEqual(["palette.flush"]);
	});

	it("a file outside the icons folder doesn't reload the icons", () => {
		const { log, fire } = fakePlugin();
		fire("vault:create", file("notes/a.md"));
		expect(log).toEqual(["palette.modify", "module.create", "map.create"]);
	});

	it("a throwing step stops only its own group, as separate handlers did (and is logged)", () => {
		const logged: unknown[] = [];
		const error = console.error;
		console.error = (...a: unknown[]) => { logged.push(a[1]); };
		try {
		const { log, fire } = fakePlugin({ throwIn: "hexProps.delete" });
		fire("vault:delete", file("icons/a.png"));
		expect(log).toEqual(["hexProps.delete", "icons", "map.delete", "palette.delete", "module.delete", "callout.forget"]);
		const inGroup = fakePlugin({ throwIn: "map.delete" });
		inGroup.fire("vault:delete", file("icons/a.png"));
		expect(inGroup.log).toEqual(["hexProps.delete", "icons", "map.delete"]);
		} finally {
			console.error = error;
		}
		expect(logged.map((e) => (e as Error).message)).toEqual(["hexProps.delete", "map.delete"]);
	});
});
