/**
 * A map made with a slice this build doesn't have (owner R4, "should only
 * happen to us"): the map list marks it "made with a newer build" and it
 * can't be opened or written. Nothing about it is dropped or rewritten.
 *
 * Told from the notes, never by naming the slice: its map note has a key
 * marked by a slice built off (release-slices.json `mapMarks`; only their
 * hashes are in this bundle, __OFF_SLICE_MAP_MARKS__), or its palette's note
 * says a `map-kind:` this build doesn't have. Pure.
 */

export const OFF_SLICE_TEXT = "made with a newer build";

/** The same hash as dev/release/slices.mjs markHash (FNV-1a, 32 bits). */
export function markHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const seen = new WeakMap<object, boolean>();

/** Does this map note's frontmatter have a key of a slice built off? */
export function hasOffSliceKey(frontmatter: object | undefined, marks: readonly number[] = __OFF_SLICE_MAP_MARKS__): boolean {
  if (!frontmatter || !marks.length) return false;
  const known = seen.get(frontmatter);
  if (known !== undefined) return known;
  const hit = Object.keys(frontmatter).some((k) => marks.includes(markHash(k)));
  seen.set(frontmatter, hit);
  return hit;
}

/** Is a palette note's `map-kind:` one this build doesn't have? (Unset: no.) */
export function isOffSliceKind(kind: unknown, known: readonly string[]): boolean {
  return typeof kind === "string" && kind.trim() !== "" && !known.includes(kind.trim().toLowerCase());
}
