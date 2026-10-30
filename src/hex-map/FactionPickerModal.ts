import type { App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  getFactionColorFromFile,
  setFactionColorInFile,
  getFactionStyleFromFile,
  setFactionStyleInFile,
} from "../frontmatter";
import { AreaNotePickerModal, type AreaNoteKind } from "./AreaNotePickerModal";

/** Faction notes in the area note picker. */
export const FACTION_NOTES: AreaNoteKind = {
  title: "Factions",
  folder: (s) => s.factionsFolder,
  noFolderText: "No factions folder set yet.",
  noNotesText: (folder) => `No faction notes found in "${folder}".`,
  editTitle: "Edit faction",
  filterThings: "factions",
  newPlaceholder: "New faction name…",
  existsText: (name) => `A faction note named "${name}" already exists.`,
  getColor: getFactionColorFromFile,
  setColor: setFactionColorInFile,
  getStyle: getFactionStyleFromFile,
  setStyle: setFactionStyleInFile,
};

/** The faction palette picker (AreaNotePickerModal over faction notes). */
export class FactionPickerModal extends AreaNotePickerModal {
  constructor(app: App, plugin: HexmakerPlugin, onPicked: (filePath: string) => void, onErase?: () => void) {
    super(app, plugin, FACTION_NOTES, onPicked, onErase);
  }
}
