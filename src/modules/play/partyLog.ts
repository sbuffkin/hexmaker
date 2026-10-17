/**
 * What a party move records (owner P1, 2026-10-16): one line in the day's
 * play log note ("Moved from 4, 4 to 5, 4."), never on the party token's
 * note. This is the one place a move is journaled, so day-to-day hexcrawl
 * bookkeeping (time passed, rations, …; planned with campaigns, not built)
 * hooks in here later. The line is a journal entry: undoing the step
 * leaves it (as with the rest of the play log).
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { PartyStep } from "../types";
import { hexPair } from "../../hexKey";
import { logError } from "../../log";
import { addToPlayLog } from "./playLogWriter";

/** The log line for a step: "Moved from 4, 4 to 5, 4." */
export function moveLogText(step: Pick<PartyStep, "from" | "to">): string {
  const [fx, fy] = hexPair(step.from);
  const [x, y] = hexPair(step.to);
  return `Moved from ${fx}, ${fy} to ${x}, ${y}.`;
}

/** The party made a step: write it to the play log. Never throws (a failed log line never costs the step). */
export async function onPartyMoved(plugin: HexmakerPlugin, step: PartyStep, now = new Date()): Promise<void> {
  try {
    const [x, y] = hexPair(step.to);
    await addToPlayLog(plugin, step.map, x, y, moveLogText(step), now, { partyPath: step.token, linkHex: false });
  } catch (e) {
    logError("party move log", e);
  }
}
