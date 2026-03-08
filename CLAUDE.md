# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (watch mode with inline sourcemaps) — use with Hot Reload (see below)
npm run dev

# Production build (type-checks then bundles)
npm run build

# Bump version (updates manifest.json and versions.json, stages both)
npm run version
```

Slash commands (invoke inside Claude Code):
- `/dev` — starts esbuild in watch mode (long-running; pairs with Hot Reload)
- `/rebuild` — one-off production build; reports errors if the build fails

There are no tests. The built output is `main.js` in the repo root, which Obsidian loads directly from this plugin folder.

## Dev loop

Each coding session:
1. Run `npm run dev` in a terminal (or `/dev` from Claude Code) — esbuild watches for changes and rebuilds `main.js` on every save
2. After a rebuild, reload the plugin in Obsidian via the developer console (Ctrl+Shift+I):
   ```js
   app.plugins.disablePlugin('duckmage-plugin'); app.plugins.enablePlugin('duckmage-plugin');
   ```
3. Use `/rebuild` for a final production build before committing (runs the TypeScript type-check too)

## Architecture

The plugin source is split across `main.ts` (entry point re-export) and modules under `src/`. esbuild bundles everything into `main.js`, which Obsidian loads directly.

### Source layout

```
main.ts                          ← thin re-export: export { default } from "./src/DuckmagePlugin"
src/
  DuckmagePlugin.ts              ← Plugin class (entry point class, default export)
  HexMapView.ts                  ← ItemView — renders the hex grid
  HexEditorModal.ts              ← Modal — right-click terrain/link editor
  FileLinkSuggestModal.ts        ← SuggestModal — file picker scoped to worldFolder
  DuckmageSettingTab.ts          ← PluginSettingTab — settings UI
  types.ts                       ← Interfaces & type constants (TerrainColor, DuckmagePluginSettings, LINK_SECTIONS, TEXT_SECTIONS)
  constants.ts                   ← Runtime constants (VIEW_TYPE_HEX_MAP, DEFAULT_TERRAIN_PALETTE, DEFAULT_SETTINGS)
  defaultHexTemplate.md          ← Built-in hex note template (imported as text via esbuild loader)
  frontmatter.ts                 ← YAML frontmatter helpers (terrain + icon override read/write)
  sections.ts                    ← Markdown section helpers (addLinkToSection, getLinksInSection, getSectionContent, setSectionContent)
  utils.ts                       ← Shared utilities (normalizeFolder, getIconUrl)
  md.d.ts                        ← TypeScript declaration for "*.md" text imports
```

The `.md` loader is configured in `esbuild.config.mjs` (`loader: { '.md': 'text' }`), allowing `defaultHexTemplate.md` to be imported as a plain string.

### Plugin purpose

Renders an interactive hex-grid map for tabletop RPG world-building inside Obsidian. Each hex cell corresponds to a Markdown note on disk.

### Key classes

- **`DuckmagePlugin`** (`src/DuckmagePlugin.ts`) — Main plugin entry point. Registers the view, ribbon icon, command, and settings tab. Exposes `hexPath(x, y)`, `createHexNote(x, y)`, and `loadAvailableIcons()`. Stores `availableIcons: string[]` (PNGs from the `icons/` folder, loaded at startup).
- **`HexMapView`** (`src/HexMapView.ts`, extends `ItemView`) — Renders the hex grid. `renderGrid(terrainOverrides?)` does a full DOM re-render; the optional `terrainOverrides` map allows immediate visual updates before the metadata cache catches up. Left-click opens/creates a note; right-click opens `HexEditorModal`.
- **`HexEditorModal`** (`src/HexEditorModal.ts`, extends `Modal`) — The right-click editor. Has a terrain picker (color swatch + icon grid) and link sections for Towns, Dungeons, and Features. Uses `ensureHexNote()` to create the note on demand before writing to it.
- **`FileLinkSuggestModal`** (`src/FileLinkSuggestModal.ts`, extends `SuggestModal<TFile>`) — Reusable file-search modal scoped to `worldFolder`. Takes an `onChoose` callback.
- **`DuckmageSettingTab`** (`src/DuckmageSettingTab.ts`) — Settings UI for folder paths, grid dimensions, hex gap, and terrain palette (name + color + icon dropdown).

### Data model

- **Hex notes**: stored at `{hexFolder}/{x}_{y}.md` (e.g. `RPG/duckmage/hexes/3_7.md`). Created via `DuckmagePlugin.createHexNote(x, y)` using the configured template or the built-in `src/defaultHexTemplate.md`.
- **Template placeholders**: `{{x}}`, `{{y}}`, `{{title}}`. The default template and any custom template should include `### Towns`, `### Dungeons`, and `### Features` headings so that links added via the editor land in the right section.
- **Terrain**: stored in a hex note's YAML frontmatter as `terrain: <name>`. Read via `getTerrainFromFile` (uses metadata cache); written via `setTerrainInFile` (parses/patches raw file content). Both live in `src/frontmatter.ts`.
- **Terrain icons**: PNG files in the plugin's `icons/` folder. Loaded at startup into `plugin.availableIcons`. Each `TerrainColor` entry has an optional `icon` filename. URLs are resolved via `getIconUrl(plugin, filename)` in `src/utils.ts`.
- **Section links**: `addLinkToSection(app, filePath, section, linkText)` inserts a wiki-link under the named `###` heading (appending the section if absent). `getLinksInSection` reads them back for display. Both in `src/sections.ts`.
- **Settings** (`data.json`): `worldFolder`, `hexFolder`, `templatePath`, `hexGap`, `terrainPalette` (array of `{name, color, icon?}`), `gridSize` ({cols, rows}), `zoomLevel`.

### Key conventions

- Folder paths are normalized (no leading/trailing slashes) via `normalizeFolder()` in `src/utils.ts`.
- Links use vault-relative paths via `metadataCache.fileToLinktext(file, sourcePath)`.
- `obsidian` is an esbuild external — never bundled; provided by Obsidian at runtime.
- CSS classes use the `duckmage-` prefix (styles in `styles.css`).
- View/modal/tab files use `import type DuckmagePlugin` to avoid circular runtime dependencies.
