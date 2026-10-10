/**
 * Mock `App` / `Vault` / `MetadataCache` + `HexmakerPlugin` that read from
 * the sim-vault fixture on real disk. Lets integration tests drive the
 * actual exporter orchestrators end-to-end without spinning up Obsidian.
 *
 * The mocks implement only the surface area our orchestrators touch:
 *   vault.read / getAbstractFileByPath / getMarkdownFiles / createBinary /
 *   modifyBinary / create / modify
 *   metadataCache.getFileCache / getFirstLinkpathDest
 *   workspace.getLeaf().openFile()  ← no-op
 *   plugin.app / plugin.settings / plugin.hexPath
 *
 * The metadata cache is built lazily per-file by an inline parser that
 * handles YAML frontmatter (simple key:value), `### Headings` (level 3),
 * and `[[wikilinks]]` — enough for everything our exporters depend on.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const SIM_VAULT_ROOT = path.resolve(
  __dirname,
  "../fixtures/sim-vault",
);

// ─── Minimal TFile/TFolder polyfills ───────────────────────────────────────

export class MockTFile {
  path: string;
  basename: string;
  extension: string;
  constructor(p: string) {
    this.path = p;
    const slash = p.lastIndexOf("/");
    const name = slash >= 0 ? p.slice(slash + 1) : p;
    const dot = name.lastIndexOf(".");
    this.basename = dot >= 0 ? name.slice(0, dot) : name;
    this.extension = dot >= 0 ? name.slice(dot + 1) : "";
  }
}

export class MockTFolder {
  path: string;
  constructor(p: string) {
    this.path = p;
  }
}

// ─── Filesystem-backed Vault ───────────────────────────────────────────────

export class MockVault {
  /** Output dir for created/modified files. Defaults to a sub-tmp. */
  outDir: string;
  /** Cache of absolute paths → TFile, populated lazily. */
  private fileCache = new Map<string, MockTFile>();

  constructor(outDir: string) {
    this.outDir = outDir;
  }

  /**
   * Resolve a vault-relative path to an absolute filesystem path.
   * Read-only files come from SIM_VAULT_ROOT; written files go to outDir.
   * On read, prefer outDir if the file was written there (overrides).
   */
  resolvePath(vaultPath: string, write: boolean): string {
    if (write) return path.join(this.outDir, vaultPath);
    // For reads: try outDir (in case we created/modified it), then sim-vault.
    const outPath = path.join(this.outDir, vaultPath);
    if (fs.existsSync(outPath)) return outPath;
    return path.join(SIM_VAULT_ROOT, vaultPath);
  }

  // ── Lookup ─────────────────────────────────────────────────────────────

  getAbstractFileByPath(p: string): MockTFile | MockTFolder | null {
    const cached = this.fileCache.get(p);
    if (cached) return cached;
    const inSim = path.join(SIM_VAULT_ROOT, p);
    const inOut = path.join(this.outDir, p);
    let real = "";
    if (fs.existsSync(inOut)) real = inOut;
    else if (fs.existsSync(inSim)) real = inSim;
    if (!real) return null;
    const stat = fs.statSync(real);
    if (stat.isDirectory()) return new MockTFolder(p);
    const file = new MockTFile(p);
    this.fileCache.set(p, file);
    return file;
  }

  /** Return all .md files under both sim-vault and outDir, deduplicated. */
  getMarkdownFiles(): MockTFile[] {
    const found = new Map<string, MockTFile>();
    const walk = (root: string, prefix: string) => {
      if (!fs.existsSync(root)) return;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const childAbs = path.join(root, entry.name);
        const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(childAbs, childRel);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          if (!found.has(childRel)) found.set(childRel, new MockTFile(childRel));
        }
      }
    };
    walk(SIM_VAULT_ROOT, "");
    walk(this.outDir, "");
    return Array.from(found.values());
  }

  // ── Read ───────────────────────────────────────────────────────────────

  async read(file: MockTFile): Promise<string> {
    const abs = this.resolvePath(file.path, false);
    return await fsp.readFile(abs, "utf8");
  }

  async cachedRead(file: MockTFile): Promise<string> {
    return this.read(file);
  }

  // ── Write ──────────────────────────────────────────────────────────────

  async create(p: string, data: string): Promise<MockTFile> {
    const abs = path.join(this.outDir, p);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, data, "utf8");
    const f = new MockTFile(p);
    this.fileCache.set(p, f);
    return f;
  }

  async modify(file: MockTFile, data: string): Promise<void> {
    const abs = path.join(this.outDir, file.path);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, data, "utf8");
  }

  async createBinary(p: string, data: ArrayBuffer): Promise<MockTFile> {
    const abs = path.join(this.outDir, p);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, Buffer.from(data));
    const f = new MockTFile(p);
    this.fileCache.set(p, f);
    return f;
  }

  async modifyBinary(file: MockTFile, data: ArrayBuffer): Promise<void> {
    const abs = path.join(this.outDir, file.path);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, Buffer.from(data));
  }

  async createFolder(p: string): Promise<void> {
    const abs = path.join(this.outDir, p);
    await fsp.mkdir(abs, { recursive: true });
  }

  // Adapter API (Obsidian-style)
  adapter = {
    exists: async (p: string): Promise<boolean> => {
      return (
        fs.existsSync(path.join(this.outDir, p)) ||
        fs.existsSync(path.join(SIM_VAULT_ROOT, p))
      );
    },
    getResourcePath: (p: string): string => {
      // Real Obsidian returns app:// URLs. Tests don't load these via the
      // browser; we just need a string. Use a file:// URL so failures are
      // obvious if anything actually fetches it.
      return `file://${this.resolvePath(p, false)}`;
    },
  };
}

