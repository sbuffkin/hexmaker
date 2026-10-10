/**
 * The plugin's note templates in one user-editable folder (PA3): the hex
 * note template and the town note template live in `templatesFolder`
 * (default "{worldFolder}/templates"). Edit them there; new notes use them.
 *
 * - Hex: a `templatePath` the user already set always wins (existing setups
 *   keep working); blank = `hex.md` in the templates folder.
 * - Town: `town.md` in the templates folder, written from the built-in
 *   default the first time a town note is made (or by "Generate folders").
 * - Workflow templates stay beside their workflows ({workflowsFolder}/
 *   templates): each belongs to one workflow, which records its path.
 *
 * Pure helpers; HexmakerPlugin does the vault work.
 */

/** File names inside the templates folder. */
export const HEX_TEMPLATE_FILE = "hex.md";
export const TOWN_TEMPLATE_FILE = "town.md";

/**
 * Built-in town note: a few open headings, nothing prescriptive. The
 * hex's back-link is added above it when the note is made from a hex.
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

/** Fill a note template's `{{title}}` placeholders. */
export function fillNoteTemplate(template: string, title: string): string {
  return template.replace(/\{\{title\}\}/g, title);
}

/** Which note template a new note in this link section starts from, if any. */
export function noteTemplateFor(section: string): "town" | null {
  return section === "Towns" ? "town" : null;
}
