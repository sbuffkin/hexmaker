---
description: Release a new version of the plugin. Follow these steps exactly:
allowed-tools: Bash(npm:*), Bash(git:*)
---

Release a new version of the plugin. Follow these steps exactly:

## 1. Check current version

Read `manifest.json` to confirm the current version number, then confirm with the user what the new version should be (patch / minor / major).

**Important**: `package.json` and `manifest.json` must stay in sync. Set `package.json` to the new version first:

```bash
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = 'X.Y.Z';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t'));
console.log('package.json set to', pkg.version);
"
```

## 2. Bump version

```bash
npm run version
```

This reads the version from `package.json` and writes it into `manifest.json` and `versions.json`, then stages both. Confirm by reading `manifest.json`.

## 3. Build and test

```bash
npm run build && npm test
```

Do not proceed if either fails.

## 4. Commit and push to master

```bash
git add manifest.json versions.json package.json package-lock.json
git commit -m "chore: release X.Y.Z"
git push prod master
```

Replace `X.Y.Z` with the actual version from `manifest.json`.

That's it. Pushing to `master` automatically triggers the GitHub Actions release workflow, which will:
- Detect the new version in `manifest.json`
- Run tests and build `main.js`
- Create a git tag `X.Y.Z`
- Publish a GitHub release with auto-generated changelog and `main.js`, `manifest.json`, `styles.css` attached

---

**Notes:**
- The remote is named `prod` (not `origin`)
- `main.js` is in `.gitignore` — never commit it manually; the CI builds it
- No manual tagging required — the workflow creates the tag automatically
- The release is published immediately (not a draft) with auto-generated release notes
- If you push to master without changing the version, no release is created (idempotent)
