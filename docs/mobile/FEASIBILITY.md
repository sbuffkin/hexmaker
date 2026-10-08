# Mobile feasibility: Hexmap World Creator on Obsidian mobile

Scout date: 2026-10-08. Branch `feat/mobile-scout`, cut from `origin/feat/wfc-worldgen-research`
at `2d3c7ee`. Read-only research; nothing was built or run on a device. Community issue #20.

## Verdict

Feasible, and cheaper than issue #20 assumed. There are no Node or Electron imports anywhere in
`src/` or `packages/`: the built bundle requires only `obsidian`, all vault I/O goes through
`app.vault`, icons are bundled as data URLs, and every path is vault-relative with `/`. The one
true platform blocker is PDF export, which runs Electron's `<webview>.printToPDF()`. It has to be
hidden on mobile. Markdown and PNG export can stay. The real work is input: `HexMapView` has no
touch or pointer handling at all. Pan, paint strokes, token drag and bg calibration are built on
`mousedown`/`mousemove`/`mouseup`, zoom on `wheel`, and much of the UI on right-click,
middle-click, dblclick and hover. A phone sends none of these for a drag. Ship it in two steps.
First, a **navigate-and-play build** (pan, pinch, tap a hex to open the editor, long-press menu,
tables and workflows), with PDF and bg calibration desktop-only. Then **touch editing** (paint,
paths, tokens). Big maps like chult (3,843 hexes) are the open performance question. Gate or warn
on them until a canvas or virtualized renderer exists. Do not aim for full parity in one go.

**Effort:** about 7–12 engineer-days to a usable phone/tablet release (Phases 0–1). About 24–44
engineer-days for everything, including touch editing, generator/export polish and a big-map
renderer.

## Hard blockers and platform issues

Severity: **blocker** = crashes, hangs or can't load on mobile. **degraded** = works badly or a
feature is unreachable. **cosmetic** = looks wrong but is usable.

