# Obsidian directory review in CI

Obsidian scans every release of the plugin (community.obsidian.md, entry
`hexmaker`, id 3699). From 2026-10-30, a plugin whose latest release fails
that scan gets delisted. CI runs the same scan for us, so nobody has to use
the dashboard by hand:

| When | Workflow | What it does |
|---|---|---|
| push to any branch except master | `obsidian-review.yml` | runs a **preview scan** of the pushed commit and fails on any `Error` finding |
| push to master (new version) | `release.yml`, release job | runs the same preview scan **before** tagging, so a bad version is never published |
| after a release is published | `release.yml`, `obsidian-review` job | clicks "Check for new releases", waits for the release scan, fails and opens an issue if it doesn't pass |

Warnings and recommendations are shown as annotations and in the job
summary, but they don't fail the build. One example is the accepted
`css-clip-path` warning.

The logic is in `dev/obsidian-review.mjs`. The HTML parser is in
`dev/obsidian-review-parse.mjs` and is pinned by
`tests/obsidianReview.test.ts`.

## The session secret

The dashboard has no API tokens, so CI uses a logged-in browser session,
stored as the repo secret `OBSIDIAN_COMMUNITY_COOKIE`. To set or refresh it:

```bash
npm run obsidian:login
```

This opens community.obsidian.md in Chrome (or Edge) with its own saved
profile. Log in if asked; after the first time you usually already are. It
reads the session cookies over the DevTools protocol (they are httpOnly, so
page scripts can't see them) and pipes them to `gh secret set` as the repo
owner. The value never goes through the clipboard or the command line.
`npm run obsidian:login -- --print` prints the Cookie header instead.

When the session expires or the secret is empty, the review steps fail with
a message that says to run `npm run obsidian:login`. On forks, where the
secret doesn't exist, they only warn.

## Running it locally

```bash
OBSIDIAN_COMMUNITY_COOKIE='…' node dev/obsidian-review.mjs preview "$(git rev-parse HEAD)"
OBSIDIAN_COMMUNITY_COOKIE='…' node dev/obsidian-review.mjs release 1.5.5
```

The commit has to be pushed to GitHub first, because the scanner fetches it
from there. Only one scan runs per entry at a time. The script waits and
retries while another one is in progress.
