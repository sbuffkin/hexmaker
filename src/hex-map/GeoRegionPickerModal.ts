import type { App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  getRegionColorFromFile,
  setRegionColorInFile,
  getRegionStyleFromFile,
  setRegionStyleInFile,
} from "../frontmatter";
import { AreaNotePickerModal, type AreaNoteKind } from "./AreaNotePickerModal";
import { REGION_AREAS_TOOL } from "./toolMode";

/** Painted area notes ("Area" in the UI, owner Q8) in the area note picker. */
export const AREA_NOTES: AreaNoteKind = {
  title: REGION_AREAS_TOOL,
  folder: (s) => s.regionsFolder,
  noFolderText: "No areas folder set yet.",
  noNotesText: (folder) => `No area notes in "${folder}" yet.`,
  editTitle: "Edit area",
  filterThings: "areas",
  newPlaceholder: "New area name…",
  existsText: (name) => `An area note named "${name}" already exists.`,
  getColor: getRegionColorFromFile,
  setColor: setRegionColorInFile,
  getStyle: getRegionStyleFromFile,
  setStyle: setRegionStyleInFile,
  afterCreate: (plugin, name) => void plugin.ensureRegionTable(name),
};

/** The area palette picker (AreaNotePickerModal over area notes). */
export class GeoRegionPickerModal extends AreaNotePickerModal {
  constructor(app: App, plugin: HexmakerPlugin, onPicked: (filePath: string) => void, onErase?: () => void) {
    super(app, plugin, AREA_NOTES, onPicked, onErase);
  }
}
