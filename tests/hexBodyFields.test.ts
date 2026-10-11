import { describe, it } from "node:test";
import expect from "expect";
import { readBodyField, sameName, takeBodyFields } from "../src/hexBodyFields";

const OLD = "# Hex 0, 1\n\n**Region:** Mountains\n**Terrain:** mountain\n\n### description\nCold.\n";

describe("hex note body fields (older templates' Terrain / Region lines)", () => {
	it("reads what the note says", () => {
		expect(readBodyField(OLD, "Terrain")).toBe("mountain");
		expect(readBodyField(OLD, "Region")).toBe("Mountains");
	});

	it("treats empty lines and template placeholders as not set", () => {
		expect(readBodyField("**Terrain:**\n**Region:**   \n", "Terrain")).toBeUndefined();
		expect(readBodyField("**Terrain:** *(woods / marsh / …)*\n", "Terrain")).toBeUndefined();
		expect(readBodyField("no such line", "Region")).toBeUndefined();
	});

	it("reads a link by its shown text", () => {
		expect(readBodyField("**Region:** [[regions/Basin|Basin]]\n", "Region")).toBe("Basin");
		expect(readBodyField("**Region:** [[Dustbowl]]\n", "Region")).toBe("Dustbowl");
	});

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
