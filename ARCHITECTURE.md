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
| Road | `"road"` | (direct click) | map note Paths table |
| River | `"river"` | (direct click) | map note Paths table |
| Terrain | `"terrain"` | `TerrainPickerModal` | map note Hexes table (Terrain) |
| Icon | `"icon"` | `IconPickerModal` | map note Hexes table (Icon) |
| Link Table | `"tableLink"` | `TablePickerModal` | `### Encounters Table` |
| Factions | `"factionLink"` | `FactionPickerModal` | `### Factions` |

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

### Map notes
Path: `{hexFolder}/{map}/_{map}.md` — one per map, owned by `MapStore` (`src/maps/MapStore.ts`), parsed/serialized by `src/maps/mapNote.ts`.

```markdown
---
hexmaker-map: 1
palette: Default
cols: 38
rows: 25
---
# Overworld

## Hexes
| Hex | Name | Terrain | Icon | GM icons | Region | Submap | Locked |
| 3_4 | Glass Wastes | dunes |  |  | Basin |  |  |

## Paths
| Type | Hexes |
| Road | 3_4 4_4 5_4 |
```

- All per-hex **map data** (name, terrain, icon override, GM icons, region, submap, locked) lives in the map note's Hexes table, and roads/rivers/paths in its Paths table. Read it through `plugin.mapStore` or the `frontmatter.ts` getters (which delegate to the store) — never from hex-note frontmatter, and never gate it on a hex note existing (most hexes have no note).
- The map's settings (palette, size, layer toggles, display name…) are the map note's frontmatter. Only the per-session viewport stays in `data.json`.
- Text outside the two tables and frontmatter keys the plugin doesn't own are the user's and survive rewrites.
- Older versions kept terrain/icon/region in each hex note's frontmatter; `MapStore` migrates that into map notes once (with a backup).

### Hex notes
Path: `{hexFolder}/{map}/{x}_{y}.md` — created only when a hex first gets prose or links.

```yaml
---
map: "[[_Overworld]]"     # NF1; older notes: hexmaker-map: (both read, src/noteFormats.ts)
aliases: [Glass Wastes]   # the hex's name, when it has one
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

- Hex notes hold no map data: their frontmatter only links back to the map note (plus the name alias).
- All their content lives under `###` headings (read/written via `sections.ts`).

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
Stored per map in the map note's Paths table (one row per chain: path type + ordered `x_y` keys; `MapData.pathChains` in memory). Rendered as SVG polylines connecting adjacent hexes.

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
| `terrainPalettes` | In-memory working copy + data.json cache of the palette notes (source of truth: one note per palette in `palettesFolder`, synced both ways by `src/palettes/PaletteStore.ts`) |
| `palettesFolder` / `palettesMigrated` | Palette notes folder (blank = `{worldFolder}/palettes`) / one-time settings→notes migration flag |
| `gridSize` | `{cols, rows}` |
| `gridOffset` | `{x, y}` origin offset (adjusted by expand buttons) |
| `zoomLevel` | Current zoom |
| `roadChains` | `string[][]` road chains |
| `riverChains` | `string[][]` river chains |
| `roadColor` / `riverColor` | CSS colour strings |
| `defaultTableDice` | Die size for new table files |
| `regions` | `[{name}]` — named map regions (each maps to a subfolder under `hexFolder`) |

---

## Modules (`src/modules/`)

Map types and whole features are **modules** (owner calls CM1–CM8, plan `plan-code-modules-and-legacy`): code that builds on the core and stays loosely coupled to it. The core never branches on a module by name; it asks the registry.

