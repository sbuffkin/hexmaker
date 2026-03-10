# Duckmage

An Obsidian plugin for tabletop RPG hex-map world-building. Each hex on the map corresponds to a Markdown note in your vault, letting you attach terrain, locations, and prose directly to the geography of your world.

---

## Features

### Hex Map view
An interactive hex grid rendered as an Obsidian panel.

- **Left-click** a hex to open (or create) its note.
- **Right-click** a hex to open the hex editor.
- **Pan** by clicking and dragging with the left or middle mouse button.
- **Zoom** with the scroll wheel.
- **Expand** the grid with the `+`/`−` buttons in the toolbar.
- **Go to hex** (`⌖` button) — enter coordinates to centre the view on a specific hex.

### Hex editor (right-click menu)
A side-panel modal for editing a hex note without leaving the map.

- **Terrain picker** — select the terrain type for the hex from your palette.
- **Icon override** — override the default terrain icon with any icon in your icons folder.
- **Towns / Dungeons** — link existing notes from their configured folders, or create a new note by name. Linked items are clickable and open in a new tab. Each entry has a remove button. Backlinks are automatically added to the linked note.
- **Features** — free-form wiki-link list for anything else.
- **Encounters Table** — link random table files to a hex. Clicking a linked table opens the Random Tables view with that table pre-selected.
- **Notes sections** — Description, Landmark, Hidden, Secret, Encounters, Weather, Hooks & Rumors — inline text areas with a 🎲 roll button to append a result from any random table.
- **Open note** link next to the hex coordinates opens the full note in a new tab.

### Random Tables view
Open via **Command palette → "Open Duckmage random tables"** or the 🎲 toolbar button on the hex map.

A two-panel view for managing and rolling on random tables.

- **Left panel** — lists all `.md` files in the configured Tables folder. Click a table to load it. **+ New** creates a file from the default template.
- **Right panel** — shows the table's entries with odds (percentage or die range). **Roll** button highlights the winning row and shows the result. The result is editable before use. Roll history shows the last 5 results.
- **Change die** dropdown — updates the `dice:` frontmatter and recalculates die ranges.

### Terrain tables & hex linking
Each terrain type has two auto-generated table files: `{terrain} - description.md` and `{terrain} - encounters.md`, stored under `{tablesFolder}/terrain/`.

> ⚠️ **Configure all folder settings before clicking Generate.** The Generate button (Settings → Duckmage → Generate world data) creates the terrain table files and links each hex note's terrain encounters table into its Encounters Table section. It is safe to run multiple times.

### Drawing tools (toolbar)
Toggle tools from the toolbar above the map. **Double-right-click** off the map to exit any tool.

| Tool | Left-click | Right-click (on hex) |
|------|-----------|----------------------|
| **Terrain** | Paint terrain on a hex (drag to paint multiple) | — |
| **Icon** | Paint an icon override on a hex | — |
| **Road** | Add hex to road chain | Remove hex from road |
| **River** | Add hex to river chain | Remove hex from river |

**Terrain painter extras:**
- Clicking the Terrain button always reopens the palette so you can switch colours mid-session.
- **Pick** (eyedropper) — samples the terrain from the next hex you click and sets it as the active brush.
- **Clear** — paints the "no terrain" state.

Roads and rivers are drawn as connected chains; adjacent chain hexes are joined by a coloured line. Road/river colours are configurable in Settings.

### Hex table view
Open via **Command palette → "Open Duckmage hex table"**.

A scrollable reference table of every hex note, with one row per hex and columns for all sections.

- **Coordinates column** — click to open the hex note.
- **Terrain column** — click to open the terrain picker.
- **Town / Dungeon columns** — click an empty cell to add a link (pick existing or create new); click a populated cell to open the note (or a navigation list for multiple links).
- **Text section columns** (Description, Landmark, etc.) — click any cell (including empty ones) to open an inline editor. Saves directly to the section in the hex note, creating the note and section if they don't exist yet.
- **Resize columns** by dragging the border between column headers.
- **Refresh** button reloads all data from disk.

---

## Settings

Open **Settings → Duckmage** to configure:

