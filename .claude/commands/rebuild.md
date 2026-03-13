---
description: Build the duckmage plugin (type-check + bundle)
allowed-tools: Bash(npm:*)
---

Current directory: !`pwd`

Run the production build for the duckmage Obsidian plugin:

```
cd /mnt/c/Users/markr/Documents/KB/journal/.obsidian/plugins/duckmage-plugin && npm run build
```

Report the build result clearly:
- If it succeeded, confirm that `main.js` was updated.
- If it failed, show the full error output and identify the likely cause (TypeScript type error, missing import, syntax error, etc.).

Then, regardless of build result, run the test suite:

```
cd /mnt/c/Users/markr/Documents/KB/journal/.obsidian/plugins/duckmage-plugin && npm test
```

Report the test result clearly:
- If all tests passed, confirm the count.
- If any tests failed, show the full failure output and determine whether the code broke an existing behaviour (needs a fix) or the test expectation needs to be updated to match an intentional change.
