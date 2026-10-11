/**
 * "Copy link to this hex": puts a Markdown link on the clipboard that opens
 * the map centred on the hex (src/hexLink.ts). Shared by the hex editor's
 * centre dot and the map's hex right-click menu.
 */
import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { hexLinkLabel, hexMarkdownLink } from "../hexLink";

export const COPY_HEX_LINK_TITLE = "Copy link to this hex";

/** The Markdown link to hex (x, y) of `mapName`, labelled with the hex's name when it has one. */
export function hexLinkFor(plugin: HexmakerPlugin, mapName: string, x: number, y: number): string {
  const name = plugin.mapStore.get(mapName, `${x}_${y}`)?.name;
  return hexMarkdownLink(plugin.app.vault.getName(), { map: mapName, hex: { x, y } }, hexLinkLabel(plugin.mapLabel(mapName), x, y, name));
}

export function copyHexLink(plugin: HexmakerPlugin, mapName: string, x: number, y: number): void {
  void navigator.clipboard.writeText(hexLinkFor(plugin, mapName, x, y)).then(
    () => new Notice(`Copied a link to hex ${x}, ${y}. Paste it in a note: it opens the map centred here.`),
    () => new Notice("Couldn't copy the link."),
  );
}
