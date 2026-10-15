/**
 * Solo play: the party token (owner call SF5, 2026-10-13).
 *
 * Any token can be the party: its note says so with `token-party: true`.
 * In Play, with the party selected, clicking a neighbouring hex moves it
 * there (dragging still works), and every hex it has stood on is marked
 * visited. The visited hexes are stored per map, in the map note's
 * frontmatter as a plain list in the order they were first reached:
 *
 *   visited: ["3_4", "4_4"]
 *
 * Read forgivingly (`3, 4` or `3_4`, one value or a list, junk dropped).
 *
 * Pure: no Obsidian imports.
 */
import { parseHexKey } from "../maps/mapNote";
import { areNeighbours } from "../hexKey";

/** Is `to` one step from `from` ("x_y" keys) on a grid of this orientation and stagger? */
export function isStep(
  from: string,
  to: string,
  orientation: "flat" | "pointy",
  stagger: "odd" | "even" = "odd",
): boolean {
  const a = parseHexKey(from);
  const b = parseHexKey(to);
  if (!a || !b || a === b) return false;
  return areNeighbours(a, b, orientation, stagger);
}

/** A map's `visited` value, read forgivingly: hex keys, first visit first, no repeats. */
export function parseVisited(raw: unknown): string[] {
  // One string: "3_4, 5_6" (commas between keys only when keys use "_") or "3, 4; 5, 6".
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(raw.includes("_") ? /[,;\n]+/ : /[;\n]+/) : [];
  const out: string[] = [];
  for (const item of items) {
    const key = typeof item === "string" || typeof item === "number" ? parseHexKey(String(item)) : null;
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** `list` with `keys` added (those not in it yet, at the end). Returns the same array when nothing is new. */
export function markVisited(list: readonly string[] | undefined, ...keys: string[]): string[] {
  const out = [...(list ?? [])];
  let changed = false;
  for (const raw of keys) {
    const key = parseHexKey(raw);
    if (key && !out.includes(key)) { out.push(key); changed = true; }
  }
  return changed ? out : (list as string[] | undefined) ?? out;
}

/** `list` without hex `key`. */
export function unmarkVisited(list: readonly string[] | undefined, key: string): string[] {
  const k = parseHexKey(key);
  return (list ?? []).filter((h) => h !== k);
}

/** The fields of a token these helpers read. */
export interface PartyLike {
  party?: boolean;
  hex: string;
  map: string;
  visible?: boolean;
  filePath: string;
}

/** The party tokens on map `map` (shown ones), in the order given. */
export function partyTokens<T extends PartyLike>(tokens: readonly T[], map: string): T[] {
  return tokens.filter((t) => t.party && t.map === map && t.visible !== false);
}

/**
 * The party a log entry made at hex `hex` names: a party token standing on
 * that hex, else the first party token on the map, else none.
 */
export function partyFor<T extends PartyLike>(tokens: readonly T[], map: string, hex: string): T | undefined {
  const parties = partyTokens(tokens, map);
  return parties.find((t) => t.hex === hex) ?? parties[0];
}

/**
 * What a left click on hex `hex` does while a party token is selected in
 * Play: "move" when the hex is one step from the token, otherwise "none"
 * (the click does what it always does, e.g. opens the hex editor).
 */
export function partyClick(
  selected: PartyLike | undefined,
  hex: string,
  orientation: "flat" | "pointy",
  stagger: "odd" | "even" = "odd",
): "move" | "none" {
  if (!selected) return "none";
  return isStep(selected.hex, hex, orientation, stagger) ? "move" : "none";
}
