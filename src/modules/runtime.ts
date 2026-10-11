/**
 * The runtime halves of the modules compiled into this build (see
 * ./types.ts), in the same order as ./index.ts. Read by the plugin and the
 * services that need a module's host-bound pieces (generators, stores,
 * settings, commands). Only ever read inside functions, never at import
 * time: modules reach back into the core, so the import graph has cycles
 * through here.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ModuleRuntime } from "./types";
import { worldRuntime } from "./world/runtime";
import { worldMapsRuntime } from "./world-maps/runtime";
import { spaceRuntime } from "./space/runtime";

export const MODULE_RUNTIMES: readonly ModuleRuntime[] = [worldRuntime, worldMapsRuntime, spaceRuntime];

/** Every module's built-in generators, in list order. */
export function moduleGenerators(plugin: HexmakerPlugin, helpers: GeneratorHelpers): GeneratorContribution[] {
  return MODULE_RUNTIMES
    .flatMap((m) => m.generators?.(plugin, helpers) ?? [])
    .sort((a, b) => a.order - b.order);
}
