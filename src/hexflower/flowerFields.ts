/**
 * The Hex flower module's own map setting and table condition. Pure data.
 */

import type { MapNoteField, TableConditionDef } from "../modules/types";

/** Where each flower's walk stands: `hex-flower-at: ["Wilds: 10"]`. */
export const HEX_FLOWER_FIELDS: readonly MapNoteField[] = [
  { field: "hexFlowerAt", key: "hex-flower-at", kind: "list" },
];

const lc = (s: string) => s.trim().toLowerCase();

/**
 * A random table's When key: `from: grassland, hills` — the terrain of the
 * hex the party came from (exploring passes it in).
 */
export const FROM_CONDITION: TableConditionDef = {
  key: "from",
  read: (value) => {
    const list = value.split(/\s*,\s*/).map(lc).filter(Boolean);
    return list.length ? list : undefined;
  },
  fits: (read, known) => typeof known === "string" && (read as string[]).includes(lc(known)),
  format: (read) => (read as string[]).join(", "),
};
