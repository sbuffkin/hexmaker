/** Preset map sizes for the generator page, plus the region a generator came from. */

export interface SizePreset {
  label: string;
  cols: number;
  rows: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { label: "Small", cols: 20, rows: 14 },
  { label: "Medium", cols: 30, rows: 20 },
  { label: "Large", cols: 40, rows: 28 },
  { label: "Huge", cols: 60, rows: 40 },
];

/** The presets, led by the source region's size when it isn't one of them. */
export function sizePresets(source?: { name: string; cols: number; rows: number }): SizePreset[] {
  if (!source || SIZE_PRESETS.some((p) => p.cols === source.cols && p.rows === source.rows)) return SIZE_PRESETS;
  return [{ label: `Like ${source.name}`, cols: source.cols, rows: source.rows }, ...SIZE_PRESETS];
}
