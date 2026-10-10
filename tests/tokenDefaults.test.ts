import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_TOKEN_FILL, isTokenNoteCandidate, pickTokenFill, TOKEN_FILL_PALETTE } from "../src/hex-map/tokenDefaults";

describe("pickTokenFill (fresh-eyes round 3: every token was the same blue)", () => {
	it("starts with the default blue on an empty map", () => {
		expect(pickTokenFill([])).toBe(DEFAULT_TOKEN_FILL);
	});

	it("gives the next token a different colour from the ones already placed", () => {
		const first = pickTokenFill([]);
		const second = pickTokenFill([first]);
		const third = pickTokenFill([first, second]);
		expect(second).not.toBe(first);
		expect(new Set([first, second, third]).size).toBe(3);
	});

	it("counts tokens without a fill as the default, and ignores case", () => {
		expect(pickTokenFill([undefined])).toBe(TOKEN_FILL_PALETTE[1]);
		expect(pickTokenFill([DEFAULT_TOKEN_FILL.toUpperCase()])).toBe(TOKEN_FILL_PALETTE[1]);
	});

	it("reuses the least-used colour once the palette is exhausted", () => {
		const all = [...TOKEN_FILL_PALETTE, TOKEN_FILL_PALETTE[0]];
		expect(pickTokenFill(all)).toBe(TOKEN_FILL_PALETTE[1]);
	});

	it("ignores custom fills outside the palette", () => {
		expect(pickTokenFill(["#123456"])).toBe(DEFAULT_TOKEN_FILL);
	});
});

describe("isTokenNoteCandidate (token note picker listed tables, generators…)", () => {
	const include = ["world", "world/towns"];
	const exclude = ["world/tables", "world/workflows", "world/hexes", "world/palettes", "world/generators", ""];

	it("offers world notes such as towns and tokens", () => {
		expect(isTokenNoteCandidate("world/towns/Ashby.md", "Ashby", include, exclude)).toBe(true);
		expect(isTokenNoteCandidate("world/tokens/Far Horizon.md", "Far Horizon", include, exclude)).toBe(true);
	});

	it("leaves out tables, generators, palettes, hex and map notes", () => {
		expect(isTokenNoteCandidate("world/tables/terrain/encounters/ocean.md", "ocean", include, exclude)).toBe(false);
		expect(isTokenNoteCandidate("world/generators/forest.md", "forest", include, exclude)).toBe(false);
		expect(isTokenNoteCandidate("world/palettes/Limited.md", "Limited", include, exclude)).toBe(false);
		expect(isTokenNoteCandidate("world/hexes/barony/0_7.md", "0_7", include, exclude)).toBe(false);
	});

	it("leaves out _ notes and notes outside the world", () => {
		expect(isTokenNoteCandidate("world/towns/_template.md", "_template", include, exclude)).toBe(false);
		expect(isTokenNoteCandidate("journal/today.md", "today", include, exclude)).toBe(false);
	});

	it("doesn't mistake a folder prefix for the folder", () => {
		expect(isTokenNoteCandidate("world/tables-old/x.md", "x", include, exclude)).toBe(true);
	});

	it("allows the whole vault when no include folder is set", () => {
		expect(isTokenNoteCandidate("journal/today.md", "today", [""], exclude)).toBe(true);
	});
});
