/**
 * The Events ledger (SP6, plan-tables-everywhere §2.7): a readable
 * `## Events` table in a map note. Round trip, hand edits kept, a deleted
 * row frees its event, and rolls by hand are labelled untracked (T7).
 */
import { describe, it } from "node:test";
import expect from "expect";
import {
	eventOnMap,
	eventRow,
	handRollLabel,
	ledgerHas,
	ledgerName,
	OnceTracker,
	readEvents,
	untrackedOnceLabel,
	withEvents,
	withoutEvents,
	type LedgerEvent,
} from "../src/arrival/eventsLedger";
import { parseRandomTable } from "../src/random-tables/randomTable";
import { memoryLookup, resolveOdds, resolveRoll } from "../src/random-tables/resolve";
import { parseMapNote } from "../src/maps/mapNote";

const NOTE = [
	"---",
	"hexmaker-map: 5",
	"palette: Space - Sector",
	"---",
	"# Drift",
	"",
	"## Hexes",
	"| Hex | Terrain |",
	"| --- | --- |",
	"| 4, 7 | anomaly |",
	"",
	"## Notes",
	"Kira's notes.",
	"",
].join("\n");

const FLEET: LedgerEvent = { event: "[[The Silent Fleet]]", where: "[[_drift]] 4, 7", when: "2026-10-11", from: "[[Rare events]]" };

describe("the ## Events table", () => {
	it("is added only when the first event fires, at the end, and reads back", () => {
		expect(withEvents(NOTE, [])).toBe(NOTE);
		const out = withEvents(NOTE, [FLEET]);
		expect(out.startsWith(NOTE.trimEnd())).toBe(true);
		expect(out).toContain("## Events");
		expect(out).toContain("| Event | Where | When | From |");
		expect(out).toContain("| [[The Silent Fleet]] | [[_drift]] 4, 7 | 2026-10-11 | [[Rare events]] |");
		expect(readEvents(out)).toEqual([FLEET]);
		// The map note still reads the same.
		expect(parseMapNote(out)!.hexes.get("4_7")?.terrain).toBe("anomaly");
	});

	it("adds rows under the existing table, in the user's column order, keeping hand edits", () => {
		const hand = withEvents(NOTE, [FLEET])
			.replace("| Event | Where | When | From |", "| When | Event | From | Where | Who |")
			.replace("| --- | --- | --- | --- |", "| --- | --- | --- | --- | --- |")
			.replace("| [[The Silent Fleet]] | [[_drift]] 4, 7 | 2026-10-11 | [[Rare events]] |", "| 2026-10-11 | [[The Silent Fleet]] | [[Rare events]] | [[_drift]] 4, 7 | Kira |");
		const more = withEvents(hand, [{ event: "a sun going out", where: "[[_drift]]", when: "2026-10-12", from: "[[Rare events]]" }]);
		expect(more).toContain("| 2026-10-11 | [[The Silent Fleet]] | [[Rare events]] | [[_drift]] 4, 7 | Kira |");
		expect(more).toContain("| 2026-10-12 | a sun going out | [[Rare events]] | [[_drift]] |  |");
		expect(readEvents(more).map((e) => e.event)).toEqual(["[[The Silent Fleet]]", "a sun going out"]);
		expect(more).toContain("Kira's notes.");
	});

	it("keeps CRLF notes CRLF", () => {
		const crlf = NOTE.replace(/\n/g, "\r\n");
		const out = withEvents(crlf, [FLEET]);
		expect(out.replace(/\r\n/g, "")).not.toContain("\n");
		expect(readEvents(out)).toEqual([FLEET]);
	});

	it("an Events section with no table yet gets one under its text", () => {
		const note = `${NOTE}\n## Events\nWhat has happened.\n\n## Later\nx\n`;
		const out = withEvents(note, [FLEET]);
		expect(readEvents(out)).toEqual([FLEET]);
		expect(out.indexOf("[[The Silent Fleet]]")).toBeLessThan(out.indexOf("## Later"));
		expect(out).toContain("What has happened.");
	});

	it("withoutEvents takes out only the rows asked for", () => {
		const two = withEvents(NOTE, [FLEET, { event: "x", where: "[[_other]] 1, 1", when: "", from: "" }]);
		const out = withoutEvents(two, (e) => eventOnMap(e, "other"));
		expect(readEvents(out)).toEqual([FLEET]);
		expect(withoutEvents(out, () => false)).toBe(out);
	});
});

