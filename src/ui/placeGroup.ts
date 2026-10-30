/**
 * Controls that are built and moved together (a labelled row with its
 * buttons, a small form) share one layer. `groupId(ids)` names the group by
 * its first id for Disclosure.target/place; every id in it is listed at the
 * call site so the placement map and the UI inventory stay in step, and
 * tests/placementSurfaces.test.ts checks the group's ids agree.
 */

import { layerOf } from "./placement";

export function groupId(ids: readonly string[]): string {
  return ids[0];
}

/** Do all the ids sit on the same layer (a group can only go one place)? */
export function groupAgrees(ids: readonly string[]): boolean {
  return ids.every((id) => layerOf(id) === layerOf(ids[0]));
}
