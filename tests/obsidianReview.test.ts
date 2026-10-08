import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { errorsOf, isDone, parseScans, textOf, warningsOf } from "../dev/obsidian-review-parse.mjs";

/**
 * The Obsidian review CI step scrapes the community dashboard's HTML. If
 * this parse breaks, the release gate would silently pass or hang, so the
 * fixture pins the markup it depends on.
 */

const html = readFileSync(path.join(process.cwd(), "tests", "fixtures", "obsidian-dashboard.html"), "utf8");
const scans = parseScans(html);

describe("obsidian review dashboard parser", () => {
  it("finds every scan, newest first", () => {
    expect(scans.map((s: { version: string | null; ref: string | null }) => s.version ?? s.ref)).toEqual([
      "1.5.5",
      "master",
      "1.5.4",
    ]);
  });

  it("reads a pending release scan", () => {
    const [pending] = scans;
    expect(pending.preview).toBe(false);
    expect(pending.sha).toBe("97fcc59720d22c56c367180229dfff6687951bd2");
    expect(pending.status).toBe("Pending");
    expect(pending.incomplete).toBe(true);
    expect(isDone(pending)).toBe(false);
  });

  it("reads a completed preview with locations", () => {
    const preview = scans[1];
    expect(preview.preview).toBe(true);
    expect(preview.ref).toBe("master");
    expect(isDone(preview)).toBe(true);
    expect(errorsOf(preview)).toEqual([]);
    const [warn] = warningsOf(preview);
    expect(warn.section).toBe("CSS lint");
    expect(warn.message).toBe('Unexpected browser feature "css-clip-path" is only partially supported by Obsidian 1.11.4');
    expect(warn.locations.map((l: { file: string; line: number }) => `${l.file}:${l.line}`)).toEqual([
      "styles.css:412",
      "styles.css:421",
      "styles.css:4779",
    ]);
    expect(preview.findings.find((f: { severity: string }) => f.severity === "Pass")?.section).toBe("Dependencies");
  });

  it("surfaces error findings", () => {
    const [err] = errorsOf(scans[2]);
    expect(err.message).toBe("Use activeDocument instead of document & friends");
    expect(err.locations[0]).toMatchObject({ file: "src/hex-map/HexMapView.ts", line: 120 });
  });

  it("text extraction drops tags, comments and entities", () => {
    expect(textOf("Date<!-- -->:<!-- --> <span>Oct 7</span> &amp; <code>x</code>")).toBe("Date: Oct 7 & x");
  });
});
