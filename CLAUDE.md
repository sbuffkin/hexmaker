# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (watch mode with inline sourcemaps, every release slice built) — use with Hot Reload (see below)
npm run dev

# Release build (type-checks then bundles the slices marked released in release-slices.json)
npm run build

# Full build: every slice, released or not (owner and test vaults)
npm run build:full

# Prove a slice built off leaves no trace in main.js (builds each slice off, then all off)
npm run check:release        # or: node dev/release/check-release.mjs --off space

# Run tests (node:test via tsx; every slice on; runs every tests/*.test.ts)
npm test

# Type-check the tests (tsconfig.test.json; also in premerge)
npm run typecheck:tests

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
   powershell.exe -Command "obsidian eval code=\"(async()=>{await app.plugins.disablePlugin('hexmaker'); await app.plugins.enablePlugin('hexmaker'); return 'ok'})()\""
   ```
   The plugin **id is `hexmaker`** (the folder is `duckmage-plugin`). On this machine's Obsidian installer the CLI's `plugin:reload` / `plugin:disable` / `plugin:enable` and `dev:*` commands silently do nothing (exit 255, "installer out of date"); `obsidian eval` works. To check what's loaded: `obsidian eval code="Object.keys(app.commands.commands).filter(c=>c.startsWith('hexmaker:'))"`. Screenshot: `require('@electron/remote').getCurrentWebContents().capturePage()` inside `eval`. `app.plugins.plugins.hexmaker.manifest.version` is cached from startup — don't use it to tell builds apart.
   **Before copying a build into this folder**, check which branch the current vault build came from — other sessions deploy from their own branches, and a deploy reverts theirs.
3. Use `/rebuild` for a final production build before committing (runs the TypeScript type-check and tests too)

## Running from a Windows-native session

`node_modules` is installed from WSL (Linux esbuild binary, no `.cmd` shims), so npm scripts fail when run from Windows. Run them through WSL:

```bash
MSYS_NO_PATHCONV=1 wsl.exe -e bash -lc 'cd /mnt/c/Users/markr/Documents/KB/journal/.obsidian/plugins/duckmage-plugin && npm run build'
```

## Before merging or deploying: `npm run premerge`

**Before merging into `feat/region-notes` (or master) or deploying a build into the live vault, run `npm run premerge`** (from WSL, like every npm script here) and only go ahead when it ends with `PREMERGE PASSED`. It runs build → lint → test type-check → unit tests → integration tests → the **smoke vault matrix**, stopping loudly at the first failure (owner decision WM5: the matrix runs locally, not in CI; CI keeps the Obsidian-free tests).

- The matrix (`dev/smoke/run.mjs`, plan [[plan-work-modes]] §3) builds 9 vault setups (fresh install, a synthetic 1.5.5 vault, a copy of the owner's real data `C:/Users/markr/work/tmp/migtest/seedF` + a copy of the live `data.json`, space only, overworld + regions, neighbours world, a custom palette with no default names, everything deleted, 80 maps), each in its own sandboxed Obsidian (fresh-eyes `sandbox.mjs`, up to 4 at once), and checks: no plugin console errors; settings saved; every map opens and renders; untouched files unchanged on disk (migrations verified separately: map notes, backups, hex data vs the old frontmatter, paths resolve, palette upgrades keep every terrain); a restart rewrites nothing; paint → undo round trip; registered commands; Play refuses a path edit. ~5 minutes, mostly the real-data migration.
- Run parts of it: `npm run smoke -- --only fresh,v155 --jobs 2` (`--list` for the setup ids, `--keep` to keep run folders, `--build <dir>` to test another build). A failed setup keeps its run folder (path in `dev/smoke/last-run.json`); a full pass writes `dev/smoke/last-pass.json` (commit, build hash, per-check results).
- It only stops the sandboxes it started and checks every other Obsidian process is still there (`otherObsidianBefore == otherObsidianAfter`). Never point it at the main vault.
- A new feature with a user-visible write path (paint, paths, a new note type, a migration) should get a smoke check in `dev/smoke/lib/page.mjs` / `setups.mjs` as well as unit tests.

## Architecture

`main.ts` re-exports `src/HexmakerPlugin.ts`; esbuild bundles everything into `main.js` (`.md` files import as text: `loader: { '.md': 'text' }` in `esbuild.config.mjs`). The plugin id is `hexmaker`; view types, CSS classes and protocol actions keep the old `duckmage-` prefix. See `ARCHITECTURE.md` for the module table, the data formats and the modules/slices system.

**Modules and release slices.** World (released), World maps (`src/overworld/`) and Space (`src/space/`) are modules (`src/modules/`); one module is one release slice (`release-slices.json`, esbuild defines `__SLICE_WORLDMAPS__` / `__SLICE_SPACE__` / `__SLICE_HEXFLOWER__`). The core never value-imports a module's code: it asks `registry` (data), the runtime contributions in `src/modules/runtime.ts`, or World maps' hooks via `worldMaps()` (undefined without the slice; type-only imports). `tests/moduleBoundary.test.ts` holds the import edges at 0. A module's settings keys get no `DEFAULT_SETTINGS` entry (written only once set); its user-visible names go in its `owns.strings`, and Space- or World-maps-only help text goes inside `<!-- slice:<id> -->…<!-- /slice -->` in `help.md`. Run `npm run check:release` after touching a module. Comments inside object literals and class bodies reach `main.js`: don't name a module's features in core comments there.

### Source layout

```
main.ts                 ← export { default } from "./src/HexmakerPlugin"
src/
  HexmakerPlugin.ts     ← Plugin class, thin: fields, onload/onunload, one-line delegations to services
  plugin/               ← what onload used to do: commands.ts (ribbon, commands, file/editor menus),
                          protocolHandlers.ts (duckmage-roll, duckmage-workflow, map/hex links),
                          vaultEvents.ts (ONE handler per vault event, fixed step order — see its header),
                          startup.ts (onLayoutReady: icons, stores, note-format upgrades, upgrade notice),
                          settingsPersistence.ts (data.json load/save, own-write echoes, stamp)
  services/             ← MapsService (map list, createNewMap options object), PaletteQueries,
                          HexNotesService, TemplatesService, TerrainTablesService
  HexmakerModal.ts      ← base class of every modal (drag, place()/section(), icon filter)
  HexmakerSettingTab.ts ← settings tab (declarative getSettingDefinitions + display() fallback)
  SetupWizardView.ts    ← first-run setup wizard
  ports.ts              ← bindPorts(plugin): the module-level setters plain modules use to reach plugin state
  log.ts                ← logError / logWarn ("Hexmaker: <scope>" prefix); user messages go via ui/notify.ts
  frontmatter.ts        ← re-export barrel over maps/hexData, notes/areaStyle, tokens/tokenNotes
  types.ts constants.ts ← settings/map types, LINK_SECTIONS/TEXT_SECTIONS; VIEW_TYPE_*, DEFAULT_SETTINGS
  hex-map/              ← HexMapView.ts (ItemView, ~1000 lines) + the map's modals, path tool, geometry
    view/               ← the map view's controllers (gridRenderer, hexPainter, mapInput, mapViewport,
                          mapToolbar + toolState, mapNavigation, mapShell, pathOverlay, areaOverlay,
                          gridLabels, neighbourShadow, backgroundCalibration, undoController,
                          hexWrites + coalescingWriteQueue, tokenLayer, hexContextMenu, hexSwap, …)
    editor/             ← HexEditorModal's sections (TerrainIconSections, LinkSection, TextSection,
                          TableSections, NeighbourFlower, MapsStrip; hosts in host.ts)
  hex-table/            ← HexTableView (spreadsheet of hexes) and its pickers
  maps/                 ← MapStore (per-hex map data, one map note per map), mapNote.ts (pure parse/write),
                          hexData.ts (hex getters/setters routed to the store), hexProps + hexPropsSync
                          (hex-note properties both ways), callouts, map tree / navigation / submaps
  migrations/           ← one file per stored-format step, registry.ts, stamp.ts (dataFormat),
                          upgradeNote.ts / upgradeReport.ts; rules in its README.md
  modules/              ← registry (data half), runtime (plugin half); world/, world-maps/, space/, hex-flower/
  worldgen/             ← generators, engines (procedural/, builtin/), GeneratorPanel + genPage/ section
                          renderers (GeneratorPageCtx), generatorPageState.ts, NewMapSetupModal
  overworld/ space/ hexflower/ ← module code (World maps, Space, hex flowers)
  random-tables/        ← RandomTableView, table parse/roll (randomTable.ts), TableStore, workflows
  palettes/             ← PaletteStore (palette notes ⇄ settings), paletteNote, pathTypeTable, presets
  paths/                ← PathsService (resolved chains, route cache), router, path edits, legacy readers
  play/ arrival/        ← play log, party travel, link icons; places made on arrival, events ledgers
  packs/ export/        ← pack export/import; map/hex/workflow exports (PNG, PDF, HTML, Markdown)
  notes/ tokens/        ← area (faction/region) note styling, frontmatter text; token notes
  ui/                   ← shared kit: sliders.ts, shareSliders.ts (zero-sum), pickers.ts, disclosure.ts
                          (Advanced dropdown, Debug, Fold), placement.ts (the placement map), notify.ts, …
  md/ stores/ vault/ workspace/ ← tableRow.splitRow; NoteFolderStore base; ensureFolder; views.ts (find/open views)
  hexKey.ts             ← hex-key ("x_y") helpers (Lane L11, landing separately)
