# Mobile port: handoff brief

**Branch:** `feat/mobile-scout` (from `origin/feat/wfc-worldgen-research` at `2d3c7ee`). Local
only, not pushed.

**Done so far:** the scout only. `docs/mobile/FEASIBILITY.md` has the verdict, the blocker table
with file:line references, gesture mapping, phased estimates (24–44 days total, 7–12 for a
navigate-and-play first release), risks and the test plan. No code has changed.

## Recommended first 3 tasks

1. **Phase 0 gate (1.5–3 days).**
   - Import `Platform` from `obsidian`. Hide or disable every PDF entry point when
     `!Platform.isDesktopApp`:
     - `src/HexmakerPlugin.ts:139` (command) and `:182` (file-menu)
     - `src/random-tables/RandomTableView.ts:1423`
     - `src/hex-map/HexExportModal.ts:95`
     - `src/random-tables/WorkflowExportModal.ts:109`
     - the map-with-table PDF path (`src/export/exporters/mapWithTable.ts:110`)
   - Add a backstop throw at the top of `exportToPdfBytes` (`src/export/pdfExporter.ts:59`).
   - Make `HexmakerModal.makeDraggable()` (`src/HexmakerModal.ts:10`) a no-op on `Platform.isPhone`.
   - Add `.is-phone` CSS resets for modal min sizes (`styles.css:704-710`, `:3036`, `:3120`,
     `:2270`, `:4001`).
   - Hide bg calibration on mobile.
   - Add `tests/mobileSafe.test.ts` (static source guard; spec in FEASIBILITY "Test plan").
   - Keep `manifest.json` `isDesktopOnly: true` on anything that ships until task 2 is in.
2. **Spike S1/S2 (½–1 day), before the big refactor.** Build a minimal pointer-event pan/pinch
   on `.duckmage-hex-map-clip` with `touch-action: none`. Install it in a **test vault** on a real
   iPhone and Android (BRAT or manual copy). Confirm two-pointer pinch arrives and that Obsidian's
   edge-swipe and pull-down can be stopped. Also try the iOS long-press: no native `contextmenu`
   is expected. Record the results in FEASIBILITY.md.
3. **Pointer-event migration of map input (core of Phase 1).**
   - In `src/hex-map/HexMapView.ts:473-745`, replace the `wheel` / `mousedown` / document
     `mousemove`/`mouseup` / `contextmenu` / `dblclick` handling with pointer events.
   - Put the logic in a DOM-free gesture helper (e.g. `src/hex-map/gestures.ts`, unit-tested like
     `src/worldgen/scrub.ts`).
   - Pinch feeds the existing `pendingZoomLog` / `pendingZoomPivot` → `flushPendingZoom()`
     (`:2969`). Long-press → `Menu.showAtPosition`.
   - Mouse behaviour on desktop must not change: right-drag and middle-drag pan, right-click
     menus, drag-suppressed clicks (`:683-697`).
   - Move `savedViewport` writes (`:356`, `:2772`, `:3090-3096`) to per-device
     `app.saveLocalStorage` so pinches stop rewriting `data.json`.

## Open questions for the user

- First release scope: is "navigate, edit hex notes, roll tables" with paint and path tools
  desktop-only acceptable for v1 mobile?
- Minimum OS: is iOS 16.4+ OK? It is needed for `@property` (pan perf) and `OffscreenCanvas`
  (PNG export).
- Big maps on phones: warn or refuse above ~2,500 hexes until Phase 4, or fund Phase 4
  (canvas/virtualized renderer, 8–15 days) up front?
- Is PDF export on mobile wanted at all? It would need a pure-JS PDF path (+3–5 days).
- OK to move per-map viewport out of `data.json` into per-device local storage? Zoom and pan
  would no longer sync between devices, which is probably what users want.
- Which devices are available for testing (iPhone model, Android model, iPad)?
- Side finding, not mobile: `src/export/pdfExporter.ts:130-160` calls `activeDocument` inside the
  webview's injected script (lint autofix in `1fa2153`). Is desktop PDF export confirmed working?

## Conventions to follow

- Read `CLAUDE.md` and `ARCHITECTURE.md` first. Reviewer-bot rules apply:
  - `activeDocument`/`activeWindow`, not `document`/`window`.
  - No `.style.foo =` / `setCssProps({ transform })` for dynamic values: write `--duckmage-*`
    custom properties and declare the property in CSS.
  - `createEl`/`createDiv`, never `document.createElement`.
  - Any new per-frame custom property on a big ancestor must be registered with
    `@property { inherits: false }` (guarded by `tests/transformVars.test.ts`).
  - Never interleave layout reads and DOM writes inside per-hex loops.
- Every modal extends `HexmakerModal` (shared behaviour goes there, e.g. the phone check in
  `makeDraggable`). Exclude `_`-prefixed notes when enumerating.
- Any setting change goes into **both** `getSettingDefinitions()` and `display()` in
  `src/HexmakerSettingTab.ts`.
- `styles.css` is stored CRLF in git. If you edit it, stage it with
  `git -c core.autocrlf=false add styles.css`. Scripted WSL edits can flip the whole file to LF.
- Tests are tsx + `node:test`, listed explicitly in `package.json` `test` **and** `test:watch`.
  Tests that slice source text must normalise `\r\n` to `\n` first (see `compat.test.ts`,
  commit `8b09ebb`).
- Node tooling lives in WSL:
  `MSYS_NO_PATHCONV=1 wsl.exe -e bash -lc 'cd /mnt/c/... && npm run build'`.
  - Don't run `npm ci`/`npm install` inside a worktree whose `node_modules` is a symlink to
    the main checkout. It wiped the main checkout's `node_modules` once.
  - Run `/rebuild` (type-check + tests + lint) after code changes.
- Don't test on the user's main vault. Use a separate test vault for device work.
