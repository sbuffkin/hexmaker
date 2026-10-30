/** The fields module's service, made once by its runtime and found here by the rest of it. */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { FieldsService } from "./FieldsService";

const services = new WeakMap<object, FieldsService>();

export function fieldsOf(plugin: HexmakerPlugin): FieldsService | undefined {
  return services.get(plugin);
}

export function setFields(plugin: HexmakerPlugin, service: FieldsService): void {
  services.set(plugin, service);
}