```

### Patterns

- **Plugin = thin shell.** New plugin behaviour goes in a service (`src/services/`) or `src/plugin/`; `HexmakerPlugin` keeps a one-line delegation (integration tests and many `plugin.getMap`-style call sites rely on them).
- **Controllers take a narrow `*Host`.** Code split out of a big view/modal gets an interface listing only what it uses (`PathToolHost`, `GridRendererHost`, `HexPainterHost`, `EditorWriteHost`, `GeneratorPageHost`…), never the whole view or plugin. `HexMapView.viewFacade()` returns the members most map controllers read (all functions, read live) and each host is built as `{ ...view, …extras }`. Fake hosts in tests implement the whole interface.
- **Vault events:** `src/plugin/vaultEvents.ts` is the only place that registers vault/workspace events; each step runs isolated, in the order its header lists. Add a step in the right slot rather than a new handler.
- **Ports:** plain modules that need plugin state get a setter bound in `ports.ts` `bindPorts()`; don't add module-level state set from elsewhere.
- **Views** are found/opened through `src/workspace/views.ts`, not `getLeavesOfType(...)[0].view as …`.

### Data model

- **Map notes are the source of truth for map data.** `{hexFolder}/{map}/_{map}.md`, frontmatter `hexmaker-map: 6` (format history in the `mapNote.ts` header). Frontmatter = the map's settings (palette, size, parent, layer toggles, mode, seed…); `## Hexes` table (Hex | Name | Terrain | Icon | GM icons | Area | Locations | Locked); `## Paths` + `## Path routes` (named paths with anchors); a derived `## Summary`. Readers are forgiving, unknown text/keys survive rewrites. Owned by `MapStore`; parsed/written by `src/maps/mapNote.ts`.
- **Hex notes** `{hexFolder}/{map}/{x}_{y}.md` exist only once a hex gets prose or links. Frontmatter `map: "[[_<map>]]"` plus mirrored properties `terrain`/`area`/`icon`/`name` (copies for Dataview/Bases; `hexPropsSync.ts` keeps them in step both ways, the map wins on conflict). Body: a `> [!hexmaker] Map data` callout and `###` sections (Description, Landmark, Hidden, Secret, Weather, Hooks & Rumors, Encounters Table, Towns, Dungeons, Quests, Factions, Features; `sections.ts`). Template: `src/defaultHexTemplate.md` or the user's in `templatesFolder`; placeholders `{{x}}`, `{{y}}`, `{{title}}`.
- **Palettes are notes** (`palettesFolder`, default `{worldFolder}/palettes`, `hexmaker-palette: 1`): a terrain table (Terrain | Color | Icon | Icon color | Category | Type | Impassable) and a `## Path types` table. `PaletteStore` syncs notes ⇄ `settings.terrainPalettes` (the in-memory working copy and data.json cache): edit palettes in memory + `saveSettings()`, never write palette notes directly. Presets in `src/palettes/presets.ts` and each module's `presets.ts`.
- **Other note stores:** biome notes and pools (World maps, `BiomeStore`), world types (Space, `WorldTypeStore`) — hex flowers (`FlowerStore`) — all on `NoteFolderStore`; generator notes (`worldgen/generators.ts`); token notes; faction/region (area) notes.
- **Random tables:** notes with a roll column, Result and Weight (`| d20 | Result | Weight |`, ranges like `1–16`, `—` for weight 0). Weights are core; stored ranges are what's rolled, a blank range is filled from the weights; older `| Result | Weight |` tables still read. Optional frontmatter (`rows:`, `pick: each`, …) and extra columns are row attributes (`randomTable.ts` header). Hand edits are imported by `TableStore`.
- **Workflows:** frontmatter `results-folder` / `template-file`, a `| Table | Rolls | Label | Die | Fills |` table (Die and Fills are derived, ignored on read); templates use `$label` / `$label_N` (`random-tables/workflow.ts`).
- **Settings (`data.json`)** — `HexmakerPluginSettings` in `types.ts`, defaults in `constants.ts`: folders (`worldFolder`, `hexFolder`, `townsFolder`, `dungeonsFolder`, `questsFolder`, `featuresFolder`, `factionsFolder`, `regionsFolder`, `tablesFolder`, `workflowsFolder`, `palettesFolder`, `templatesFolder`, `exportFolder`, `iconsFolder`, `logFolder`…), `maps` (per-map `MapData` minus what the map note holds: `paths`/`pathChains` are stripped by `withoutNotePaths`, hexes live only in `MapStore`), `terrainPalettes`, display prefs (`hexOrientation`, `staggerOffset`, `hexGap`, `zoomLevel`, coord/hex-name/legend options), `mapKinds`, and one-time flags (`palettesMigrated`, `pathTypesExplicit`, `tableRangesUpgraded`, `noteFormatUpgrades`, …). `dataFormat` is the data stamp (`migrations/stamp.ts`, currently 2: map data in map notes), `savedWith` the version that saved, `migrationsRun` the ids of migrations that changed this vault. `settings.pathTypes` is only read by the path-type migrations.
- **Hex geometry:** `hexNeighbors(x, y, orientation, stagger)` in `src/hex-map/hexGeometry.ts`; flat-top (default) staggers columns, pointy-top rows; `staggerOffset` odd/even (per map or global).

