/**
 * Prints each module's slice and what it owns, as JSON, for
 * dev/release/check-release.mjs (the bundle deny-list is derived from the
 * modules, never kept by hand). Run with tsx and tests/register.mjs (every
 * slice on).
 */
import { MODULES } from "../../src/modules";

const out = MODULES.map((m) => ({ id: m.id, slice: m.slice, owns: m.owns }));
console.log(JSON.stringify(out));