| Module | Slice | What it brings |
|---|---|---|
| `world` | `foundation` (always built) | The World map type (fallback type: a palette that says nothing else is World), the Places icon pack (its sub-groups are pack data), the Expanded and Limited presets, Region detail and Overland (on the core's noise engine), first-map generator Overland, the Overland map scale |
| `world-maps` | `worldmaps` | No map type (works with any). Code in `src/overworld/`: World biomes generator and the Biomes scale, the `temperature` When key, the biome notes store, Biomes / Biome pools folder settings, New overworld…, the Biome columns upgrade (BC1), River's Carves path-field upgrade, biome seeding when map types are turned on, the sandbox demo builders, and its map-surface hooks (`worldMaps()`, below): overworld layer and minimap, biome brush, overworld clicks and menus, region walking, overworld paths, Edit region…, Make generator…, the Maps modal's overworld parts, arrival regions, the generator page's biome panel |
| `space` | `space` | Code in `src/space/`. The Space map type (section words, Region/Location card text, `planet` alias, generators offered in context, no path carry-over, `void` background), 16 space terrain types + the Space group, the space icon pack, Space - Sector/System/Planet presets, Star scatter/Orbits (engines in `src/space/`)/Planet surface, their table roles and engines, `routes`/`orbits` path roles, `zone`/`ring`/`star` When keys, the World types store, folder setting and commands, the one-time terrain type refinement, moon tethers (an overlay), Map properties → Convert world types to tables (Generator tables itself is the core's: Names is on every map; Space's roles list from its `tablesFolder` "space"), New map setup's Edit world types…, the arrival table source, the Sector-or-system and Planet map scales |

**Two halves per module**, so the import graph has no cycles:
- **Data** — `src/modules/<id>/index.ts` → `HexmakerModule` (`types.ts`): map type info (`KindInfo`), terrain types and groups, icon pack (with optional sub-groups), palette presets, table roles, When keys, engines, path roles, map scales (the setup wizard's "What are you mapping?": label, size, palette, generator ids), Submap-defaults generator ids, path-type fields added after release, `owns` (settings keys, map-note keys, commands, and `strings`: text only it puts in `main.js`, for `check:release`). Imports types and pure data only. `src/modules/index.ts` lists them in order (`MODULES`) and builds `registry` (`ModuleRegistry`, `registry.ts`). Any core file may import `registry`.
- **Runtime** — `src/modules/<id>/runtime.ts` → `ModuleRuntime`: what needs the plugin — built-in generators (with a list `order` and engine `tuning` sliders), note stores (`ModuleStore`: init + the vault events), folder settings (rendered by both settings paths), commands (`onlyWhenOn` waits on the module's map type), ref-link rewriters for the NF3 note-format upgrade, `onEnabled` (install shipped content when its map type is turned on), `onKindsEnabled` (any map type turned on), `afterStoresReady` (one-time upgrades once the core's stores and its own load), `folders` (more note folders), `devTools` (sandbox only), and the map UI pieces (P5): `overlays` (drawn by the map view and the PNG export from the same `segments()`), `mapProperties` (Maps modal sections), `newMapSetup` (extras beside a generator option), `arrival.tableSourceFor`, `newMapOptionIds` (placement ids of its generators' options), `scaleSetup` (a map scale's own choices beside its generator and `afterCreate` once a map is made on it: World maps' Biomes turns the new map into an overworld through `finishNewOverworld`, the same path as New overworld…, with its region defaults `NEW_OVERWORLD_DEFAULTS`; "Make every region now" is off and in Advanced). `src/modules/runtime.ts` lists them; it is only read inside functions, never at import time.
- **World maps' hooks** — `src/modules/world-maps/api.ts`: the module's own functions and classes the core's map surfaces call by name (`HexMapView`, `HexEditorModal`, `MapModal`, `newChildMap`, `ArrivalService`, `GeneratorPanel`). The core gets them from `worldMaps()` in `src/modules/runtime.ts` and types them with `import type` only; the object is made on first use (the overworld code imports the core, so never at import time). Without the slice `worldMaps()` is undefined and those surfaces skip their overworld parts. This is the coupling still named after a module: each hook is a candidate for a generic contribution later.

**What the core derives from the registry:** `MAP_KINDS`, `TERRAIN_TYPES` / `TERRAIN_GROUPS` (core land and water types first: they are shared schema, CM5), `PALETTE_PRESETS`, `BUNDLED_ICONS` and the icon-pack tabs, `ENGINE_ROLES`, the generator list (`listGeneratorKinds` = Blank + module generators + shipped/learned), When keys (`tableConditions.ts` keeps `type` and `terrain`), path role labels, the setup wizard and Settings → Map types lists, the wizard's first-map step (map scales then a generator list with Blank first, `src/mapScales.ts` and `src/wizardKinds.ts`; its Advanced holds each generator's `tuning` sliders, passed to the engine as `tune.<key>` options whose defaults reproduce the engine exactly). New map (`NewMapSetupModal`) has the same split for new top-level maps (no scale for submaps, regions, or next to a map); both forms draw the scale cards, sliders and scale choices from `src/ui/mapScaleForm.ts` and resolve options with `optionsWithTuning`, `plugin.worldTypeStore` and `plugin.biomeStore` (getters over `plugin.moduleStores`, for module code).

**One map-type rule (CM3)** — `mapKinds.ts`:
- `inferredKind(terrains)`: the map type a module's own terrain types say; land and water types say nothing.
- `paletteKind(p)`: declared `kind` (palette note `map-kind`), else inferred, else the fallback (World).
- `kindForChain(chain)` / `plugin.kindFor(map)`: walking from the map up its parents, the nearest palette that says a type (declared, else by its own types). Section words, Region/Location cards and the CM6 offer use it.
- `contextKindsOf(chain)` / `plugin.contextKinds(map)`: every palette's type along the chain. Generators of a type with `offerInContext` (Space) show on such maps even when the type is off; `visibleKinds` / `isGeneratorShown` take this set.

**A module that's off (CM6):** its maps, notes and stores still load ("off hides, never deletes"). Opening such a map on purpose (maps picker, region list, hex menu Enter region / Open location, hex editor map chips — `navigateToMap(name, { offerModule: true })`) offers to turn it on (`src/maps/moduleOffer.ts`, `plugin.offerModuleFor`, `plugin.enableMapKind`); "Not now" holds for the session. "New …" flows never pass `offerModule` and never turn a module on (`tests/moduleOffer.test.ts`).

**Release slices (P6).** `release-slices.json` maps each slice to its modules and an esbuild define (`foundation`: world, always built; `worldmaps`: `__SLICE_WORLDMAPS__`; `space`: `__SLICE_SPACE__`; `hexflower`: `__SLICE_HEXFLOWER__`, the hex-flower module, not released yet). `npm run build` builds the released slices, `build:full` and `dev` all of them, `HEXMAKER_SLICES_OFF=space,worldmaps` turns slices off on top (`dev/release/slices.mjs`). `src/modules/index.ts` and `runtime.ts` push a module only behind its flag; for a slice built off, esbuild loads the module's `index.ts` / `runtime.ts` as stubs (esbuild keeps `if (false)` branches and their imports unless minifying), so with no other import of its code nothing of it reaches `main.js`. `help.md` and `README.md` blocks inside `<!-- slice:<id> -->…<!-- /slice -->` are dropped for slices built off (markers removed otherwise): help.md as it is bundled, README.md as the release README a production build writes to `dist/README.md` beside main.js (`releaseReadme`, `dev/release/slices.mjs`). In README a table row's block opens at the end of the row before it, so removing it leaves the table whole. A module's settings keys have no `DEFAULT_SETTINGS` entry, so a build without it never writes them; its upgrades and seeding run only from its runtime. **`npm run check:release`** (`dev/release/check-release.mjs`) builds each slice off and all off and fails on any of the off modules' command ids, settings keys (not counting placement ids), map-note keys or `owns.strings`, and its release README on any off module's `owns.strings`, any marker, or any line of the off slices' README blocks (`sliceBlockText`); the full build must contain them all. Tests run with every slice on (`tests/register.mjs`); `tests/releaseSlices.test.ts` checks the manifest, flags and markers, `tests/integration/releaseSlices.integration.ts` runs `check:release`.

**Still in the core for World maps** (documented remainder, P7): the Regions tab's region settings form and the `RegionSettings` type, region submaps and neighbours ("Next to", the d-pad; the walk into new land itself is World maps'), the biome brush's toolbar button with the `biome` tool mode and work-mode actions, the `projection` undo kind, the `Overworld path` column reader (`src/paths/pathColumns.ts`, so regeneration keeps projected paths whether or not the slice is built), River's `carves` in `DEFAULT_PATH_TYPES`, and World maps' placement ids in `src/ui/placement.ts`. None of these import module code.

**Boundary ratchet (CM8):** `tests/moduleBoundary.test.ts` scans `src/` for value imports from core files into a module's code (`src/space/`, `src/overworld/`, `src/modules/<id>/`; the registry entry points `index.ts`, `runtime.ts`, `registry.ts`, `types.ts` are allowed) and for map-type branches by name (`isSpaceMap`, `=== "space"`, `.has("world")`…). The counts live in `tests/fixtures/moduleBoundary.json`; a count may never go up, and when one goes down the list must be lowered with it. **Now 0 for every module** (P5 took Space from 4 to 0, P7 World maps from 68 to 0). **Adding a module:** write its `index.ts` (data) and `runtime.ts`, list it in both entry points, give its settings/commands placement ids, and never import it from the core.

**Characterisation:** `tests/moduleCharacterisation.test.ts` pins the core's map-type answers over a matrix of map types × palettes × map trees (`tests/fixtures/moduleCharacterisation.json`, `UPDATE_SNAPSHOT=1` to rewrite after a deliberate change).

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
| `frontmatter.ts` | Map data getters/setters (terrain, icon, region, submap… — delegate to `MapStore`), token frontmatter |
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
