/**
 * Template notes (the hex template, workflow templates, the Templates /
 * Templater folders) are scaffolding, not world notes: never offer them in
 * a note picker. A round-7 tester's click in the token form landed on
 * "hextemplate". Pure helpers; HexmakerPlugin.isLinkableNote wires them up.
 */

import { templatesFolderFor } from "./noteTemplates";

export interface TemplateNoteRules {
  /** Exact vault paths of template notes. */
  paths: string[];
  /** Folders whose notes are all templates (no trailing slash). */
  folders: string[];
}

const trimSlashes = (p: string): string => p.trim().replace(/^\/+|\/+$/g, "");

/** The template rules for the plugin's settings plus any template folders
 *  other plugins use (core Templates, Templater). Blank entries are dropped. */
export function templateNoteRules(
  settings: { templatePath?: string; workflowsFolder?: string; templatesFolder?: string; worldFolder?: string },
  extraFolders: (string | undefined)[] = [],
): TemplateNoteRules {
  const paths: string[] = [];
  const hexTemplate = trimSlashes(settings.templatePath ?? "");
  if (hexTemplate) paths.push(hexTemplate.endsWith(".md") ? hexTemplate : `${hexTemplate}.md`);
  const folders: string[] = [];
  const wf = trimSlashes(settings.workflowsFolder ?? "");
  folders.push(wf ? `${wf}/templates` : "templates");
  // The plugin's own templates folder (PA3: hex and town templates).
  folders.push(templatesFolderFor(settings));
  for (const f of extraFolders) {
    const t = trimSlashes(f ?? "");
    if (t) folders.push(t);
  }
  return { paths, folders };
}

/** Whether `path` is a template note under `rules` (case-insensitive). */
export function isTemplateNotePath(path: string, rules: TemplateNoteRules): boolean {
  const p = path.toLowerCase();
  if (rules.paths.some((t) => t.toLowerCase() === p)) return true;
  return rules.folders.some((f) => p.startsWith(f.toLowerCase() + "/"));
}

/**
 * What a note picker is for. "link" (the default): linking a note to a hex,
 * token, section… — templates are hidden. "template": choosing a template
 * (a template path, a workflow's template file) — templates are listed.
 */
export type NotePickPurpose = "link" | "template";

/** Whether a note may be listed in a picker for `purpose`: never when
 *  `_`-prefixed; templates only when choosing a template. */
export function isLinkableNotePath(
  path: string,
  basename: string,
  rules: TemplateNoteRules,
  purpose: NotePickPurpose = "link",
): boolean {
  if (basename.startsWith("_")) return false;
  return purpose === "template" || !isTemplateNotePath(path, rules);
}