// ─── MetadataCache ─────────────────────────────────────────────────────────

interface ParsedCache {
  frontmatter: Record<string, unknown>;
  headings: Array<{
    heading: string;
    level: number;
    position: {
      start: { line: number; col: number; offset: number };
      end: { line: number; col: number; offset: number };
    };
  }>;
  links: Array<{
    link: string;
    position: {
      start: { line: number; col: number; offset: number };
      end: { line: number; col: number; offset: number };
    };
  }>;
  blocks: Record<string, unknown>;
}

export class MockMetadataCache {
  constructor(private vault: MockVault) {}

  getFileCache(file: MockTFile): ParsedCache | null {
    try {
      const abs = this.vault.resolvePath(file.path, false);
      if (!fs.existsSync(abs)) return null;
      const content = fs.readFileSync(abs, "utf8");
      return parseFileCache(content);
    } catch {
      return null;
    }
  }

  getFirstLinkpathDest(
    linkpath: string,
    _sourcePath: string,
  ): MockTFile | null {
    // Try linkpath as-is, with .md, as a folder/basename match.
    const candidates = [linkpath, `${linkpath}.md`];
    for (const c of candidates) {
      const f = this.vault.getAbstractFileByPath(c);
      if (f instanceof MockTFile) return f;
    }
    // Fall back to a basename search across the vault.
    const target = (linkpath.split("/").pop() ?? linkpath).replace(/\.md$/i, "");
    for (const f of this.vault.getMarkdownFiles()) {
      if (f.basename === target) return f;
    }
    return null;
  }

  fileToLinktext(file: MockTFile, _sourcePath: string): string {
    return file.basename;
  }
}

// ─── Workspace (no-op) ─────────────────────────────────────────────────────

class MockLeaf {
  async openFile(_f: MockTFile): Promise<void> {
    /* no-op */
  }
  async setViewState(_s: unknown): Promise<void> {
    /* no-op */
  }
}

export class MockWorkspace {
  getLeaf(_arg?: unknown): MockLeaf {
    return new MockLeaf();
  }
  /** No open tabs (exports look for one showing the file first). */
  iterateAllLeaves(_cb: (leaf: MockLeaf) => unknown): void {
    /* no leaves */
  }
  async revealLeaf(_leaf: MockLeaf): Promise<void> {
    /* no-op */
  }
}

// ─── App ────────────────────────────────────────────────────────────────────

export class MockApp {
  vault: MockVault;
  metadataCache: MockMetadataCache;
  workspace: MockWorkspace;
  constructor(outDir: string) {
    this.vault = new MockVault(outDir);
    this.metadataCache = new MockMetadataCache(this.vault);
    this.workspace = new MockWorkspace();
  }
}

// ─── Plugin ────────────────────────────────────────────────────────────────

import { DEFAULT_SETTINGS } from "../../src/constants";
import type { HexmakerPluginSettings } from "../../src/types";

export class MockHexmakerPlugin {
  app: MockApp;
  settings: HexmakerPluginSettings;
  manifest = { dir: ".obsidian/plugins/duckmage-plugin", id: "duckmage" };
  // Field that real plugin uses for icon URL resolution.
  vaultIconsSet = new Set<string>();

  constructor(outDir: string) {
    this.app = new MockApp(outDir);
    this.settings = makeSimSettings();
  }

