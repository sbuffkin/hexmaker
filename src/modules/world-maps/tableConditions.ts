/**
 * The World maps module's When key for random tables: temperature (cold …
 * hot, or 0.2–0.5), from the overworld's climate. Pure.
 */

import type { TableConditionDef } from "../types";
import { TEMPERATURE_WORDS, inClimateRange, parseClimateRange, type ClimateRange } from "../../overworld/biomeClimate";

export const WORLD_MAPS_TABLE_CONDITIONS: TableConditionDef[] = [
  {
    key: "temperature",
    aliases: ["temp"],
    read: (value) => {
      const r = parseClimateRange(value, TEMPERATURE_WORDS);
      return r.range && !r.problem ? r.range : undefined;
    },
    fits: (range, known) => inClimateRange(range as ClimateRange, known as number),
    format: (range) => `${(range as ClimateRange).lo}–${(range as ClimateRange).hi}`,
  },
];
