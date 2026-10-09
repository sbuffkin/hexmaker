/** A small YAML subset (scalars, quoted strings, inline and dash lists) for tests. */
export function parseMiniYaml(src: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	let listKey: string | null = null;
	for (const raw of src.split(/\r?\n/)) {
		if (!raw.trim()) continue;
		const item = /^\s+-\s*(.*)$/.exec(raw);
		if (item && listKey) {
			(out[listKey] as unknown[]).push(scalar(item[1]));
			continue;
		}
		const kv = /^([^:#\s][^:]*):\s*(.*)$/.exec(raw);
		if (!kv) continue;
		const [, key, value] = kv;
		if (value === "") {
			out[key] = [];
			listKey = key;
		} else {
			out[key] = scalar(value);
			listKey = null;
		}
	}
	// "key:" with no items is null in YAML
	for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && v.length === 0) out[k] = null;
	return out;
}

function scalar(v: string): unknown {
	v = v.trim();
	if (v.startsWith("[") && v.endsWith("]") && !v.startsWith("[[")) {
		return v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean).map(scalar);
	}
	if (/^".*"$/.test(v)) return JSON.parse(v);
	if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
	if (v === "true") return true;
	if (v === "false") return false;
	if (v === "null" || v === "~") return null;
	if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
	return v;
}
