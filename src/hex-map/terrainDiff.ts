/**
 * Hexes whose shown terrain differs from the map's data now, for a view
 * showing a map that's being painted elsewhere (the overworld brush): only
 * those are repainted. `null`: no terrain. Pure.
 */
export function terrainDiff(shown: ReadonlyMap<string, string | null>, now: (key: string) => string | undefined): [string, string | null][] {
  const out: [string, string | null][] = [];
  for (const [key, was] of shown) {
    const t = now(key) ?? null;
    if (t !== was) out.push([key, t]);
  }
  return out;
}
