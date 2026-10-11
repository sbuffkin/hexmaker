# UI inventory worksheet (owner tags, 2026-10-11)

Every user-facing input, picker, command and menu item, tagged by the owner:
- keep: as today
- simple: everyone
- advanced: the page's Advanced dropdown
- overkill: Debug, only in debug mode
- drop: removed

Built with the `ui-inventory` skill (`work/tools/skills-share/ux-testing/ui-inventory`).

- `items.json`: the inventory (ids are permanent; `src/ui/placement.ts` is keyed by them)
- `config.json`: the tier scheme and page settings
- `inputs-tags.html`: the worksheet page (serve with `npm run sandbox`, open `/dev/ui-inventory/inputs-tags.html`)
- `submission-2026-10-11.json`: the owner's submission (group picks, own picks, notes)
- `inputs-tags-resolved.json` / `.csv` / `-summary.md`: effective tag per item, with source (own / group / twin)

To review again, run the skill's `build-page.mjs` with `items.json` + `config.json` and load the last submission as progress, so the owner starts from these answers. Then apply the new resolved tags to `src/ui/placement.ts`.

KB: `knowledgebase/projects/duckmage-plugin/notes/impl/audit-inputs-2026-10-11.md`.
