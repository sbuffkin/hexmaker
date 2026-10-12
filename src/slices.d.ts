/**
 * Release slice flags (release-slices.json), set at build time by
 * esbuild's `define` (esbuild.config.mjs) and in tests by
 * tests/register.mjs. A slice built off is dropped from main.js: only
 * src/modules/index.ts and src/modules/runtime.ts read these.
 */
declare const __SLICE_WORLDMAPS__: boolean;
declare const __SLICE_SPACE__: boolean;
