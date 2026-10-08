#!/usr/bin/env node
// Runs and watches the Obsidian community directory's automated review, so
// nobody has to click through https://community.obsidian.md by hand.
//
//   node dev/obsidian-review.mjs preview <sha>      scan a commit before releasing
//   node dev/obsidian-review.mjs release <version>  pick up a published release and
//                                                       wait for its scan
//
// Exits 1 when the scan reports any Error finding (a release with errors gets
// delisted), when the scan itself fails, or when it times out.
//
// Auth: the dashboard has no API tokens, only the browser session, so
// OBSIDIAN_COMMUNITY_COOKIE must hold the Cookie header of a logged-in
// session; refresh it with `npm run obsidian:login` (see .github/OBSIDIAN_REVIEW.md).
// When it is unset the script fails on the home repo (an empty secret must not
// pass silently) but only warns elsewhere, so forks aren't blocked.

import { appendFileSync } from "node:fs";
import { errorsOf, isDone, parseScans, warningsOf } from "./obsidian-review-parse.mjs";

const BASE = "https://community.obsidian.md";
const ENTRY_ID = process.env.OBSIDIAN_ENTRY_ID ?? "3699";
const SLUG = process.env.OBSIDIAN_SLUG ?? "hexmaker";
const COOKIE = process.env.OBSIDIAN_COMMUNITY_COOKIE?.trim();
const POLL_MS = Number(process.env.OBSIDIAN_REVIEW_POLL_MS ?? 60_000);
const TIMEOUT_MS = Number(process.env.OBSIDIAN_REVIEW_TIMEOUT_MIN ?? 90) * 60_000;
const DASHBOARD = `${BASE}/account/plugins/${SLUG}`;
const inActions = !!process.env.GITHUB_ACTIONS;
const HOME_REPO = process.env.OBSIDIAN_REVIEW_REPO ?? "sbuffkin/hexmaker";
const RUNBOOK = `https://github.com/${HOME_REPO}/blob/master/.github/OBSIDIAN_REVIEW.md`;

/** A failure with the runbook entry that says what to do about it. */
class ReviewFailure extends Error {
  constructor(message, anchor, fix) {
    super(message);
    this.anchor = anchor;
    this.fix = fix;
  }
}
const SESSION_FIX = "Run `npm run obsidian:login` (log in if asked), then re-run this job.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function annotate(level, msg, loc) {
  if (!inActions) return console.log(`${level.toUpperCase()}: ${msg}`);
  const at = loc ? ` file=${loc.file},line=${loc.line}` : "";
  console.log(`::${level}${at}::${msg.replace(/\r?\n/g, "%0A")}`);
}

function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}

async function request(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    redirect: "manual",
    headers: { cookie: COOKIE, "user-agent": "hexmaker-ci-obsidian-review", ...init.headers },
  });
  return res;
}

async function assertSession() {
  const res = await request("/api/auth/session");
  const body = await res.json().catch(() => ({}));
  if (!body.authenticated) {
    throw new ReviewFailure("The Obsidian community session has expired or the cookie is wrong.", "session-expired-or-secret-empty", SESSION_FIX);
  }
  log(`signed in as ${body.user?.handle ?? body.user?.github_username ?? "?"}`);
}

async function listScans() {
  const res = await request(`/account/plugins/${SLUG}`);
  if (res.status !== 200) {
    throw new ReviewFailure(`The dashboard returned HTTP ${res.status}.`, "dashboard-unreachable-or-layout-changed",
      "Open the dashboard in a browser. If it loads for you, re-run the job; if it redirects to a login, run `npm run obsidian:login`.");
  }
  const scans = parseScans(await res.text());
  if (scans.length === 0) {
    throw new ReviewFailure("No scans found on the dashboard; its layout may have changed.", "dashboard-unreachable-or-layout-changed",
      "Save the dashboard HTML as tests/fixtures/obsidian-dashboard.html and update dev/obsidian-review-parse.mjs until tests/obsidianReview.test.ts passes.");
  }
  return scans;
}

/** Polls until `find(scans)` returns a finished scan. */
async function waitFor(label, find, { onIdle } = {}) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = "";
  for (;;) {
    const scan = find(await listScans());
    const state = scan ? `${scan.status}${scan.incomplete ? " (incomplete)" : ""}` : "not started";
    if (state !== last) log(`${label}: ${state}`);
    last = state;
    if (scan && isDone(scan)) return scan;
    if (!scan && onIdle) await onIdle();
    if (Date.now() > deadline) {
      throw new ReviewFailure(`${label} is still ${state} after ${TIMEOUT_MS / 60_000} min.`, "scan-timed-out-or-stuck",
        `Check the scan on ${DASHBOARD}. Re-run the job once it finishes (a finished preview of the same commit is reused); if it never finishes, use Get help → "A scan is stuck".`);
    }
    await sleep(POLL_MS);
  }
}

