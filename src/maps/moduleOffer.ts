/**
 * Owner call CM6: a map whose module is turned off still loads (its notes
 * and data are all there; nothing breaks), but its module's generators,
 * palettes and icons are hidden. When the user opens such a map on
 * purpose, from the maps picker or a hex's region menu, offer to turn the
 * module on. Only there: "New …" flows (a parent for an overworld, a new
 * map, a submap) never offer it, and never turn a module on.
 *
 * Self-paced (no nags): "Not now" is remembered for the rest of the
 * session, per map type, and the map opens either way.
 */

import { registry } from "../modules";
import { enabledKinds } from "../mapKinds";

/** Map types the user said "Not now" to this session. */
const declined = new Set<string>();

/** Forget this session's "Not now" answers (tests). */
export function resetModuleOffers(): void {
  declined.clear();
}

export interface ModuleOffer {
  /** The map type (module) that's off. */
  kind: string;
  /** Its name in Settings → Map types. */
  label: string;
}

/**
 * The module to offer for `mapName`, or undefined: the map's type (one
 * rule, CM3) is a module that's compiled in, turned off, and not declined
 * this session.
 */
export function moduleOfferFor(
  mapName: string,
  kindFor: (map: string) => string | undefined,
  settings: { mapKinds?: string[] },
): ModuleOffer | undefined {
  const kind = kindFor(mapName);
  const info = registry.kindInfo(kind);
  if (!kind || !info) return undefined;
  if (enabledKinds(settings).has(kind) || declined.has(kind)) return undefined;
  return { kind, label: info.shortLabel ?? info.label };
}

/** The offer's words (plain, short). */
export function moduleOfferText(mapLabel: string, offer: ModuleOffer): { heading: string; message: string; confirm: string } {
  return {
    heading: `Turn on ${offer.label}?`,
    message: `"${mapLabel}" is a ${offer.label} map, but ${offer.label} is turned off in Settings → Map types, so its generators, palettes and icons are hidden. The map opens either way.`,
    confirm: `Turn on ${offer.label}`,
  };
}

/** "Not now": don't ask about this map type again this session. */
export function declineModuleOffer(kind: string): void {
  declined.add(kind);
}
