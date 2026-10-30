/**
 * The Space module's When keys for random tables: zone (inner, habitable,
 * outer), ring (hexes from the star, like 2–4) and star (star terrains).
 * Pure.
 */

import type { TableConditionDef } from "../types";
import { readIntRange, type IntRange } from "../../worldgen/cellReaders";
import { ORBIT_ZONES, readOrbit, type OrbitZone } from "./orbitZones";

const lc = (s: string) => s.trim().toLowerCase();
const fmt = (r: IntRange) => (r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`);

export const SPACE_TABLE_CONDITIONS: TableConditionDef[] = [
  {
    key: "zone",
    aliases: ["orbit"],
    read: (value) => {
      const o = readOrbit(value);
      return !o || o.distance || !o.zones?.length ? undefined : o.zones;
    },
    fits: (zones, known) => !known || (zones as OrbitZone[]).includes(known as OrbitZone),
    format: (zones) => ORBIT_ZONES.filter((z) => (zones as OrbitZone[]).includes(z)).join(", "),
  },
  {
    key: "ring",
    aliases: ["distance"],
    read: (value) => readIntRange(value),
    fits: (range, known) => {
      const r = range as IntRange, n = known as number;
      return !(n < r.lo || n > r.hi);
    },
    format: (range) => fmt(range as IntRange),
  },
  {
    key: "star",
    read: (value) => {
      const values = value.split(/\s*,\s*/).map(lc).filter((s) => s !== "");
      return values.length ? values : undefined;
    },
    fits: (values, known) => (values as string[]).includes(lc(String(known))),
    format: (values) => (values as string[]).join(", "),
  },
];
