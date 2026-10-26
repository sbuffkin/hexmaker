/**
 * Hex fields over a whole map (plan-custom-hex-fields phase 1): what a hex
 * gets when it gets terrain and what Recalculate fields does to every hex. The service (src/services/FieldsService.ts)
 * hands in the map's hexes, places and the table roller; this file decides.
 *
 * Pure: no Obsidian imports.
 */

import type { HexData } from "../maps/mapNote";
import type { ConditionContext } from "../random-tables/tableConditions";
import { fieldNamed, type FieldDecls, type FieldDef } from "./fieldTypes";
import { computeHexFields, setByHand, type FieldPass } from "./hexFields";
import { effectsAt, type FieldEffect, type Place } from "./influence";
import { placesNear } from "./places";

export interface MapFieldsInput {
  decls: FieldDecls;
  hexes: ReadonlyMap<string, HexData>;
  places: readonly Place[];
  /** Hexes between two hex keys. */
  distance(a: string, b: string): number;
  /** A terrain's palette type ("forest", "settlement"), if any. */
  typeOf(terrain: string): string | undefined;
  /** Roll a field's table with this When context: its result text, or undefined. */
  roll(field: FieldDef, ctx: ConditionContext): string | undefined;
  rand?: () => number;
}

/** The When context of a hex's rolls: its terrain, the terrain's type and the places around it. */
export function hexContext(input: MapFieldsInput, key: string, h: HexData | undefined): ConditionContext {
  const ctx: ConditionContext = { near: placesNear(input.places, (k) => input.distance(key, k)) };
  if (h?.terrain) {
    ctx.terrain = h.terrain;
    const type = input.typeOf(h.terrain);
    if (type) ctx.type = type;
  }
  return ctx;
}

/** What the places do to each field on this hex. */
export function hexEffects(input: MapFieldsInput, key: string): Map<string, FieldEffect> {
  return effectsAt(input.places, input.decls.influences, (k) => input.distance(key, k));
}

/** One hex worked out (a FieldPass): its new `extra`, or undefined when nothing changes. */
export function workOutHex(input: MapFieldsInput, key: string, h: HexData | undefined, pass: FieldPass): Record<string, string> | undefined {
  if (!input.decls.fields.length) return undefined;
  const ctx = hexContext(input, key, h);
  return computeHexFields(h, {
    decls: input.decls,
    roll: (f) => input.roll(f, ctx),
    effects: hexEffects(input, key),
    rand: input.rand,
  }, pass);
}

/** A value typed by hand on one hex (the editor): its new `extra`, or undefined when nothing changes. */
export function typedOnHex(input: MapFieldsInput, key: string, field: string, raw: string): Record<string, string> | undefined {
  const f = fieldNamed(input.decls, field);
  if (!f) return undefined;
  return setByHand(input.hexes.get(key), input.decls, f, raw, hexEffects(input, key));
}

/** Every hex with terrain worked out: [key, new extra] for the ones that change. */
export function workOutMap(input: MapFieldsInput, pass: FieldPass): [string, Record<string, string>][] {
  const out: [string, Record<string, string>][] = [];
  if (!input.decls.fields.length) return out;
  for (const [key, h] of input.hexes) {
    if (!h.terrain) continue;
    const next = workOutHex(input, key, h, pass);
    if (next) out.push([key, next]);
  }
  return out;
}
