/**
 * Links to a hex: `obsidian://duckmage-openmap?vault=…&map=…&x=…&y=…`
 * opens the map view on that map, centred on the hex (the protocol handler
 * in HexmakerPlugin). Without x and y it just opens the map (the "Insert map
 * link" editor item, released in 1.5). The hex editor's centre dot copies
 * one as a Markdown link a note can use.
 *
 * Pure: no Obsidian imports.
 */

export const OPEN_MAP_ACTION = "duckmage-openmap";

export interface MapLinkTarget {
  map: string;
  /** The hex to centre on (both or neither). */
  hex?: { x: number; y: number };
}

/** The obsidian:// URI that opens `target` in `vault`. */
export function mapLinkUri(vault: string, target: MapLinkTarget): string {
  let uri = `obsidian://${OPEN_MAP_ACTION}?vault=${encodeURIComponent(vault)}&map=${encodeURIComponent(target.map)}`;
  if (target.hex) uri += `&x=${target.hex.x}&y=${target.hex.y}`;
  return uri;
}

/** A Markdown link to the hex: `[Label](obsidian://…)`. Brackets in the label are escaped. */
export function hexMarkdownLink(vault: string, target: MapLinkTarget, label: string): string {
  const text = label.replace(/([[\]\\])/g, "\\$1");
  return `[${text}](${mapLinkUri(vault, target)})`;
}

/** The link text for a hex: "Coast 3, 4", or the hex's name when it has one ("Coast: Old Mill"). */
export function hexLinkLabel(mapLabel: string, x: number, y: number, hexName?: string): string {
  const name = hexName?.trim();
  return name ? `${mapLabel}: ${name}` : `${mapLabel} ${x}, ${y}`;
}

/**
 * Read the protocol handler's params (already URI-decoded by Obsidian).
 * Null without a map; the hex only when x and y are both whole numbers.
 */
export function parseMapLinkParams(params: Record<string, string | undefined>): MapLinkTarget | null {
  const map = params["map"];
  if (!map) return null;
  const int = (v: string | undefined) => (v !== undefined && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null);
  const x = int(params["x"]);
  const y = int(params["y"]);
  return x !== null && y !== null ? { map, hex: { x, y } } : { map };
}