function report(label, scan) {
  const errors = errorsOf(scan);
  const warnings = warningsOf(scan);
  const lines = [`### Obsidian review: ${label}`, "", `Status: **${scan.status}**, commit \`${scan.sha?.slice(0, 7)}\``, ""];
  lines.push("| Severity | Section | Finding |", "|---|---|---|");
  for (const f of scan.findings) {
    const where = f.locations.map((l) => `[${l.file}:${l.line}](${l.url})`).join(" ");
    lines.push(`| ${f.severity} | ${f.section} | ${f.message.replace(/\|/g, "\\|")} ${where} |`);
  }
  lines.push("", `Dashboard: ${DASHBOARD}`);
  summary(lines.join("\n"));

  for (const f of scan.findings) {
    if (f.severity === "Pass") continue;
    const level = f.severity === "Error" ? "error" : f.severity === "Warning" ? "warning" : "notice";
    annotate(level, `[${f.section}] ${f.message}`, f.locations[0]);
  }
  log(`${label}: ${scan.status}, ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (scan.status !== "Completed") {
    throw new ReviewFailure(`${label} ended with status ${scan.status}.`, "scan-timed-out-or-stuck", `Check the scan on ${DASHBOARD}, then re-run the job.`);
  }
  if (errors.length) {
    const released = label.startsWith("release");
    throw new ReviewFailure(`${label} has ${errors.length} error finding(s).`, released ? "release-scan-failed-after-publishing" : "error-findings",
      released
        ? "Fix the errors listed above and publish a new patch version; the directory delists a plugin whose latest release fails."
        : "Fix the errors listed above (each has a file and line) and push; the next push re-scans.");
  }
}

async function preview(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`preview needs a full commit SHA, got "${sha}"`);
  const label = `preview ${sha.slice(0, 7)}`;
  const find = (scans) => scans.find((s) => s.preview && s.sha === sha);

  // A finished preview of the same commit has the same answer; reuse it.
  if (!find(await listScans())) {
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const res = await request(`/api/entries/${ENTRY_ID}/ref-scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: sha }),
      });
      if (res.ok) {
        log(`${label}: requested`);
        break;
      }
      const err = (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`;
      // Only one scan runs per entry at a time (409); wait for the other one.
      if (res.status !== 409 || Date.now() > deadline) {
        throw new ReviewFailure(`Couldn't start ${label}: ${err}`, "couldnt-start-a-scan",
          res.status === 401 || res.status === 403 ? SESSION_FIX : `Make sure the commit is pushed to GitHub, check ${DASHBOARD} for a stuck scan, then re-run.`);
      }
      log(`${label}: ${err}; retrying`);
      await sleep(POLL_MS);
    }
  } else {
    log(`${label}: reusing the existing preview scan`);
  }
  report(label, await waitFor(label, find));
}

async function release(version) {
  const label = `release ${version}`;
  const find = (scans) => scans.find((s) => !s.preview && s.version === version);
  // "Check for new releases" is a plain GET; it's rate-limited, which is fine,
  // because the directory also picks up releases on its own.
  const checkRelease = async () => {
    const res = await request(`/account/plugins/${SLUG}/check-release`);
    log(`check-release: HTTP ${res.status}`);
  };
  if (!find(await listScans())) await checkRelease();
  let idle = 0;
  report(label, await waitFor(label, find, { onIdle: async () => (++idle % 10 === 0 ? checkRelease() : undefined) }));
}

const [cmd, arg] = process.argv.slice(2);
// exitCode rather than process.exit(): exiting with fetch sockets still open
// trips a libuv assertion on Windows.
/** Log a failure with its fix and runbook link, in the log and the job summary. */
function fail(e) {
  const link = e.anchor ? `${RUNBOOK}#${e.anchor}` : `${RUNBOOK}#runbook`;
  const fix = e.fix ? ` Fix: ${e.fix}` : "";
  annotate("error", `${e.message}${fix} Runbook: ${link}`);
  summary([`### ❌ Obsidian review failed`, "", e.message, "", e.fix ? `**Fix:** ${e.fix}` : "", "", `Runbook: ${link}`].join("\n"));
  process.exitCode = 1;
}

if (!COOKIE && process.env.GITHUB_REPOSITORY === HOME_REPO) {
  fail(new ReviewFailure("OBSIDIAN_COMMUNITY_COOKIE is empty.", "session-expired-or-secret-empty", SESSION_FIX));
} else if (!COOKIE) {
  annotate("warning", "OBSIDIAN_COMMUNITY_COOKIE is not set; skipping the Obsidian review check.");
} else {
  try {
    await assertSession();
    if (cmd === "preview" && arg) await preview(arg);
    else if (cmd === "release" && arg) await release(arg);
    else throw new Error("usage: obsidian-review.mjs preview <sha> | release <version>");
  } catch (e) {
    fail(e);
  }
}
