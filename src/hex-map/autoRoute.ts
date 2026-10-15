/**
 * Auto-route for the path tool. The router itself (A*, the winding route,
 * hex distance) lives in src/paths/router.ts (ROUTER v1, frozen by golden
 * tests) and is re-exported here. The path tool itself (what a click does,
 * dragging, forks) is src/hex-map/pathTool.ts.
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
