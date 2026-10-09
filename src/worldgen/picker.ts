/**
 * Options for the generator page's one picker: the generators there are, and
 * the regions (maps) a new generator can be learned from.
 */

export interface PickerGenerator {
  path: string;
  name: string;
  sourceMap?: string;
  palette?: string;
}

export interface PickerRegion {
  name: string;
  cols: number;
  rows: number;
  palette: string;
}

export interface PickerItem {
  kind: "generator" | "region";
  /** Generator file path, or region name. */
  value: string;
  label: string;
  detail: string;
}

/** Every word of the query appears in the label or detail. */
function matches(item: PickerItem, query: string): boolean {
  const hay = `${item.label} ${item.detail}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function pickerItems(
  generators: PickerGenerator[],
  regions: PickerRegion[],
  query = "",
): { generators: PickerItem[]; regions: PickerItem[] } {
  const learned = new Map<string, number>();
  for (const g of generators) if (g.sourceMap) learned.set(g.sourceMap, (learned.get(g.sourceMap) ?? 0) + 1);
  const gens = generators
    .map((g): PickerItem => ({
      kind: "generator",
      value: g.path,
      label: g.name,
      detail: [g.sourceMap ? `from ${g.sourceMap}` : "", g.palette ? `palette ${g.palette}` : ""].filter(Boolean).join(" · "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const regs = regions
    .map((r): PickerItem => {
      const n = learned.get(r.name) ?? 0;
      return {
        kind: "region",
        value: r.name,
        label: r.name,
        detail: [`${r.cols}×${r.rows}`, `palette ${r.palette}`, n ? `${n} generator${n === 1 ? "" : "s"} already` : ""].filter(Boolean).join(" · "),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return { generators: gens.filter((i) => matches(i, query)), regions: regs.filter((i) => matches(i, query)) };
}
