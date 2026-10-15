/**
 * The frontmatter shape the plugin reads and writes, and a raw-text
 * frontmatter patch for notes that haven't been written yet. Pure (no
 * obsidian): tests/fixtures/pureFiles.json.
 */
export interface Frontmatter {
  [key: string]: string | string[] | boolean | undefined;
  terrain?: string;
  icon?: string;
  "gm-icon"?: string;
  "gm-icons"?: string[];
  tags?: string[];
  aliases?: string[];
  cssclass?: string;
  publish?: boolean;
  linkedFolder?: string;
  "roll-filter"?: boolean;
  "encounter-filter"?: boolean;
  "faction-color"?: string;
  "faction-pattern"?: string;
  "faction-pattern-scale"?: string;
  "faction-pattern-opacity"?: string;
  "faction-outline-width"?: string;
  "region-color"?: string;
  "region-pattern"?: string;
  "region-pattern-scale"?: string;
  "region-pattern-opacity"?: string;
  "region-outline-width"?: string;
}

/**
 * Set a top-level string field in raw note text before the note is written,
 * adding a frontmatter block if there isn't one. Used when bulk-creating hex
 * notes so each note is written once rather than created then patched.
 */
export function withFrontmatterField(content: string, key: string, value: string): string {
  const yaml = /^[\w][\w .()/-]*$/.test(value) && !value.endsWith(" ") ? value : JSON.stringify(value);
  const line = `${key}: ${yaml}`;
  const m = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/.exec(content);
  if (!m) return `---\n${line}\n---\n${content}`;
  const body = m[1];
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:.*$`, "m");
  const newBody = keyRe.test(body) ? body.replace(keyRe, line) : body ? `${body}\n${line}` : line;
  return `---\n${newBody}\n---${m[2]}${content.slice(m[0].length)}`;
}
