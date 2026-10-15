/**
 * A token note's frontmatter keys (`token`, `token-*` incl. `token-party`
 * and `token-log`), read from and written to an already-fetched
 * frontmatter object. Pure (no obsidian): tests/fixtures/pureFiles.json.
 * The vault side is tokens/tokenNotes.ts.
 */
import type { TokenEntry, TokenShape, TokenSize } from "../types";
import { mapNameFromRef, mapNoteLink, noteLink, noteRefTarget } from "../noteFormats";

const VALID_SHAPES: TokenShape[] = ["circle", "square", "hexagon"];
const VALID_SIZES:  TokenSize[]  = ["sm", "md", "lg"];

/** Every key a token note may carry (removed together when a note stops being a token). */
export const TOKEN_KEYS = [
  "token",
  "token-icon",
  "token-hex",
  "token-map",
  "token-visible",
  "token-shape",
  "token-size",
  "token-color",
  "token-border",
  "token-link",
  "token-description",
  "token-party",
  "token-log",
] as const;

/** What applyTokenFrontmatter can set; undefined fields are left alone. */
export interface TokenFieldPatch {
  icon?: string;
  hex?: string;
  map?: string;
  visible?: boolean;
  shape?: TokenShape;
  size?: TokenSize;
  color?: string;
  border?: string;
  tokenLink?: string;
  description?: string;
  party?: boolean;
  logFolder?: string;
}

/** How a token note names its map: a link to the map note (NF3); "" stays "". */
export function tokenMapValue(map: string): string {
  return map ? mapNoteLink(map) : map;
}

/** A yes/no frontmatter value read forgivingly (true, "yes", "x", "on", 1). */
export function tokenFlag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return typeof v === "string" && /^(yes|true|y|x|on|1|✓)$/i.test(v.trim());
}

/**
 * The token a note's frontmatter describes, or null when it isn't a token.
 * `linked`: the note its `token-link` resolves to (a proxy's original), if any.
 */
export function tokenEntryFromFm(
  fm: Record<string, unknown> | null | undefined,
  file: { path: string; basename: string },
  linked: { path: string; basename: string } | null,
): TokenEntry | null {
  if (!fm?.["token"]) return null;
  const rawShape = fm["token-shape"] as string | undefined;
  const rawSize  = fm["token-size"]  as string | undefined;
  // A proxy's original note: a link (NF3) or, in older notes, a path.
  const tokenLink = linked?.path ?? (noteRefTarget(fm["token-link"]).target || undefined);

  // Resolve display title from the linked note if this is a proxy
  const title = linked ? linked.basename : file.basename;

  return {
    filePath: file.path,
    title,
    tokenLink,
    icon: typeof fm["token-icon"] === "string" ? fm["token-icon"] : undefined,
    hex: typeof fm["token-hex"] === "string" ? fm["token-hex"] : "",
    // A link to the map note (NF3) or, in older notes, the map's name.
    map: mapNameFromRef(fm["token-map"]),
    visible: fm["token-visible"] !== false,
    shape: VALID_SHAPES.includes(rawShape as TokenShape)
      ? (rawShape as TokenShape)
      : "circle",
    size: VALID_SIZES.includes(rawSize as TokenSize)
      ? (rawSize as TokenSize)
      : "md",
    color: typeof fm["token-color"] === "string" ? fm["token-color"] : undefined,
    border: typeof fm["token-border"] === "string" ? fm["token-border"] : undefined,
    description: typeof fm["token-description"] === "string" ? fm["token-description"] : undefined,
    // The party token (SF5): `token-party: true` (yes/x/on read too).
    party: tokenFlag(fm["token-party"]),
    logFolder: typeof fm["token-log"] === "string" && fm["token-log"].trim() ? fm["token-log"].trim() : undefined,
  };
}

/** Mark `fm` as a token and write the given fields (an empty string removes its key). */
export function writeTokenFields(fm: Record<string, unknown>, data: TokenFieldPatch): void {
  fm["token"] = true;
  if (data.icon !== undefined) {
    if (data.icon) fm["token-icon"] = data.icon;
    else delete fm["token-icon"];
  }
  if (data.hex !== undefined) fm["token-hex"] = data.hex;
  if (data.map !== undefined) fm["token-map"] = tokenMapValue(data.map);
  if (data.visible !== undefined) fm["token-visible"] = data.visible;
  if (data.shape !== undefined) fm["token-shape"] = data.shape;
  if (data.size !== undefined) fm["token-size"] = data.size;
  if (data.color !== undefined) {
    if (data.color) fm["token-color"] = data.color; else delete fm["token-color"];
  }
  if (data.border !== undefined) {
    if (data.border) fm["token-border"] = data.border; else delete fm["token-border"];
  }
  if (data.tokenLink !== undefined) fm["token-link"] = data.tokenLink ? noteLink(data.tokenLink) : data.tokenLink;
  if (data.description !== undefined) {
    if (data.description) fm["token-description"] = data.description;
    else delete fm["token-description"];
  }
  // Written only while on: a plain token's note doesn't grow the keys.
  if (data.party !== undefined) {
    if (data.party) fm["token-party"] = true; else delete fm["token-party"];
  }
  if (data.logFolder !== undefined) {
    if (data.logFolder.trim()) fm["token-log"] = data.logFolder.trim(); else delete fm["token-log"];
  }
}
