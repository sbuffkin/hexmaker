# Migrations

Every change to how the plugin stores data comes with a migration here: one
file per step, named by the version (or format) it upgrades from, plus
`registry.ts`, which lists them in the order a start-up runs them.

Rules (CLAUDE.md, "Stored formats"):

- A change to anything the plugin stores (data.json, map notes, hex notes,
  palette notes, tables, workflows, tokens, generators…) adds a file here.
  Never an inline upgrade in a store or view.
- A step looks at the data, not at the version that wrote it, so a vault
  from any released version has a path forward: every older step still runs
  when its data is there.
- Back up before rewriting notes (`src/backup.ts`, gzipped JSON with each
  note's full text under `<plugin>/backups/<kind>-<date>/`). No backup, no
  change: the step isn't recorded and runs again next start.
- Readers stay forgiving forever: old keys, columns and spellings are still
  read after the rewrite (a note can come back from a device on an older
  build). The readers live with the parsers; the files here are the
  one-time rewrites.
- Hand edits are never lost: rewrite only what the step owns, re-plan a note
  that changed since it was read, leave what can't be read as it was and say
  so.
- Never impose structure on a user's maps (no "fixing" links or loops the
  user made).
- Each step declares `info` (types.ts): id (= file name), from, to, phase,
  `change` (one short sentence, used in the changelog and the upgrade note)
  and `recordedBy` (the data.json flag that says it ran).
- Add a test: a unit test of the step, and update the golden upgrade
  (`tests/migrationGolden.test.ts`) when the 1.5.6 result changes on purpose.

## Phases and steps

Start-up runs the phases in this order. The palettes and maps phases run
inside their stores (PaletteStore.attach, MapStore.init) at the points
named in each file; settings, notes and tables run from `registry.ts`.

| Phase | Step (file) | From → to | Recorded by |
| --- | --- | --- | --- |
| settings | `v1.0.26-settings-regions-to-maps` | 1.0.26 → 1.0.27 | every load |
| settings | `unreleased-drop-table-ranges-prompt` | unreleased → 1.6 | every load |
| settings | `v1.2-road-river-chains-to-path-chains` (via compat.migrateMapData) | 1.2 → 1.3 | every load |
| settings | `v1.0-flat-hex-notes-to-default-map` | 0.x → 1.0 | every load (hexes folder only) |
| palettes | `v1.5-path-types-explicit` | 1.5.x → 1.6 | `pathTypesExplicit` |
| palettes | `v1.5-palettes-to-notes` | 1.5.x → 1.6 | `palettesMigrated` |
| palettes | `v1.5-palette-colors-as-code` | unreleased → 1.6 | `paletteColorsCode` |
| palettes | `v1.5-palette-path-types` | 1.5.x → 1.6 | every load |
| palettes | `v1.5-palette-terrain-types` | 1.5.x → 1.6 | `terrainTypesSeeded` |
| palettes | `v1.5-palette-data` | 1.5.x → 1.6 | `paletteDataUpgraded` |
| maps | `v1.5-map-data-to-map-notes` | 1.5.x → 1.6 | a map note existing |
| notes | `v1.5-hex-map-key` | unreleased → 1.6 | `noteFormatUpgrades: hex-map-key` |
| notes | `v1.5-hex-body-lines` | 1.5.x → 1.6 | `noteFormatUpgrades: hex-body-lines` |
| notes | `v1.5-note-links` | 1.5.x → 1.6 | `noteFormatUpgrades: note-links` |
| notes | `v1.5-ref-links` | 1.5.x → 1.6 | `noteFormatUpgrades: ref-links` |
| tables | `v1.0-flat-terrain-tables-to-subfolders` | 0.x → 1.0 | every terrain-table check |
| tables | `v1.5-table-roll-ranges` | 1.5.x → 1.6 | `tableRangesUpgraded` |

`noteRewrites.ts` is the runner for the notes phase: a new rewrite of notes
is a `NoteRewrite` (plan the vault, re-plan one note) in its own file, added
to `NOTE_REWRITES`.

Not here, on purpose:

- Map notes upgrade their own older formats (`hexmaker-map: 1`–`4`) on
  their next write, after a backup (MapStore + mapNote.ts): that is the map
  note's reader and writer, which must read every format forever.
- Content updates to shipped palettes (new preset terrains, new path-type
  fields: `palettes/presetUpdates.ts`) add content rather than change a
  format.
- Modules own the upgrades of their own notes and run them from their
  runtime (the core never imports a module): World maps fills overworlds'
  Biome column once (BC1, `overworld/overworldPass.ts`, `biomeColumnsFilled`);
  Space upgrades World types tables when read (`space/WorldTypeStore.ts`).
