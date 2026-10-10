/**
 * Auto-route for the path tool. The router itself (A*, the winding route,
 * hex distance) lives in src/paths/router.ts (ROUTER v1, frozen by golden
 * tests) and is re-exported here; this file keeps the tool's chain helpers.
 * Pure — no Obsidian imports — so it's unit-tested directly
 * (tests/autoRoute.test.ts).
 *
 * Hex keys are "x_y" offset coordinates, the same as path chains use.
 */

export {
  findRoute,
  hashString,
  hexCenter,
  hexDistance,
  type RouteBounds,
  type RouteOptions,
  type RouteResult,
} from "../paths/router";

/** The bits of a path chain auto-route needs. */
export interface RouteChain {
  typeName: string;
  hexes: string[];
}

/**
 * The chain an auto-route starting at `start` continues: one of the same
 * type whose LAST hex is `start` (the active chain first). Anything else,
 * including a start on a chain's first hex or in its middle, starts a new
 * path (round 7 R11: a second road from the keep must not join the first).
 */
export function routeExtendTarget<T extends RouteChain>(
  chains: readonly T[],
  typeName: string,
  start: string,
  active: T | null,
): T | null {
  const endsAtStart = (c: T) => c.typeName === typeName && c.hexes[c.hexes.length - 1] === start;
  if (active && endsAtStart(active)) return active;
  return chains.find(endsAtStart) ?? null;
}

/**
 * Add a routed leg to `chains`: appended to the chain it continues (only new
 * hexes are added; existing ones are never changed), else as a new chain.
 * Returns the chain the leg is now part of.
 */
export function addRoutedLeg<T extends RouteChain>(
  chains: T[],
  typeName: string,
  route: readonly string[],
  active: T | null,
  make: (typeName: string, hexes: string[]) => T,
): T {
  const target = routeExtendTarget(chains, typeName, route[0], active);
  if (target) {
    target.hexes.push(...route.slice(1));
    return target;
  }
  const chain = make(typeName, [...route]);
  chains.push(chain);
  return chain;
}
