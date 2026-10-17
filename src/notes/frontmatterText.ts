/**
 * The frontmatter shape the plugin reads and writes. Pure (no obsidian):
 * tests/fixtures/pureFiles.json.
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
