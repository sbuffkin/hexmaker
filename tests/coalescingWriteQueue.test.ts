import { describe, it } from "node:test";
import expect from "expect";
import { CoalescingWriteQueue, retryDelay, type WriteOutcome } from "../src/hex-map/view/coalescingWriteQueue";

/**
 * The map view's paint queues (terrain, icon, GM icons) run on this queue.
 * It's data-loss sensitive: the LAST value painted on a hex must be the one
 * that ends up written, never an older one landing after it.
 */

/** A write the test lets finish (or fail) when it chooses. */
interface Gate {
  key: string;
  value: number;
  resolve: (o?: WriteOutcome) => void;
  reject: (e: unknown) => void;
}

function harness() {
  const gates: Gate[] = [];
  const written: [string, number][] = [];
  const sleeps: number[] = [];
  const errors: [string, number][] = [];
  let changes = 0;
  const q = new CoalescingWriteQueue<number>({
    write: (key, value) =>
      new Promise<WriteOutcome>((res, rej) => {
        gates.push({
          key,
          value,
          resolve: (o = "done") => {
            written.push([key, value]);
            res(o);
          },
          reject: rej,
        });
      }),
    onChange: () => changes++,
    onError: (key, attempt) => errors.push([key, attempt]),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  /** Let microtasks run (the flush loop awaits between steps). */
  const tick = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** The write waiting to finish (the latest started). */
  const open = () => gates[gates.length - 1];
  return { q, gates, written, sleeps, errors, tick, open, changes: () => changes };
}

describe("CoalescingWriteQueue", () => {
  it("writes the first value, then only the latest one queued behind it", async () => {
    const h = harness();
    h.q.schedule("a", 1);
    await h.tick();
    expect(h.gates.map((g) => g.value)).toEqual([1]);
    // Painted twice more while 1 is in flight: 2 is replaced by 3.
    h.q.schedule("a", 2);
    h.q.schedule("a", 3);
    expect(h.q.peek("a")).toBe(3);
    expect(h.gates.length).toBe(1); // never a second write in flight for a key
    h.open().resolve();
    await h.tick();
    expect(h.gates.map((g) => g.value)).toEqual([1, 3]);
    h.open().resolve();
    await h.tick();
    expect(h.written).toEqual([["a", 1], ["a", 3]]);
    expect(h.q.busy()).toBe(false);
    expect(h.q.count).toBe(0);
  });

  it("keeps the order of writes per key; keys flush independently", async () => {
    const h = harness();
    h.q.schedule("a", 1);
    h.q.schedule("b", 10);
    await h.tick();
    expect(h.gates.map((g) => [g.key, g.value])).toEqual([["a", 1], ["b", 10]]);
    h.q.schedule("a", 2);
    // b finishes first; a's queued 2 waits for a's own write.
    h.gates[1].resolve();
    await h.tick();
    expect(h.gates.length).toBe(2);
    h.gates[0].resolve();
    await h.tick();
    expect(h.gates.map((g) => [g.key, g.value])).toEqual([["a", 1], ["b", 10], ["a", 2]]);
    h.gates[2].resolve();
    await h.tick();
    expect(h.written).toEqual([["b", 10], ["a", 1], ["a", 2]]);
  });

  it("retries a failed write with the same value and backs off", async () => {
    const h = harness();
    h.q.schedule("a", 1);
    await h.tick();
    h.open().reject(new Error("busy"));
    await h.tick();
    h.open().reject(new Error("busy"));
    await h.tick();
    // A newer value painted meanwhile still waits for the retried one.
    h.q.schedule("a", 2);
    h.open().resolve();
    await h.tick();
    h.open().resolve();
    await h.tick();
    expect(h.gates.map((g) => g.value)).toEqual([1, 1, 1, 2]);
    expect(h.written).toEqual([["a", 1], ["a", 2]]);
    expect(h.errors).toEqual([["a", 1], ["a", 2]]);
    expect(h.sleeps).toEqual([200, 400]);
  });

  it("'stop' ends the flush and leaves a newer value queued until the next schedule", async () => {
    const h = harness();
    h.q.schedule("a", 1);
    await h.tick();
    h.q.schedule("a", 2);
    h.open().resolve("stop");
    await h.tick();
    expect(h.gates.map((g) => g.value)).toEqual([1]);
    expect(h.q.isFlushing("a")).toBe(false);
    expect(h.q.peek("a")).toBe(2);
    h.q.schedule("a", 3);
    await h.tick();
    h.open().resolve();
    await h.tick();
    expect(h.written).toEqual([["a", 1], ["a", 3]]);
  });

  it("discard drops only the queued value, not the one in flight", async () => {
    const h = harness();
    h.q.schedule("a", 1);
    await h.tick();
    h.q.schedule("a", 2);
    h.q.discard("a");
    expect(h.q.peek("a")).toBeUndefined();
    expect(h.q.isFlushing("a")).toBe(true);
    h.open().resolve();
    await h.tick();
    expect(h.written).toEqual([["a", 1]]);
    expect(h.q.isFlushing("a")).toBe(false);
  });

  it("counts queued and in-flight keys and reports each change", async () => {
    const h = harness();
    h.q.schedule("a", 1);
    expect(h.q.count).toBe(1); // in flight (flush started synchronously)
    h.q.schedule("a", 2);
    expect(h.q.count).toBe(2); // in flight + queued
    h.q.schedule("b", 1);
    expect(h.q.count).toBe(3);
    expect(h.changes()).toBeGreaterThanOrEqual(4);
    await h.tick();
    for (let i = 0; i < 3; i++) {
      h.gates.find((g) => !h.written.some(([k, v]) => k === g.key && v === g.value))?.resolve();
      await h.tick();
    }
    expect(h.q.count).toBe(0);
    expect(h.q.busy()).toBe(false);
  });

  it("backs off 200 ms doubling, capped at 2 s", () => {
    expect([1, 2, 3, 4, 5, 6, 12].map(retryDelay)).toEqual([200, 400, 800, 1600, 2000, 2000, 2000]);
  });
});
