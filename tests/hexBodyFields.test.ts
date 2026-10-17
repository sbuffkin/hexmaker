import { describe, it } from "node:test";
import expect from "expect";
import { sameName, takeBodyFields } from "../src/hexBodyFields";

const OLD = "# Hex 0, 1\n\n**Region:** Mountains\n**Terrain:** mountain\n\n### description\nCold.\n";

describe("hex note body fields (older templates' Terrain / Region lines)", () => {
	it("takes filled lines out (as typed), keeping everything else (NF2)", () => {
		const r = takeBodyFields(OLD);
		expect(r.taken).toEqual([{ field: "Region", value: "Mountains" }, { field: "Terrain", value: "mountain" }]);
		expect(r.content).toBe("# Hex 0, 1\n\n### description\nCold.\n");
		// Placeholders and empty lines stay; frontmatter is never read as body.
		const tmpl = "---\nnote: \"**Terrain:** x\"\n---\n**Terrain:**\n**Region:** *(fill in)*\n";
		expect(takeBodyFields(tmpl)).toEqual({ content: tmpl, taken: [] });
		expect(takeBodyFields("**Terrain:** a\r\nrest").content).toBe("rest");
	});

	it("compares names ignoring case and spacing", () => {
		expect(sameName("Desert  Rocky", "desert rocky")).toBe(true);
		expect(sameName("mountain", null)).toBe(false);
	});
});
