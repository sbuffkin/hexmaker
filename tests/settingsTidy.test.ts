/**
 * Settings fixed up on load (src/plugin/settingsTidy.ts) and the save
 * failure report (src/plugin/saveFailure.ts). The load path through the
 * real plugin is in tests/integration/settingsPersistence.integration.ts.
 */
import { beforeEach, describe, it } from "node:test";
import expect from "expect";
import { Notice } from "./__mocks__/obsidian"; // the mock: Notice.shown records every notice
import { DEFAULT_SETTINGS } from "../src/constants";
import { RETIRED_SETTINGS_KEYS, tidyLoadedSettings } from "../src/plugin/settingsTidy";
import { reportSaveFailure, resetSaveFailureNotices } from "../src/plugin/saveFailure";
import type { HexmakerPluginSettings } from "../src/types";
import { readSource } from "./helpers/source";

(globalThis as Record<string, unknown>).window ??= globalThis;

/** As loadSettings builds them: data.json merged over the defaults. */
const loaded = (data: Record<string, unknown>): HexmakerPluginSettings =>
	Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), data) as HexmakerPluginSettings;

describe("tidyLoadedSettings", () => {
	it("drops the retired keys, which the defaults no longer write", () => {
		const s = loaded({ mySetting: "default", zoomLevel: 2, hexEditorTerrainExpanded: true });
		tidyLoadedSettings(s);
		for (const k of RETIRED_SETTINGS_KEYS) {
			expect(k in s).toBe(false);
			expect(k in DEFAULT_SETTINGS).toBe(false);
		}
	});

	it("the smoke suite's data.json check knows each retired key (else it reports it lost)", () => {
		const run = readSource("dev", "smoke", "run.mjs");
		const listed = /const retired = new Set\(\[([^\]]*)\]\)/.exec(run)?.[1] ?? "";
		for (const k of RETIRED_SETTINGS_KEYS) expect(listed).toContain(`"${k}"`);
	});

	it("keeps 1.5.x's hex orientation: missing = flat (default), empty or unknown = pointy, a real value stays", () => {
		const cases: [Record<string, unknown>, string][] = [
			[{}, "flat"],
			[{ hexOrientation: "pointy" }, "pointy"],
			[{ hexOrientation: "flat" }, "flat"],
			[{ hexOrientation: "" }, "pointy"],
			[{ hexOrientation: null }, "pointy"],
			[{ hexOrientation: "sideways" }, "pointy"],
		];
		for (const [data, want] of cases) {
			const s = loaded(data);
			tidyLoadedSettings(s);
			expect([data, s.hexOrientation]).toEqual([data, want]);
		}
	});

	it("fills values that are saved but unusable; leaves good ones alone", () => {
		const s = loaded({ tablesFolder: "", defaultTableDice: 0, rollTableExcludedFolders: null, encounterTableExcludedFolders: "x", defaultMap: "", maps: [{ name: "coast" }] });
		tidyLoadedSettings(s);
		expect(s.tablesFolder).toBe("world/tables");
		expect(s.defaultTableDice).toBe(100);
		expect(s.rollTableExcludedFolders).toEqual(["terrain"]);
		expect(s.encounterTableExcludedFolders).toEqual(["terrain"]);
		expect(s.defaultMap).toBe("coast");
		const good = loaded({ tablesFolder: "t", defaultTableDice: 20, rollTableExcludedFolders: [], defaultMap: "north", questsFolder: "q" });
		tidyLoadedSettings(good);
		expect([good.tablesFolder, good.defaultTableDice, good.rollTableExcludedFolders, good.defaultMap, good.questsFolder]).toEqual(["t", 20, [], "north", "q"]);
	});
});

describe("reportSaveFailure", () => {
	beforeEach(() => {
		resetSaveFailureNotices();
		Notice.shown.length = 0;
	});

	it("logs every failure but shows one notice per 10 seconds", () => {
		const logged: unknown[][] = [];
		const error = console.error;
		console.error = (...a: unknown[]) => { logged.push(a); };
		try {
			const e = new Error("disk full");
			reportSaveFailure("the map notes", e, 1000);
			reportSaveFailure("the map notes", e, 5000);
			reportSaveFailure("the palette notes", e, 12_000);
		} finally {
			console.error = error;
		}
		expect(logged.map((a) => a[0])).toEqual(["Hexmaker: couldn't save the map notes", "Hexmaker: couldn't save the map notes", "Hexmaker: couldn't save the palette notes"]);
		expect(Notice.shown.map((n) => n.msg)).toEqual([
			"Hexmap World Creator: couldn't save the map notes (disk full). Your last change may not be on disk; check the vault folder can be written to.",
			"Hexmap World Creator: couldn't save the palette notes (disk full). Your last change may not be on disk; check the vault folder can be written to.",
		]);
	});
});
