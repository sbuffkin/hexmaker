# Architecture Overview — Duckmage Plugin

A tabletop RPG world-building plugin for Obsidian. Three interconnected views (hex map, hex table, random tables/workflows) operate on a shared vault of Markdown notes.

---

## Views

### HexMapView
The primary interactive surface. Renders a hex grid where every cell corresponds to a `{hexFolder}/{region}/{x}_{y}.md` note on disk. Multiple regions are supported; the active region is tracked as `activeRegionName`.

**DOM structure:**
```
.duckmage-hex-map-container
  ├── .duckmage-hex-map-clip          ← overflow:hidden clipping layer
  │     └── .duckmage-hex-map-viewport  ← transform target (pan + zoom)
  │           └── .duckmage-hex × N    ← individual hex cells
  └── .duckmage-hex-map-controls      ← pointer-events:none overlay
        ├── expand buttons (+)
        └── drawing toolbar
```

The clip/controls separation ensures toolbar buttons are never hidden by the viewport's CSS transform.

**Drawing tools** — each follows the same pattern:

| Tool | drawingMode | Opens | Section written |
|------|-------------|-------|-----------------|
| Road | `"road"` | (direct click) | `settings.roadChains` |
| River | `"river"` | (direct click) | `settings.riverChains` |
| Terrain | `"terrain"` | `TerrainPickerModal` | frontmatter `terrain:` |
| Icon | `"icon"` | `IconPickerModal` | frontmatter `icon:` |
| Link Table | `"tableLink"` | `TablePickerModal` | `### Encounters Table` |
| Link Faction | `"factionLink"` | `FactionPickerModal` | `### Factions` |

**Tool lifecycle** (standard pattern):
1. Button click → `handle*Button()` opens picker modal
2. Picker callback sets `drawingMode` + paint target, calls `updateToolbarButtonStates()`
3. Hex left-click → `onHex*Click(x, y)`
4. Right-click (on any hex) → `exit*Mode()` → `drawingMode = null`
5. `updateToolbarButtonStates()` syncs active CSS and button labels

**Write strategies:**
- Terrain/icon: synchronous DOM patch + coalescing async write queue (`scheduleTerrainWrite` / `scheduleIconWrite`). Only the latest value per hex is flushed, preventing stale writes.
- Link tools: purely async, no DOM patch needed (badge added directly after `await addLinkToSection`).
- Roads/rivers: written to `plugin.settings` and persisted via `saveSettings()`.

**Visual feedback for link tools:**
- Persistent: accent-coloured outline + emoji badge (📋 table, ⚔️ faction)
- Transient: `.duckmage-hex-blip` — a CSS-animated circle that expands and fades, then self-removes on `animationend`

---

### HexTableView
A live spreadsheet of all hex notes found in `hexFolder`. Updates on vault `modify` events (300 ms debounce per file).

**Columns:** Hex (coords + ◎ jump button), Terrain (colour swatch), then one column per section key from `COLUMNS`.

Current columns in order: Description, Landmark, Towns, Dungeons, Features, Quests, Factions, Enc. Table, Hidden, Secret, Weather, Hooks & Rumors.

The **Enc. Table** cell displays the basename of the linked table file (not the full path). Clicking a populated cell opens `RandomTableView` at that file via `openTable()`.

**Filters (toolbar):**
- X / Y numeric range inputs
- Region selector (scoped to one region subfolder)
- Terrain multi-select modal — left-click to include, right-click to exclude (strikethrough + red)
- Has Town / Has Dungeon / Has Feature / Has Quest / Has Faction checkboxes
- Sort priority (X→Y or Y→X) and direction (Asc / Desc)

Filter state is stored as `dataset` attributes on each `<tr>` (`data-terrain`, `data-has-town`, etc.) and read by `applyFilters()` — no file I/O on filter change.

**Jump button (◎):** Calls `HexMapView.centerOnHex(x, y)` on the first open map leaf, panning the viewport to that hex.

---

### RandomTableView
A two-column browser with two modes toggled by tab buttons: **Tables** and **Workflows**.

**Tables mode:**
- Left: folder tree (collapsible) + search filter + new-table creator at the bottom.
- Right: selected table — entries with die-range (`dN` column) and percentage odds, die-size selector, Roll button, copy-result textarea, recent roll history. Edit button opens `RandomTableEditorModal`.
- Right-click a table in the tree → context menu with "Delete table".

