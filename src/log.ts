/**
 * Console logging with one prefix ("Hexmaker: <scope>"), so the plugin's
 * lines are easy to find in the developer console. For developers only:
 * user-facing messages go through Notices (src/ui/notify.ts).
 *
 * Output matches the hand-written form it replaces:
 *   logError("couldn't write biome note", e, path)
 *   === console.error("Hexmaker: couldn't write biome note", path, e)
 */
export const LOG_PREFIX = "Hexmaker";

const head = (scope: string): string => `${LOG_PREFIX}: ${scope}`;

/** An error caught and handled: the scope, any context values, then the error. */
export function logError(scope: string, e: unknown, ...context: unknown[]): void {
	console.error(head(scope), ...context, e);
}

/** Something odd but not failed: the scope, then any details. */
export function logWarn(scope: string, ...details: unknown[]): void {
	console.warn(head(scope), ...details);
}
