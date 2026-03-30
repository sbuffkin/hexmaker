import { App, TFile } from "obsidian";

export interface Frontmatter {
  [key: string]: string | string[] | boolean | undefined;
  terrain?: string;
  icon?: string;
  tags?: string[];
  aliases?: string[];
  cssclass?: string;
  publish?: boolean;
  linkedFolder?: string;
  "roll-filter"?: boolean;
  "encounter-filter"?: boolean;
}

export function getFrontMatter(app: App, path: string) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter as Frontmatter;
  return frontmatter;
}

export function getTerrainFromFile(app: App, path: string): string | null {
  const terrain = getFrontMatter(app, path)?.terrain;
  return typeof terrain === "string" ? terrain : null;
}

export async function setTerrainInFile(
  app: App,
  path: string,
  terrainKey: string | null,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (terrainKey === null) {
      delete fm["terrain"];
    } else {
      fm["terrain"] = terrainKey;
    }
  });
  return true;
}

export function getIconOverrideFromFile(app: App, path: string): string | null {
  const icon = getFrontMatter(app, path)?.icon;
  return typeof icon === "string" ? icon : null;
}

export async function setIconOverrideInFile(
  app: App,
  path: string,
  icon: string | null,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (icon === null) {
      delete fm["icon"];
    } else {
      fm["icon"] = icon;
    }
  });
  return true;
}
