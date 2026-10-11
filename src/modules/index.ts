/**
 * The modules compiled into this build, in registry order, and the
 * registry over them. The one place (with ./runtime.ts) that imports a
 * module: the core asks `registry`, never a module directly
 * (tests/moduleBoundary.test.ts).
 *
 * Data only (see ./types.ts): safe to import from anywhere in the core.
 */

import type { HexmakerModule } from "./types";
import { ModuleRegistry } from "./registry";
import { worldModule } from "./world";
import { worldMapsModule } from "./world-maps";
import { spaceModule } from "./space";

export const MODULES: readonly HexmakerModule[] = [worldModule, worldMapsModule, spaceModule];

export const registry = new ModuleRegistry(MODULES);
