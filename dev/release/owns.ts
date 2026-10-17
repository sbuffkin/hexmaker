/**
 * Prints each module's slice and what it owns, as JSON, for
 * dev/release/check-release.mjs (the bundle deny-list is derived from the
 * modules, never kept by hand): its `owns`, its placement ids and the ids
 * of its work-mode rows (commands, menu items, tools, actions). Run with
 * tsx and tests/register.mjs (every slice on).
 */
import { MODULES } from "../../src/modules";

const out = MODULES.map((m) => ({
  id: m.id,
  slice: m.slice,
  owns: m.owns,
  placementIds: Object.keys(m.placement ?? {}),
  modeActionIds: [
    ...Object.keys(m.modeActions?.commands ?? {}),
    ...Object.keys(m.modeActions?.menus ?? {}),
    ...Object.keys(m.modeActions?.tools ?? {}),
    ...Object.keys(m.modeActions?.policy ?? {}),
  ],
}));
console.log(JSON.stringify(out));