### Tests

- `npm test` globs `tests/*.test.ts` (node's own glob, so the order is fixed): a new test file runs as soon as it exists. There is no file list in package.json to edit. Integration tests stay in `tests/integration/*.integration.ts` (`npm run test:integration`).
- Tests are type-checked: `npm run typecheck:tests` (`tsc -p tsconfig.test.json`; `obsidian` resolves to `tests/__mocks__/obsidian.ts`; import mock-only members like `Notice.shown` from `./__mocks__/obsidian`). It runs in premerge after lint.
- **Tests that assert on source text read a surface, never a file path:** `readSurface("map-view")` etc. from `tests/helpers/source.ts`. A surface is a big file plus the folder its code is being split into (e.g. `map-view` = `src/hex-map/HexMapView.ts` + `src/hex-map/view/**`, `plugin` = `src/HexmakerPlugin.ts` + `src/plugin/**` + `src/services/**`, `hex-editor`, `generator-page`, …; the list is `SURFACES`). Moving code inside a surface needs no test edit. When you extract code out of a surface file, put it in that surface's folder or add the new file to the surface in the same commit. Loops over file lists use `readSource(path)`; scans that report file paths map them with `ownerFile(path)`.
- **Ratchets:** `fileSizes` (files over 800 lines are capped and may only shrink; lower the cap in `tests/fixtures/fileSizes.json` when they do; prefer new focused files over growing a big one), `importCycles` (no new cycles; the list only shrinks), `pureFiles` (listed files never reach `obsidian` at run time), `moduleBoundary` (above).

### Key conventions

- Folder paths normalised (no leading/trailing slashes) via `normalizeFolder()`. Links via `metadataCache.fileToLinktext(file, sourcePath)`.
- `obsidian` is an esbuild external. CSS classes use the `duckmage-` prefix (`styles.css`, CRLF: stage with `git -c core.autocrlf=false add styles.css`).
- Views, modals and helpers use `import type HexmakerPlugin` to avoid runtime import cycles.
- Paint tools patch the DOM synchronously and queue file writes through `CoalescingWriteQueue` (`hex-map/view/hexWrites.ts`): only the latest value per hex is written. Link tools are one-shot async writes.
- Modals that preload file content accept an optional `preloaded` / `initialContent` parameter so callers that already hold the content skip a vault read.
- Exclude notes whose `basename` starts with `"_"` whenever enumerating vault files for display, dropdowns, or linking. Pattern: `.filter(f => !f.basename.startsWith("_"))`.
- **Map data lives in map notes, not hex notes.** Terrain, icon, GM icons, area/region, submap/locations, name and locked are stored in the map note (src/maps). Read/write them only through `plugin.mapStore` or the `src/frontmatter.ts` getters/setters (→ `maps/hexData.ts`) — never `cache.frontmatter.terrain` etc. (the hex-note properties are copies), and never gate the read on the hex note existing (most hexes have no note). This mistake caused four separate regressions (submap rings, hex locks, editor terrain, exports) — see the KB plan note `plan-map-notes`.
- **Note-only fields survive a settings reload; missing ≠ empty.** data.json leaves out what only the map note holds (each map's `paths`/`pathChains`, via `withoutNotePaths`; hexes live only in `MapStore`). So `loadSettings` / `onExternalSettingsChange` hand out fresh `MapData` objects WITHOUT those fields, and Obsidian fires `onExternalSettingsChange` for our own saves during a save burst. Never read a missing note-only field as "empty" (`map.paths ?? []` feeding a write is the trap): `MapStore.adopt()` carries the store's copy onto fresh objects, `SettingsPersistence.loadSettings` must not `await` between swapping `plugin.settings` and `mapStore.adoptAll()`, and `MapStore.writeNote` refuses to drop every path/hex a note holds unless an edit cleared them (`clearedPaths`/`clearedHexes`). Any new field stored only in the map note needs the same treatment. Incident: 2026-10-10 paths wiped when creating a region next to a map (KB `incident-2026-10-10-path-loss-on-external-reload`; regression tests `tests/pathLossReload.test.ts`).
- **A store never reads its own write back over newer memory, and writes made before it's ready are owned, not half-done.** A fresh install's stores wait for the setup wizard (F19), so maps can be made before `MapStore` is ready: `sync()` keeps the notes this session already wrote current, and `init()` loads those through `loadOwnNote` (memory wins, hand edits folded in), never `apply`. Any new store, gate or "load from disk" step must keep that. Test both ways (stores started, and held then released), as `tests/integration/regionDataAfterCreate.integration.ts` does. Incident 2026-10-14: every region lost `submap-kind`/world/`arrival` (KB `incident-2026-10-14-region-data-after-create`). New note-folder stores extend `src/stores/NoteFolderStore.ts` (one queue for reads and writes, so a hand edit is read before a write that follows it).
- **Stored formats change only through `src/migrations/`** (owner MG7). Any change to what the plugin stores (data.json keys, map/hex/palette/table/workflow/token/generator note formats, names written into notes) adds a migration file there, one per step, named `v<from>-<what>.ts` (or `map-note-<a>-to-<b>-…`, `unreleased-…`), with its `info` (one-sentence `change`, `recordedBy` flag) and an entry in `registry.ts` — never an upgrade inline in a store or view. Back up before rewriting notes (`src/backup.ts`), keep readers of every old form forever, re-plan notes edited since they were read, and update `tests/migrationGolden.test.ts` when the 1.5.6 upgrade's result changes on purpose. A vault from any released version must still have a path forward. Bump the data stamp (`DATA_FORMAT` in `src/migrations/stamp.ts`) when an older build would misread the new data. Changes are recorded in `migrationsRun` and reported in the upgrade note. Rules and the step list: `src/migrations/README.md`.
- **All modals must extend `HexmakerModal`** (`src/HexmakerModal.ts`) rather than Obsidian's `Modal` directly. `HexmakerModal` is the single place for shared modal behaviour (drag, `place(id, el)` / `section("advanced")` placement, `addIconFilter`). Any functionality needed by more than one modal belongs there, not in `utils.ts` or duplicated across files.
- All modals call `this.makeDraggable()` in `onOpen` (inherited from `HexmakerModal`), which adds the `duckmage-editor-modal-drag` class and locks dragging to the title-bar area. (`FileLinkSuggestModal` is the sole exception — it extends `SuggestModal` and cannot inherit from `HexmakerModal`.)
- **Placement, not feature levels.** Where a control sits (main / more / advanced / debug / hidden) comes from `src/ui/placement.ts`; use `place()` / `section()` (modals, pages) and the settings-tab equivalents. Same concept, same shared control: weights/shares that sum to a whole use `ShareSliders`, single values `ui/sliders.ts`, lists `ui/pickers.ts`, groups `Fold` (`ui/disclosure.ts`).
- **NEVER interleave layout reads (`offsetWidth/Height/Left/Top`, `getBoundingClientRect`, `getComputedStyle`) with DOM writes (`createDiv`/`createEl`/`appendChild`/`setCssProps`/style changes) inside a per-hex loop.** Each read after a write forces a full synchronous layout flush → O(n²) thrash. On large maps (chult = 3843 hexes) this stalled the main thread for ~20s on open (regression in `renderCoordLabelsLayer`, commit 10475fd; fixed by batching). **Pattern:** read ALL geometry into a plain array first, THEN do all DOM writes. The overlay/label builders in `src/hex-map/view/` (`pathOverlay`, `areaShapes`, `gridLabels`, `neighbourShadow`) are the hot path and follow read-then-write — any new one MUST too. Reproduce/validate with `dev/coord-label-thrash-bench.{html,mjs}`.
- **Hit tests live in the drawing's units.** The map's zoom is baked into the grid's font size, so anything placed in em/% follows it but geometry measured in px at render time goes stale. A pointer→cell lookup must re-measure or rescale cached px geometry by the em ratio, and be tested at several zoom factors. Data writers (`createRegion`, `setBiomeAt`, …) refuse coordinates outside the map rather than trusting the UI. (Incident 2026-10-12: region hover said "No region yet" and a click made a region off the map; KB `incident-2026-10-12-region-hit-test-drift`.)
- **Sandboxes are hidden.** Visual and e2e checks run in a throwaway vault via the fresh-eyes `sandbox.mjs` (`C:/Users/markr/work/tools/skills-share/ux-testing/fresh-eyes-tester/scripts/`), which starts Obsidian on its own hidden Windows desktop by default (`--visible` or `SANDBOX_VISIBLE=1` to watch). Never run the plugin against the main vault, never kill Obsidian by name; check `otherObsidianBefore == otherObsidianAfter` after `stop`.

### Obsidian directory review in CI (never via the dashboard by hand)

Every branch push runs Obsidian's automated review (preview scan) in CI, and
master releases are gated on it, then the published release scan is watched
(`.github/workflows/obsidian-review.yml`, `release.yml`, `dev/obsidian-review.mjs`).
**When an "Obsidian review" job fails, follow the Runbook in
`.github/OBSIDIAN_REVIEW.md`**: the failure message names the entry. The
common one is an expired session: the fix is `npm run obsidian:login`
(opens a browser, user logs in if asked, it sets the
`OBSIDIAN_COMMUNITY_COOKIE` secret), then re-run the job. Use
`gh` as `sbuffkin` (`GH_TOKEN=$(gh auth token --user sbuffkin)`) for this repo.

### Obsidian reviewer-bot conventions (enforced beyond what eslint catches)

The obsidianmd reviewer flags patterns the locally-installed
`eslint-plugin-obsidianmd` doesn't have rules for. Watch for these
in any new code; failing these means another bump-and-fix cycle.

- **Keep `eslint-plugin-obsidianmd` AND `typescript-eslint` current.** The
  reviewer bot runs the LATEST versions; stale pins let findings through
  local lint twice on 2026-08-09 (obsidianmd 0.1.9 → 22 `prefer-create-el`
  sites; typescript-eslint 8.58 → 6 unnecessary-assertion sites its newer
  "receiver accepts the original type" check catches). When reviewer
  warnings arrive that local lint missed, first `npm view <pkg> version`
  vs `npm ls <pkg>` for both packages and upgrade.
- **`prefer-create-el` + `@typescript-eslint/no-unnecessary-type-assertion`
  are now enforced locally** (plugin 0.4.1 + type-aware rule in
  eslint.config.mjs). Use `parent.createEl/createDiv/createSpan` (or the
  global `createEl` for genuinely detached elements), never
  `document.createElement`/`activeDocument.createElement`.
- **Settings tab is declarative (Obsidian ≥1.13).** `HexmakerSettingTab`
  implements `getSettingDefinitions()`; on 1.13+ the tab renders FROM THE
  DEFINITIONS and `display()` is never called (it remains only as the
  pre-1.13 fallback). The fallback draws the SAME definitions
  (`display()` → `renderDefinitions`), so a new setting goes in
  `getSettingDefinitions()` only, tagged with its `Settings.<control>`
  placement id, and one placement entry places it on both paths. Local `obsidian` typings are 1.12 — the
  1.13 shapes are mirrored as local interfaces in HexmakerSettingTab.ts;
  delete them when the package is bumped.
- **CSS lint "css-clip-path partially supported" warnings are accepted** —
  our clip-paths are basic `polygon()` hex shapes, fully supported in
  desktop Electron, and the plugin is `isDesktopOnly`. Don't churn on them.

- **`document` / `window` → `activeDocument` / `activeWindow`.** Required
  for popout-window compatibility. Globals are listed in `eslint.config.mjs`.
  Use `activeDocument.createElementNS(...)`, `activeDocument.body.createDiv(...)`,
  `window.setTimeout(...)` is OK but prefer `activeWindow.setTimeout(...)`
  inside view code where popouts could fire it.
- **Dynamic CSS: never `.style.foo = …` or `setCssProps({ transform: … })`.**
  The local eslint rule (`obsidianmd/no-static-styles-assignment`) is
  promoted to an error to catch this. The pattern is: declare the
  `transform` / `opacity` / etc. in CSS using `var(--duckmage-..., default)`
  fallbacks, and write the dynamic values to the custom properties from
  JS. See `.duckmage-bg-image-layer`, `.duckmage-hex-map-grid`,
  `.duckmage-hex-map-viewport` for the canonical examples.
- **`setDynamicTooltip()` is deprecated.** The slider value is now always
  shown inline. Drop the call from any new `.addSlider(...)` chain.
