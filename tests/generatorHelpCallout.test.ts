/** Generator notes' help as a collapsed callout, read in both forms (plan-release-slicing, R3). */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { modelToMarkdown, parseModelMarkdown, type HexWfcModel } from "../packages/hex-wfc/src";
import { generatorHelpCallout, wrapGeneratorHelp } from "../src/migrations/unreleased-generator-help-callout";

const MODEL: HexWfcModel = { name: "x", terrains: [{ name: "Grass", weight: 2 }], adjacency: [{ a: "Grass", b: "Grass", weight: 1 }], meta: {} };
const OLD_NOTE = readFileSync("tests/fixtures/compat/1.5.5/generator.md", "utf8");

describe("generator help callout", () => {
  it("a new note has its help in a collapsed callout, before the tables", () => {
    const text = modelToMarkdown(MODEL);
    const at = text.indexOf("> [!info]- How to edit this generator");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(text.indexOf("## Terrains"));
    expect(text).not.toMatch(/^A wave function/m);
    expect(text).not.toMatch(/^- \*\*Terrains/m);
  });

  it("the reader gets the same model from either form", () => {
    expect(parseModelMarkdown(wrapGeneratorHelp(OLD_NOTE)).model).toEqual(parseModelMarkdown(OLD_NOTE).model);
    expect(parseModelMarkdown(modelToMarkdown(MODEL)).warnings).toEqual([]);
  });

  it("the migration wraps an old note's help as it stands and nothing else", () => {
    const edited = OLD_NOTE.replace("- **Adjacency**", "- My own line in the help.\n- **Adjacency**").replace("## Terrains", "My notes after the help.\n\n## Terrains");
    const next = wrapGeneratorHelp(edited);
    expect(next).toContain("> [!info]- How to edit this generator");
    expect(next).toContain("> - My own line in the help.");
    expect(next).toMatch(/^My notes after the help\.$/m);
    expect(next).toMatch(/^## Terrains$/m);
    expect(next.replace(/^> ?/gm, "").replace("[!info]- How to edit this generator\n", "")).toBe(edited);
  });

  it("is idempotent, leaves a note without the help alone and keeps CRLF", () => {
    const once = wrapGeneratorHelp(OLD_NOTE);
    expect(wrapGeneratorHelp(once)).toBe(once);
    const none = "---\nhex-wfc: 1\nname: y\n---\n\n## Terrains\n";
    expect(wrapGeneratorHelp(none)).toBe(none);
    const crlf = OLD_NOTE.replace(/\n/g, "\r\n");
    expect(wrapGeneratorHelp(crlf)).toBe(once.replace(/\n/g, "\r\n"));
  });

  it("plans generator notes only, never their saves", async () => {
    const notes: Record<string, string> = {
      "W/generators/a.md": OLD_NOTE,
      "W/generators/saves/s.md": OLD_NOTE,
      "W/other.md": OLD_NOTE,
      "W/generators/prose.md": "A wave function collapse generator. Not one really.\n",
    };
    const planned: string[] = [];
    const host = {
      settings: { worldFolder: "W" },
      app: { vault: { getMarkdownFiles: () => Object.keys(notes).map((path) => ({ path })), cachedRead: async (f: { path: string }) => notes[f.path] } },
    } as never;
    await generatorHelpCallout.plan(host, (path: string) => void planned.push(path), {} as never);
    expect(planned).toEqual(["W/generators/a.md"]);
  });
});
