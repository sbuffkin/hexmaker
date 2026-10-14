import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { bindPorts, resetPorts, type PortsHost } from "../src/ports";
import { canDo, noteHandEdit } from "../src/modeGate";
import { canEditPaths } from "../src/paths/editGate";
import { numberBoxShown } from "../src/ui/numberBoxes";
import { getTerrainFromFile } from "../src/frontmatter";
import { DEBUG_MODE_KEY } from "../src/ui/debugMode";

const SETTERS = [
	"setHexDataSource",
	"setModeMapLookup",
	"setHandEditListener",
	"setPathEditMapLookup",
	"setIconPackDefault",
	"setNumberBoxDebug",
	"setPaletteTerrainSource",
];
// setBiomeSource is the World maps module's own port (BiomeStore feeds it), outside src/ports.ts.

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
/** Setter names called in a block of source text, in call order. */
const calls = (text: string) => [...text.matchAll(/\b(set[A-Z]\w+)\(/g)].map((m) => m[1]).filter((n) => SETTERS.includes(n));
const body = (text: string, start: string) => {
	const at = text.indexOf(start);
	expect(at).toBeGreaterThan(-1);
	return text.slice(at, text.indexOf("\n}\n", at));
};

function fakeHost(locked: Set<string>) {
	const storage = new Map<string, unknown>();
	const handEdits: string[] = [];
	const host = {
		settings: { mapKinds: ["space"] },
		app: { loadLocalStorage: (k: string) => storage.get(k), saveLocalStorage: (k: string, v: unknown) => storage.set(k, v) },
		mapStore: {
			isReady: () => true,
			resolve: (p: string) => (p === "hexes/m/1_2.md" ? { map: "m", key: "1_2" } : null),
			get: () => ({ terrain: "forest" }),
			set: () => true,
		},
		arrival: { lockOnHandEdit: (name: string) => handEdits.push(name) },
		getMap: (name: string) => (locked.has(name) ? { workMode: "play" } : {}),
		getPaletteOrPresetTerrains: () => [],
	};
	return { host: host as unknown as PortsHost, storage, handEdits };
}

describe("ports (src/ports.ts)", () => {
	afterEach(() => resetPorts());

	it("bindPorts wires the plugin-fed ports to the plugin", () => {
		const { host, storage, handEdits } = fakeHost(new Set(["p"]));
		bindPorts(host);
		expect(canDo("p", "paint-terrain")).toBe(false);
		expect(canDo("b", "paint-terrain")).toBe(true);
		expect(canEditPaths("p", "draw")).toBe(false);
		noteHandEdit("b", "paint-terrain");
		expect(handEdits).toEqual(["b"]);
		expect(numberBoxShown()).toBe(false);
		storage.set(DEBUG_MODE_KEY, true);
		expect(numberBoxShown()).toBe(true);
		expect(getTerrainFromFile({} as never, "hexes/m/1_2.md")).toBe("forest");
	});

	it("resetPorts unbinds them all", () => {
		const { host, storage, handEdits } = fakeHost(new Set(["p"]));
		bindPorts(host);
		resetPorts();
		storage.set(DEBUG_MODE_KEY, true);
		expect(canDo("p", "paint-terrain")).toBe(true);
		expect(canEditPaths("p", "draw")).toBe(true);
		noteHandEdit("p", "paint-terrain");
		expect(handEdits).toEqual([]);
		expect(numberBoxShown()).toBe(false);
	});

	it("resetPorts covers the seven plugin-fed setters; bindPorts covers every one onload sets, in the same order", () => {
		const ports = read("src", "ports.ts");
		expect([...new Set(calls(body(ports, "export function resetPorts")))].sort()).toEqual([...SETTERS].sort());
		// Until the plugin lane switches onload to bindPorts(this): the same setters, same order.
		const onload = calls(read("src", "HexmakerPlugin.ts"));
		const bound = calls(body(ports, "export function bindPorts"));
		if (onload.length) expect(bound).toEqual(onload);
		else expect(read("src", "HexmakerPlugin.ts")).toMatch(/bindPorts\(this\)/);
	});
});
