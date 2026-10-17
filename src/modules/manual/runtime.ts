/**
 * The Hexcrawl manual module's runtime: its part of the Map export form
 * (./exportForm.ts).
 */

import type { ModuleRuntime } from "../types";
import { manualExportForm } from "./exportForm";

export const manualRuntime: ModuleRuntime = {
  id: "manual",
  exportForm: [manualExportForm],
};
