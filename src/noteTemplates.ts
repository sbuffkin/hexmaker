/**
 * The plugin's note templates in one user-editable folder (PA3): the hex
 * note template and the town note template live in `templatesFolder`
 * (default "{worldFolder}/templates"). Edit them there; new notes use them.
 *
 * - Hex: a `templatePath` the user already set always wins (existing setups
 *   keep working); blank = `hex.md` in the templates folder.
 * - Link-section notes (towns, dungeons, features, quests, factions): one
 *   template per section in the templates folder (`town.md`, `dungeon.md`…),
 *   written from its built-in starter the first time such a note is made (or
 *   by "Generate folders"). Every section works the same way: LINK_NOTE_TEMPLATES.
 * - Workflow templates stay beside their workflows ({workflowsFolder}/
 *   templates): each belongs to one workflow, which records its path.
 *
 * Pure helpers; HexmakerPlugin does the vault work.
 */

/** File names inside the templates folder. */
export const HEX_TEMPLATE_FILE = "hex.md";
export const TOWN_TEMPLATE_FILE = "town.md";

/**
 * Built-in town note: a few open headings, nothing prescriptive. Made
 * from a hex, it gets a "Location: [[hex]]" line under the title.
 * `{{title}}` is the town's name.
 */
export const DEFAULT_TOWN_TEMPLATE = `# {{title}}

## Description

## People

## Places

## Rumours
`;

/** What the templates helpers need from the settings. */
export interface TemplateSettings {
  templatesFolder?: string;
  worldFolder?: string;
  templatePath?: string;
}

const trimSlashes = (p: string | undefined): string => (p ?? "").trim().replace(/^\/+|\/+$/g, "");

/** The templates folder: the setting, else "{worldFolder}/templates" (world = "world" when blank). */
export function templatesFolderFor(s: TemplateSettings): string {
  const set = trimSlashes(s.templatesFolder);
  if (set) return set;
  return `${trimSlashes(s.worldFolder) || "world"}/templates`;
}

/** Where the hex template is: the user's templatePath, else hex.md in the templates folder. */
export function hexTemplatePathFor(s: TemplateSettings): string {
  const set = trimSlashes(s.templatePath);
  if (set) return set.endsWith(".md") ? set : `${set}.md`;
  return `${templatesFolderFor(s)}/${HEX_TEMPLATE_FILE}`;
}

/** Where the town template is. */
export function townTemplatePathFor(s: TemplateSettings): string {
  return `${templatesFolderFor(s)}/${TOWN_TEMPLATE_FILE}`;
}

/** A link section's note template: its file in the templates folder and the built-in starter written there. */
export interface LinkNoteTemplate {
  file: string;
  starter: string;
}

/**
 * Every link section whose new notes start from a template, one entry each
 * (fresh-eyes F17: a dungeon note started blank while a town got headings).
 * The starters are a few open headings, nothing prescriptive; the user edits
 * the files. Encounter tables aren't here: a new one is a table.
 */
export const LINK_NOTE_TEMPLATES: Readonly<Record<string, LinkNoteTemplate>> = {
  Towns: { file: TOWN_TEMPLATE_FILE, starter: DEFAULT_TOWN_TEMPLATE },
  Dungeons: { file: "dungeon.md", starter: `# {{title}}

## Description

## Rooms

## Inhabitants

## Treasure

## Rumours
` },
  Features: { file: "feature.md", starter: `# {{title}}

## Description

## Rumours
` },
  Quests: { file: "quest.md", starter: `# {{title}}

## Goal

## Leads

## Reward
` },
  Factions: { file: "faction.md", starter: `# {{title}}

## Goals

## Members

## Rumours
` },
};

/** The template a new note in link section `section` starts from (any case), or null. */
export function linkNoteTemplate(section: string): LinkNoteTemplate | null {
  const key = Object.keys(LINK_NOTE_TEMPLATES).find((k) => k.toLowerCase() === section.toLowerCase());
  return key ? LINK_NOTE_TEMPLATES[key] : null;
}

/** Where link section `section`'s note template is, or null when it has none. */
export function linkNoteTemplatePathFor(s: TemplateSettings, section: string): string | null {
  const t = linkNoteTemplate(section);
  return t ? `${templatesFolderFor(s)}/${t.file}` : null;
}

/** Fill a note template's `{{title}}` placeholders. */
export function fillNoteTemplate(template: string, title: string): string {
  return template.replace(/\{\{title\}\}/g, title);
}

/** Link sections whose new notes are places on the map: they get a Location line (R3). */
export const LOCATION_SECTIONS: readonly string[] = ["Towns", "Dungeons", "Features", "Quests"];

/**
 * A note made from a hex says where it is, as a labelled line under its
 * title (or at the top): `Location: [[world/hexes/coast/3_4|The Coast 3, 4]]`.
 * The full path keeps hexes of different maps apart. A note that already
 * links the hex is returned unchanged.
 */
export function withLocationLine(content: string, hexPath: string, label: string): string {
  const target = hexPath.replace(/\.md$/i, "");
  if (content.includes(`[[${target}]]`) || content.includes(`[[${target}|`)) return content;
  const shown = label.replace(/[|[\]]/g, "").replace(/\s+/g, " ").trim();
  const line = `Location: ${shown ? `[[${target}|${shown}]]` : `[[${target}]]`}`;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (content.trim() === "") return line + eol;
  let at = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close > 0) at = close + 1;
  }
  const afterFrontmatter = at;
  const title = lines.findIndex((l, i) => i >= at && /^#\s/.test(l));
  if (title >= 0) at = title + 1;
  const before = at > 0 && at !== afterFrontmatter && lines[at - 1]?.trim() !== "" ? [""] : [];
  const after = lines[at] !== undefined && lines[at].trim() !== "" ? [""] : [];
  lines.splice(at, 0, ...before, line, ...after);
  return lines.join(eol);
}

/** Which note template a new note in this link section starts from (its file name without .md), if any. */
export function noteTemplateFor(section: string): string | null {
  return linkNoteTemplate(section)?.file.replace(/.md$/i, "") ?? null;
}
