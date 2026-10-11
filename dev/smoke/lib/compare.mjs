/**
 * Pure comparison helpers for the smoke suite (unit-tested in
 * tests/smokeSuite.test.ts).
 */

/** Where two JSON values differ: "maps[2].savedViewport.zoom: 1 → 0.8" (first `max`). */
export function jsonDiff(a, b, at = "", out = [], max = 8) {
  if (out.length >= max) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) jsonDiff(a[k], b[k], Array.isArray(a) ? `${at}[${k}]` : at ? `${at}.${k}` : k, out, max);
  } else out.push(`${at || "(root)"}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`);
  return out;
}

/** Stable JSON: object keys sorted at every level (store dumps come back in another order after a reload). */
export function canon(v) {
  const sort = (x) => (Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(v));
}

/**
 * Settings the plugin sets once, on some later start (the one-time
 * table-ranges survey, note format upgrades): a restart may write these
 * to data.json. Anything else it writes is a rewrite.
 */
export const ONE_TIME_KEYS = new Set(["tableRangesPrompt", "noteFormatUpgrades"]);


/** data.json changed only in ONE_TIME_KEYS (top level). */
export function oneTimeOnly(a, b) {
  const keys = [...new Set(jsonDiff(a, b, "", [], 500).map((s) => s.split(/[.[:]/)[0]))];
  return keys.length > 0 && keys.every((k) => ONE_TIME_KEYS.has(k));
}
