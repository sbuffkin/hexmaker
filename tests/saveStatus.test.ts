import { describe, it } from "node:test";
import expect from "expect";
import { SAVE_STATUS_TEXT, SAVED_SHOWN_MS, SaveTracker, type SaveState } from "../src/hex-map/saveStatus";

/** A tracker wired to a log of rendered states and a manual clock. */
function harness() {
	const shown: SaveState[] = [];
	const timers = new Map<number, { fn: () => void; ms: number }>();
	let next = 1;
	const tracker = new SaveTracker(
		(s) => shown.push(s),
		(fn, ms) => { timers.set(next, { fn, ms }); return next++; },
		(id) => { timers.delete(id); },
	);
	const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
	return { shown, timers, tracker, fire };
}

const deferred = () => {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
};

describe("SaveTracker (fresh-eyes round 3: no 'saved' cue)", () => {
	it("shows Saving… then ✓ Saved, then clears after a moment", async () => {
		const h = harness();
		await h.tracker.track(Promise.resolve());
		expect(h.shown).toEqual(["saving", "saved"]);
		expect([...h.timers.values()][0].ms).toBe(SAVED_SHOWN_MS);
		h.fire();
		expect(h.shown.at(-1)).toBe("idle");
		expect(SAVE_STATUS_TEXT.saved).toContain("Saved");
	});

	it("waits for every overlapping save before saying Saved", async () => {
		const h = harness();
		const a = deferred();
		const b = deferred();
		const ta = h.tracker.track(a.promise);
		const tb = h.tracker.track(b.promise);
		a.resolve();
		await ta;
		expect(h.shown.at(-1)).toBe("saving");
		b.resolve();
		await tb;
		expect(h.shown.at(-1)).toBe("saved");
	});

	it("reports a failed save instead of Saved, and doesn't throw", async () => {
		const h = harness();
		const origError = console.error;
		console.error = () => {};
		try {
			await h.tracker.track(Promise.reject(new Error("disk full")));
		} finally {
			console.error = origError;
		}
		expect(h.shown.at(-1)).toBe("error");
		expect(h.timers.size).toBe(0); // the error stays up
		await h.tracker.track(Promise.resolve());
		expect(h.shown.at(-1)).toBe("saved");
	});

	it("a new save cancels the pending clear", async () => {
		const h = harness();
		await h.tracker.track(Promise.resolve());
		expect(h.timers.size).toBe(1);
		const d = deferred();
		const t = h.tracker.track(d.promise);
		expect(h.timers.size).toBe(0);
		d.resolve();
		await t;
		expect(h.timers.size).toBe(1);
		h.tracker.dispose();
		expect(h.timers.size).toBe(0);
	});
});
