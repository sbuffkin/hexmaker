import { register, createRequire } from "node:module";

// Stub .png and .md for CJS mode (tsx CLI uses CJS transforms; without this, tsx's
// .js fallback handler tries to parse binary/markdown files as TypeScript and crashes).
const req = createRequire(import.meta.url);
const CJSModule = req("module");
CJSModule._extensions[".png"] = function (mod) { mod.exports = ""; };
CJSModule._extensions[".svg"] = function (mod) { mod.exports = ""; };
// A module's shipped table notes (src/modules/<id>/tables/*.md) are data the
// code rolls on, so tests get their real text; every other .md stays stubbed.
const fs = req("fs");
const MODULE_TABLE = /[\\/]src[\\/]modules[\\/][^\\/]+[\\/]tables[\\/][^\\/]+\.md$/;
CJSModule._extensions[".md"]  = function (mod, filename) { mod.exports = MODULE_TABLE.test(filename) ? fs.readFileSync(filename, "utf8") : ""; };

// Register ESM load hook for .png/.md (fallback for ESM mode)
register("./asset-hooks.mjs", import.meta.url);
