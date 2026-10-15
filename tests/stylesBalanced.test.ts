import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";

/**
 * A rule left unclosed (easy to do when resolving a merge in styles.css)
 * makes the browser swallow every rule after it, silently: 2026-10-09 a
 * merge dropped one "}" and all later styles stopped applying.
 */
describe("styles.css", () => {
  it("has every { closed, and no stray }", () => {
    const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let line = 1;
    const problems: string[] = [];
    for (const ch of css) {
      if (ch === "\n") line++;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth < 0) {
        problems.push(`stray } at line ${line}`);
        depth = 0;
      }
    }
    expect(problems).toEqual([]);
    expect(depth).toBe(0);
  });
});
