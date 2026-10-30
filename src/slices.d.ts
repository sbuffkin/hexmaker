/**
 * Release slice flags (release-slices.json), set at build time by
 * esbuild's `define` (esbuild.config.mjs) and in tests by
 * tests/register.mjs. A slice built off is dropped from main.js: only
 * src/modules/index.ts and src/modules/runtime.ts read these.
 */
declare const __SLICE_WORLDMAPS__: boolean;
declare const __SLICE_SPACE__: boolean;
declare const __SLICE_PLAY__: boolean;
declare const __SLICE_FOG__: boolean;
declare const __SLICE_HEXFLOWER__: boolean;
declare const __SLICE_GENPAGE__: boolean;
declare const __SLICE_PACKS__: boolean;
declare const __SLICE_MANUAL__: boolean;
declare const __SLICE_FIELDS__: boolean;
/** The slices built on, as JSON text ('["worldmaps","space"]'); see src/modules/index.ts builtSlices(). */
declare const __HEXMAKER_SLICES__: string;
/** Hashes of the map-note keys of slices built off (src/maps/offSliceMaps.ts). */
declare const __OFF_SLICE_MAP_MARKS__: readonly number[];
