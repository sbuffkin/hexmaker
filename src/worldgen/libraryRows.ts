/**
 * Rows for the generator page's file list: one tab of generators, one of the
 * regions (maps) generators are learned from. Filtering matches every typed
 * word against all of a row's columns.
 */

export interface LibraryGenerator {
  path: string;
  name: string;
  /** Regions it was learned from (several for a combined generator). */
  sources: string[];
  palette?: string;
  terrains: number;
  created?: string;
}

export interface LibraryRegion {
  name: string;
  cols: number;
  rows: number;
  palette: string;
}

export interface GeneratorRow {
  path: string;
  name: string;
  from: string;
  palette: string;
  terrains: number;
  created: string;
}

export interface RegionRow {
  name: string;
  size: string;
  palette: string;
  /** Generators learned from this region (alone or combined). */
  generators: number;
}

const matches = (columns: (string | number)[], query: string): boolean => {
  const hay = columns.join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

export function generatorRows(generators: LibraryGenerator[], query = ""): GeneratorRow[] {
  return generators
    .map((g) => ({
      path: g.path,
      name: g.name,
      from: g.sources.join(" + "),
      palette: g.palette ?? "",
      terrains: g.terrains,
      created: g.created ?? "",
    }))
    .filter((r) => matches([r.name, r.from, r.palette, r.created], query))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function regionRows(regions: LibraryRegion[], generators: LibraryGenerator[], query = ""): RegionRow[] {
  const learned = new Map<string, number>();
  for (const g of generators) for (const s of new Set(g.sources)) learned.set(s, (learned.get(s) ?? 0) + 1);
  return regions
    .map((r) => ({ name: r.name, size: `${r.cols}×${r.rows}`, palette: r.palette, generators: learned.get(r.name) ?? 0 }))
    .filter((r) => matches([r.name, r.size, r.palette], query))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Default name for a generator learned from these regions (slug-safe). */
export function combinedName(regions: string[]): string {
  return regions.join("-and-");
}
