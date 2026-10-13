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
 */
export function noticeBackground(msg: string, timeout?: number): Notice {
  return new Notice(backgroundText(msg), timeout);
}