| Item | Where | Severity | Mobile approach |
|---|---|---|---|
| `isDesktopOnly: true` stops the plugin loading on mobile at all | `manifest.json:12` | blocker | Flip to `false` only after Phase 0 lands. |
| PDF export uses an Electron `<webview>` plus `printToPDF()`. On mobile the element never fires `did-finish-load`, so every PDF export hangs for 10 s and then throws | `src/export/pdfExporter.ts:65` (webview), `:103` (printToPDF), `:110-128` (10 s timeout) | blocker (feature) | Gate on `Platform.isDesktopApp`. Hide or disable the PDF choices at every entry point: `HexmakerPlugin.ts:139` (command), `:182` (file-menu item), `RandomTableView.ts:1423`, `HexExportModal.ts:95`, `WorkflowExportModal.ts:109`, plus the map-with-table PDF path (`exporters/mapWithTable.ts:110`). Keep the Markdown variants. Throw a clear error inside `exportToPdfBytes` as a backstop. |
| PNG export canvas size. Chult at the default `hexRadius` 50 comes to roughly 4.8k × 5.3k ≈ 25 MP. iOS WebKit caps canvas area at about 16.7 MP, so this fails or comes out blank | `src/export/mapPngRenderer.ts:148-149` (W/H), `:282` (`new OffscreenCanvas`), `:431` (`convertToBlob`) | degraded | On mobile, clamp `hexRadius` so `W*H` stays at or under 16 MP, and tell the user. Feature-detect `OffscreenCanvas` (iOS 16.4+) and fall back to an `HTMLCanvasElement` plus `toBlob`. |
| Possible existing desktop bug: the webview inject script calls `activeDocument`, which is an Obsidian global, inside the webview's own page (a lint autofix in `1fa2153`) | `src/export/pdfExporter.ts:130-160` (e.g. `:149`) | unknown (desktop) | Not mobile-specific. Check that desktop PDF export still works. If not, use a plain `document` inside the injected string with an eslint-disable comment. |
| `makeDraggable()` forces `position: fixed` and px `left`/`top` on every modal, which overrides Obsidian mobile's full-screen modal layout and soft-keyboard handling. Dragging is mouse-only | `src/HexmakerModal.ts:21`, `:30-38`, `:40-58` | degraded | Return early on `Platform.isPhone`. On tablet, keep it but switch to pointer events. Every modal gets this through `HexmakerModal`, so it is a one-place fix. |
| Modal minimum sizes are wider than a 390 px phone: draggable modal `min-height: 420px`, roll modal `min-width: 380px`, table editor `min-width: 420px`, link/faction pickers `320px` | `styles.css:704-710`, `:3036`, `:3120`, `:2270`, `:4001` | degraded | Reset these under `.is-phone` (Obsidian puts it on `body`). |
| Map pan, zoom and paint are mouse-only: zero touch or pointer listeners in `HexMapView` | `src/hex-map/HexMapView.ts:473-503` (wheel), `:518-580` (mousedown), `:620-680` (document mousemove/mouseup) | blocker (UX) | Move to pointer events (see the interaction table). On a touch drag the browser sends `pointercancel`/scroll instead of mouse events. |
| Zoom "bake" relayouts the whole grid and **writes `data.json`** 80 ms after every zoom settle (when the map has no bg image) | `HexMapView.ts:2991-3016`, `:3027-3096` (`saveSettings` at `:3096`) | degraded (perf + sync) | Every pinch would trigger a full-grid relayout and a synced settings write. On mobile, debounce longer (~300 ms). Store `savedViewport` per device with `app.saveLocalStorage`, not in `data.json`. |
| Viewport also saved to `data.json` on map switch and view close | `HexMapView.ts:356`, `:2772-2778` | degraded (sync) | Same per-device storage. Two devices on the same map otherwise fight over `savedViewport`, and each sync fires `onExternalSettingsChange` → `refreshHexMap()` (`HexmakerPlugin.ts:494-501`), which is a full re-render. |
| `@property { inherits: false }` transform vars are the pan-perf fix | `styles.css:134-145` | degraded on old iOS | Supported on iOS/Safari 16.4+ and Android Chrome 85+. On older WebKit the vars inherit and pan goes back to the measured ~435 ms/frame on chult. Set a floor (iOS 16.4) or accept it. |
| `@container` query for the generator page | `styles.css:5233-5264` | fine | iOS 16+. The 760 px breakpoint already gives a one-column layout, which is what a phone needs. |
| Bg image calibration: mousedown-drag on image, grid and handles, wheel to scale, arrow keys and Escape | `HexMapView.ts:2357`, `:2429`, `:2537`, `:2620-2663` | degraded | Desktop-only at first (hide the "Calibrate" entry on mobile). Touch calibration comes later in Phase 3. |
| HTML5 drag-and-drop reorder/move (terrain, path, icon pickers; table-editor rows; workflow steps; move table to folder) | `TerrainPickerModal.ts:156`, `PathPickerModal.ts:180`, `IconPickerModal.ts:127`, `RandomTableEditorModal.ts:231`, `WorkflowEditorModal.ts:333`, `RandomTableView.ts:1130` / `:201` | degraded | Touch DnD support varies (iOS 15+ partial, Android WebView uncertain). Add explicit up/down or "Move to…" actions on mobile rather than relying on DnD. |
| File drop zones (icon import, bg image) | `IconPickerModal.ts:255`, `MapModal.ts:511` | degraded | You can't drop files on mobile. The icon picker already has a file input (`IconPickerModal.ts:240`). Add one for the bg image. |
| Hover-only controls | `styles.css:1438` (shrink button), `:1829` (icon hide), `:1006`/`:1023` (terrain edit grip/pencil), `:3024` (copy-row button), `:4101` (faction edit) | degraded | Under `.is-mobile` or `@media (hover: none)`, always show them, at reduced opacity. |
| Clipboard writes | `RandomTableModal.ts:217`, `RandomTableView.ts:956` / `:1614` / `:1638` / `:1776`, `RollerBlock.ts:80`, `WorkflowWizardModal.ts:127` | cosmetic / unknown | `navigator.clipboard.writeText` normally works inside Obsidian mobile. Check once on iOS. |
| Inline `.style.*` writes (`fontSize`, tooltip `left`/`top`, swatch colour, PainterContextMenu position) | `HexMapView.ts:3020`, `:3058`, `:3340-3344`; `PainterContextMenu.ts:26-27`, `:55-57` | cosmetic | Not a mobile blocker, but these break the reviewer convention in CLAUDE.md. Fix any you touch. |
| Bundle and target | `esbuild.config.mjs:30` (`es2018`). Built `main.js` ≈ 1.3 MB and only requires `obsidian` | fine | Startup parse on a phone is ~2–4× desktop. Optional: lazy-load the export and worldgen modules (perf plan Tier 2 #7). |
| Icon and resource URLs | `utils.ts:54-62`, `HexMapView.ts:2321` (`adapter.getResourcePath`) | fine | `getResourcePath` exists on the mobile adapter. Bundled icons are data URLs (`bundledIcons.ts`). |

Checked and clean: no `fs`, `path`, `child_process`, `electron`, `require()`, `process`, `Buffer`,
`window.require`, `FileSystemAdapter`, `basePath`, `shell` or popout APIs in `src/` or
`packages/hex-wfc/src/`. The `Buffer` hits are only `ArrayBuffer` / `blob.arrayBuffer()`. The
popout handling (issue #32: element-level listeners, the view `Scope` for undo) is harmless on
mobile.

## Interaction mapping

| Desktop gesture (where) | Proposed touch gesture | Conflicts / notes |
|---|---|---|
| Left-drag pan, no tool (`HexMapView.ts:580-589`) | One-finger drag | Needs `touch-action: none` on `.duckmage-hex-map-clip`, otherwise the webview scrolls or bounces. Obsidian's edge-swipe sidebars can start from the screen edge. Stop propagation of `touchstart` / `touchmove` from the clip, then test (spike S2). |
| Middle-drag / right-drag pan (`:520-547`) | Two-finger drag | Same as above. |
| Wheel zoom about the cursor (`:473-503`) | Pinch about the midpoint. Feed `pendingZoomLog` and `pendingZoomPivot`, which `flushPendingZoom()` (`:2969`) already uses | Pinch-to-zoom of the whole webview is off in Obsidian. Confirm we get the raw two pointers (S1). |
| Left-click a hex → `HexEditorModal` (`:3317`, `:3565-3611`) | Tap | Already works: a tap sends a synthetic `click`. The drag-suppress capture handler (`:683-697`) must keep working once pan uses pointer events. |
| Right-click a hex → context menu (`:3323`, `:3426-3562`, `showAtMouseEvent`) | Long-press (~500 ms, cancel on >8 px movement), then `menu.showAtPosition` | Android WebView sends `contextmenu` on long-press. iOS WKWebView does not, so build our own long-press timer and ignore the native event while it's armed. Set `-webkit-touch-callout: none` and `user-select: none` on hexes. |
| Right-click with a tool active → painter menu (`:701-729`, `PainterContextMenu.ts`) | Long-press, or a "tool options" button in the toolbar (more discoverable) | `PainterContextMenu` items fire on `mousedown` (`:39`), which a tap synthesizes, but late. Switch to `click`. |
| Right-click in GM icon mode removes one icon (`:712-724`) | Use the erase toggle (already in the painter menu). Long-press on a hex removes one | Same long-press detector. |
| Left-drag paint stroke for terrain, icon, faction, region (`:549-578`, `:616-640` with `elementFromPoint`) | One-finger drag paints, two fingers pan, while a paint tool is active | `elementFromPoint` works fine with pointer coordinates. Needs `setPointerCapture` or document-level pointer listeners. |
| Hover brush preview (`:594-611`) | Show only during the stroke | No hover on touch. |
| Path tool: click to extend, dblclick to finish (`:1737-1742`) | Tap to extend. A "Done" button in the toolbar finishes | Double-tap → `dblclick` is unreliable on WebKit and also fires two `click`s first. |
| Dblclick off-grid exits terrain/icon mode (`:733-744`) | "Done" button, or tap the active tool button again | As above. |
| Ctrl/Cmd+click opens submap in new tab (`:3597-3609`) | Context menu "Open submap" (already exists, `:3464-3471`) | Nothing new needed. |
| Middle-click opens table / random-tables view in new tab (`:763`, `:789`; `RandomTableView.ts:149`, `:160`, `:788`, `:1115`; `HexTableView.ts:772`) | Plain tap (same tab). Optionally a long-press menu "Open in new tab" | No middle button. |
| Mod+Z / Mod+Shift+Z (`:438-448`) | Existing undo/redo toolbar buttons (`:832`, `:842`) | Make sure they're visible in the phone toolbar layout. |
| Faction tooltip on `mouseenter` (`:3328-3346`) | Tap shows it in the hex editor, or long-press shows a tooltip | No hover. |
| Token drag (`:5849`, `:5963-5964`) and token right-click menu (`:5841`) | Pointer-event drag. Long-press → token menu | Token drag must win over map pan: `stopPropagation` on pointerdown, as the mouse path does now. |
| Expand-group shrink button shows on hover (`styles.css:1438`, `HexMapView.ts:1189`) | Always visible on mobile | — |
| Hex table column resize (`HexTableView.ts:944`) | Pointer events, or leave fixed widths on phone | — |
| Terrain filter right-click = exclude (`TerrainFilterModal.ts:62`, `:99`) | Tap cycles include → exclude → off | — |
| HexEditorModal GM icon tile right-click = remove one (`HexEditorModal.ts:607`) | Long-press, or a small "−" badge | — |
| Map list right-click menu (`MapModal.ts:254`); random-tables tree right-click (`RandomTableView.ts:799`, `:1109`, `:1126`) | Long-press, or a "⋯" button per row | — |
| Generator scrub inputs: drag up/down or wheel (`src/worldgen/scrub.ts:56-110`) | On `pointerType === "touch"`, don't scrub. A tap focuses the input for typing | A vertical drag on a field in a scrolling page should scroll the page. Scrubbing would fight that and get `pointercancel`. |
| Generator path-row hover highlight (`GeneratorPanel.ts:731-738`) | Tap a row to toggle the highlight | — |
| Modal title-bar drag (`HexmakerModal.ts:40`) | None on phone (full-screen modals). Pointer events on tablet | — |
| Calibration arrow keys, Escape, wheel scale (`HexMapView.ts:2620-2663`) | Phase 3: one-finger drag moves, pinch scales the focused layer, Lock button exits | Desktop-only until then. |

Obsidian mobile gestures to watch: swipe from the left/right edge opens the sidebars, a
pull-down at the top runs the configured action (command palette by default), and swiping the
bottom bar switches tabs. Obsidian's own Canvas and Excalidraw take over pans inside their views,
so it can be done. Spike S2 confirms which events we have to stop.

## Performance on mobile hardware

Desktop figures from the 2026-10-06 pass (`plan-perf-pass-2026-06.md`) on chult (63×61 = 3,843
hexes, ~13.7k elements):

- Pan/zoom frames are compositor-only (the transform is on the viewport, and `@property
  inherits:false` stops descendant restyles). Desktop runs at 60 fps, and phones should mostly
  keep that, because the work is GPU compositing rather than layout. Two risks. First, iOS caps
  layer/tile memory, so a huge zoomed-out layer with `will-change` can get re-rastered or go
  blank. Second, with no bg image, every zoom settle "bakes" `font-size`, which is a full layout of
  every hex plus an overlay rebuild (`HexMapView.ts:3027-3099`). Desktop layout floor is about
  70 ms. Expect 250–500 ms on a mid-range phone, so a visible hitch after each pinch.
- `renderGrid` is ~260 ms on desktop. Assume 3–6× on mobile WebKit or a mid-range Android, so
  0.8–1.6 s per full render. `renderGrid` has many callers (29 at the last count, some since made
  incremental). Every one of them would be a stall on chult.
- Rough expectation, to confirm in spike S3: maps up to ~30×30 (~900 hexes) should be fine on
  current phones with the DOM renderer. 50×50 is borderline. Chult-sized needs Phase 4.
- Phase 4 options, cheapest first. (a) Warn on mobile above ~2,500 hexes. (b) Hex virtualization:
  only create DOM for hexes near the viewport, the same approach as the coord-label
  virtualization already shipped. (c) A canvas terrain layer with DOM kept only for the selected
  or hovered hex and the overlays. That is the "next lever" in the perf notes. (c) is the big one,
  because paths, faction/region SVG, tokens, GM icons and bg calibration all currently sit on DOM
  hex geometry (`centerMap` built from `offsetLeft`/`offsetTop`).
- Map creation and the generator write one note per hex: `generateHexNotes`
  (`HexmakerPlugin.ts:1257-1286`) and `writeTerrain` (`src/worldgen/generators.ts:332-357`), in
  chunks of 20 concurrent writes. About 19 ms per file on desktop means ~70 s for chult. The
  mobile adapter goes through the native bridge, so expect 2–5× that (several minutes). The
  screen may lock and the OS may suspend the app mid-write. On mobile, cap or warn on size, keep
  the progress UI, and make the batch resumable (both writers already skip existing notes). Hex
  notes are optional for rendering, so lazy creation on first edit is a real option.
- The WFC solver is fast. The KB measured 60×60 at 50–100 ms in node. It runs synchronously
  (`generators.ts:272`). On a phone that's ~0.3–0.5 s of main-thread block, which is acceptable.
  If needed, move it to a Worker: `packages/hex-wfc` is pure TypeScript with no DOM.
- Metadata-cache lag: after bulk writes, the pending-terrain cache in `src/frontmatter.ts:110-128`
  covers the window before the cache indexes the new notes. Mobile indexing is slower, so the
  window is longer. That's fine: entries clear on the `metadataCache` `changed` event
  (`HexmakerPlugin.ts:53`), not on a timer, so slower indexing only keeps them alive longer.
  Don't add timer-based clearing.
- Sync churn: `saveSettings()` is called from 98 sites and rewrites the whole `data.json`, which
  holds all map data (paths, palettes, grid, overlays, viewport). With Obsidian Sync or iCloud,
  edits on two devices are last-writer-wins for the whole file. Moving `savedViewport` to
  per-device storage removes the noisiest writer. Real conflict safety would mean splitting map
  data into per-map files, which is out of scope here. Note it for the user.

## Layout and UI on small screens

- Phone (~390 px):
  - Map toolbar. Top-row buttons plus the drawing/overlay side panels (`.duckmage-side-panel`,
    absolute, `top: 44px`, `styles.css:69-82`) will overlap. Make the panels bottom sheets or
    full-width drawers under `.is-phone`, and enlarge hit targets to ≥ 44 px.
  - Modals. Drop the minimum sizes and dragging (see the blocker table). HexEditorModal is the core
    play surface. It is long but collapsible, so it should work full-screen.
  - Random tables view (`styles.css:2520-2530`): the fixed 220 px left tree leaves ~170 px for the
    detail pane. Stack the tree above the detail with an `@container` rule on the view, or make
    the tree a collapsible drawer.
  - Hex table view: 14 columns with `table-layout: fixed` (`styles.css:2032-2034`). Horizontal
    scroll works but is clumsy. The 10+ filter toolbar (`:1944`) needs to wrap or collapse. Low
    priority: a tablet feature.
  - Generator page already goes to one column below 760 px (`styles.css:5264`), with the preview
    pinned at `max-height: 45vh`. Check the canvas preview width (`preview.ts`, `maxWidth = 420`)
    scales down.
  - Setup wizard: plain form, should be OK. Check once.
- Tablet (~768–1024 px): mostly the desktop layout. The main issues are input (no right-click or
  hover) and the soft keyboard covering fixed-position modals.

## Data compatibility

Same data, unchanged:

- Hex notes are `{hexFolder}/{map}/{x}_{y}.md` built with `/` (`HexmakerPlugin.ts:638-643`).
  Coordinates may be negative (`-3_5.md`), which is valid everywhere.
- File names from user input are sanitized of `\/:*?"<>|` (`utils.ts` `importBinaryFileToVault`,
  exporters' `sanitiseFilename`).
- No absolute paths, `basePath`, or OS separators anywhere.
- Frontmatter, sections, generator/save markdown (`src/worldgen/saveFormat.ts`) and `data.json`
  are plain text and JSON, with no platform-specific fields. `compat.ts` version stamps are
  build-time constants.
- One caveat: iOS and macOS file systems are case-insensitive by default and Android's are not.
  Two map or table names differing only in case would collide on iOS. Edge case, not a blocker.
- `onExternalSettingsChange` already reloads settings and re-renders when sync delivers a new
  `data.json` (`HexmakerPlugin.ts:494-501`). Good, but a full re-render is expensive on mobile
  (see Performance).

## Settings tab

Both paths, declarative `getSettingDefinitions()` (`HexmakerSettingTab.ts:147`, Obsidian ≥ 1.13)
and the `display()` fallback (`:133`), use only text, number, slider, toggle, dropdown, color,
list and buttons. All of these are standard Obsidian components that render on mobile. Nothing
refers to the OS file system. Notes:

- Palette editing opens `TerrainEntryEditorModal` and similar modals, so it gets the modal
  fixes for free.
- The "Generate terrain tables & hex links" and "Generate folders" buttons do bulk vault writes.
  Add a progress or "keep the app open" notice on mobile.
- No desktop-only setting exists today. When PDF export is gated, any PDF defaults (page size and
  so on, if added later) should be hidden on mobile, in **both** the declarative and `display()`
  paths, as CLAUDE.md requires.

## Phased plan

Estimates are engineer-days for someone who knows the codebase. Three things drive the ranges.
How much Obsidian mobile's own gestures interfere (spike S2). Whether iOS needs a custom
long-press everywhere (likely). And for Phase 4, whether the overlays have to move off DOM
geometry.

| Phase | Scope | Days |
|---|---|---|
| **0. Hard blockers + mobile gate** | `Platform.isDesktopApp` gating for all PDF entry points, with a backstop throw in `exportToPdfBytes`. `HexmakerModal.makeDraggable` no-op on phone. Phone CSS resets for modal min sizes. Hide bg calibration on mobile. PNG canvas-area clamp. A static guard test (see Test plan). Flip `isDesktopOnly` to `false` **only on a branch** until Phase 1 is in. | 1.5–3 |
| **1. Navigate and play** | Map input moves to Pointer Events (`HexMapView.ts:473-745`): one-finger pan, pinch zoom, tap, long-press context menu, `touch-action`, stopping Obsidian's swipe gestures. Per-device `savedViewport` and a longer bake debounce on mobile. Phone toolbar and side-panel layout, 44 px targets, hover-only controls made visible. Random tables view stacked layout. Hex editor full-screen pass. Help modal (`src/help.md`) touch section. | 5–9 |
| **2. Touch editing** | Paint strokes (one finger paints, two pan). "Done"/tool-options buttons replacing dblclick and right-click. Path tool. Token drag and menu. GM remove-one. Terrain filter tri-state. Reorder fallbacks for the 6 DnD sites. Bg image file input. Long-press menus in random-tables, map list and hex editor. | 6–10 |
| **3. Generator page + exports** | Touch-mode scrub (tap to type). Path-row tap highlight. Preview sizing. PNG export on iOS (non-Offscreen fallback, area clamp, tiles if needed). Bulk-write UX (warnings, resumable progress). Touch bg calibration (drag/pinch, Lock), optional. PDF stays desktop-only unless a pure-JS PDF path is wanted (+3–5 days, not included). | 4–7 |
| **4. Big-map performance** | Measure on devices first. Then hex virtualization or a canvas terrain layer, with overlays (paths, faction/region, tokens, GM, coord labels) re-plumbed onto computed geometry instead of `offsetLeft`/`offsetTop`. Incremental updates so fewer callers need a full `renderGrid`. Desktop benefits too. | 8–15 |
| **Total** | | **24–44** |

A sensible first release is Phases 0 + 1 (7–12 days), shipped as "mobile: view, navigate,
edit hex notes, roll tables". Editing tools stay desktop-only and are hidden on mobile.

## Risks and unknowns, with cheap ways to resolve them

| # | Risk | Cheap resolution |
|---|---|---|
| S0 | Something mobile-only breaks at load | Desktop dev console: `app.emulateMobile(true)` (and `app.emulateMobile(false)` to undo). It turns on Obsidian's mobile UI (`Platform.isMobile`, `body.is-mobile` / `.is-phone`, mobile toolbar, full-screen modals) inside desktop Electron. **What it catches:** layout and CSS under `.is-mobile`, code paths branching on `Platform.isMobile`, modal sizing. **What it misses:** WebKit engine differences (iOS), real touch and multi-touch, iOS long-press and `contextmenu` behaviour, canvas size limits, CPU/memory, the Capacitor vault adapter (desktop keeps the Node adapter, so a stray `fs` import would still work there), soft-keyboard viewport changes, and Obsidian's swipe gestures. Pair it with DevTools device mode (touch emulation, single pointer only) and CPU throttling at 4–6×. |
| S1 | Pinch on the transformed viewport: do we get two pointers, or does the webview or Obsidian eat the gesture? | Half-day spike. Minimal pointer handler (`touch-action: none` on the clip, log `pointerdown`/`pointermove` with `pointerId`) on a real iPhone and Android, loaded via BRAT or a manual copy into a **test vault** (not the user's main vault). |
| S2 | Obsidian edge-swipe / pull-down conflicts | Same spike: start pans at the screen edges and the top. Try `stopPropagation` on `touchstart`/`touchmove` at the clip. |
| S3 | Big-map performance on real hardware | Load `dev/real-map-bench.html` (chult DOM snapshot) in iOS Safari and Android Chrome. Measure pan fps and the bake/re-render hitch. Note: `npm run sandbox` / `dev/serve.mjs` is not on this branch, and serving to a phone means binding to the LAN, which needs the user's OK. Alternative: Chrome remote debugging with the phone over USB. |
| S4 | iOS long-press and `contextmenu`, text-selection callouts | Covered by S1's test page: add a 500 ms timer plus `-webkit-touch-callout: none`. |
| S5 | HTML5 drag-and-drop on Android WebView | One test of `TerrainPickerModal` reorder. If it fails, use the up/down fallback (already planned). |
| S6 | `OffscreenCanvas` / `convertToBlob` and the 16.7 MP limit on iOS | Export a small map, then a chult-sized one, on an iPhone. |
| S7 | Soft keyboard covering inputs in fixed modals | Check on the device once `makeDraggable` is disabled on phone. |
| S8 | Sync conflicts on `data.json` | Two devices with Obsidian Sync, pan and edit paths on both, and watch for lost path chains. If it's bad, add per-map data files to the roadmap. |
| S9 | App suspended mid bulk write (map create, generator fill) | Create a 40×40 map on a phone, lock the screen halfway through, and confirm resume or skip-existing behaviour. |

## Test plan

**Automated.** The repo runs tsx + `node:test`, with tests listed explicitly in
`package.json` `"test"`. New files must be added to both `test` and `test:watch`.

- New `tests/mobileSafe.test.ts`, a static guard over `src/**/*.ts` and `packages/*/src/**/*.ts`:
  - No imports of Node built-ins or `electron`.
  - No `require(`, no `window.require`, no `FileSystemAdapter` / `basePath`.
  - `printToPDF` or `"webview"` only in `src/export/pdfExporter.ts`.
  - Every call to `export*AsPdf` sits in a file that also references `Platform.isDesktopApp`.
  - Normalize `\r\n` to `\n` before slicing source text (see `compat.test.ts` and `8b09ebb`).
- Extend `tests/worldgenScrub.test.ts` for the touch rule (a `pointerType: "touch"` press focuses
  instead of scrubbing). Keep the helper pure so it can be tested without a DOM.
- New pure helpers with unit tests:
  - A gesture recognizer (pointer list → pan / pinch factor and pivot / long-press / tap).
    Keep it DOM-free, like `scrub.ts`'s `scrubValue`.
  - The PNG area clamp (`clampHexRadius(W, H, maxPixels)`).
- Extend `tests/transformVars.test.ts` if new per-frame custom properties are added for gestures.
  They must be `@property inherits:false`.
- Extend `tests/toolSwitch.test.ts` for the new "Done" / tool-options exits.

**Manual on devices** (test vault with a 20×20 map, a 50×50 map, and a copy of chult):

1. iPhone (iOS 17+) and a mid-range Android phone. Plugin loads with no console errors (Obsidian
   mobile → Settings → Community plugins; check logs through Safari Web Inspector or
   `chrome://inspect`).
2. Open the map, then pan, pinch, tap a hex (editor opens), long-press (menu), undo/redo.
3. Open tables and workflows: roll, copy, edit a table, run a workflow, save the result.
4. Confirm PDF options are hidden and Markdown/PNG export writes files into the vault.
5. Edge swipes still open the sidebars when started outside the map, and not when started on it.
6. Rotate the device. Open the soft keyboard in the hex editor.
7. iPad: same list plus the hex table view, and pointer/trackpad (Magic Keyboard sends mouse
   events, so the desktop paths must still work there).
8. Desktop regression: `/rebuild` (type-check, tests, lint), then pan/zoom/paint, right-click and
   middle-pan, because the pointer-event migration touches the same code. Re-run
   `dev/snapshot-bg-hex-alignment.mjs` after any render-path change, as the perf notes require.
