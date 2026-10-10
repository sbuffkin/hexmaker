import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";

// The token form is DOM-heavy (Obsidian Setting/Modal), so these pin the
// round-4 fixes at the source level.
const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("token form icon picker (fresh-eyes round 4)", () => {
	const token = read("src", "hex-map", "TokenModal.ts");
	const base = read("src", "HexmakerModal.ts");
	const css = read("styles.css");
	const r4 = css.slice(css.indexOf("Fresh-eyes r4"));

	it("closes the note suggestions on click, not on press (the first icon click was lost)", () => {
		expect(token).not.toMatch(/modalEl\.addEventListener\("pointerdown"/);
		expect(token).toMatch(/modalEl\.addEventListener\("click", \(e: MouseEvent\) => \{\n\s+const t = e\.target as Node \| null;\n\s+if \(t && \(el\.contains\(t\) \|\| resultsEl\.contains\(t\)\)\) return;\n\s+resultsEl\.hide\(\);/);
	});

	it("gives every icon tile its full name as a tooltip", () => {
		expect(token).toMatch(/tile\.title = label;/);
		// Every picker with the filter bar (token form, hex editor, icon tool).
		expect(base).toMatch(/if \(icon && !tile\.title\) tile\.title = iconLabel\(icon\);/);
	});

	it("is roomy and wraps names instead of cutting them short", () => {
		expect(r4).toMatch(/\.duckmage-token-modal \.duckmage-icon-picker-inline \{[^}]*height: min\(360px, 45vh\)/);
		expect(r4).toMatch(/\.duckmage-token-modal \.duckmage-icon-option-name \{[^}]*white-space: normal;[^}]*text-overflow: clip;/);
	});
});
