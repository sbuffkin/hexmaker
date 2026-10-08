/**
 * Hex notes start from a template whose sections often contain hint text
 * ("What the party sees and feels…"). Unedited hints must not end up in a
 * printed manual, so section text is compared line by line against the hint
 * lines of the templates in use, and lines that only repeat a hint are dropped.
 */

/** Hint lines from the plugin's built-in templates, past and present. */
const BUILT_IN_HINTS = [
  "What the party sees and feels. Terrain, atmosphere, any obvious features.",
  "What the party sees and feels. Terrain, atmosphere, any obvious features. One or two sentences or a short paragraph.",
  "The visible standout feature — spire, ruin, lighthouse, statue, village — that can be spotted or used for navigation.",
  "Links to settlements or named locations in this hex.",
  "Discoverable with exploration, tracking, or clues. Hidden lairs, ruins, tombs, camps, shortcuts.",
  "Revealed only through specific actions, NPCs, or investigation.",
  "Revealed only through specific actions, NPCs, or investigation. Havens, caches, true nature of a place.",
  "Normal for region, or special (e.g. always pleasant, sandstorms, magic zone effect).",
  "Who holds sway, patrols, or claims territory. Church, free states, beast territory, mages, bandits, nobody.",
  "Seeds for adventures, things locals might mention, or what finding this hex could lead to.",
  "- **Table:** *(terrain from world/encounters — e.g. Woods, Marsh, Beach, salt flats)*",
  "- **Custom / notable:** Any fixed encounters, lairs, or \"no combat here\" notes for this hex.",
  "- **Difficulty:** Normal / slow / treacherous / blocked",
  "- **Notes:** Trail condition, shortcuts, routes to key adjacent hexes.",
];

const norm = (line: string) => line.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A line that is only a fill-in prompt: a parenthesised note such as
 * "(add seeds here)" or "(TBD)", or a bare "TODO …" / "TBD". Real text that
 * merely ends in "here" ("The dragon sleeps here.") is kept.
 */
const PROMPT = /^\s*(?:[*_]*\((?:[^)]*\b(?:add|todo|tbd|fill in|placeholder|here)\b[^)]*)\)[*_]*|todo\b.*|tbd\.?)\s*$/i;

/** Every non-heading, non-rule line of a template, as hint lines to ignore. */
export function templateHintLines(template: string): string[] {
  return template
    .replace(/^---[\s\S]*?---/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l) && !/^-{3,}$/.test(l) && !/\{\{/.test(l));
}

export class PlaceholderFilter {
  private hints: Set<string>;

  constructor(templates: string[] = []) {
    this.hints = new Set([...BUILT_IN_HINTS, ...templates.flatMap(templateHintLines)].map(norm));
  }

  /** Section text with hint lines (and blank edges) removed; "" if only hints. */
  clean(text: string | undefined): string {
    if (!text) return "";
    const kept = text.split(/\r?\n/).filter((l) => !this.hints.has(norm(l)) && !PROMPT.test(l.trim()));
    return kept.join("\n").replace(/^\s+|\s+$/g, "");
  }
}
