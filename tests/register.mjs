import { register, createRequire } from "node:module";

// Release slice flags (esbuild defines in a build; see release-slices.json):
// tests run with every slice on.
globalThis.__SLICE_WORLDMAPS__ = true;
globalThis.__SLICE_SPACE__ = true;

// Stub .png and .md for CJS mode (tsx CLI uses CJS transforms; without this, tsx's
// .js fallback handler tries to parse binary/markdown files as TypeScript and crashes).
const req = createRequire(import.meta.url);
const CJSModule = req("module");
CJSModule._extensions[".png"] = function (mod) { mod.exports = ""; };
CJSModule._extensions[".svg"] = function (mod) { mod.exports = ""; };
CJSModule._extensions[".md"]  = function (mod) { mod.exports = ""; };

// Register ESM load hook for .png/.md (fallback for ESM mode)
register("./asset-hooks.mjs", import.meta.url);
