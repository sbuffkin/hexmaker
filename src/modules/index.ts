/**
 * The modules compiled into this build, in registry order, and the
 * registry over them. The one place (with ./runtime.ts) that imports a
 * module: the core asks `registry`, never a module directly
 * (tests/moduleBoundary.test.ts).
 *
 * One module is one release slice (release-slices.json): a slice built
 * off (its __SLICE_*__ flag false) is left out here, so nothing in the
 * bundle reaches its code and esbuild drops it (npm run check:release).
 *
 * Data only (see ./types.ts): safe to import from anywhere in the core.
 */

import type { HexmakerModule } from "./types";
import { ModuleRegistry } from "./registry";
import { worldModule } from "./world";
import { worldMapsModule } from "./world-maps";
import { spaceModule } from "./space";
import { hexFlowerModule } from "./hex-flower";

// Plain `if`s on the flags: esbuild drops a false branch (and so the
// module) without minifying; a ternary inside an array isn't folded.
const compiled: HexmakerModule[] = [worldModule];
if (__SLICE_WORLDMAPS__) compiled.push(worldMapsModule);
if (__SLICE_SPACE__) compiled.push(spaceModule);
if (__SLICE_HEXFLOWER__) compiled.push(hexFlowerModule);

export const MODULES: readonly HexmakerModule[] = compiled;

export const registry = new ModuleRegistry(MODULES);