**Workflows mode:**
- Left: folder tree of workflow files + new-workflow creator. New workflows created with "New workflow with this table" (from a table detail pane) pre-populate the first step including auto-derived label.
- Right: selected workflow — each step shown as a clickable link (opens that table in Tables mode) with `×N` roll count, "Roll workflow" button, Edit button opens `WorkflowEditorModal`.
- Right-click a workflow in the tree → context menu with "Delete workflow".

**Public API:**
- `openTable(filePath)` — switches to Tables mode, expands all ancestor folders of the target file so it is visible in the tree, refreshes the list, and loads the specified table. Called from `HexTableView` (Enc. Table cell), `HexEditorModal`, workflow step links, and the `obsidian://duckmage-roll` protocol handler.

---

## Modals

| Modal | Purpose |
|-------|---------|
| `HexEditorModal` | Right-click per-hex editor — terrain, all link sections, all text sections |
| `TerrainPickerModal` | Full terrain palette picker (toolbar terrain button) |
| `TerrainEntryEditorModal` | Edit a single palette entry — name, color, icon, icon color tint |
| `IconPickerModal` | Full icon picker with image previews (toolbar icon button) |
| `RegionModal` | Switch active region; create, rename, delete regions |
| `FileLinkSuggestModal` | Fuzzy-search file picker scoped to any folder |
| `RandomTableModal` | Inline roll modal — used from HexEditorModal 🎲 buttons |
| `RandomTableEditorModal` | Edit table entries (result + weight), linked folder, description, filter flags |
| `WorkflowEditorModal` | Edit workflow definition — steps, template, results folder. Draggable by title bar. Auto-saves on close. |
| `WorkflowWizardModal` | Execute a workflow — roll/pick each step, view filled template, save result as a vault note |

---

## Data model

### Hex notes
Path: `{hexFolder}/{region}/{x}_{y}.md`

```yaml
---
terrain: forest
icon: custom-castle.png   # optional override
---

### Towns
[[My Town]]

### Dungeons

### Features

### Quests

### Factions
[[Iron Brotherhood]]

### Encounters Table
[[forest-encounters]]

### Description
Rolling hills...

### Landmark
### Hidden
### Secret
### Weather
### Hooks & Rumors
```

- `terrain` and `icon` live in YAML frontmatter (read via metadata cache, written via raw-text patching in `frontmatter.ts`).
- All other data lives under `###` headings (read/written via `sections.ts`).

### Link sections (`LINK_SECTIONS`)
```
"Towns" | "Dungeons" | "Features" | "Quests" | "Factions" | "Encounters Table"
```
Each has a corresponding folder setting. The heading key used in files is the section name lowercased.

### Text sections (`TEXT_SECTIONS`)
```
description | landmark | hidden | secret
```
Weather and Hooks & Rumors are also free-text sections under `###` headings but are not part of the `TEXT_SECTIONS` constant.

### Roads & rivers
Stored as `string[][]` in `settings.roadChains` / `settings.riverChains`. Each chain is an ordered array of `"x_y"` keys. Rendered as SVG polylines connecting adjacent hexes.

### Random tables
Markdown files with:
```yaml
---
dice: 100
---
| Result | Weight |
|--------|--------|
| Dragons | 1 |
| Goblins | 5 |
```
Parsed by `randomTable.ts` into `{ dice, entries: [{result, weight}] }`. Terrain tables generated at `{tablesFolder}/terrain/{name} - description.md` and `…encounters.md`.

### Workflows
Markdown files with YAML frontmatter + a steps table:
```yaml
---
results-folder: world/results
template-file: world/workflows/templates/My Workflow.md
---

| Table | Rolls | Label |
|-------|-------|-------|
| [[world/tables/forest-encounters]] | 2 | forest_encounters |
| [[world/tables/treasure]] | 1 | treasure |
```
Parsed/serialized by `workflow.ts`. Template files live at `{workflowsFolder}/templates/{name}.md` and use `$label` / `$label_N` placeholders (multi-roll steps). `WorkflowEditorModal` auto-syncs the template when steps change: adding a step appends its section, changing a label updates the `## heading` and all `$var`/`$var_N` references, changing roll count adds or removes `_N`-suffixed placeholders. `WorkflowWizardModal` fills placeholders with roll results and saves the output as a new note.

### Settings (`data.json`)

