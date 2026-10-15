import { describe, it } from "node:test";
import expect from "expect";
import { areNeighbours, hexKey, hexPair, hexXY, isHexKey, neighbourKeys, strictHexXY } from "../src/hexKey";
import { hexNeighbors } from "../src/hex-map/hexGeometry";

/** What the call sites did before the helper: the behaviour hexXY keeps. */
const oldParse = (k: string) => k.split("_").map(Number);

describe("hexKey / hexXY", () => {
  it("builds and reads keys, negatives included", () => {
    expect(hexKey(3, 4)).toBe("3_4");
    expect(hexKey(-1, -12)).toBe("-1_-12");
    expect(hexKey(0, -0)).toBe("0_0");
    expect(hexXY("3_4")).toEqual({ x: 3, y: 4 });
    expect(hexXY("-1_-12")).toEqual({ x: -1, y: -12 });
    expect(hexPair("-7_5")).toEqual([-7, 5]);
  });

  it("round-trips", () => {
    for (const [x, y] of [[0, 0], [5, -3], [-20, 17], [1000, 1]]) {
      expect(hexXY(hexKey(x, y))).toEqual({ x, y });
      expect(hexPair(hexKey(x, y))).toEqual([x, y]);
    }
  });

  it("is lenient with malformed keys, like split(\"_\").map(Number)", () => {
    for (const bad of ["abc", "3_x", "x_3", "1_2_3", "_4", "4_", "", " 3_4 ", "3.5_2", "3"]) {
      const [ox, oy] = oldParse(bad);
      const { x, y } = hexXY(bad);
      expect(Object.is(x, ox)).toBe(true);
      // the one difference: a missing y is NaN, not undefined
      expect(Object.is(y, oy === undefined ? NaN : oy)).toBe(true);
    }
    expect(hexXY("abc")).toEqual({ x: NaN, y: NaN });
    expect(hexXY("1_2_3")).toEqual({ x: 1, y: 2 });
    expect(hexXY("_4")).toEqual({ x: 0, y: 4 });
    expect(hexXY("3")).toEqual({ x: 3, y: NaN });
    expect(() => hexXY("")).not.toThrow();
  });
});

describe("isHexKey / strictHexXY", () => {
  it("accepts exact integer keys only", () => {
    for (const ok of ["0_0", "3_4", "-1_-2", "12_-7"]) expect(isHexKey(ok)).toBe(true);
    for (const bad of ["", "3", "3_", "_3", "3_4_5", " 3_4", "3_4 ", "3.5_4", "a_b", "3,4", "+3_4", "--1_2"]) {
      expect(isHexKey(bad)).toBe(false);
      expect(strictHexXY(bad)).toBeNull();
    }
    expect(strictHexXY("-3_14")).toEqual({ x: -3, y: 14 });
  });
});

describe("neighbourKeys / areNeighbours", () => {
  it("are hexNeighbors as keys", () => {
    for (const orientation of ["flat", "pointy"] as const) {
      for (const stagger of ["odd", "even"] as const) {
        for (const [x, y] of [[0, 0], [3, 4], [-2, -5]]) {
          const keys = neighbourKeys(hexKey(x, y), orientation, stagger);
          expect(keys).toEqual(hexNeighbors(x, y, orientation, stagger).map(([a, b]) => `${a}_${b}`));
          for (const k of keys) expect(areNeighbours(hexKey(x, y), k, orientation, stagger)).toBe(true);
          expect(areNeighbours(hexKey(x, y), hexKey(x, y), orientation, stagger)).toBe(false);
          expect(areNeighbours(hexKey(x, y), hexKey(x + 5, y), orientation, stagger)).toBe(false);
        }
      }
    }
  });

  it("a malformed key has no real neighbours", () => {
    expect(areNeighbours("abc", "0_0", "flat")).toBe(false);
  });
});
