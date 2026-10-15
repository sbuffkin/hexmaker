import { describe, it } from "node:test";
import expect from "expect";
import { sizeFromInput } from "../src/sizeInput";

/** Fresh-eyes r4: the wizard preview follows the size while typing. */

const live = { min: 2, max: 200, fallback: 20, committed: false };
const done = { ...live, committed: true };

describe("sizeFromInput", () => {
	it("while typing: a valid size is used at once", () => {
		expect(sizeFromInput("12", live)).toBe(12);
		expect(sizeFromInput("200", live)).toBe(200);
	});

	it("while typing: half-typed or out-of-range values wait (undefined)", () => {
		expect(sizeFromInput("1", live)).toBeUndefined(); // on the way to "12"
		expect(sizeFromInput("", live)).toBeUndefined();
		expect(sizeFromInput("2000", live)).toBeUndefined();
		expect(sizeFromInput("abc", live)).toBeUndefined();
	});

	it("on commit: clamps into range, falls back when empty or zero", () => {
		expect(sizeFromInput("1", done)).toBe(2);
		expect(sizeFromInput("999", done)).toBe(200);
		expect(sizeFromInput("", done)).toBe(20);
		expect(sizeFromInput("0", done)).toBe(20);
		expect(sizeFromInput("-4", done)).toBe(2);
		expect(sizeFromInput("15", done)).toBe(15);
	});
});
