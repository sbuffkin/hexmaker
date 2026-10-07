// Parses the scan list on the Obsidian community dashboard
// (https://community.obsidian.md/account/plugins/<slug>). The dashboard has
// no JSON API for scan results, so this reads the server-rendered HTML: one
// <details> per scan, a <summary> with version/ref, commit and status, then
// sections (<h4>) of findings (<li>) each led by a severity label.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Tag-stripped, entity-decoded, whitespace-collapsed text. */
export function textOf(html) {
  return decodeEntities(
    html
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+([:.,])/g, "$1");
}

function parseFinding(li) {
  const severity = textOf(li.match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
  const message = textOf(li.match(/<span class="block wrap-anywhere">([\s\S]*?)<\/span>/)?.[1] ?? "");
  const locations = [...li.matchAll(/<a href="([^"]*#L\d+)"[^>]*>([^<]+)<\/a>/g)].map((m) => {
    const [file, line] = decodeEntities(m[2]).split(/:(?=\d+$)/);
    return { file, line: Number(line), url: decodeEntities(m[1]) };
  });
  return { severity, message, locations };
}

/**
 * @returns {{
 *   preview: boolean, version: string|null, ref: string|null, sha: string|null,
 *   status: string, incomplete: boolean, date: string|null,
 *   findings: {section: string, severity: string, message: string,
 *              locations: {file: string, line: number, url: string}[]}[]
 * }[]} newest first, as the dashboard lists them
 */
export function parseScans(html) {
  const blocks = html.match(/<details[\s>][\s\S]*?<\/details>/g) ?? [];
  return blocks.map((block) => {
    const summaryHtml = block.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    const summary = textOf(summaryHtml);
    const field = (name) => summary.match(new RegExp(`${name}: (\\S+)`))?.[1] ?? null;
    const findings = [];
    const body = block.slice(block.indexOf("</summary>"));
    for (const sec of body.split(/(?=<h4[\s>])/).slice(1)) {
      const section = textOf(sec.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1] ?? "");
      for (const li of sec.match(/<li[\s>][\s\S]*?<\/li>/g) ?? []) {
        findings.push({ section, ...parseFinding(li) });
      }
    }
    return {
      preview: /^Preview\b/.test(summary),
      version: field("Version"),
      ref: field("Ref"),
      sha: summaryHtml.match(/\/commit\/([0-9a-f]{40})/)?.[1] ?? null,
      // The status is the last word of the summary ("... Commit: 97fcc59 Completed").
      status: summary.match(/Commit: [0-9a-f]+ (\w+)/)?.[1] ?? "Unknown",
      incomplete: /results are incomplete/i.test(body),
      date: summaryHtml.match(/title="([^"]+)"/)?.[1] ?? null,
      findings,
    };
  });
}

export const isDone = (scan) => scan.status !== "Pending" && !scan.incomplete;
export const errorsOf = (scan) => scan.findings.filter((f) => f.severity === "Error");
export const warningsOf = (scan) => scan.findings.filter((f) => f.severity === "Warning");
