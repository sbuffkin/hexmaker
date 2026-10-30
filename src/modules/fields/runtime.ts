/**
 * The Hex fields module's runtime: the service and its fields note, the
 * filler MapStore calls when a hex gets terrain, and the hooks for the hex
 * editor, the hex table, the settings tab and Recalculate fields.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { ModuleRuntime, ModuleStore } from "../types";
import { fieldsOf, setFields } from "../../fields/context";
import { FieldsSection } from "../../fields/FieldsSection";
import { FieldsService } from "../../fields/FieldsService";
import { fieldsTablePart } from "../../fields/hexTablePart";
import { HEX_FIELD_SETTINGS } from "../../fields/hexFieldsSetting";
import { RecalculateFieldsModal } from "../../fields/RecalculateFieldsModal";
import { setFieldFiller } from "../../maps/fieldFill";

function stores(plugin: HexmakerPlugin): ModuleStore[] {
  const service = new FieldsService(plugin);
  setFields(plugin, service);
  // A hex that gets terrain has its blank fields worked out in the same write.
  setFieldFiller((map, key, h) => service.fillFor(map, key, h));
  return [service.moduleStore()];
}

export const fieldsRuntime: ModuleRuntime = {
  id: "fields",
  stores,
  // Read once the map store is in; it writes nothing by itself.
  afterStoresReady: (plugin) => fieldsOf(plugin)?.init() ?? Promise.resolve(),
  settings: HEX_FIELD_SETTINGS,
  commands: [{
    id: "recalculate-fields",
    name: "Recalculate fields",
    placementId: "Plugin.cmd.recalculateFields",
    available: (plugin) => !!plugin.activeMapName(),
    run: (plugin) => {
      const map = plugin.activeMapName();
      if (map) new RecalculateFieldsModal(plugin.app, plugin, map).open();
    },
  }],
  hexEditor: [{ id: "fields", create: (host) => new FieldsSection(host) }],
  hexTable: fieldsTablePart,
};
