# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (watch mode with inline sourcemaps) — use with Hot Reload (see below)
npm run dev

# Production build (type-checks then bundles)
npm run build

# Run tests (vitest)
npm test

# Bump version (updates manifest.json and versions.json, stages both)
npm run version
```

Slash commands (invoke inside Claude Code):
- `/dev` — starts esbuild in watch mode (long-running; pairs with Hot Reload)
- `/rebuild` — one-off production build + test run; reports errors if either fails

**Always run `/rebuild` after making code changes.** The TypeScript type-check and test suite are the only automated verification — catch errors before the user does.

## Dev loop

Each coding session:
1. Run `npm run dev` in a terminal (or `/dev` from Claude Code) — esbuild watches for changes and rebuilds `main.js` on every save
2. After a rebuild, reload the plugin in Obsidian:
   ```bash
   powershell.exe -Command "obsidian plugin:reload id=duckmage-plugin"
   ```
3. Use `/rebuild` for a final production build before committing (runs the TypeScript type-check and tests too)

## Architecture

The plugin source is split across `main.ts` (entry point re-export) and modules under `src/`. esbuild bundles everything into `main.js`, which Obsidian loads directly.

See `ARCHITECTURE.md` for a full overview of the system.

### Source layout

```
main.ts                          ← thin re-export: export { default } from "./src/DuckmagePlugin"
src/
  DuckmagePlugin.ts              ← Plugin class (entry point, default export)
  HexMapView.ts                  ← ItemView — hex grid, all drawing tools, inline modals
  HexEditorModal.ts              ← Modal — right-click per-hex editor (terrain, links, notes, icon override)
  HexTableView.ts                ← ItemView — spreadsheet view of all hex notes with filters/sort
  TerrainPickerModal.ts          ← Modal — full terrain palette picker for the terrain paint tool
  TerrainEntryEditorModal.ts     ← Modal — edit a single terrain palette entry (name, color, icon)
  IconPickerModal.ts             ← Modal — icon picker for the icon paint tool
  RegionModal.ts                 ← Modal — switch active region, create/rename/delete regions
  FileLinkSuggestModal.ts        ← SuggestModal — file picker scoped to worldFolder
  RandomTableView.ts             ← ItemView — random table + workflow browser (tabbed: Tables / Workflows)
  RandomTableModal.ts            ← Modal — inline roll modal used from HexEditorModal
  RandomTableEditorModal.ts      ← Modal — edit entries of a random table file
  WorkflowEditorModal.ts         ← Modal — edit workflow definition (steps, template, results folder)
  WorkflowWizardModal.ts         ← Modal — execute a workflow (roll steps, fill template, save as note)
  randomTable.ts                 ← Pure logic: parse, roll, weight, die-range helpers
  workflow.ts                    ← Pure logic: parse/serialize workflows, generate templates, placeholder helpers
  DuckmageSettingTab.ts          ← PluginSettingTab — settings UI
  types.ts                       ← Interfaces & type constants (TerrainColor, DuckmagePluginSettings, LINK_SECTIONS, TEXT_SECTIONS)
  constants.ts                   ← Runtime constants (VIEW_TYPE_*, DEFAULT_TERRAIN_PALETTE, DEFAULT_SETTINGS)
  defaultHexTemplate.md          ← Built-in hex note template (imported as text via esbuild loader)
  frontmatter.ts                 ← YAML frontmatter helpers (terrain + icon override read/write)
  sections.ts                    ← Markdown section helpers (addLinkToSection, getLinksInSection, getAllSectionData, …)
  utils.ts                       ← Shared utilities (normalizeFolder, getIconUrl, makeTableTemplate)
  md.d.ts                        ← TypeScript declaration for "*.md" text imports
