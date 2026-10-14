/**
 * Modules' tabs on the generator page's library (ModuleRuntime.generatorPage):
 * beside Generators and Maps, each with its own list and its own page below.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GeneratorPageHost, GeneratorPageTab } from "../../modules/types";
import { moduleGeneratorTabs } from "../../modules/runtime";

/** The module tab with id `tab` (undefined: Generators, Maps, or a tab of a module not in this build). */
export function moduleTab(tab: string): GeneratorPageTab | undefined {
  return moduleGeneratorTabs().find((t) => t.id === tab);
}

/** Show the module tab's page when `tab` is one; true when it did. */
export function showModuleTab(plugin: HexmakerPlugin, tab: string, main: HTMLElement, side: HTMLElement, host: GeneratorPageHost): boolean {
  const t = moduleTab(tab);
  if (!t) return false;
  t.renderPanel(plugin, main, side, host);
  return true;
}
