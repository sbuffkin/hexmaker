# Duckmage Obsidian Plugin



## Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Build**
   - `npm run dev` — watch mode (rebuilds on save)
   - `npm run build` — production build

3. **Install in Obsidian**
   - Copy the entire `plugin` folder into your vault’s `.obsidian/plugins/duckmage-plugin/` (create the folder if needed), **or** symlink this folder there.
   - Ensure these files are present in that folder: `main.js`, `manifest.json`, `styles.css`.
   - In Obsidian: **Settings → Community plugins → Turn on “Duckmage Plugin”** (enable Developer mode if the plugin doesn’t appear).

## Troubleshooting

- **"Failed to load plugin duckmage-plugin"** — Usually means `main.js` is missing. Run `npm run build` in this folder so that `main.js` is generated from `main.ts`. Obsidian loads the compiled JS, not the TypeScript source.
- **Viewing logs** — In Obsidian, press **Ctrl+Shift+I** (Windows/Linux) or **Cmd+Option+I** (Mac) to open Developer tools. Check the **Console** tab for red error messages when you enable the plugin or use its commands.

## Files

| File | Purpose |
|------|--------|
| `main.ts` | Plugin logic (ribbon, commands, settings) |
| `manifest.json` | Plugin id, name, version, min Obsidian version |
| `styles.css` | Plugin styles |
| `versions.json` | Version history for community plugin releases |

After editing `main.ts`, run `npm run dev` or `npm run build` to produce `main.js`.
