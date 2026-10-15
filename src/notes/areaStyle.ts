/**
 * A painted area note's colour and overlay style (faction notes and area
 * notes), read from the metadata cache and written with
 * processFrontMatter. The keys per kind are in notes/areaStyleFields.ts.
 */
import { App, TFile } from "obsidian";
import { getFrontMatter } from "./noteFrontmatter";
import type { Frontmatter } from "./frontmatterText";
import {
  type AreaKind,
  type OverlayStyle,
  areaColorFromFm,
  areaStyleFromFm,
  writeAreaColor,
  writeAreaStyle,
} from "./areaStyleFields";

export function getAreaColor(kind: AreaKind, app: App, path: string): string | null {
  return areaColorFromFm(kind, getFrontMatter(app, path));
}

export async function setAreaColor(kind: AreaKind, app: App, path: string, color: string | null): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => writeAreaColor(fm, kind, color));
  return true;
}

export function getAreaStyle(kind: AreaKind, app: App, path: string): OverlayStyle {
  return areaStyleFromFm(kind, getFrontMatter(app, path));
}

export async function setAreaStyle(kind: AreaKind, app: App, path: string, style: Partial<OverlayStyle>): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => writeAreaStyle(fm, kind, style));
  return true;
}

// ── Per-kind names (still imported by the pickers, overlays and PNG export) ──

export const getFactionColorFromFile = (app: App, path: string): string | null => getAreaColor("faction", app, path);
export const setFactionColorInFile = (app: App, path: string, color: string | null): Promise<boolean> =>
  setAreaColor("faction", app, path, color);
export const getFactionStyleFromFile = (app: App, path: string): OverlayStyle => getAreaStyle("faction", app, path);
export const setFactionStyleInFile = (app: App, path: string, style: Partial<OverlayStyle>): Promise<boolean> =>
  setAreaStyle("faction", app, path, style);

export const getRegionColorFromFile = (app: App, path: string): string | null => getAreaColor("region", app, path);
export const setRegionColorInFile = (app: App, path: string, color: string | null): Promise<boolean> =>
  setAreaColor("region", app, path, color);
export const getRegionStyleFromFile = (app: App, path: string): OverlayStyle => getAreaStyle("region", app, path);
export const setRegionStyleInFile = (app: App, path: string, style: Partial<OverlayStyle>): Promise<boolean> =>
  setAreaStyle("region", app, path, style);
