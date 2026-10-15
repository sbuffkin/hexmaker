/**
 * Debug mode: shows the Debug subsection inside each surface's Advanced
 * dropdown (backend controls: engine knobs, maintenance and repair).
 *
 * - Per device (DJ-Q1): kept in Obsidian's local storage for this vault
 *   (`app.saveLocalStorage`), never in data.json, so it never syncs.
 * - Turned on only from the bottom of the plugin's settings, with a
 *   one-time confirmation (settings tab). No command, ribbon or menu item
 *   turns it on.
 * - While on, a "Debug" status-bar item shows; clicking it turns debug
 *   mode off (HexmakerPlugin).
 */

/** The bit of Obsidian's App this needs (local storage), so tests can fake it. */
export interface LocalStore {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

/** Local-storage key: debug mode is on. */
export const DEBUG_MODE_KEY = "hexmaker-debug-mode";
/** Local-storage key: the user has seen and accepted the debug-mode confirmation once. */
export const DEBUG_CONFIRMED_KEY = "hexmaker-debug-mode-confirmed";

const listeners = new Set<(on: boolean) => void>();

export function isDebugMode(store: LocalStore): boolean {
  return store.loadLocalStorage(DEBUG_MODE_KEY) === true;
}

/** Turn debug mode on or off on this device and tell every listener. Off removes the key. */
export function setDebugMode(store: LocalStore, on: boolean): void {
  if (on === isDebugMode(store)) return;
  store.saveLocalStorage(DEBUG_MODE_KEY, on ? true : null);
  for (const fn of [...listeners]) fn(on);
}

/** Has the one-time "this is a debug mode" confirmation been accepted on this device? */
export function debugModeConfirmed(store: LocalStore): boolean {
  return store.loadLocalStorage(DEBUG_CONFIRMED_KEY) === true;
}

export function markDebugModeConfirmed(store: LocalStore): void {
  store.saveLocalStorage(DEBUG_CONFIRMED_KEY, true);
}

/** Call `fn` whenever debug mode changes. Returns the unsubscribe. */
export function onDebugModeChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The confirmation shown the first time debug mode is turned on. */
export const DEBUG_CONFIRM_TEXT = {
  title: "Turn on debug mode?",
  body: "This is a debug mode. It shows backend controls, such as engine tuning and maintenance tools, that most people never need. They appear in a Debug section inside each page's Advanced dropdown. While it's on, \"Debug\" shows in the status bar; click it to turn debug mode off.",
  confirm: "Turn on debug mode",
};
