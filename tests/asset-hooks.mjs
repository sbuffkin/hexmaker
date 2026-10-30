import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MODULE_TABLE = /\/src\/modules\/[^/]+\/tables\/[^/]+\.md$/;

/** `obsidian` is the test mock (see register.mjs). */
export async function resolve(specifier, context, nextResolve) {
	if (specifier === "obsidian") return nextResolve(new URL("./__mocks__/obsidian.ts", import.meta.url).href, context);
	return nextResolve(specifier, context);
}

/** Stub loader — returns an empty-string default export for .png and .md assets. */
export async function load(url, context, nextLoad) {
	// A module's shipped table notes keep their text (see register.mjs).
	if (url.endsWith(".md") && MODULE_TABLE.test(decodeURIComponent(new URL(url).pathname))) {
		return {
			format: "module",
			shortCircuit: true,
			source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url), "utf8"))};`,
		};
	}
	if (url.endsWith(".png") || url.endsWith(".svg") || url.endsWith(".md")) {
		return {
			format: "module",
			shortCircuit: true,
			source: 'export default "";',
		};
	}
	return nextLoad(url, context);
}
