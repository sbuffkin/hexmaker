import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
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

describe("SaveTracker (fresh-eyes rounds 3-4: no noticeable 'saved' cue)", () => {
	it("starts by saying changes save automatically", () => {
		const h = harness();
		expect(h.tracker.current).toBe("idle");
		expect(SAVE_STATUS_TEXT.idle).toMatch(/save automatically/);
	});

	it("shows Saving… then a fresh 'saved', which settles but never disappears", async () => {
		const h = harness();
		await h.tracker.track(Promise.resolve());
		expect(h.shown).toEqual(["saving", "saved"]);
		expect([...h.timers.values()][0].ms).toBe(SAVED_SHOWN_MS);
		h.fire();
		expect(h.shown.at(-1)).toBe("settled");
		expect(h.tracker.current).toBe("settled");
		expect(SAVE_STATUS_TEXT.settled).toBe(SAVE_STATUS_TEXT.saved);
		expect(SAVE_STATUS_TEXT.saved).toContain("saved");
		expect(SAVE_STATUS_TEXT.settled).not.toBe("");
	});

	it("says 'not saved yet' while typing, before the autosave runs", () => {
		const h = harness();
		h.tracker.markPending();
		expect(h.shown.at(-1)).toBe("pending");
		expect(SAVE_STATUS_TEXT.pending).toMatch(/not saved/i);
	});

	it("a pending edit that needs no write returns to the last resting state", async () => {
		const h = harness();
		h.tracker.markPending();
		h.tracker.settle();
		expect(h.shown.at(-1)).toBe("idle");
		await h.tracker.track(Promise.resolve());
		h.fire();
		h.tracker.markPending();
		h.tracker.settle();
		expect(h.shown.at(-1)).toBe("settled");
	});

	it("typing during a save shows 'not saved yet' once the save lands", async () => {
		const h = harness();
		const d = deferred();
		const t = h.tracker.track(d.promise);
		h.tracker.markPending();
		expect(h.shown.at(-1)).toBe("saving"); // a save is in flight: keep saying so
		d.resolve();
		await t;
		expect(h.shown.at(-1)).toBe("pending");
	});

	it("waits for every overlapping save before saying saved", async () => {
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

	it("reports a failed save instead of saved, and doesn't throw", async () => {
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
		h.tracker.markPending();
		h.tracker.settle();
		expect(h.shown.at(-1)).toBe("error"); // an unchanged edit doesn't hide it
		await h.tracker.track(Promise.resolve());
		expect(h.shown.at(-1)).toBe("saved");
	});

	it("a new save cancels the pending settle", async () => {
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

describe("HexEditorModal autosave wiring (fresh-eyes round 4)", () => {
	const src = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexEditorModal.ts"), "utf8").replace(/\r\n/g, "\n");

	it("shows the status beside the focused text box and marks typing as pending", () => {
		expect(src).toMatch(/duckmage-editor-notes-status/);
		expect(src).toMatch(/addEventListener\("focus"[\s\S]{0,200}labelEl\.after\(status\)/);
		expect(src).toMatch(/this\.saves\.markPending\(\)/);
		expect(src).toMatch(/this\.saves\.settle\(\)/);
	});

	it("creates the note of the hex the text was typed into, even after navigating", () => {
		const m = /private async ensureHexNote[\s\S]*?\n {2}\}/.exec(src);
		expect(m).not.toBeNull();
		expect(m![0]).toMatch(/createHexNote\(x, y, this\.mapName\)/);
	});
});
