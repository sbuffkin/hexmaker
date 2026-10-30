/**
 * The hex table's sort button: xy → yx → type, then whatever the modules'
 * table parts add (`field:<name>`). Pure.
 */

export type SortMode = "x" | "y" | "type" | `field:${string}`;

/** The sort button's label. */
export function sortLabel(mode: SortMode): string {
  if (mode === "x") return "Sort: xy";
  if (mode === "y") return "Sort: yx";
  if (mode === "type") return "Sort: type";
  return `Sort: ${mode.slice("field:".length)}`;
}

/** The next sort: xy → yx → type → each added name in order → xy. */
export function nextSort(mode: SortMode, added: readonly { name: string }[]): SortMode {
  const order: SortMode[] = ["x", "y", "type", ...added.map((f) => `field:${f.name}` as SortMode)];
  const i = order.findIndex((m) => m.toLowerCase() === mode.toLowerCase());
  return order[(i + 1) % order.length] ?? "x";
}
