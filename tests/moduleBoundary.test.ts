import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { scanBoundary, totals } from "./moduleBoundary";

/**
 * The module boundary ratchet (owner call CM8, plan-code-modules §3.4
 * rule 1). The core reaches a module only through src/modules/index.ts
 * and src/modules/runtime.ts; every other import of a module's code from
 * the core, and every branch on a map type by name, is listed in
 * tests/fixtures/moduleBoundary.json. A count may never go up, and when
 * one goes down the list must come down with it (so it can only shrink).
 */
const allowed = JSON.parse(readFileSync(new URL("./fixtures/moduleBoundary.json", import.meta.url), "utf8")) as {
  imports: Record<string, number>;
  decisions: Record<string, number>;
};

const now = scanBoundary();

function ratchet(kind: "imports" | "decisions"): void {
  const have = now[kind];
  const allow = allowed[kind];
  const grew: string[] = [];
  const shrank: string[] = [];
  for (const [k, n] of Object.entries(have)) {
    const a = allow[k] ?? 0;
    if (n > a) grew.push(`${k}: ${n} (allowed ${a})`);
  }
  for (const [k, a] of Object.entries(allow)) {
    const n = have[k] ?? 0;
    if (n < a) shrank.push(`${k}: ${n} (list says ${a})`);
  }
  expect({ grew }).toEqual({ grew: [] });
  // Lower tests/fixtures/moduleBoundary.json to the new counts.
  expect({ shrank }).toEqual({ shrank: [] });
}

describe("module boundary ratchet", () => {
  it("the core imports no more module code than the allow-list says", () => ratchet("imports"));
  it("the core branches on map types by name no more than the allow-list says", () => ratchet("decisions"));
  it("reports totals per module (for the record)", () => {
    expect(totals(now.imports)).toEqual(totals(allowed.imports));
    expect(totals(now.decisions)).toEqual(totals(allowed.decisions));
  });
});
