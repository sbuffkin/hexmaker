/**
 * Note templates: the hex template (configured, in the templates folder,
 * or built in), each link section's note template, filling a new linked
 * note, and which notes a note picker may offer (templates only when
 * picking one). Split from HexmakerPlugin (plan-architecture-refactor
 * L1a); the plugin keeps one-line delegations.
 */
import { Notice, TFile } from "obsidian";
import { generatorsFolder } from "../worldgen/generators";
import { moduleFolders } from "../modules/runtime";
import { normalizeFolder, makeTableTemplate } from "../utils";
import DEFAULT_HEX_TEMPLATE from "../defaultHexTemplate.md";
import { isLinkableNotePath, templateNoteRules, type NotePickPurpose, type TemplateNoteRules } from "../templateNotes";
import { fillNoteTemplate, hexTemplatePathFor, LINK_NOTE_TEMPLATES, linkNoteTemplate, linkNoteTemplatePathFor, LOCATION_SECTIONS, templatesFolderFor, withLocationLine } from "../noteTemplates";
import type HexmakerPlugin from "../HexmakerPlugin";

/** The plugin: the template rules hand it to module code (moduleFolders, generatorsFolder). */
export type TemplatesHost = HexmakerPlugin;

export class TemplatesService {
  constructor(private readonly plugin: TemplatesHost) {}

  /**
   * Whether a note may be offered in a note picker: never `_`-prefixed;
   * templates (the hex template, workflow templates, the core Templates or
   * Templater folder) only when the picker is for choosing a template
   * (`purpose` "template"). Use in every note picker.
   */
  isLinkableNote(file: TFile, purpose: NotePickPurpose = "link"): boolean {
    return isLinkableNotePath(file.path, file.basename, this.templateRules(), purpose);
  }

  private templateRules(): TemplateNoteRules {
    type Loose = {
      internalPlugins?: {
        getPluginById?(id: string): { enabled?: boolean; instance?: { options?: { folder?: string } } } | null;
      };
      plugins?: { plugins?: Record<string, { settings?: { templates_folder?: string } } | undefined> };
    };
    const loose = this.plugin.app as unknown as Loose;
    const core = loose.internalPlugins?.getPluginById?.("templates");
    const coreFolder = core?.enabled ? core.instance?.options?.folder : undefined;
    const templater = loose.plugins?.plugins?.["templater-obsidian"]?.settings?.templates_folder;
    return templateNoteRules(this.plugin.settings, [coreFolder, templater], [
      this.plugin.paletteStore.folder(),
      ...this.plugin.moduleStores.flatMap((st) => (st.folder ? [st.folder()] : [])),
      ...moduleFolders(this.plugin),
      generatorsFolder(this.plugin),
    ]);
  }

  async loadHexTemplate(): Promise<string> {
    const templatePath = normalizeFolder(this.plugin.settings.templatePath ?? "");
    if (templatePath) {
      const templateFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
      if (templateFile instanceof TFile) {
        try {
          return await this.plugin.app.vault.read(templateFile);
        } catch { /* fall through */ }
      }
      new Notice(`Hex template not found at "${templatePath}" — using built-in default.`);
      return DEFAULT_HEX_TEMPLATE;
    }
    // No path set: hex.md in the templates folder, if there is one (PA3).
    const inFolder = this.plugin.app.vault.getAbstractFileByPath(hexTemplatePathFor(this.plugin.settings));
    if (inFolder instanceof TFile) {
      try {
        return await this.plugin.app.vault.read(inFolder);
      } catch { /* fall through */ }
    }
    return DEFAULT_HEX_TEMPLATE;
  }

  /** The plugin's templates folder (PA3; see src/noteTemplates.ts). */
  templatesFolder(): string {
    return templatesFolderFor(this.plugin.settings);
  }

  /** Create a note template file from its built-in default if it's missing. */
  private async ensureTemplateFile(path: string, content: string): Promise<void> {
    if (this.plugin.app.vault.getAbstractFileByPath(path)) return;
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !this.plugin.app.vault.getAbstractFileByPath(folder)) {
      try {
        await this.plugin.app.vault.createFolder(folder);
      } catch { /* exists */ }
    }
    try {
      await this.plugin.app.vault.create(path, content);
    } catch { /* created concurrently — fine */ }
  }

  /**
   * Make sure the templates folder holds every plugin note template: the
   * hex template (unless the user points templatePath elsewhere) and each
   * link section's note template. Existing files are never overwritten.
   */
  async ensureTemplates(): Promise<void> {
    await this.plugin.ensureHexTemplate();
    for (const section of Object.keys(LINK_NOTE_TEMPLATES)) {
      const path = linkNoteTemplatePathFor(this.plugin.settings, section);
      if (path) await this.ensureTemplateFile(path, LINK_NOTE_TEMPLATES[section].starter);
    }
  }

  /**
   * Open a note template to edit it (SX1: easy to find and edit), making
   * it from its built-in starter first if it isn't there yet.
   */
  async openNoteTemplate(path: string): Promise<void> {
    await this.plugin.ensureTemplates();
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.plugin.app.workspace.getLeaf("tab").openFile(file);
    else new Notice(`No template at ${path}.`);
  }

  /**
   * Starting text for a note made from a link section's "create new": the
   * section's note template (LINK_NOTE_TEMPLATES, written to the templates
   * folder on first use); encounter tables get a table. `title` fills {{title}}.
   */
  async newLinkedNoteContent(section: string, title: string, fromHex?: string): Promise<string> {
    if (section === "Encounters Table") return makeTableTemplate(this.plugin.settings.defaultTableDice);
    // Made from a hex: a place says where it is (R3).
    const located = (content: string) =>
      fromHex && LOCATION_SECTIONS.includes(section) ? this.plugin.withHexLocation(content, fromHex) : content;
    const tpl = linkNoteTemplate(section);
    const path = linkNoteTemplatePathFor(this.plugin.settings, section);
    if (!tpl || !path) return located("");
    await this.ensureTemplateFile(path, tpl.starter);
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    let template = tpl.starter;
    if (file instanceof TFile) {
      try {
        template = await this.plugin.app.vault.read(file);
      } catch { /* use the default */ }
    }
    return located(fillNoteTemplate(template, title));
  }

  /** `content` with a `Location: [[hex|<map> x, y]]` line under its title (R3). */
  withHexLocation(content: string, hexPath: string): string {
    const loc = this.plugin.mapStore.resolve(hexPath);
    const [x, y] = loc ? loc.key.split("_") : [];
    const label = loc ? this.plugin.hexCoordAlias(loc.map, x, y) : this.plugin.hexLinkAlias(hexPath);
    return withLocationLine(content, hexPath, label);
  }

  /**
   * Ensure a hex template file exists on disk.
   * - If templatePath is set and the file exists: no-op.
   * - If templatePath is set but the file is missing: create it from the built-in default.
   * - If templatePath is blank: create hex.md in the templates folder (PA3)
   *   and persist the path.
   */
  async ensureHexTemplate(): Promise<void> {
    let templatePath = normalizeFolder(this.plugin.settings.templatePath ?? "");
    if (!templatePath) {
      templatePath = hexTemplatePathFor(this.plugin.settings);
      this.plugin.settings.templatePath = templatePath;
      await this.plugin.saveSettings();
    }
    await this.ensureTemplateFile(templatePath, DEFAULT_HEX_TEMPLATE);
  }
}
