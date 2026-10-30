/**
 * How far the party sees: how far a step (or the party's Look) reveals or
 * fills. 0 = only the hex entered (the default), 1–3 = that many rings around
 * it too (owner HF3, 2026-10-16). Kept in the map note as `explore-reveal`:
 * `entered`, `1 ring`, `2 rings`, `3 rings`; the older `neighbours` reads as
 * 1 ring. Pure.
 */
export type Reveal = 0 | 1 | 2 | 3;
export const DEFAULT_REVEAL: Reveal = 0;
export const MAX_REVEAL: Reveal = 3;

export function parseReveal(raw: string | number | undefined): Reveal {
  const text = String(raw ?? "");
  const n = /\d+/.exec(text);
  if (n) return Math.max(0, Math.min(MAX_REVEAL, Number(n[0]))) as Reveal;
  return /neighbou?rs?|around|all/i.test(text) ? 1 : DEFAULT_REVEAL;
}

/** The map-note value for `rings` (undefined: the default, no key). */
export function formatReveal(rings: number): string | undefined {
  const r = parseReveal(rings);
  return r === 0 ? undefined : `${r} ring${r === 1 ? "" : "s"}`;
}
