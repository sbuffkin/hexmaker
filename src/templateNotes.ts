/**
 * Template notes (the hex template, workflow templates, the Templates /
 * Templater folders) are scaffolding, not world notes: never offer them in
 * a note picker. A round-7 tester's click in the token form landed on
 * "hextemplate". Pure helpers; HexmakerPlugin.isLinkableNote wires them up.
 */

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
  settings: { templatePath?: string; workflowsFolder?: string },
  extraFolders: (string | undefined)[] = [],
): TemplateNoteRules {
  const paths: string[] = [];
  const hexTemplate = trimSlashes(settings.templatePath ?? "");
  if (hexTemplate) paths.push(hexTemplate.endsWith(".md") ? hexTemplate : `${hexTemplate}.md`);
  const folders: string[] = [];
  const wf = trimSlashes(settings.workflowsFolder ?? "");
  folders.push(wf ? `${wf}/templates` : "templates");
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

/** Whether a note may be listed for linking: not `_`-prefixed, not a template. */
export function isLinkableNotePath(path: string, basename: string, rules: TemplateNoteRules): boolean {
  return !basename.startsWith("_") && !isTemplateNotePath(path, rules);
}
