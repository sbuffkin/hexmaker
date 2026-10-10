import { describe, it } from "node:test";
import expect from "expect";
import { readBodyField, sameName, setBodyField } from "../src/hexBodyFields";

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

	it("updates only that line, keeping everything else", () => {
		const out = setBodyField(OLD, "Terrain", "desert rocky");
		expect(out).toBe(OLD.replace("**Terrain:** mountain", "**Terrain:** desert rocky"));
		expect(setBodyField("**Terrain:**\nrest", "Terrain", "grass")).toBe("**Terrain:** grass\nrest");
		expect(setBodyField("nothing here", "Terrain", "grass")).toBe("nothing here");
		// A trailing "  " (a Markdown line break) stays.
		expect(setBodyField("**Region:** Mountains  \n**Terrain:** x", "Region", "Dustbowl")).toBe("**Region:** Dustbowl  \n**Terrain:** x");
	});

	it("compares names ignoring case and spacing", () => {
		expect(sameName("Desert  Rocky", "desert rocky")).toBe(true);
		expect(sameName("mountain", null)).toBe(false);
	});
});
