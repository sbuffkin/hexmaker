/** Stub loader — returns an empty-string default export for .png and .md assets. */
export async function load(url, context, nextLoad) {
	if (url.endsWith(".png") || url.endsWith(".md")) {
		return {
			format: "module",
			shortCircuit: true,
			source: 'export default "";',
		};
	}
	return nextLoad(url, context);
}
