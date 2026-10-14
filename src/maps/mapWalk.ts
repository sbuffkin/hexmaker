/** Walks up a map tree by its parent links (pure: no Obsidian imports, so EventsService stays pure). */

/**
 * Maps may be each other's submaps (owner MG8: links like any other, never
 * "fixed" or warned about). Every walk up the parent links goes through
 * these helpers, which stop where a map comes round again, so a loop never
 * hangs anything or shows a map twice.
 */

/**
 * The top of `start`'s map tree: the first map above it with no parent. In
 * a loop of parents (a and b each other's parent) there is no top, so it's
 * the loop's first map by name: the same map from wherever in the loop
 * the walk starts, so maps in a loop share one top (one world ledger).
 */
export function mapRoot(start: string, parentOf: (mapName: string) => string | undefined): string {
  const order: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = start;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    order.push(cur);
    cur = parentOf(cur);
  }
  if (!cur) return order[order.length - 1];
  // Came round to `cur`: the loop is order[from…].
  const loop = order.slice(order.indexOf(cur));
  return [...loop].sort((a, b) => a.localeCompare(b))[0];
}

/**
 * Ancestors of `start`, root first, excluding `start` itself. Stops at the
 * first map without a parent, on a cycle, or after `max` hops.
 */
export function mapAncestors(
  start: string,
  parentOf: (mapName: string) => string | undefined,
  max = 8,
): string[] {
  const chain: string[] = [];
  const seen = new Set([start]);
  let cur = parentOf(start);
  while (cur && !seen.has(cur) && chain.length < max) {
    chain.unshift(cur);
    seen.add(cur);
    cur = parentOf(cur);
  }
  return chain;
}