  hexPath(x: number, y: number, mapName: string): string {
    const folder = this.settings.hexFolder;
    return folder
      ? `${folder}/${mapName}/${x}_${y}.md`
      : `${mapName}/${x}_${y}.md`;
  }

  getMap(mapName: string) {
    return this.settings.maps.find((m) => m.name === mapName);
  }

  getMapPalette(mapName: string) {
    const map = this.getMap(mapName);
    return (
      this.settings.terrainPalettes.find((p) => p.name === map?.paletteName)
        ?.terrains ?? this.settings.terrainPalettes[0]?.terrains ?? []
    );
  }
}

function makeSimSettings(): HexmakerPluginSettings {
  // Start from real defaults but point folders + maps at the sim-vault layout.
  const settings: HexmakerPluginSettings = JSON.parse(
    JSON.stringify(DEFAULT_SETTINGS),
  );
  settings.worldFolder = "";
  settings.hexFolder = "hexes";
  settings.tablesFolder = "tables";
  settings.workflowsFolder = "workflows";
  settings.townsFolder = "towns";
  settings.dungeonsFolder = "dungeons";
  settings.featuresFolder = "features";
  settings.questsFolder = "quests";
  settings.factionsFolder = "factions";
  settings.regionsFolder = "regions";
  settings.iconsFolder = "";
  settings.exportFolder = "exports";

  // Single 3×2 map.
  settings.maps = [
    {
      name: "the-coast",
      paletteName: settings.terrainPalettes[1]?.name ?? settings.terrainPalettes[0].name,
      gridSize: { cols: 3, rows: 2 },
      gridOffset: { x: 0, y: 0 },
      pathChains: [],
    },
  ];

  // Inject a duplicate "ocean" entry into the palette to exercise the
  // first-wins regression fix.
  const pal = settings.terrainPalettes.find(
    (p) => p.name === settings.maps[0].paletteName,
  );
  if (pal) {
    const oceanIdx = pal.terrains.findIndex((t) => t.name === "ocean");
    if (oceanIdx >= 0) {
      pal.terrains.push({ name: "ocean", color: "#888888" });
    }
  }

  return settings;
}

// ─── Inline parser for the metadata cache ──────────────────────────────────

function parseFileCache(content: string): ParsedCache {
  const out: ParsedCache = {
    frontmatter: {},
    headings: [],
    links: [],
    blocks: {},
  };

  // Frontmatter
  let bodyStart = 0;
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (fmMatch) {
    bodyStart = fmMatch[0].length;
    const fmBody = fmMatch[1];
    for (const line of fmBody.split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (m) {
        const key = m[1];
        let val: unknown = m[2].trim();
        // Strip optional surrounding quotes
        if (typeof val === "string") {
          const unq = /^"(.*)"$/.exec(val)?.[1];
          if (unq !== undefined) val = unq;
        }
        out.frontmatter[key] = val;
      }
    }
  }

  // Headings — track byte offsets in the original content
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(content)) !== null) {
    if (hm.index < bodyStart) continue;
    out.headings.push({
      heading: hm[2],
      level: hm[1].length,
      position: {
        start: { line: 0, col: 0, offset: hm.index },
        end: { line: 0, col: 0, offset: hm.index + hm[0].length },
      },
    });
  }

  // Wikilinks
  const linkRe = /\[\[([^\]]+)\]\]/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(content)) !== null) {
    out.links.push({
      link: lm[1].split("|")[0].split("#")[0].trim(),
      position: {
        start: { line: 0, col: 0, offset: lm.index },
        end: { line: 0, col: 0, offset: lm.index + lm[0].length },
      },
    });
  }

  return out;
}

// Export a TFile alias as `TFile` for code that does `instanceof TFile`.
// Use a Proxy/typing trick: the orchestrators import `TFile` from "obsidian"
// (the mock obsidian.ts), so we don't substitute here. Test files using these
// mocks should pass MockTFile instances which extend nothing — orchestrators'
// `instanceof TFile` checks will fail.
//
// To make `instanceof TFile` work in orchestrators run through tsx, the test
// setup needs to alias MockTFile under the same name as the obsidian module's
// TFile. The simplest pattern: monkey-patch the imported TFile via a setup
// helper.
import * as obsidian from "obsidian";
const ObsidianTFile = (obsidian as unknown as { TFile: typeof MockTFile }).TFile;
// Force MockTFile to be reported as instanceof obsidian's TFile.
Object.setPrototypeOf(MockTFile.prototype, ObsidianTFile.prototype);
