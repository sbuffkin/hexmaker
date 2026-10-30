/**
 * Compass words for directions on the map (shared by map navigation and
 * the World maps module's regions). Pure.
 */

const BEARINGS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];

/** Compass word for a direction in screen space (y down): 8 sectors. */
export function bearingWord(dx: number, dy: number): string {
  const a = Math.atan2(dy, dx); // 0 = east, π/2 = south
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return BEARINGS[i];
}
