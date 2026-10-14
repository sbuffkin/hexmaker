import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { hexHoverLabel, hexKeyCoords, overlayClosed, pointerMovedFrom } from "../src/hex-map/hexHover";
import { readSurface } from "./helpers/source";

describe("hexHoverLabel", () => {
	it("names the hex's terrain and coordinates", () => {
		expect(hexHoverLabel(10, 7, "ice planet", "void")).toBe("ice planet · hex 10, 7");
	});

	it("marks the map's base terrain on a hex with none of its own", () => {
		expect(hexHoverLabel(3, 4, null, "void")).toBe("void (map base) · hex 3, 4");
	});

	it("ends with the notes the hex links (round 6 S3)", () => {
		expect(hexHoverLabel(6, 6, "beach", null, "Gullmouth", "Town: Gullmouth"))
			.toBe("Gullmouth · beach · hex 6, 6 · Town: Gullmouth");
		expect(hexHoverLabel(6, 6, "beach", null, null, "")).toBe("beach · hex 6, 6");
	});

	it("names the hex's region after its coordinates (Biomes view, where the outline is hidden)", () => {
		expect(hexHoverLabel(4, 2, "taiga", null, null, "", "Frostmarch")).toBe("taiga · hex 4, 2 · Region: Frostmarch");
		expect(hexHoverLabel(4, 2, "taiga", null, "Old Pass", "Town: Rime", "Frostmarch")).toBe("Old Pass · taiga · hex 4, 2 · Region: Frostmarch · Town: Rime");
	});

	it("falls back to the coordinates", () => {
		expect(hexHoverLabel(0, 0, null, null)).toBe("Hex 0, 0");
	});
});

describe("coordinates read \"x, y\" everywhere people see them (fresh-eyes round 5)", () => {
	it("hexKeyCoords turns an x_y key into x, y", () => {
		expect(hexKeyCoords("3_4")).toBe("3, 4");
		expect(hexKeyCoords("-2_10")).toBe("-2, 10");
		expect(hexKeyCoords("not-a-key")).toBe("not-a-key");
	});

	it("titles, cards and notices don't show x_y or x,y", () => {
		const read = (...p: string[]) => readFileSync(path.join(process.cwd(), "src", ...p), "utf8");
		const files = [
			readSurface("map-view"),
			read("hex-map", "TokenInfoModal.ts"),
			readSurface("hex-editor"),
			readSurface("hex-table"),
		];
		for (const src of files) {
			expect(src).not.toMatch(/[Hh]ex \$\{[^}]+\},\$\{/); // "Hex 3,4"
			expect(src).not.toMatch(/[Hh]ex \$\{[\w.]*\.hex\}/); // "Hex 3_4"
			expect(src).not.toMatch(/on \$\{x\},\$\{y\}/);
		}
		expect(readSurface("hex-table")).not.toMatch(/`\$\{x\},\$\{y\}/);
	});
});

describe("no stray hover highlight after a modal closes (fresh-eyes round 5)", () => {
	const el = (...classes: string[]) => ({ nodeType: 1, classList: { contains: (c: string) => classes.includes(c) } }) as unknown as Node;

	it("notices a modal or menu leaving the page", () => {
		expect(overlayClosed([el("modal-container", "mod-dim")])).toBe(true);
		expect(overlayClosed([el("menu")])).toBe(true);
		expect(overlayClosed([el("notice-container"), { nodeType: 3 } as unknown as Node])).toBe(false);
		expect(overlayClosed([])).toBe(false);
	});

	it("resumes hover only once the pointer really moves", () => {
		expect(pointerMovedFrom(null, 5, 5)).toBe(false);
		expect(pointerMovedFrom({ x: 5, y: 5 }, 5, 5)).toBe(false);
		expect(pointerMovedFrom({ x: 5, y: 5 }, 6, 5)).toBe(true);
	});

	it("the map pauses hover on close and the CSS hides it meanwhile", () => {
		const view = readSurface("map-view");
		const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\r\n/g, "\n");
		expect(view).toMatch(/overlayClosed\(Array\.from\(r\.removedNodes\)\)[\s\S]{0,200}addClass\("duckmage-hover-paused"\)/);
		expect(view).toMatch(/pointerMovedFrom\(hoverPausedAt, e\.clientX, e\.clientY\)[\s\S]{0,120}removeClass\("duckmage-hover-paused"\)/);
		expect(css.slice(css.indexOf("Fresh-eyes r5 (map view"))).toMatch(/\.duckmage-hover-paused \.duckmage-hex:not\(\.is-selected\):hover::after \{\s*content: none;/);
	});
});
