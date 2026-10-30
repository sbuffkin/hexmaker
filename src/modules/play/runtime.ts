/**
 * The Solo play module's runtime: what it adds to the map, the hex editor
 * and the plugin through the core's contribution points (types.ts PlayHooks
 * and the rest). The core keeps the party token itself (selecting it in
 * Play, moving it, its undo); this module says which clicks are steps,
 * marks the hexes it visits and keeps the play log.
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { HexMenuContribution, ModuleRuntime, PartyStep } from "../types";
import type { UndoItem } from "../../hex-map/undoItems";
import { applyTokenFrontmatter } from "../../frontmatter";
import { hexPair } from "../../hexKey";
import { openNoteFocused } from "../../openNote";
import { workModeOf } from "../../workMode";
import { isStep, markVisited, parseVisited, unmarkVisited } from "./partyTravel";
import { addToPlayLog, ensureLogNote } from "./playLogWriter";
import { logFolderFor, PLAY_LOG_TARGET } from "./playLog";
import { onPartyMoved } from "./partyLog";
import { PlayLogModal } from "./PlayLogModal";

/** The class a visited hex gets (styles.css draws a dot; the layers menu's Visited hides it). */
export const VISITED_CLS = "duckmage-hex-visited";

/**
 * Mark hexes of map `mapName` visited (or not), saved in its map note.
 * The undo entry for it, or none when nothing changed.
 */
export function setVisited(plugin: HexmakerPlugin, mapName: string, keys: readonly string[], on: boolean): UndoItem[] {
  const map = plugin.getMap(mapName);
  if (!map) return [];
  const before = map.visited;
  const list = parseVisited(before);
  const after = on ? markVisited(list, ...keys) : keys.reduce((l, k) => unmarkVisited(l, k), list);
  if (after.length === list.length && after.every((k, i) => k === list[i])) return [];
  map.visited = after;
  void plugin.saveSettings();
  return [{ kind: "map-field", mapName, field: "visited", before, after }];
}

/** "Add to play log…" for hex (x, y) of map `mapName` (SF3). */
export function openPlayLog(plugin: HexmakerPlugin, mapName: string, x: number, y: number): void {
  new PlayLogModal(plugin.app, `${plugin.mapLabel(mapName)} ${x}, ${y}`, (text) => addToPlayLog(plugin, mapName, x, y, text)).open();
}

/** Today's play log note, made if missing, opened. */
function openTodaysLog(plugin: HexmakerPlugin): Promise<void> {
  return ensureLogNote(plugin.app, logFolderFor(plugin.settings))
    .then((file) => openNoteFocused(plugin.app, file))
    .catch((err) => { new Notice(`Could not open the play log: ${String(err)}`); });
}

/** A step: both hexes visited, at once (P2: one undo with the move). */
function markStep(plugin: HexmakerPlugin, step: PartyStep): UndoItem[] {
  return setVisited(plugin, step.map, [step.from, step.to], true);
}

/** A step in Play goes in the play log (P1); moving the party by hand in Build or God isn't a step of the game. */
async function logStep(plugin: HexmakerPlugin, step: PartyStep): Promise<UndoItem[]> {
  if (workModeOf(plugin.getMap(step.map)) === "play") await onPartyMoved(plugin, step);
  return [];
}

/** The hex menu: a line in the play log, and the hex visited (or not) by hand. */
function hexMenu(plugin: HexmakerPlugin, mapName: string, hex: string): HexMenuContribution[] {
  const [x, y] = hexPair(hex);
  const visited = parseVisited(plugin.getMap(mapName)?.visited).includes(hex);
  return [
    { id: "hex.log", label: "Add to play log…", icon: "notebook-pen", run: () => openPlayLog(plugin, mapName, x, y) },
    {
      id: "hex.visited",
      label: "Visited",
      icon: "footprints",
      checked: visited,
      placementId: "MapView.hexVisited",
      run: () => {
        if (setVisited(plugin, mapName, [hex], !visited).length) plugin.refreshHexMap();
      },
    },
  ];
}

export const playRuntime: ModuleRuntime = {
  id: "play",
  commands: [{
    id: "open-play-log",
    name: "Open today's play log",
    placementId: "Plugin.cmd.openPlayLog",
    run: (plugin) => openTodaysLog(plugin),
  }],
  settings: [{
    id: "Settings.logFolder",
    name: "Play log folder",
    desc: "Where the play log goes: one note per day, with what happened, when, where and who. Blank: a log folder in the world folder.",
    control: { type: "folder", key: "logFolder", placeholder: "World/log" },
    // Asked in the setup wizard with the other folders.
    wizard: { label: "Play log", suffix: "log" },
  }],
  play: {
    // In Play, with the party selected, a neighbouring hex is a step (SF5).
    partyClick: (_plugin, click) => (isStep(click.from, click.to, click.orientation, click.stagger) ? "move" : "none"),
    onStep: markStep,
    onEnter: logStep,
    gridDecorations: (_plugin, map) => {
      const visited = new Set(parseVisited(map.visited));
      return visited.size ? (hex) => (visited.has(hex) ? [VISITED_CLS] : []) : undefined;
    },
    // SF5: any token can be the party.
    tokenMenu: (plugin, token) => [{
      id: "token.party",
      label: "Party token",
      icon: "users",
      checked: token.party,
      run: () => void applyTokenFrontmatter(plugin.app, token.token, { party: !token.party }),
    }],
    // A roll made on a hex can go to the log; in Play it goes there first (SF3).
    rollTargets: (plugin, at) => [{
      key: PLAY_LOG_TARGET,
      label: "Play log",
      defaultIn: ["play"],
      add: async (text) => { await addToPlayLog(plugin, at.map, at.x, at.y, text); },
    }],
    logWriters: [{
      id: "play-log",
      label: "Add to log",
      title: "Write what happened here in today's play log",
      open: (plugin, at) => openPlayLog(plugin, at.map, at.x, at.y),
    }],
  },
  hexMenu,
};
