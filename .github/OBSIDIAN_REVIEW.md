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

The dashboard has no API tokens, so CI uses a logged-in browser session.
Store its Cookie header as the repo secret `OBSIDIAN_COMMUNITY_COOKIE`:

1. Log in at https://community.obsidian.md in a normal browser.
2. Open DevTools → Network, reload the page, click the first
   `community.obsidian.md` request, and copy the whole **Cookie** request
   header value.
3. Run `gh secret set OBSIDIAN_COMMUNITY_COOKIE --repo sbuffkin/hexmaker` and
   paste the value when prompted. The value stays out of shell history.

When the session expires, the review steps fail with "The Obsidian community
session has expired". Repeat the steps above to fix it. If the secret is
missing, the steps only warn and pass, so forks aren't blocked.

## Running it locally

```bash
OBSIDIAN_COMMUNITY_COOKIE='…' node dev/obsidian-review.mjs preview "$(git rev-parse HEAD)"
OBSIDIAN_COMMUNITY_COOKIE='…' node dev/obsidian-review.mjs release 1.5.5
```

The commit has to be pushed to GitHub first, because the scanner fetches it
from there. Only one scan runs per entry at a time. The script waits and
retries while another one is in progress.
