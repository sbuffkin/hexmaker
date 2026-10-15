# Architecture Overview — Hexmap World Creator (Hexmaker)

A tabletop RPG world-building plugin for Obsidian (plugin id `hexmaker`; the repo, view types, CSS classes and protocol actions keep the older `duckmage` name). Its views — hex map, hex table, random tables/workflows, generator page, palette editor, setup wizard — work on one vault of plain Markdown notes. Map notes hold the map data; hex notes hold prose and links.

---

## Layers

```
HexmakerPlugin (thin shell: fields, onload, one-line delegations)
  ├── src/plugin/    commands · protocolHandlers · vaultEvents · startup · settingsPersistence
  ├── src/services/  MapsService · PaletteQueries · HexNotesService · TemplatesService · TerrainTablesService
  ├── stores         MapStore (maps/) · PaletteStore (palettes/) · TableStore + TableNotes (random-tables/)
  │                  · module stores (BiomeStore, WorldTypeStore, FlowerStore: NoteFolderStore subclasses)
  │                  · HexPropsSync (maps/) · PathsService + RoutePins (paths/) · UndoBook
  ├── views          HexMapView · HexTableView · RandomTableView · GeneratorView · PaletteEditorView · SetupWizardView
  └── ports.ts       bindPorts(): the module-level setters plain modules use to reach plugin state
```

- **Start-up** (`HexmakerPlugin.onload`): `loadSettings` (settings-phase migrations on the raw data, then defaults) → table notes, route pins → `bindPorts` → `registerVaultEvents` → `onLayoutReady(startOnLayoutReady)` (icons, stores — held for the setup wizard on a fresh install, F19 — note-format upgrades, the one upgrade notice and upgrade note) → views, commands, settings tab, roller block, protocol handlers.
- **Vault events** (`src/plugin/vaultEvents.ts`): one handler per event for the whole plugin; each step is isolated (a throw is logged, the next runs) and the order is fixed and documented in the file header (e.g. delete: hex-note properties → icons → map store → palette store → module stores → callout memory → workflow steps).
- **Settings persistence** (`src/plugin/settingsPersistence.ts`): one read, no `await` between swapping in the settings and `mapStore.adoptAll()` (incident 2026-10-10); saves strip note-held paths (`withoutNotePaths`), skip writes that change nothing, recognise our own write echoed back by `onExternalSettingsChange`, and keep the `dataFormat` stamp.
- **Controllers and hosts.** Code split out of a big view or modal is a controller taking a narrow `*Host` interface (precedent: `PathToolHost` in `hex-map/pathTool.ts`). `HexMapView.viewFacade()` returns what most map controllers read (functions, read live); each host is `{ ...view, …extras }`. The hex editor's sections share `hex-map/editor/host.ts` (`EditorHexHost`, `EditorWriteHost`); the generator page's sections get one `GeneratorPageCtx` (`worldgen/genPage/ctx.ts`), and its selections live in `worldgen/generatorPageState.ts` (survive re-render and reopen).

---

## Views

