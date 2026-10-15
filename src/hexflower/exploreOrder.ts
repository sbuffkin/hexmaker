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
