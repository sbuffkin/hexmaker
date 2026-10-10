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
