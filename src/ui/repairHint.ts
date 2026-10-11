/**
 * Where the repair button lives, for messages that find something missing.
 *
 * "Generate terrain tables & hex links" (settings, Advanced) makes missing
 * terrain tables and links them into hex notes. It sits in Advanced, so
 * whenever the plugin notices a table or table link is missing, the
 * message names where to find it (self-paced discovery rule 6: repair tools
 * may be tucked away, but the UI must point to them when they're needed).
 */

/** The repair setting's name (settings tab row and every pointer to it). */
export const GENERATE_WORLD_DATA_NAME = "Generate terrain tables & hex links";

/** Where it is, as users click to it. */
export const REPAIR_SETTING_PATH = `Settings → Hexmap World Creator → Advanced → ${GENERATE_WORLD_DATA_NAME}`;

/** One sentence to append to a "missing table" message. */
export const REPAIR_HINT = `To make missing terrain tables and links, use ${REPAIR_SETTING_PATH}.`;

/** `message` with the repair pointer after it. */
export function withRepairHint(message: string): string {
  const m = message.trim();
  return `${m}${/[.!?]$/.test(m) ? "" : "."} ${REPAIR_HINT}`;
}
