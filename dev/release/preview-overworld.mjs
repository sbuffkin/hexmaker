#!/usr/bin/env node
/**
 * npm run preview:overworld — bundles dev/overworld-preview.ts for
 * dev/overworld-preview.html, with the slice flags from the same switch as
 * the build (dev/release/slices.mjs; default: every slice on).
 * HEXMAKER_SLICES / _ON / _OFF and --slices work as for esbuild.config.mjs.
 */
import esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceDefines, slicesFromEnv } from "./slices.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resolved = slicesFromEnv(process.env, process.argv.slice(2), "all");

await esbuild.build({
	absWorkingDir: ROOT,
	entryPoints: ["dev/overworld-preview.ts"],
	bundle: true,
	format: "iife",
	loader: { ".md": "text" },
	define: sliceDefines(resolved),
	outfile: "dev/overworld-preview.js",
	logLevel: "info",
});
