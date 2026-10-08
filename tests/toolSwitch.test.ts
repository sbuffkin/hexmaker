import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Regression guard: switching terrain (or any tool's choice) must not turn
 * the tool off. The terrain button and the right-click "Switch …" entries
 * used to exit the tool and then open its picker, so closing the picker
 * without picking (Escape, clicking away, after only changing brush size)
 * left no tool active. Pickers now overwrite the tool's state only when
 * something is picked.
 */

const src = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");

/** Source of the method `name` (up to its closing brace at two-space indent). */
function method(name: string): string {
  const start = src.indexOf(`  private ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

describe("switching a tool's choice keeps the tool", () => {
  it("the terrain picker doesn't exit terrain mode before opening", () => {
    expect(method("handleTerrainButton")).not.toMatch(/exitTerrainMode\(\)/);
  });

  it("right-click Switch entries never exit the tool first", () => {
    const menu = method("showPainterContextMenu");
    const switches = [...menu.matchAll(/onSwitch = ([^;]+);/g)].map((m) => m[1]);
    expect(switches.length).toBeGreaterThanOrEqual(8);
    for (const s of switches) expect(s).not.toMatch(/exit\w*Mode\(/);
  });

  it("paint tools offer Paint mode (not Link mode) to leave erasing", () => {
    const menu = method("showPainterContextMenu");
    const terrain = menu.slice(menu.indexOf('mode === "terrain"'), menu.indexOf('mode === "tableLink"'));
    expect(terrain).not.toContain("Link mode");
    expect(terrain.match(/"Paint mode"/g)?.length).toBe(2);
  });

  it("the brush only applies to terrain, so icons don't reset its size", () => {
    expect(method("getBrushHexes")).toMatch(/this\.drawingMode !== "terrain"/);
    expect(method("openIconPicker")).not.toMatch(/paintBrushSize\s*=/);
  });
});
