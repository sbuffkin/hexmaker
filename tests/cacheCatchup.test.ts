import { describe, it, mock, beforeEach, afterEach } from "node:test";
import expect from "expect";

import { CacheCatchup } from "../src/hex-map/cacheCatchup";

// CacheCatchup uses window.setTimeout (Obsidian lint rule); node has no window.
(globalThis as unknown as { window: typeof globalThis }).window ??= globalThis;

/**
 * 1.5.8: a map drawn while Obsidian was still indexing drew its hex notes
 * blank and never redrew them. CacheCatchup redraws once the cache fills in.
 */
describe("CacheCatchup", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("does nothing when the last draw had every note cached", () => {
    let draws = 0;
    const c = new CacheCatchup(() => draws++, () => false, 1000);
    c.setIncomplete(false);
    c.poke();
    mock.timers.tick(5000);
    expect(draws).toBe(0);
  });

  it("redraws once after cache events while notes were missing", () => {
    let draws = 0;
    const c = new CacheCatchup(() => draws++, () => false, 1000);
    c.setIncomplete(true);
    for (let i = 0; i < 50; i++) c.poke();
    mock.timers.tick(999);
    expect(draws).toBe(0);
    mock.timers.tick(1);
    expect(draws).toBe(1);
  });

  it("keeps redrawing while indexing continues, then stops when complete", () => {
    let draws = 0;
    let missing = 3;
    const c = new CacheCatchup(() => {
      draws++;
      missing--;
      c.setIncomplete(missing > 0);
    }, () => false, 1000);
    c.setIncomplete(true);
    for (let t = 0; t < 10; t++) {
      c.poke();
      mock.timers.tick(1000);
    }
    expect(draws).toBe(3);
    expect(c.pending).toBe(false);
  });

  it("waits for pending writes before redrawing", () => {
    let draws = 0;
    let busy = true;
    const c = new CacheCatchup(() => draws++, () => busy, 1000);
    c.setIncomplete(true);
    c.poke();
    mock.timers.tick(3000);
    expect(draws).toBe(0);
    busy = false;
    mock.timers.tick(1000);
    expect(draws).toBe(1);
  });

  it("cancel stops a scheduled redraw", () => {
    let draws = 0;
    const c = new CacheCatchup(() => draws++, () => false, 1000);
    c.setIncomplete(true);
    c.poke();
    c.cancel();
    mock.timers.tick(5000);
    expect(draws).toBe(0);
  });

  it("skips the redraw if a normal draw already completed the map", () => {
    let draws = 0;
    const c = new CacheCatchup(() => draws++, () => false, 1000);
    c.setIncomplete(true);
    c.poke();
    c.setIncomplete(false);
    mock.timers.tick(1000);
    expect(draws).toBe(0);
  });
});
