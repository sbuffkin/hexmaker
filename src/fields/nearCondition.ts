/** `near: town 2` in a table's When (tableConditions.ts): a place of one of the types within that many hexes (also `near: town, city 3`; no number = 1). Pure. */

import type { TableConditionDef } from "../modules/types";

const lc = (s: string) => s.trim().toLowerCase();
const list = (value: string) => value.split(/\s*,\s*/).map(lc).filter(Boolean);

export const NEAR_CONDITION: TableConditionDef = {
  key: "near",
  aliases: ["within"],
  read(value) {
    const m = /^(.*?)(?:\s+(\d+))?$/.exec(value.trim());
    const types = list(m?.[1] ?? "");
    if (!types.length) return undefined;
    return { types, radius: m?.[2] ? Number(m[2]) : 1 };
  },
  fits(read, known) {
    const { types, radius } = read as { types: string[]; radius: number };
    if (!Array.isArray(known)) return true;
    return (known as { type: string; distance: number }[]).some((p) => types.includes(lc(p.type)) && p.distance <= radius);
  },
  format(read) {
    const { types, radius } = read as { types: string[]; radius: number };
    return `${types.join(", ")} ${radius}`;
  },
};
