/**
 * Notices (owner Q10, audit N1): the plugin's name goes only on background
 * notices, the ones the user didn't just cause with a click (migrations,
 * file-watch repairs, notes that can't be read, start-up work), so they
 * know where the message came from. Direct feedback to a click has no
 * prefix: `new Notice(text)` as usual.
 *
 * The drift guard (tests/uiConsistency.test.ts) fails on a hand-written
 * "Hexmap World Creator:" or "Hexmaker:" notice outside this file.
 */

import { Notice } from "obsidian";

/** The plugin's name as shown to the user. */
export const PLUGIN_NAME = "Hexmap World Creator";

/** What a background notice starts with. */
export const BACKGROUND_PREFIX = `${PLUGIN_NAME}:`;

/** A background notice's text: "Hexmap World Creator: <msg>" (not doubled). */
export function backgroundText(msg: string): string {
  return msg.startsWith(BACKGROUND_PREFIX) ? msg : `${BACKGROUND_PREFIX} ${msg}`;
}

/**
 * Show a background notice (not caused by a click the user just made):
 * prefixed with the plugin's name. `timeout` as Notice's (0 stays until
 * dismissed or hidden).
 *
 * Background notices let clicks through to whatever they cover (the map's
 * toolbar sits under Obsidian's notice corner) and close with their own ×
 * (fresh-eyes 2026-10-13 F2: a stack of upgrade notices blocked the
 * "Map overlays" button).
 */
export function noticeBackground(msg: string, timeout?: number): Notice {
  return clickThrough(new Notice(backgroundText(msg), timeout));
}

// ── Upgrade notices: one combined notice per start-up ──────────────────────

/** Upgrade messages waiting for the start-up batch to end (null: no batch open). */
let batch: string[] | null = null;
let batchBackstop: number | null = null;

/** How long a batch may stay open before it's shown anyway. */
const BATCH_BACKSTOP_MS = 10 * 60 * 1000;

/**
 * Start collecting upgrade notices (plugin start-up, before the stores and
 * one-time upgrades run). Until endNoticeBatch, noticeUpgrade queues instead
 * of showing, so the upgrades' reports appear as one notice, in the order
 * they happened, instead of a stack over the toolbar.
 */
export function beginNoticeBatch(): void {
  if (batch) return;
  batch = [];
  batchBackstop = window.setTimeout(() => endNoticeBatch(), BATCH_BACKSTOP_MS);
}

/** Show what the batch collected (one notice), and stop batching. */
export function endNoticeBatch(): Notice | null {
  if (batchBackstop !== null) window.clearTimeout(batchBackstop);
  batchBackstop = null;
  const msgs = batch ?? [];
  batch = null;
  if (!msgs.length) return null;
  if (msgs.length === 1) return noticeBackground(msgs[0], UPGRADE_NOTICE_MS);
  const lines = combinedUpgradeLines(msgs);
  const frag = createFragment((f) => {
    f.createEl("p", { text: lines[0] });
    const list = f.createEl("ul");
    for (const l of lines.slice(1)) list.createEl("li", { text: l });
  });
  return clickThrough(new Notice(frag, combinedTimeout(msgs.length)));
}

/** How long one upgrade notice stays. */
export const UPGRADE_NOTICE_MS = 15000;

/** A combined notice's time: 15 s, plus 6 s for each further message, at most 45 s. */
export function combinedTimeout(n: number): number {
  return Math.min(45000, UPGRADE_NOTICE_MS + Math.max(0, n - 1) * 6000);
}

/**
 * The combined notice's lines: a heading, then each message (without the
 * plugin prefix, first letter capitalised), in order, duplicates dropped.
 */
export function combinedUpgradeLines(msgs: readonly string[]): string[] {
  const items: string[] = [];
  for (const m of msgs) {
    const t = (m.startsWith(BACKGROUND_PREFIX) ? m.slice(BACKGROUND_PREFIX.length) : m).trim();
    const s = t.charAt(0).toUpperCase() + t.slice(1);
    if (s && !items.includes(s)) items.push(s);
  }
  return [`${BACKGROUND_PREFIX} updated this vault.`, ...items];
}

/**
 * Report a one-time upgrade or migration. During start-up (see
 * beginNoticeBatch) it joins the combined upgrade notice; otherwise it's a
 * background notice of its own.
 */
export function noticeUpgrade(msg: string): void {
  if (batch) batch.push(msg);
  else noticeBackground(msg, UPGRADE_NOTICE_MS);
}

/** Show what the batch has so far and stop batching (plugin unload). */
export function closeNoticeBatch(): void {
  if (batch) endNoticeBatch();
}

/** Whether upgrade notices are being collected (tests). */
export function noticeBatchOpen(): boolean {
  return batch !== null;
}

/** Let clicks pass through a notice, and give it a × to close it. */
function clickThrough(notice: Notice): Notice {
  // The notice's own element (Obsidian 1.8.7+; the tests' stand-in has none).
  const el = (notice as { containerEl?: HTMLElement }).containerEl;
  if (!el || typeof el.addClass !== "function") return notice;
  el.addClass("duckmage-bg-notice");
  const close = el.createEl("button", { cls: "duckmage-bg-notice-close", text: "×", attr: { "aria-label": "Close" } });
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    notice.hide();
  });
  return notice;
}
