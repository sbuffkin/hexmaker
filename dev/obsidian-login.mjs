#!/usr/bin/env node
// Refresh the OBSIDIAN_COMMUNITY_COOKIE repo secret in one go:
//
//   npm run obsidian:login            (plain Windows node is fine; no deps)
//   npm run obsidian:login -- --print (print the Cookie header instead)
//
// Opens community.obsidian.md in Chrome (or Edge) with its own saved profile,
// so after the first time you're usually still logged in. Waits until the
// session is logged in, reads the cookies over the DevTools protocol (they're
// httpOnly, so page scripts can't), and pipes them to `gh secret set` as the
// repo owner. The cookie never touches the clipboard, argv or shell history.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SITE = "https://community.obsidian.md";
const START_URL = `${SITE}/account/plugins/hexmaker`;
const REPO = process.env.OBSIDIAN_REVIEW_REPO ?? "sbuffkin/hexmaker";
const GH_USER = process.env.OBSIDIAN_REVIEW_GH_USER ?? REPO.split("/")[0];
const SECRET = "OBSIDIAN_COMMUNITY_COOKIE";
const PORT = Number(process.env.OBSIDIAN_LOGIN_PORT ?? 9333);
const PROFILE = path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), ".cache"), "hexmaker-obsidian-login");
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const printOnly = process.argv.includes("--print");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome or Edge found; set CHROME to the browser executable.");
  return found;
}

async function debuggerUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`The browser didn't open its debugging port (${PORT}).`);
}

/** Minimal Chrome DevTools Protocol client over the built-in WebSocket. */
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Couldn't connect to the browser.")), { once: true });
  });
  return {
    opened,
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function cookieHeader(client) {
  const { cookies } = await client.send("Storage.getCookies");
  return cookies
    .filter((c) => c.domain === "community.obsidian.md" || c.domain === ".community.obsidian.md")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function loggedInAs(cookie) {
  if (!cookie) return null;
  const res = await fetch(`${SITE}/api/auth/session`, { headers: { cookie } });
  const body = await res.json().catch(() => ({}));
  return body.authenticated ? (body.user?.handle ?? body.user?.github_username ?? "?") : null;
}

function setSecret(cookie) {
  const token = execFileSync("gh", ["auth", "token", "--user", GH_USER], { encoding: "utf8" }).trim();
  // No --body: gh reads the value from stdin.
  execFileSync("gh", ["secret", "set", SECRET, "--repo", REPO], {
    input: cookie,
    env: { ...process.env, GH_TOKEN: token },
    stdio: ["pipe", "inherit", "inherit"],
  });
}

mkdirSync(PROFILE, { recursive: true });
const browser = spawn(
  findBrowser(),
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--new-window", START_URL],
  { stdio: "ignore", detached: true },
);
browser.unref();

const client = cdp(await debuggerUrl());
await client.opened;
let exitCode = 0;
try {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let cookie = await cookieHeader(client);
  let user = await loggedInAs(cookie);
  if (!user) console.log("Log in to Obsidian in the browser window that just opened; this waits for you…");
  while (!user) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the login.");
    await sleep(3000);
    cookie = await cookieHeader(client);
    user = await loggedInAs(cookie);
  }
  console.log(`Logged in to the Obsidian community site as ${user}.`);
  if (printOnly) {
    console.log(cookie);
  } else {
    setSecret(cookie);
    console.log(`Updated ${SECRET} on ${REPO}. CI will use it from the next run.`);
  }
} catch (e) {
  console.error(e.message);
  exitCode = 1;
} finally {
  // Closing keeps the profile (and its login) for next time.
  await client.send("Browser.close").catch(() => {});
  client.close();
}
process.exitCode = exitCode;
