/**
 * Hexes just revealed (filled by exploring: a party step, the party's
 * Reveal button, Roll this hex), so the map draws them with a small bounce
 * (owner HF3, 2026-10-16). Whoever fills a hex marks it here; the grid
 * renderer tags the marked hexes it draws (`duckmage-hex-reveal`, with the
 * ring number for a short stagger) for a moment after, so a render that
 * lands a little later still shows it. The CSS turns the bounce off under
 * prefers-reduced-motion.
 *
 * Pure: no Obsidian imports.
 */

/** How long after being marked a hex still bounces when drawn (ms). */
export const REVEAL_BOUNCE_MS = 1500;

/** map → hex → { when it was marked, its ring (0 = the hex itself) }. */
const marks = new Map<string, Map<string, { at: number; ring: number }>>();

/** Mark hexes of map `map` as just revealed; `ring` per hex (default 0). */
export function markRevealed(map: string, hexes: Iterable<string> | ReadonlyMap<string, number>, now = Date.now()): void {
  let m = marks.get(map);
  if (!m) marks.set(map, (m = new Map<string, { at: number; ring: number }>()));
  const entries: [string, number][] = hexes instanceof Map ? [...(hexes as ReadonlyMap<string, number>)] : [...(hexes as Iterable<string>)].map((h) => [h, 0]);
  for (const [hex, ring] of entries) m.set(hex, { at: now, ring });
}

/** The hexes of map `map` to draw bouncing now (hex → ring); old marks are dropped. */
export function revealedNow(map: string, now = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  const m = marks.get(map);
  if (!m) return out;
  for (const [hex, v] of m) {
    if (now - v.at > REVEAL_BOUNCE_MS) m.delete(hex);
    else out.set(hex, v.ring);
  }
  if (!m.size) marks.delete(map);
  return out;
}

/** Forget every mark (tests). */
export function clearRevealed(): void {
  marks.clear();
}
