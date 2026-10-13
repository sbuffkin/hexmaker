/**
 * A grid-size number field read while the user types (live preview) and
 * when it is committed (blur / Enter).
 *
 * While typing, a half-typed value ("1" on the way to "12", or an empty
 * field) is not a size yet: return undefined so the preview keeps the last
 * good size instead of flashing a 2-column map. On commit, clamp into
 * range and fall back when the field is empty or not a number.
 */
export function sizeFromInput(
	raw: string,
	opts: { min: number; max: number; fallback: number; committed: boolean },
): number | undefined {
	const n = Math.floor(Number(raw));
	const valid = raw.trim() !== "" && Number.isFinite(n);
	if (!opts.committed) return valid && n >= opts.min && n <= opts.max ? n : undefined;
	if (!valid || n === 0) return opts.fallback;
	return Math.max(opts.min, Math.min(opts.max, n));
}

/** How long typing in a size field waits before the preview redraws. */
export const LIVE_PREVIEW_DELAY_MS = 300;

/**
 * One mouse-wheel step on a size field: up adds one, down takes one,
 * clamped into range. A field that isn't a number starts from `min`.
 */
export function wheelSize(raw: string, deltaY: number, min: number, max: number): number {
	const n = Math.floor(Number(raw));
	const base = raw.trim() !== "" && Number.isFinite(n) ? n : min;
	if (!deltaY) return Math.max(min, Math.min(max, base));
	return Math.max(min, Math.min(max, base + (deltaY < 0 ? 1 : -1)));
}

/** What a size field needs for wheelStep (an HTMLInputElement, or a stand-in in tests). */
export interface WheelField {
	value: string;
	matches(selector: string): boolean;
	addEventListener(type: "wheel", fn: (e: { deltaY: number; preventDefault(): void }) => void, opts: { passive: boolean }): void;
	dispatchEvent(e: Event): boolean;
}

/**
 * Let the mouse wheel step a size field while it's hovered or focused
 * (owner: "grid size on onboarding should be scroll adjustable"). Anywhere
 * else the wheel scrolls the page as usual. Each step commits like typing
 * a value and leaving the field (a `change` event).
 */
export function wheelStep(input: WheelField, min: number, max: number, isFocused: () => boolean): void {
	input.addEventListener("wheel", (e) => {
		if (!isFocused() && !input.matches(":hover")) return;
		if (!e.deltaY) return;
		e.preventDefault();
		const next = String(wheelSize(input.value, e.deltaY, min, max));
		if (next === input.value) return;
		input.value = next;
		input.dispatchEvent(new Event("change"));
	}, { passive: false });
}

/**
 * The size after another map scale is picked (Overland ↔ Biomes): the
 * scale's own size, unless the user chose one (typed it, a preset): that
 * is kept (critic C9: switching scale threw a typed 40 columns away). The
 * size's reset button still goes back to the scale's size.
 */
export function sizeForScalePick(
	chosen: { cols: number; rows: number } | null,
	scaleSize: { cols: number; rows: number },
): { cols: number; rows: number } {
	return chosen ? { cols: chosen.cols, rows: chosen.rows } : { cols: scaleSize.cols, rows: scaleSize.rows };
}
