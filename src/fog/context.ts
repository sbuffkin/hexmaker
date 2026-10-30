/** The fog module's service, made once by its runtime and found here by the rest of it. */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { FogService } from "./FogService";

const services = new WeakMap<object, FogService>();

export function fogOf(plugin: HexmakerPlugin): FogService | undefined {
  return services.get(plugin);
}

export function setFog(plugin: HexmakerPlugin, fog: FogService): void {
  services.set(plugin, fog);
}