```

The `.md` loader is configured in `esbuild.config.mjs` (`loader: { '.md': 'text' }`), allowing `defaultHexTemplate.md` to be imported as a plain string.

### Plugin purpose

Renders an interactive hex-grid map for tabletop RPG world-building inside Obsidian. Each hex cell corresponds to a Markdown note on disk. The map supports terrain painting, icon painting, road/river chain drawing, link-to-hex tools (random tables, factions), panning, and zooming. A spreadsheet view summarises all hex notes with filtering. A random tables view lets users browse, roll, and edit weighted random tables, and execute multi-step workflows that chain table rolls into a filled template note.

### Key classes

- **`DuckmagePlugin`** (`src/DuckmagePlugin.ts`) — Main plugin entry point. Registers views (`HexMapView`, `HexTableView`, `RandomTableView`), ribbon icons, commands, and the settings tab. Key public API:
  - `hexPath(x, y)` — vault-relative path for a hex note
  - `createHexNote(x, y)` — creates hex note from template
  - `loadAvailableIcons()` — merges plugin `icons/` with user custom icons folder into `availableIcons: string[]`
  - `refreshHexMap()` — re-renders all open `HexMapView` instances
  - `ensureTerrainTables()` — creates missing terrain table files under `tablesFolder/terrain/`
  - `ensureAllRollerLinks()` — adds roller-link preamble to all table files
  - `backfillTerrainLinks()` — links each hex note's terrain table into its Encounters Table section
  - `buildRollerLink(path)` — generates the `[Roll](<obsidian://…>)` URI for a table file

- **`HexMapView`** (`src/HexMapView.ts`, extends `ItemView`) — Renders the hex grid and handles all user interaction.
  - **DOM structure**: `contentEl` (`.duckmage-hex-map-container`) → `.duckmage-hex-map-clip` (panning viewport, `overflow: hidden`) + `.duckmage-hex-map-controls` (overlay for buttons, `pointer-events: none`). This keeps toolbar/expand buttons unclipped by the viewport transform.
  - **`renderGrid(terrainOverrides?, iconOverrides?)`** — full DOM re-render. Optional override Maps allow passing values not yet in the metadata cache.
  - **Drawing tools**: `drawingMode` union `"road" | "river" | "terrain" | "icon" | "tableLink" | "factionLink" | null`. Toolbar buttons toggle mode; each mode has a `handle*Button()` opener, `exit*Mode()` closer, and `onHex*Click()` handler.
  - **Write queues**: `scheduleTerrainWrite` / `scheduleIconWrite` coalesce rapid repaints — only the latest value per hex is written, preventing stale overwrites.
  - **Link tools** (`tableLink`, `factionLink`): pick a file via folder-tree modal, then click hexes to add a wiki-link to the `Encounters Table` or `Factions` section. Visual feedback: badge span + CSS ripple blip animation (`duckmage-hex-blip`).
  - Left-click: opens/creates hex note (normal), paints terrain/icon, extends road/river chain, or adds a link.
  - Right-click: opens `HexEditorModal` (normal), deletes road/river node, or exits current tool mode.
  - Expand buttons (+) grow the grid in four cardinal directions, adjusting `gridOffset` and `gridSize` in settings.
  - **`centerOnHex(x, y)`** (public) — pans the viewport to centre on a given hex coordinate.
  - **`activeRegionName`** (public) — the currently displayed region name.

- **`HexEditorModal`** (`src/HexEditorModal.ts`, extends `Modal`) — The right-click per-hex editor:
  - Terrain picker (2-row scrollable grid) with icon override and "Clear terrain".
  - Dropdown link sections for **Towns, Dungeons, Features, Quests, Factions, Encounters Table** — each backed by its own configured folder, rendered via `renderDropdownSection`. Uses `LinkPickerModal` internally (file list + create-new).
  - Free-text note sections: Description, Landmark, Hidden, Secret, Weather, Hooks & Rumors.
  - Fetches all section data in a single read before touching the DOM (`getAllSectionData`).

- **`HexTableView`** (`src/HexTableView.ts`, extends `ItemView`) — Spreadsheet of all hex notes:
  - Columns: Hex (coords + jump button), Terrain, Description, Landmark, Towns, Dungeons, Features, Quests, Factions, Enc. Table, Hidden, Secret, Weather, Hooks & Rumors.
  - Enc. Table cell shows the basename of the linked table file; clicking opens `RandomTableView` at that file.
  - Toolbar filters: X/Y range inputs, terrain multi-select (left-click include / right-click exclude), Has Town/Dungeon/Feature/Quest/Faction checkboxes, region selector, X→Y / Y→X sort priority, Asc/Desc direction.
  - Live updates on vault `modify` events (300 ms debounce per file).
  - Jump button (◎) calls `HexMapView.centerOnHex(x, y)` on the open map view.

- **`RandomTableView`** (`src/RandomTableView.ts`, extends `ItemView`) — Tabbed browser with two modes:
  - **Tables mode**: folder tree + search + new-table creator. Detail pane shows entries with die-range and % odds, die-size selector, Roll button, copy result, roll history. Edit opens `RandomTableEditorModal`. Bottom of detail pane shows "Workflows using this table" links (each opens that workflow in Workflows mode) and a "+ New workflow with this table" link.
  - **Workflows mode**: folder tree of workflow files. Detail pane shows each step as a clickable link (opens that table in Tables mode) with roll count. Edit opens `WorkflowEditorModal`. "Roll workflow" button opens `WorkflowWizardModal`.
  - **`openTable(filePath)`** (public) — switches to Tables mode, expands ancestor folders so the target is visible, and loads the table detail; called from `HexTableView` (Enc. Table cell), `HexEditorModal`, workflow step links, and the protocol handler.

- **`RandomTableModal`** (`src/RandomTableModal.ts`, extends `Modal`) — Lightweight inline roll modal opened from `HexEditorModal` (🎲 button per link section or 📖 for terrain description). Skips the picker if `initialFilePath` is supplied.

- **`RandomTableEditorModal`** (`src/RandomTableEditorModal.ts`, extends `Modal`) — Edit table entries (result text + weight), linked folder, description, filter flags. Auto-saves on close. Accepts optional `initialContent` to avoid a redundant vault read when the caller already has the file content.

- **`WorkflowEditorModal`** (`src/WorkflowEditorModal.ts`, extends `Modal`) — Edit a workflow definition:
  - Rename workflow, set results folder, manage steps (table picker + roll count + label) with drag-to-reorder.
  - Template textarea with live placeholder validation — shows missing `$placeholder` names.
  - Template auto-syncs: new step appends `## label\n$label` block; label change updates the heading AND all `$var`/`$var_N` placeholder references; roll-count change adds or removes `_N` suffixed placeholders (reducing to 1 collapses back to bare `$var`).
  - Auto-saves workflow file and template file on close. Modal is draggable by its title bar.

- **`WorkflowWizardModal`** (`src/WorkflowWizardModal.ts`, extends `Modal`) — Execute a workflow:
  - Shows each step with a manual-pick dropdown and a Roll button. Fixed-width controls to prevent layout shift on roll.
  - Result textarea shows the template filled with rolled values.
  - Save section writes the filled result as a new vault note in the configured results folder.

- **`RegionModal`** (`src/RegionModal.ts`, extends `Modal`) — Manage hex map regions:
  - Switch the active region displayed on the hex map.
  - Create, rename, and delete regions. Regions map to subfolders under `hexFolder`.

- **`TerrainEntryEditorModal`** (`src/TerrainEntryEditorModal.ts`, extends `Modal`) — Edit a single terrain palette entry: name, color, icon (with preview), and icon color tint. Changes are staged in pending fields and only written to the palette on Save.

- **`TerrainPickerModal`** (`src/TerrainPickerModal.ts`) — Full terrain palette picker (no row cap). Includes "Clear" to erase terrain.

- **`IconPickerModal`** (`src/IconPickerModal.ts`) — Full icon picker with image previews. Includes "Remove" option.

- **`FileLinkSuggestModal`** (`src/FileLinkSuggestModal.ts`) — Reusable fuzzy-search file picker scoped to a configured folder.

- **`DuckmageSettingTab`** (`src/DuckmageSettingTab.ts`) — Settings UI:
  - "Generate folders" button — fills blank folder settings with defaults under `worldFolder` and creates the folders.
  - Folder paths: world, hexes, towns, dungeons, quests, features, factions, tables, workflows.
  - "Generate terrain tables & hex links" button — runs `ensureTerrainTables`, `ensureAllRollerLinks`, `backfillTerrainLinks`.
  - Hex orientation, grid dimensions, hex gap, custom icons folder, road/river colors, terrain palette editor (drag-to-reorder, click entry to open `TerrainEntryEditorModal`).

### Data model

- **Hex notes**: `{hexFolder}/{region}/{x}_{y}.md`. Created via `createHexNote(x, y, region)` using the configured template or `defaultHexTemplate.md`.
- **Template placeholders**: `{{x}}`, `{{y}}`, `{{title}}`. Template must include `### Towns`, `### Dungeons`, `### Features`, `### Quests`, `### Factions`, `### Encounters Table` headings.
- **Terrain**: YAML frontmatter `terrain: <name>`. Read via `getTerrainFromFile` (metadata cache); written via `setTerrainInFile` (raw text patch). Both in `frontmatter.ts`.
- **Icon override**: frontmatter `icon: <filename>`. Read via `getIconOverrideFromFile`; written via `setIconOverrideInFile`.
- **Terrain icons**: plugin `icons/` folder + user custom icons folder → `plugin.availableIcons`. URLs via `getIconUrl(plugin, filename)`. Vault-sourced filenames tracked in `plugin.vaultIconsSet`.
- **Roads & rivers**: `settings.roadChains` / `settings.riverChains` — arrays of `string[]` chains, each element `"x_y"`. Drawn as SVG polylines over the grid.
- **Link sections** (`LINK_SECTIONS`): `"Towns" | "Dungeons" | "Features" | "Quests" | "Factions" | "Encounters Table"`. Wiki-links inserted under the matching `###` heading via `addLinkToSection`. Read back via `getLinksInSection`.
- **Text sections** (`TEXT_SECTIONS`): Description, Landmark, Hidden, Secret. Free text stored under `###` headings. Weather and Hooks & Rumors are also text sections but not in the `TEXT_SECTIONS` constant.
- **Random tables**: Markdown files with YAML `dice: N` frontmatter and a `| Result | Weight |` table. Parsed by `randomTable.ts`. Stored under `tablesFolder` (default `world/tables`). Terrain tables live at `{tablesFolder}/terrain/{name} - {description|encounters}.md`.
- **Workflows**: Markdown files with YAML frontmatter (`results-folder`, `template-file`) and a `| Table | Rolls | Label |` steps table. Stored under `workflowsFolder`. Templates stored at `{workflowsFolder}/templates/{name}.md`. Parsed/serialized by `workflow.ts`.
- **Settings** (`data.json`): `worldFolder`, `hexFolder`, `townsFolder`, `dungeonsFolder`, `questsFolder`, `featuresFolder`, `factionsFolder`, `tablesFolder`, `workflowsFolder`, `iconsFolder`, `templatePath`, `hexGap`, `hexOrientation`, `terrainPalette`, `gridSize`, `gridOffset`, `zoomLevel`, `roadChains`, `riverChains`, `roadColor`, `riverColor`, `defaultTableDice`, `regions`.

### Hex orientations

- **Pointy-top**: points north/south, flat sides east/west. Odd rows offset right. Adjacency via odd-r offset.
- **Flat-top** (default): flat sides north/south, points east/west. Odd columns offset down. Adjacency via odd-q offset.
- `hexNeighbors(x, y)` in `HexMapView` branches on `settings.hexOrientation`.

### Key conventions

- Folder paths normalised (no leading/trailing slashes) via `normalizeFolder()`.
- Links use vault-relative paths via `metadataCache.fileToLinktext(file, sourcePath)`.
- `obsidian` is an esbuild external — never bundled; provided by Obsidian at runtime.
- CSS classes use the `duckmage-` prefix (styles in `styles.css`).
- View/modal/tab files use `import type DuckmagePlugin` to avoid circular runtime dependencies.
- Paint tool methods (`onHexPaintClick`, `onHexIconClick`) are synchronous — DOM patched immediately, file writes queued via coalescing queue.
- Link-tool click handlers (`onHexTableLinkClick`, `onHexFactionLinkClick`) are async — no coalescing needed (one-shot writes).
- `onChanged` callback from `HexEditorModal` defers `renderGrid()` 300 ms when no terrain/icon overrides are passed (link-only changes) to avoid a metadata-cache race after `vault.modify`.
- Modals that preload file content accept an optional `preloaded` / `initialContent` parameter — callers that already hold the file content pass it in to avoid a redundant vault read.
- Exclude notes whose `basename` starts with `"_"` whenever enumerating vault files for display, dropdowns, or linking. Pattern: `.filter(f => !f.basename.startsWith("_"))`.
- **All modals must extend `DuckmageModal`** (`src/DuckmageModal.ts`) rather than Obsidian's `Modal` directly. `DuckmageModal` is the single place for shared modal behaviour. Any functionality needed by more than one modal belongs there, not in `utils.ts` or duplicated across files.
- All modals call `this.makeDraggable()` in `onOpen` (inherited from `DuckmageModal`), which adds the `duckmage-editor-modal-drag` class and locks dragging to the title-bar area. (`FileLinkSuggestModal` is the sole exception — it extends `SuggestModal` and cannot inherit from `DuckmageModal`.)
