import { describe, it } from "node:test";
import expect from "expect";
import { emptyFlower, type Flower } from "../src/hexflower/flower";
import { fillFromPalette } from "../src/hexflower/fromPalette";
import { buildFlowerNote, isFlowerNote, parseFlowerNote, parseRange, updateFlowerNote } from "../src/hexflower/flowerNote";
import { FlowerStore, hexFlowersFolder } from "../src/hexflower/FlowerStore";
import { MemVault } from "./helpers/memVault";
import { TFile } from "obsidian";

/** plan-hex-flower phase 3: the hex flower note (readable, forgiving, hand edits kept). */

describe("the hex flower note", () => {
	const f = (): Flower => {
		const x = emptyFlower("Wilds", "Expanded");
		x.cells = fillFromPalette(["grassland", "forest", "hills"], 3);
		x.cells[0] = { result: "[[Old shrine|shrine]]", notes: "moss | ivy" };
		x.cells[1] = { result: "(blocked)" };
		return x;
	};

	it("round-trips: keys, cells (links, pipes, notes), moves", () => {
		const note = buildFlowerNote(f());
		expect(isFlowerNote(note)).toBe(true);
		expect(note).toMatch(/^hexmaker-hex-flower: 1$/m);
		expect(note).toContain("```duckmage-hex-flower");
		expect(note).toContain("> [!info]");
		const back = parseFlowerNote(note, "Wilds")!;
		expect(back.problems).toEqual([]);
		expect(back.flower).toEqual(f());
	});

	it("reads hand edits forgivingly and reports what it can't read", () => {
		const note = [
			"---", "hexmaker-hex-flower: 1", "start: 40", "edges: stay", "dice: 2d6", "tags: [mine]", "---",
			"My own words.",
			"## Cells",
			"| Result | Cell | Mood |", "|---|---|---|",
			"| forest | 3 | dark |", "| hills | 3 | |", "| x | twelve | |",
			"## Moves",
			"| Move | 2d6 |", "|---|---|",
			"| N | 2-7 |", "| SW | 8 to 12 |", "| sideways | 1 |",
		].join("\n");
		const r = parseFlowerNote(note, "Mine")!;
		expect(r.flower.start).toBe(10);
		expect(r.flower.edges).toBe("stay");
		expect(r.flower.cells[2]).toEqual({ result: "forest" });
		expect(r.flower.cells[0].result).toBe("(nothing)");
		expect(r.flower.moves).toEqual([{ from: 2, to: 7, move: "up" }, { from: 8, to: 12, move: "down-left" }]);
		expect(r.problems.length).toBe(4);
		expect(parseFlowerNote("---\ntitle: x\n---\n", "x")).toBeNull();
	});

	it("writes patch only its keys and tables: prose, other keys and other columns stay", () => {
		const note = [
			"---", "hexmaker-hex-flower: 1", "start: 10", "tags: [mine]", "---",
			"My own words.",
			"## Cells",
			"| Cell | Result | Notes | Mood |", "|---|---|---|---|",
			"| 1 | forest | | dark |",
			"",
			"After the table.",
		].join("\n");
		const flower = parseFlowerNote(note, "Mine")!.flower;
		flower.cells[0] = { result: "hills" };
		const out = updateFlowerNote(note, flower);
		expect(out).toContain("tags: [mine]");
		expect(out).toContain("My own words.");
		expect(out).toContain("After the table.");
		expect(out).toMatch(/^\| 1 \| hills \|  \| dark \|$/m);
		expect(out).toMatch(/^## Moves$/m);
		expect(parseFlowerNote(out, "Mine")!.flower.cells[0].result).toBe("hills");
		expect(parseRange("2–3")).toEqual([2, 3]);
	});
});

describe("the hex flowers store", () => {
	const plugin = (v: MemVault, settings: Record<string, unknown> = {}) => ({
		app: v.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", ...settings },
		saveSettings: async () => {},
	});
	const tfile = (path: string): TFile => {
		const f = new TFile();
		f.path = path;
		f.name = path.slice(path.lastIndexOf("/") + 1);
		f.basename = f.name.replace(/\.md$/, "");
		f.extension = "md";
		return f;
	};

	it("lives in <world>/hex flowers (or its setting), reads flower notes only, finds them by name or link", async () => {
		expect(hexFlowersFolder({ worldFolder: "world" })).toBe("world/hex flowers");
		expect(hexFlowersFolder({ worldFolder: "world", hexFlowersFolder: "/x/y/" })).toBe("x/y");
		const v = new MemVault({
			"world/hex flowers/Wilds.md": buildFlowerNote(emptyFlower("Wilds")),
			"world/hex flowers/Plain note.md": "# just a note",
			"world/elsewhere/Other.md": buildFlowerNote(emptyFlower("Other")),
		});
		const s = new FlowerStore(plugin(v) as never, () => {});
		await s.init();
		expect(s.list().map((e) => e.flower.name)).toEqual(["Wilds"]);
		expect(s.get("wilds")?.path).toBe("world/hex flowers/Wilds.md");
		expect(s.get("world/hex flowers/Wilds")?.flower.name).toBe("Wilds");
		expect(s.get("Other")).toBeUndefined();
	});

	it("creates under a free name, saves by patching, reports problems once per edit", async () => {
		const said: string[] = [];
		const v = new MemVault({});
		const s = new FlowerStore(plugin(v) as never, (m) => said.push(m));
		await s.init();
		const path = await s.create(emptyFlower("Wilds"));
		expect(path).toBe("world/hex flowers/Wilds.md");
		expect(await s.create(emptyFlower("Wilds"))).toBe("world/hex flowers/Wilds 2.md");
		v.files.set(path, v.files.get(path)!.replace("## Cells", "My words.\n\n## Cells"));
		s.onModify(tfile(path));
		const f = s.get("Wilds")!.flower;
		f.cells[0] = { result: "hills" };
		await s.save(path, f);
		expect(v.files.get(path)).toContain("My words.");
		expect(v.files.get(path)).toMatch(/^\| 1 \| hills \|/m);
		const bad = v.files.get(path)!.replace("start: 10", "start: 99");
		v.files.set(path, bad);
		s.onModify(tfile(path));
		await s.reload();
		v.files.set(path, bad + "\n");
		s.onModify(tfile(path));
		await s.reload();
		expect(said.filter((m) => /start/.test(m))).toHaveLength(1);
	});
});
