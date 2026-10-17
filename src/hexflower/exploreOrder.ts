/**
 * The order a whole map is filled in: outward from a start hex, breadth
 * first, each hex with the hex it was reached from (so it's seen "from"
 * there, as if the party walked in). Pure.
 */
export function exploreOrder(start: string, neighbours: (k: string) => string[]): { hex: string; from?: string }[] {
  const out: { hex: string; from?: string }[] = [{ hex: start }];
  const seen = new Set([start]);
  for (let i = 0; i < out.length; i++) {
    for (const n of neighbours(out[i].hex)) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({ hex: n, from: out[i].hex });
    }
  }
  return out;
}

/**
 * The hexes up to `rings` steps from `center` (not the center itself), ring
 * by ring, each with the hex it was reached from and its ring (1…rings):
 * the order the party's Reveal fills them in.
 */
export function ringOrder(center: string, rings: number, neighbours: (k: string) => string[]): { hex: string; from: string; ring: number }[] {
  const out: { hex: string; from: string; ring: number }[] = [];
  const seen = new Set([center]);
  let edge = [center];
  for (let ring = 1; ring <= rings && edge.length; ring++) {
    const next: string[] = [];
    for (const k of edge) {
      for (const n of neighbours(k)) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
        out.push({ hex: n, from: k, ring });
      }
    }
    edge = next;
  }
  return out;
}