| Setting | Description |
|---------|-------------|
| **World folder** | Root folder for world notes (used by the Features file picker). |
| **Hex folder** | Folder where hex notes are stored, e.g. `RPG/world/hexes`. |
| **Towns folder** | Scopes the Towns dropdown to a specific folder. |
| **Dungeons folder** | Scopes the Dungeons dropdown to a specific folder. |
| **Tables folder** | Folder for random table files. Terrain tables are created in a `terrain/` subfolder here. |
| **Default die** | Die size used when creating new table files (d4–d100). |
| **Icons folder** | Folder containing `.png` icon files available as terrain/hex icons. |
| **Template path** | Path to a custom hex note template. Supports `{{x}}`, `{{y}}`, `{{title}}` placeholders. Leave blank to use the built-in template. |
| **Hex gap** | Gap between hexes in pixels. |
| **Grid size** | Number of columns and rows in the map grid. |
| **Hex orientation** | `pointy` (default) or `flat` top hex style. |
| **Road color / River color** | Hex colour values for the road and river overlays. |
| **Terrain palette** | Ordered list of terrain types. Each entry has a name, a colour, and an optional icon filename. Adding a terrain type automatically creates its table files. Renaming a terrain type renames the files too. |
| **Generate** | ⚠️ Configure all folders first. Creates missing terrain table files and links each hex's terrain encounters table into the hex note. |

---

## Hex notes

Each hex note lives at `{hexFolder}/{x}_{y}.md` (e.g. `RPG/world/hexes/3_7.md`).

**Frontmatter:**
```yaml
---
terrain: Forest
---
```

**Sections** (used by the editor and table view):

| Heading | Type | Purpose |
|---------|------|---------|
| `### description` | Text | What the party sees and feels |
| `### landmark` | Text | The standout visible feature |
| `### Towns` | Links | Settlement links |
| `### Dungeons` | Links | Dungeon/site links |
| `### Features` | Links | Other points of interest |
| `### Encounters Table` | Links | Random table links (linked to terrain by Generate) |
| `### hidden` | Text | Discoverable with effort |
| `### secret` | Text | Revealed only through investigation |
| `### encounters` | Text | Encounter table notes |
| `### weather` | Text | Weather notes |
| `### hooks & rumors` | Text | Adventure seeds |

You can use your own template (configured in Settings). Any `### Heading` that matches a section name will be picked up automatically.

---

## Development

```bash
npm install        # install dependencies
npm run dev        # watch mode — rebuilds main.js on every save
npm run build      # production build (type-check + bundle)
npm run version    # bump version (updates manifest.json and versions.json)
```

The built output is `main.js` in the repo root. Obsidian loads this file directly from the plugin folder.

**Reload the plugin after a build:**
```js
// Paste in Obsidian developer console (Ctrl+Shift+I)
app.plugins.disablePlugin('duckmage-plugin');
app.plugins.enablePlugin('duckmage-plugin');
```

### Source layout

```
main.ts                      ← re-exports DuckmagePlugin
src/
  DuckmagePlugin.ts          ← plugin entry point
  HexMapView.ts              ← interactive hex grid (ItemView)
  HexEditorModal.ts          ← right-click hex editor (Modal)
  HexTableView.ts            ← hex reference table (ItemView)
  RandomTableView.ts         ← random tables panel (ItemView)
  RandomTableModal.ts        ← inline roll modal (used from hex editor)
  randomTable.ts             ← parse/roll/odds utilities
  TerrainPickerModal.ts      ← terrain palette picker
  IconPickerModal.ts         ← icon override picker
  FileLinkSuggestModal.ts    ← file search modal
  DuckmageSettingTab.ts      ← settings UI
  types.ts                   ← interfaces and type constants
  constants.ts               ← runtime constants and defaults
  frontmatter.ts             ← terrain/icon YAML read/write
  sections.ts                ← markdown section read/write helpers
  utils.ts                   ← shared utilities
  defaultHexTemplate.md      ← built-in hex note template
```

### Troubleshooting

- **"Failed to load plugin"** — `main.js` is missing. Run `npm run build`.
- **Viewing logs** — Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac) to open the developer console.