describe("matching ledger rows to table rows", () => {
	it("by the row's result and the table's name, any case, links or not", () => {
		expect(ledgerName("[[world/tables/Rare events|Rare]]")).toBe("rare events");
		expect(ledgerName("world/tables/Rare events.md")).toBe("rare events");
		expect(ledgerName("[[Tundra#Mix]]")).toBe("tundra#mix");
		expect(ledgerHas([FLEET], "world/tables/Rare events.md", "The Silent Fleet")).toBe(true);
		expect(ledgerHas([FLEET], "world/tables/Other.md", "The Silent Fleet")).toBe(false);
		// A row typed by hand with no From counts for any table.
		expect(ledgerHas([{ ...FLEET, from: "" }], "world/tables/Other.md", "the silent fleet")).toBe(true);
		// Extra words after the link are fine.
		expect(ledgerHas([{ ...FLEET, event: "[[The Silent Fleet]] (Kira found it)" }], "Rare events", "The Silent Fleet")).toBe(true);
	});

	it("a fired event becomes a readable row", () => {
		expect(eventRow({ table: "world/tables/Rare events.md", index: 0, scope: "world", result: "The Silent Fleet", link: true, hex: "4_7" }, { mapLink: "[[_drift]]", date: "2026-10-11" }))
			.toEqual(FLEET);
		expect(eventRow({ table: "Sector hexes", index: 2, scope: "map", result: "silent fleet", link: false }, { mapLink: "[[_drift]]", date: "2026-10-11" }))
			.toEqual({ event: "silent fleet", where: "[[_drift]]", when: "2026-10-11", from: "[[Sector hexes]]" });
	});
});

const RARE = parseRandomTable([
	"---",
	"dice: 100",
	"---",
	"| d100 | Result | Weight | Once |",
	"| --- | --- | ---: | --- |",
	"| 01–50 | [[The Silent Fleet]] | 50 | per world |",
	"| 51–75 | a sun going out | 25 | per map |",
	"| 76–100 | [[Derelicts]] | 25 |  |",
].join("\n"));

describe("rolling with a ledger (the resolver's isUsed)", () => {
	const lookup = memoryLookup({ "Rare events": RARE });

	it("a ledgered row is left out and the rest rescaled", () => {
		const used = new OnceTracker({ world: [{ ...FLEET, from: "[[Rare events]]" }], map: [] });
		const odds = resolveOdds("Rare events", lookup, { isUsed: used.isUsed });
		expect(odds.map((o) => [o.value, o.odds]).sort()).toEqual([["Derelicts", 0.5], ["a sun going out", 0.5]]);
	});

	it("per world rows check the world's ledger, per map rows the map's", () => {
		const sun = { event: "a sun going out", where: "", when: "", from: "[[Rare events]]" };
		// In the world's ledger only: the per-map row may still come up here.
		const t = new OnceTracker({ world: [sun], map: [] });
		expect(resolveOdds("Rare events", lookup, { isUsed: t.isUsed }).some((o) => o.value === "a sun going out")).toBe(true);
		const m = new OnceTracker({ world: [], map: [sun] });
		expect(resolveOdds("Rare events", lookup, { isUsed: m.isUsed }).some((o) => o.value === "a sun going out")).toBe(false);
	});

	it("the roll says which Once rows it landed on, and one run fires each at most once", () => {
		const t = new OnceTracker();
		const got: string[] = [];
		for (let seed = 1; seed < 200; seed++) {
			const r = resolveRoll("Rare events", lookup, { seed, isUsed: t.isUsed });
			if (r.onces) expect(r.onces.map((o) => o.result)).toEqual([r.value]);
			t.fire(r.onces, `${seed}_0`);
			got.push(r.value);
		}
		expect(got.filter((g) => g === "The Silent Fleet")).toHaveLength(1);
		expect(got.filter((g) => g === "a sun going out")).toHaveLength(1);
		expect(t.fired.map((f) => [f.result, f.scope, f.link])).toEqual(expect.arrayContaining([["The Silent Fleet", "world", true], ["a sun going out", "map", false]]));
		expect(t.fired).toHaveLength(2);
	});
});

describe("rolls by hand are not tracked (T7)", () => {
	it("a Once row says so; a repeatable row says nothing", () => {
		expect(untrackedOnceLabel(RARE, 0)).toBe("once per world: not tracked here");
		expect(untrackedOnceLabel(RARE, 1)).toBe("once per map: not tracked here");
		expect(untrackedOnceLabel(RARE, 2)).toBeUndefined();
		expect(handRollLabel(RARE, { entry: RARE.entries[0], index: 0, face: 7 })).toBe("d100 → 7 · once per world: not tracked here");
		expect(handRollLabel(RARE, { entry: RARE.entries[2], index: 2, face: 90 })).toBe("d100 → 90");
	});
});
