/**
 * UI inventory ids for the New map form's generator options, so each one
 * is placed by the placement map (src/ui/placement.ts) like any control.
 * Ids are `NewMap.<generator><Option>` from the owner's worksheet; an option
 * without one is `main`. Each module lists its own generators' ids
 * (ModuleRuntime.newMapOptionIds); this asks the modules compiled in.
 */

import { moduleNewMapOptionIds } from "../modules/runtime";

/** Every generator's option ids: generator id → option key → inventory id. */
export function newMapOptionIds(): Readonly<Record<string, Readonly<Record<string, string>>>> {
  return moduleNewMapOptionIds();
}

/** The inventory id of generator `kindId`'s option `key` (undefined: not in the inventory, so main). */
export function newMapOptionId(kindId: string, key: string): string | undefined {
  return moduleNewMapOptionIds()[kindId]?.[key];
}
