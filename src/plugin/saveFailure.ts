/**
 * A save that failed after the caller moved on (saveSettings and the note
 * syncs it starts are fired and forgotten): logged, and said in a notice so
 * the user knows their change may not be on disk. Saves run on every edit,
 * so a disk that keeps failing shows one notice per NOTICE_GAP_MS, not one
 * per save; every failure is still logged.
 */
import { logError } from "../log";
import { noticeBackground } from "../ui/notify";

const NOTICE_GAP_MS = 10_000;
let lastNoticeAt = -Infinity;

/** `what`: what wasn't saved, as it reads in "Couldn't save <what>". */
export function reportSaveFailure(what: string, e: unknown, now = Date.now()): void {
  logError(`couldn't save ${what}`, e);
  if (now - lastNoticeAt < NOTICE_GAP_MS) return;
  lastNoticeAt = now;
  noticeBackground(`couldn't save ${what} (${e instanceof Error ? e.message : String(e)}). Your last change may not be on disk; check the vault folder can be written to.`, 10_000);
}

/** Tests: forget the last notice time. */
export function resetSaveFailureNotices(): void {
  lastNoticeAt = -Infinity;
}
