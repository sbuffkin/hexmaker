/**
 * The module-level ports: functions the plugin hands to plain modules on
 * load so they can reach plugin state without importing the plugin
 * (frontmatter's hex data, the work-mode gates, palette previews, icon
 * pickers, slider number boxes).
 *
 * The eighth port, setBiomeSource (overworld/biomes.ts), is not here: it
 * is World maps module code (core may not import it: tests/moduleBoundary),
 * and BiomeStore, not the plugin, feeds it as biome notes load.
 *
 * bindPorts(plugin) wires all of them in one place; HexmakerPlugin.onload
 * calls it (in the order onload used to set them itself). resetPorts() puts
 * every port back to its module default (for tests; onunload doesn't call
 * it yet, as the plugin never did).
 */
import type HexmakerPlugin from "./HexmakerPlugin";
import { setIconPackDefault } from "./HexmakerModal";
import { setHexDataSource } from "./frontmatter";
import { setHandEditListener, setModeMapLookup } from "./modeGate";
import { setPaletteTerrainSource } from "./palettes/paletteOptions";
import { setPathEditMapLookup } from "./paths/editGate";
import { isDebugMode } from "./ui/debugMode";
import { setNumberBoxDebug } from "./ui/numberBoxes";
import { defaultIconPack } from "./utils";

/** What the ports read from the plugin. */
export type PortsHost = Pick<HexmakerPlugin, "settings" | "app" | "mapStore" | "arrival" | "getMap" | "getPaletteOrPresetTerrains">;

/** Point every plugin-fed port at `plugin`. */
export function bindPorts(plugin: PortsHost): void {
	// Icon pickers open on the Space tab for space-only setups.
	setIconPackDefault(() => defaultIconPack(plugin.settings));
	// Number boxes beside sliders follow debug mode (src/ui/numberBoxes.ts).
	setNumberBoxDebug(() => isDebugMode(plugin.app));
	// Palette pickers preview the picked palette's terrains (E4).
	setPaletteTerrainSource((name) => plugin.getPaletteOrPresetTerrains(name));
	setHexDataSource(plugin.mapStore);
	setPathEditMapLookup((name) => plugin.getMap(name));
	setModeMapLookup((name) => plugin.getMap(name));
	// The first hand edit of a new (open) place locks it (ArrivalService.lockOnHandEdit).
	setHandEditListener((name) => plugin.arrival.lockOnHandEdit(name));
}

/** Every port back to its module default (nothing bound). */
export function resetPorts(): void {
	setIconPackDefault(() => "all");
	setNumberBoxDebug(() => false);
	setPaletteTerrainSource(null);
	setHexDataSource(null);
	setPathEditMapLookup(null);
	setModeMapLookup(null);
	setHandEditListener(null);
}