### HexMapView (`src/hex-map/HexMapView.ts` + `src/hex-map/view/`)
The interactive map. DOM: `contentEl` (`.duckmage-hex-map-container`) → `.duckmage-hex-map-clip` (overflow hidden) → `.duckmage-hex-map-viewport` (pan/zoom transform; zoom is baked into the grid's font size) → hexes and em-placed layers; `.duckmage-hex-map-controls` is a `pointer-events: none` overlay for the toolbar and edge buttons, so the transform never clips them.

| Controller (`view/`) | Job |
|---|---|
| `gridRenderer` | full re-render (`renderGrid`), layers placed from measured geometry, empty state |
| `hexPainter` | terrain / icon / GM icon / biome / region-hex brushes, table and submap link clicks |
| `hexWrites` + `coalescingWriteQueue` | paint writes, one queue per field, only the latest value per hex lands, retried with backoff |
| `mapInput` | hover, wheel, drag-pan, paint strokes, gap clicks |
| `mapViewport` | pan/zoom, zoom bake, fit/centre, each map's last viewport |
| `toolState` + `mapToolbar` | the drawing mode (`DrawingMode` in `hex-map/toolMode.ts`: path, terrain, icon, tableLink, submapLink, factionLink, regionLink, swap, placeToken, biome) and its buttons / mode bar |
| `mapNavigation` | Back/Forward/Up, breadcrumb, neighbours, walking into new land, child maps |
| `mapShell` | shortcuts, top bar, side panels, workspace/store listeners |
| `pathOverlay`, `areaOverlay` + `areaShapes`, `gridLabels`, `neighbourShadow` | overlays (read-then-write) |
| `backgroundCalibration` + `calibrationDrag` | background image layer and grid calibration |
| `undoController` + `undoGroup` | strokes → `plugin.undoBook` (one queue per map per work mode) |
| `tokenLayer`, `hexContextMenu`, `hexSwap`, `gridEdgeButtons`, `workModeButton` | tokens and party travel, right-click menus, swap tool, +/− edges, Play/Build/God |

Public: `centerOnHex(x, y)`, `activeMapName`, `renderGrid(...)`. The path tool is `hex-map/pathTool.ts`.

### HexEditorModal (`src/hex-map/HexEditorModal.ts` + `src/hex-map/editor/`)
Right-click per-hex editor: `TerrainIconSections` (terrain, icon override, GM icons — written to the map store), `LinkSection` (Towns, Dungeons, Quests, Factions, Features), `TextSection` (Description, Landmark, … and the note's own sections), `TableSections` (encounter / rolled tables: hex > area > terrain), `NeighbourFlower`, `MapsStrip`. All section data is read once (`getAllSectionData`) before the DOM is built.

### HexTableView (`src/hex-table/`)
Spreadsheet of the hex notes: Hex (coords + ◎ jump), Terrain, then Description, Landmark, Towns, Dungeons, Features, Quests, Factions, Enc. Table, Hidden, Secret, Weather, Hooks & Rumors. Filters (X/Y range, map, terrain include/exclude, has-link checkboxes) work on `dataset` attributes without file I/O. Live updates on `modify` (300 ms debounce per file).

### RandomTableView (`src/random-tables/`)
Tables and Workflows tabs: folder tree, roll, edit (`RandomTableEditorModal`), workflow steps (`WorkflowEditorModal`, `WorkflowWizardModal`). `openTable(filePath)` is the public entry, used by the hex table, the hex editor, workflow step links and the `obsidian://duckmage-roll` handler.

### Other views
`GeneratorView` (the generator page: `worldgen/GeneratorPanel.ts` + `genPage/`), `PaletteEditorView` (`palettes/`), `SetupWizardView` (first run). Views are found and opened through `src/workspace/views.ts`.

---

## Modals

Every modal extends `HexmakerModal` (`src/HexmakerModal.ts`): drag by title bar (`makeDraggable`), placement (`place(id, el)`, `section(layer)` over `ui/placement.ts` + `ui/disclosure.ts`), icon search and pack tabs (`addIconFilter`). The one exception is `FileLinkSuggestModal` (a `SuggestModal`). Main ones: `HexEditorModal`, `MapModal` (maps tree and map properties), `TerrainPickerModal`, `IconPickerModal`, `TerrainEntryEditorModal`, `PathPickerModal` / `PathTypeEditorModal`, `AreaNotePickerModal` (factions and regions), `RegionNavigateModal`, `SubmapPickerModal`, `LocationsModal`, `TokenModal`, `NewMapSetupModal`, `MapExportModal`, `PackExportModal` / `PackImportModal`, `RandomTableModal`, `RandomTableEditorModal`, `WorkflowEditorModal`, `WorkflowWizardModal`, plus World maps' modals in `src/overworld/`.

---

## Data model

### Map notes — the source of truth for map data
Path `{hexFolder}/{map}/_{map}.md`, one per map, owned by `MapStore` (`src/maps/MapStore.ts`), parsed and written by `src/maps/mapNote.ts` (pure; its header has the full format history 1→6).

```markdown
---
hexmaker-map: 6
palette: Default
cols: 38
rows: 25
parent: "[[_the-north]]"
parent-hex: 3, 4
---
# The Coast
> [!info]- How to edit this note
## Summary            ← derived, regenerated on every write
## Hexes
| Hex | Name | Terrain | Icon | GM icons | Area | Locations | Locked |
| 3_4 | Glass Wastes | dunes |  |  | [[Basin]] | [[_saltmere]] |  |
## Paths
| Path | Type | Route | Notes |
| King's Road | Road | 3, 4 → 9, 4 · 1 fork · 9 hexes | Paved. |
## Path routes
| Path | Branch | Anchors |
| King's Road | main | 3, 4 → 9, 4 |
```

- Every per-hex map field (name, terrain, icon override, GM icons, area/region, region map, locations, locked) lives here. Read it through `plugin.mapStore` or the `src/frontmatter.ts` getters (→ `src/maps/hexData.ts`), never from hex-note frontmatter, and never gate it on a hex note existing.
- The map's settings (palette, size, parent, layer toggles, work `mode:`, seed, display name…) are frontmatter, one plain key each. Only per-session state (viewport) stays in `data.json`.
- Reading is forgiving (block YAML, `3, 4` for `3_4`, column order, yes/x/✓…); rows that can't be read stay as written and are listed in a warning callout; text and keys the plugin doesn't own survive rewrites. Older formats are read forever and rewritten on the next write after a backup.

### Hex notes
Path `{hexFolder}/{map}/{x}_{y}.md`, made only when a hex first gets prose or links (from `src/defaultHexTemplate.md` or the user's template in `templatesFolder`; placeholders `{{x}}`, `{{y}}`, `{{title}}`).

```markdown
---
map: "[[_coast]]"
terrain: forest        ← mirrored properties (MG4), for Dataview / Bases / search
area: Basin
icon: castle.png
name: Glass Wastes
---
# Hex 3, 4
> [!hexmaker] Map data
> Filled in from the map by Hexmaker.

### Description
### Landmark
### Hidden
### Secret
### Weather
### Hooks & Rumors
### Encounters Table
### Towns
### Dungeons
### Quests
### Factions
### Features
```

- The properties are copies: `src/maps/hexPropsSync.ts` writes them on every map change (only into notes that exist) and sends a hand edit back to the map; on conflict the map wins (`hexProps.ts`). `hexNoteProperties: false` turns them off.
- The Map data callout is kept by `src/hexMapData.ts` / `maps/calloutSync.ts`; hand edits to its lines go to the map.
- Link sections (`LINK_SECTIONS`: Towns, Dungeons, Features, Quests, Factions, Encounters Table) hold wiki-links (`sections.ts`: `addLinkToSection`, `getLinksInSection`, `getAllSectionData`); text sections (`TEXT_SECTIONS` Description, Landmark, Hidden, Secret; `ROLLED_TEXT_SECTIONS` Weather, Hooks & Rumors) hold free text.

### Palettes and path types — notes
One note per palette in `palettesFolder` (default `{worldFolder}/palettes`; frontmatter `hexmaker-palette`, basename = name). A terrain table (`| Terrain | Color | Icon | Icon color | Category | Type | Impassable |`, colours as inline code) and a `## Path types` table (`| Path | Color | Width | Style | Routing | Avoid impassable | Auto-route |`). `PaletteStore` syncs notes ⇄ `settings.terrainPalettes` (working copy + data.json cache); code edits palettes in memory and calls `saveSettings()`. Presets: `src/palettes/presets.ts` and each module's `presets.ts`; `presetUpdates.ts` offers new preset content once.

### Other notes
- **Areas:** faction and region notes (`factionsFolder`, `regionsFolder`), styled by `src/notes/areaStyle.ts`, with a Map data callout (`regionMapData.ts`).
- **Biomes and pools** (World maps, `BiomeStore`), **world types** (Space, `WorldTypeStore`), **hex flowers** (`FlowerStore`): folders of notes that are the only copy of their data, on `src/stores/NoteFolderStore.ts`.
- **Generators:** generator notes under the generators folder (`worldgen/generators.ts`, `saves.ts`).
- **Tokens:** token notes' frontmatter (`src/tokens/tokenNotes.ts`). **Play log:** one dated note per day in `logFolder`.

### Random tables
```markdown
| d20   | Result  | Weight |
|-------|---------|--------|
| 1–16  | crabmen | 4 |
| 17–20 | mage    | 1 |
| —     | kraken  | 0 |
```
Weights are core; the roll column shows the ranges, and valid stored ranges are what's rolled (blank = filled from weights; unusable ranges are reported and the table rolls by weight). Older `| Result | Weight |` tables still parse. Optional frontmatter (`rows:`, `terrain-type:`, `pick: each`, `linked-folder:`…) and extra columns (Roll, Shown as, Once, When…) are row attributes. Parser/roller: `src/random-tables/randomTable.ts`; hand edits imported by `TableStore`; terrain tables under `{tablesFolder}/terrain/` (`TerrainTablesService`).

### Workflows
```markdown
---
results-folder: world/results
template-file: world/workflows/templates/npc.md
---
| Table | Rolls | Label | Die | Fills |
|-------|-------|-------|-----|-------|
| [[world/tables/aspects]] | 3 | aspects | d12 | $aspects_1 $aspects_2 $aspects_3 |
```
Table, Rolls and Label are the steps; Die and Fills are derived and ignored on read. Templates use `$label` / `$label_N`. `src/random-tables/workflow.ts` parses and writes; `WorkflowEditorModal` keeps the template in step with the steps.

### Settings (`data.json`)
`HexmakerPluginSettings` (`src/types.ts`), defaults in `DEFAULT_SETTINGS` (`src/constants.ts`). Module settings keys have no default and are written only once set.

| Key(s) | Purpose |
|-----|---------|
| `dataFormat` | Data stamp (`src/migrations/stamp.ts`): absent/1 = 1.5.x, 2 = map data in map notes. Never lowered; a higher one than the build knows = "written by a newer version" |
| `savedWith` | Plugin version that last saved |
| `migrationsRun` | Ids of the migrations that changed this vault, in order |
| `worldFolder`, `hexFolder`, `townsFolder`, `dungeonsFolder`, `questsFolder`, `featuresFolder`, `factionsFolder`, `regionsFolder`, `tablesFolder`, `workflowsFolder`, `palettesFolder`, `templatesFolder`, `exportFolder`, `iconsFolder`, `logFolder` | Vault folders (blank ones default under `worldFolder`); module folders: `biomesFolder`, `biomePoolsFolder`, `worldTypesFolder`, `hexFlowersFolder` |
| `templatePath` | Hex note template (else the templates folder, else built in) |
| `maps` | `MapData[]` — the map list and per-map fields; `paths`/`pathChains` are left out once the map note holds them (`withoutNotePaths`), hexes are never here |
| `terrainPalettes` | Working copy / cache of the palette notes; `paletteNotes` records which notes were written |
| `mapKinds`, `kindContent` | Map types turned on; whose shipped content is installed |
| `defaultMap`, `defaultPalette`, `defaultNewMapCols/Rows`, `defaultSubmapCols/Rows`, `defaultTableDice` | Defaults for new things |
| `hexOrientation`, `staggerOffset`, `hexGap`, `zoomLevel`, `coord*`, `hexName*`, `showTerrainLegend`, `terrainLegend*`, `hiddenIcons`, `iconOrder`, `linkSectionIcons` | Display |
| `hexEditor*Collapsed`, `rollTableExcludedFolders`, `encounterTableExcludedFolders`, `mapExportPrefs`, `hexNoteProperties` | UI state and options |
| `setupComplete`, `setupDismissed` | Setup wizard |
| `palettesMigrated`, `pathTypesExplicit`, `paletteColorsCode`, `paletteDataUpgraded`, `terrainTypesSeeded`, `tableRangesUpgraded`, `noteFormatUpgrades`, `presetTerrainsAdded`, `presetPathFieldsAdded`, `biomesSeeded`, `biomeClimatesSeeded`, `biomePoolSeeded`, `biomeColumnsFilled`, `worldTypesSeeded`, `expandedByDefault` | One-time upgrade / seeding flags (keep reading them) |
| `pathTypes` | Legacy global path types; read only by the path-type migrations |

### Migrations (`src/migrations/`)
One file per stored-format step (`v<from>-<what>.ts`, `map-note-<a>-to-<b>-…`, `unreleased-…`), each with `info` (`change`, `phase`, `recordedBy`), listed in `registry.ts`. Phases run in order: settings (raw data, in `loadSettings`) → palettes (`PaletteStore`) → maps (`MapStore`) → notes (`noteRewrites.ts` runner) → tables. Back up first (`src/backup.ts`), keep old readers forever, re-plan edited notes; changes go into `migrationsRun` and the upgrade note (`upgradeNote.ts`). Modules run their own notes' upgrades from their runtime. Step list and rules: `src/migrations/README.md`; golden test `tests/migrationGolden.test.ts`.

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

| Path | Responsibility |
|------|---------------|
| `HexmakerPlugin.ts` | Plugin class: fields (stores, services), `onload`/`onunload`, one-line delegations |
| `plugin/commands.ts` | Ribbon icon, commands, file and editor menus |
| `plugin/protocolHandlers.ts` | `obsidian://duckmage-roll`, `duckmage-workflow`, map / hex links (`hexLink.ts`) |
| `plugin/vaultEvents.ts` | The single handler per vault/workspace event, fixed step order |
| `plugin/startup.ts` | Layout-ready start-up: icons, stores, note-format upgrades, upgrade notice |
| `plugin/settingsPersistence.ts` | data.json load/save, own-write echoes, data stamp, upgrade report |
| `services/MapsService.ts` | Map list: find, create (`createNewMap` options object), rename, restore, submap/region links, inheritance |
| `services/PaletteQueries.ts` | Palettes by name / per map, terrains, submap defaults, installing presets |
| `services/HexNotesService.ts` | Hex notes on use, names/aliases, Map data callouts, notes following renames |
| `services/TemplatesService.ts` | Hex and link-section templates, which notes pickers offer |
| `services/TerrainTablesService.ts` | Terrain/area tables, shipped tables, roller blocks, encounter links, terrain renames |
| `HexmakerModal.ts` | Modal base class (drag, placement, icon filter) |
| `HexmakerSettingTab.ts` | Settings tab: declarative `getSettingDefinitions()`, `display()` fallback draws the same definitions |
| `SetupWizardView.ts` | First-run setup (map types, folders, first map; `wizardKinds.ts`, `mapScales.ts`) |
| `ports.ts`, `log.ts` | `bindPorts` / `resetPorts`; `logError` / `logWarn` |
| `frontmatter.ts` | Barrel over `maps/hexData.ts` (hex map data), `notes/areaStyle.ts`, `tokens/tokenNotes.ts` |
| `hex-map/` | `HexMapView` + `view/` controllers, `HexEditorModal` + `editor/`, path tool, geometry and hit tests, map modals and pickers |
| `hex-table/` | `HexTableView`, link and terrain pickers |
| `maps/` | `MapStore`, `mapNote.ts` (pure format), `hexData`, `hexProps` / `hexPropsSync`, callouts, map tree, navigation, submaps, module offer |
| `migrations/` | Format steps, `registry.ts`, `stamp.ts`, `noteRewrites.ts`, upgrade report/note |
| `modules/` | `registry` (data), `runtime` (plugin side), `world/`, `world-maps/` (+ `api.ts` hooks), `space/`, `hex-flower/` |
| `worldgen/` | Generator registry and engines, `GeneratorPanel` + `genPage/`, `generatorPageState.ts`, `NewMapSetupModal`, previews, saves |
| `overworld/`, `space/`, `hexflower/` | Module code: World maps (biomes, regions, overworld layer), Space (orbits, star scatter, world types), hex flowers |
| `random-tables/` | `RandomTableView`, parse/roll (`randomTable.ts`, `resolve.ts`), `TableStore`, `TableNotes`, roller block, workflows |
| `palettes/` | `PaletteStore`, `paletteNote.ts`, `pathTypeTable.ts`, presets, palette editor view, renames |
| `paths/` | `PathsService`, router, route cache and pins, edits and gates, path columns, legacy readers |
| `play/`, `arrival/` | Play log, party travel, link icons; places made on arrival, events ledgers |
| `packs/`, `export/` | Pack export/import; PNG / PDF / HTML / Markdown exports |
| `notes/`, `tokens/` | Area-note styling and frontmatter text; token notes |
| `ui/` | Shared controls: `sliders`, `shareSliders` (+ `shares`), `pickers`, `disclosure` (Advanced, Debug, `Fold`), `placement` (the placement map), `notify`, `numberBoxes`, `debugMode`, `mapScaleForm` |
| `md/tableRow.ts`, `stores/NoteFolderStore.ts`, `vault/ensureFolder.ts`, `workspace/views.ts` | Shared `splitRow`; note-folder store base; race-safe folder creation; finding/opening views |
| `hexKey.ts` | Hex-key (`"x_y"`) helpers (Lane L11, landing separately) |
| `sections.ts`, `utils.ts`, `types.ts`, `constants.ts` | `###` section read/write; `normalizeFolder`, `getIconUrl`…; types; `VIEW_TYPE_*`, `DEFAULT_SETTINGS` |

---

## Key conventions

- Folder paths normalised (no leading/trailing slashes) via `normalizeFolder()`.
- Wiki-links via `metadataCache.fileToLinktext(file, sourcePath)`.
- `obsidian` is an esbuild external — never bundled.
- CSS classes use the `duckmage-` prefix; dynamic values go through CSS custom properties, never `.style.x =`.
- Views, modals and helpers import `HexmakerPlugin` as a type only (`import type`); `tests/importCycles.test.ts` forbids new value-import cycles.
- New code goes in new focused files (`tests/fileSizes.test.ts` caps files over 800 lines); split-out code takes a narrow `*Host`.
- Map data only through `plugin.mapStore` / the `frontmatter.ts` getters; stored-format changes only through `src/migrations/`.
- Layout reads before DOM writes in any per-hex loop; hit tests in the drawing's units (em), tested at several zooms.
- Modals that preload file content accept an optional `preloaded` / `initialContent` parameter.
- Notes whose `basename` starts with `"_"` are excluded from dropdowns, file trees and generated lists: `.filter(f => !f.basename.startsWith("_"))`.
- Control placement comes from `src/ui/placement.ts` (main / more / advanced / debug / hidden); the same kind of input uses the same shared control.