| Key | Purpose |
|-----|---------|
| `worldFolder` | Root vault folder — scopes file search |
| `hexFolder` | Where region subfolders and `x_y.md` notes live |
| `townsFolder` | Folder for the Towns dropdown |
| `dungeonsFolder` | Folder for the Dungeons dropdown |
| `questsFolder` | Folder for the Quests dropdown |
| `featuresFolder` | Folder for the Features dropdown |
| `factionsFolder` | Folder for the Factions dropdown |
| `tablesFolder` | Folder for random table files |
| `workflowsFolder` | Folder for workflow files (templates in `{workflowsFolder}/templates/`) |
| `iconsFolder` | User custom icons (merged with plugin `icons/`) |
| `templatePath` | Path to hex note template |
| `hexGap` | CSS gap between cells |
| `hexOrientation` | `"pointy"` or `"flat"` |
| `terrainPalette` | `[{name, color, icon?, iconColor?}]` |
| `gridSize` | `{cols, rows}` |
| `gridOffset` | `{x, y}` origin offset (adjusted by expand buttons) |
| `zoomLevel` | Current zoom |
| `roadChains` | `string[][]` road chains |
| `riverChains` | `string[][]` river chains |
| `roadColor` / `riverColor` | CSS colour strings |
| `defaultTableDice` | Die size for new table files |
| `regions` | `[{name}]` — named map regions (each maps to a subfolder under `hexFolder`) |

---

## Module responsibilities

| File | Responsibility |
|------|---------------|
| `DuckmagePlugin.ts` | Entry point, view registration, cross-view API, terrain table generation |
| `HexMapView.ts` | Grid rendering, all drawing tools, panning/zooming, expand, region switching |
| `HexEditorModal.ts` | Per-hex right-click editor |
| `HexTableView.ts` | Hex spreadsheet, filters, sort, jump, enc-table → RandomTableView navigation |
| `RegionModal.ts` | Region switcher and manager |
| `RandomTableView.ts` | Table + workflow browser, roll UI, public `openTable()` |
| `RandomTableModal.ts` | Inline roll from hex editor |
| `RandomTableEditorModal.ts` | Table entry editor |
| `WorkflowEditorModal.ts` | Workflow definition editor (steps, template, draggable modal) |
| `WorkflowWizardModal.ts` | Workflow execution — roll steps, fill template, save result note |
| `TerrainPickerModal.ts` | Full terrain palette picker |
| `TerrainEntryEditorModal.ts` | Single terrain palette entry editor |
| `IconPickerModal.ts` | Icon picker with previews |
| `FileLinkSuggestModal.ts` | Reusable fuzzy file picker |
| `randomTable.ts` | Pure parse/roll/weight logic (no Obsidian API) |
| `workflow.ts` | Pure workflow parse/serialize/template logic (no Obsidian API) |
| `frontmatter.ts` | `terrain:` and `icon:` read/write |
| `sections.ts` | `###` heading read/write (`addLinkToSection`, `getLinksInSection`, `getAllSectionData`, `setSectionContent`, `addBacklinkToFile`) |
| `utils.ts` | `normalizeFolder`, `getIconUrl`, `makeTableTemplate`, `createIconEl` |
| `types.ts` | `DuckmagePluginSettings`, `LINK_SECTIONS`, `TEXT_SECTIONS`, `TerrainColor` |
| `constants.ts` | `VIEW_TYPE_*`, `DEFAULT_TERRAIN_PALETTE`, `DEFAULT_SETTINGS` |
| `DuckmageSettingTab.ts` | Settings UI — "Generate folders", "Generate terrain tables", palette editor |

---

## Key conventions

- Folder paths normalised (no leading/trailing slashes) via `normalizeFolder()`.
- All wiki-links use `metadataCache.fileToLinktext(file, sourcePath)` for vault-relative resolution.
- `obsidian` is an esbuild external — never bundled.
- CSS classes use the `duckmage-` prefix.
- Views and modals import `DuckmagePlugin` as a type only (`import type`) to avoid circular runtime deps.
- Metadata-cache race after `vault.modify`: `HexEditorModal.onChanged()` defers `renderGrid()` by 300 ms when no terrain/icon overrides are passed.
- Modals that preload file content accept an optional `preloaded` / `initialContent` parameter to avoid redundant vault reads when the caller already holds the content.
- Notes whose `basename` starts with `"_"` are excluded from all dropdowns, file trees, and auto-generated lists. Pattern: `.filter(f => !f.basename.startsWith("_"))`.
- Draggable modals call `makeDraggable()` in `onOpen`, add the `duckmage-editor-modal-drag` class, and restrict drag to the title-bar area.
