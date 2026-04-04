---
description: Start the duckmage plugin dev watcher (esbuild watch mode)
allowed-tools: Bash(npm:*)
---

Start esbuild in watch mode for the duckmage plugin. This rebuilds `main.js` automatically on every TypeScript file save.

```
cd /mnt/c/Users/markr/Documents/KB/journal/.obsidian/plugins/duckmage-plugin && npm run dev
```

Run this in the background — it is a long-running process. Tell the user the watcher has started, then remind them:
- `main.js` rebuilds automatically on every save to `main.ts`
- To reload the plugin in Obsidian after a rebuild, run:
  `powershell.exe -Command "obsidian plugin:reload id=duckmage-plugin"`
- Or use `/rebuild` instead for a one-off production build (includes type-checking).
