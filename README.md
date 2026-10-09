# Hexmap World Creator

An Obsidian plugin for tabletop RPG hex-map world-building. Each hex on the map is a Markdown note in your vault — attach terrain, locations, paths, and prose directly to the geography of your world.

![A populated hex map showing multiple terrain types, icons, and drawn paths](docs/Hero.PNG)

---

## What it does

Hexmaker gives you an interactive hex grid that lives inside Obsidian. Paint terrain, draw roads and rivers, link town and dungeon notes to individual hexes, overlay faction and geographic region fills, drill into submaps, roll random encounters, and browse everything in a spreadsheet view — all without leaving your vault. Every hex is a plain Markdown file you own.

### Hex editor

Right-click any hex to open the editor: set terrain, override the icon, link Towns, Dungeons, Features, Quests, Factions, and Encounters Tables, and write freeform notes (Description, Landmark, Hidden, Secret, Weather, Hooks & Rumors). A 🎲 button on each section lets you roll any random table and append the result inline. Link a submap to the hex and click the center dot in the hex flower to dive into it.

![The hex editor showing terrain, links, and notes for a single hex](docs/Editor.PNG)

### Terrain painting

Switch to the Terrain tool, pick a colour from your palette, and drag across hexes to paint. Choose a 1×, 3×, or 7× brush for broad strokes. An eyedropper lets you sample an existing hex's terrain as your active brush.

![Terrain being painted across multiple hexes with the drag brush](docs/TerrainPaint.gif)

### Path drawing

Click the Path button to open the path picker. Select any defined path type — road, river, or anything you've created — then click hexes to lay down a chain. Each type has its own colour, width, line style (solid / dashed / dotted), and routing mode (through hex centres, meandering between them, or tracing hex edges). Edit types at any time from the map toolbar.

![A road path being drawn hex by hex across the map](docs/PathDraw.gif)

### Random tables

A two-panel view for rolling and managing weighted random tables. The left panel shows your tables folder as a collapsible folder tree — the same structure as your vault. Click any table to load it, hit Roll to highlight a result, and see percentage odds for every entry. Create new table files from the toolbar, edit entries inline, and chain tables together into multi-step **workflows** that fill a template note with rolled results.

![Rolling on a random table and seeing the result highlighted](docs/RandomTable.gif)

### Hex table view

A scrollable spreadsheet of every hex note — one row per hex, columns for terrain, description, towns, dungeons, features, quests, factions, encounters table, and all the freeform sections. Click any cell to edit it in place. Filter by map, terrain type, or the presence of specific link types. The ◎ button jumps the map view to that hex's position.

![The hex table view showing a grid of hex notes with populated columns](docs/Table.PNG)

### Faction and region overlays

Paint translucent colour fills over hexes to show political control or geographic regions. Adjacent hexes of the same faction or region merge into smooth blobs with a rendered legend. Toggle overlays from the map overlay panel; overlay state is saved per map.

### GM layer

Toggle the GM layer from the overlay panel to switch between player-facing and GM views. When active, Hidden and Secret sections in the hex editor expand automatically, and hexes with hidden or secret content are highlighted on the map.

---

## Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/sbuffkin/hexmaker/releases/latest).
2. In your vault, create the folder `.obsidian/plugins/hexmaker-plugin/`.
3. Copy the three downloaded files into that folder.
4. In Obsidian, open **Settings → Community plugins**, find **Hexmap World Creator** in the list, and enable it.

---

## Getting started

After enabling the plugin, do this once before you start mapping:

### 1. Set your world folder
Open **Settings → Hexmap World Creator** and enter a root folder name in **World folder** (e.g. `RPG/world`). This is the base for all other folders.

### 2. Generate folders
Click **Generate folders**. This fills in the hex, towns, dungeons, tables, and other folder settings with sensible defaults under your world folder and creates them in your vault. Any field you've already filled in is left untouched.

### 3. Open the Hex Map
Click the map icon in the left ribbon (or use the command palette: **Open Hexmaker hex map**). You'll be prompted to create your first map — give it a name, choose its size, and pick a terrain palette.

### 4. Generate terrain tables
Once your folders are set, go back to **Settings → Hexmap World Creator** and click **Generate terrain tables & hex links**. This creates a description and encounters table file for every terrain type and links them into any existing hex notes. It's safe to run again at any time.

You're ready to start mapping.

---

## Features

### Hex Map view
An interactive hex grid rendered as an Obsidian panel.

- **Left-click** a hex to open (or create) its note.
- **Right-click** a hex to open the hex editor.
- **Pan** by clicking and dragging with the left or middle mouse button.
- **Zoom** with the scroll wheel.
- **Expand** the grid with the `+`/`−` buttons at the map edges.
- **Go to hex** (`⌖` button in the toolbar) — enter coordinates to centre the view on a specific hex.
- **Undo / Redo** (`↩` / `↪` buttons) — step back or forward through terrain and icon paint operations.

### Maps
Organise your world into multiple named hex maps, each stored as a subfolder under your hex folder. The active map name is shown in the top-left of the toolbar as a dropdown button.

- **Switch** — click the map name button to open the maps panel, then click any map in the list to make it active.
- **Create** — enter a name, choose a grid size and terrain palette, then click Create.
- **Rename** — update the name field and click Rename; all hex notes in the folder are moved automatically.
- **Delete** — removes the map and moves all its hex notes to the trash.
- **Terrain theme** — assign a terrain type to a map. The swatch appears next to the map name in the switch list and sets the colour of the submap center dot when this map is linked as a submap from a parent map.
- **Back** (`← Back` button) — returns to the previously active map after following a submap link.

### Hex editor (right-click menu)
A modal for editing a hex note without leaving the map.

- **Terrain picker** — select the terrain type for the hex from the map's palette.
- **Icon override** — override the default terrain icon with any icon in your icons folder.
- **Submap link** — link another map to this hex. The hex flower widget shows a center dot coloured by the linked map's terrain theme. Click the dot to navigate directly to that map.
- **Towns / Dungeons / Features / Quests / Factions** — link existing notes from their configured folders, or create a new note by name. Linked items are clickable and open in a new tab. Each entry has a remove button.
- **Encounters Table** — link random table files to a hex. Clicking a linked table opens the Random Tables view with that table pre-selected.
- **Notes sections** — Description, Landmark, Hidden, Secret, Weather, Hooks & Rumors — inline text areas with a 🎲 roll button to append a result from any random table.
- **Open note** link next to the hex coordinates opens the full note in a new tab.

### Random Tables view
Open via **Command palette → "Open Hexmaker random tables"** or the 🎲 ribbon button.

A two-panel view for managing and rolling on random tables.

- **Left panel** — shows all `.md` files in the configured Tables folder as a collapsible folder tree. Click a folder header to expand or collapse it. Click a table to load it. The filter input at the top narrows results and temporarily expands all folders. **+ New** creates a file from the default template.
- **Right panel** — shows the table's entries with odds (percentage or die range). **Roll** button highlights the winning row and shows the result. The result is editable before use. Roll history shows the last 5 results.
- **Change die** dropdown — updates the `dice:` frontmatter and recalculates die ranges.

### Workflows view
Open via the Workflows tab in the Random Tables panel.

Chain multiple table rolls together into a filled template note.

- **Create a workflow** — define steps (each step rolls a table N times), a template with `$placeholder` variables, and a results folder.
- **Roll a workflow** — each step shows a dropdown and a Roll button. The template fills in live as you roll. Save the result as a new vault note.

### Terrain tables & hex linking
Each terrain type has two auto-generated table files: `{terrain} - description.md` and `{terrain} - encounters.md`, stored under `{tablesFolder}/terrain/`.

> ⚠️ **Configure all folder settings before clicking Generate.** The Generate button (Settings → Hexmap World Creator → Generate world data) creates the terrain table files and links each hex note's terrain encounters table into its Encounters Table section. It is safe to run multiple times.

### Drawing tools (toolbar)
Click the **pencil** icon on the right edge of the map to open the drawing tools panel. **Right-click** off a hex (or click the active button again) to exit any tool. Tools that link or paint items show a **Remove** option at the start of the picker — selecting it enters erase mode so you can click hexes to remove that layer.

| Tool | Left-click | Right-click (on hex) |
|------|------------|----------------------|
| **Terrain** | Paint terrain (drag to paint multiple hexes) | — |
| **Icon** | Paint an icon override | — |
| **Path** | Add hex to the active path chain | Remove hex from chain |
| **Link table** | Add the selected random table to the hex's Encounters Table section | — |
| **Link submap** | Link the selected map to the hex as a submap | Remove submap link |
| **Factions** | Paint a faction colour (drag to paint multiple hexes) | Erase faction from hex |
| **Regions** | Paint a geographic region colour | Erase region from hex |
| **Token** | Open the token creator, then click a hex to place the new token | Cancel placement |

**Terrain painter extras:**
- Clicking the Terrain button always reopens the palette so you can switch colours mid-session.
- **Pick** (eyedropper) — samples the terrain from the next hex you click and sets it as the active brush.
- **Clear** — paints the "no terrain" state.
- **Brush size** — paint 1×, 3×, or 7× hex radius at once.

**Path tool:** Click the Path button to open the path type picker. Select a type to start drawing, or switch to edit mode to create, rename, recolour, or delete path types. Each path type has a name, colour, line width, line style (solid / dashed / dotted), and routing mode:

- **Through** — smooth Bezier curve through hex centres.
- **Meander** — gentle curve through the midpoints between hex centres (good for rivers).
- **Edge** — traces strictly along the hex polygon boundary lines between hexes.

**Link table / Link submap:** Clicking either button opens a picker. For tables, the picker shows your tables folder as a collapsible folder tree with a filter input. For submaps, the picker shows a filterable list of your maps with their terrain theme swatches. Once a table or map is selected, click any number of hexes to link it. The hex flashes a ripple animation on each successful link.

### Overlays (faction and region)
Toggled from the **layers** panel on the right edge of the map.

- **Faction overlay** — paint a faction colour on any hex. Adjacent hexes of the same faction merge into smooth filled blobs with a coloured border. A legend lists each active faction. Edit faction names and colours from the overlay panel. Faction data is stored as wiki-links in each hex note's `### Factions` section.
- **Region overlay** — paint a geographic region colour on any hex. Regions render as filled blobs with a scaled label centred on the blob. Region data is stored in each hex note's frontmatter.
- Both overlays can be shown simultaneously and toggled independently.
- Additional toggles: **Show coordinates**, **Show terrain icons**, **Show icon overrides**, **GM layer**, **Tokens**.

### GM layer
Toggle from the overlay panel. When active:

- Hexes with Hidden or Secret content are visually highlighted.
- The hex editor automatically expands the Hidden and Secret sections when opened.

GM layer state is stored per map and persists across sessions.

### Tokens
Place movable tokens on the map — useful for tracking party position, NPCs, or any note-backed marker.

**Creating a token:**
1. Click the **Token** button in the drawing tools panel.
2. Fill in the token form: choose a note (existing or new), icon, shape (circle / square / hexagon), fill colour, and border colour.
3. Click **Next: place on map**, then click any hex to place the token there.

**Interacting with tokens:**
- **Click** a token to open its info card — shows the linked note title and hex position, with a "Jump to hex" button and an "Open note" link.
- **Drag** a token to a different hex to move it. The target hex is highlighted as you drag.
- **Right-click** a token to edit its properties (icon, shape, colours) or remove it from the map.

Token state is stored in the linked note's frontmatter (`token`, `token-hex`, `token-map`, `token-icon`, `token-shape`, `token-color`, `token-border`, `token-visible`). Tokens follow the map they were placed on and persist with the note.

### Hex table view
Open via **Command palette → "Open Hexmaker hex table"**.

A scrollable reference table of every hex note, with one row per hex and columns for all sections.

- **Coordinates column** — click to open the hex note.
- **Terrain column** — click to open the terrain picker.
- **Town / Dungeon columns** — click an empty cell to add a link (pick existing or create new); click a populated cell to open the note (or a navigation list for multiple links).
- **Text section columns** (Description, Landmark, etc.) — click any cell (including empty ones) to open an inline editor. Saves directly to the section in the hex note, creating the note and section if they don't exist yet.
- **Resize columns** by dragging the border between column headers.
- **Filter** by map, terrain type, or the presence of specific link types using the toolbar controls.
- **Refresh** button reloads all data from disk.

---

## Settings

Open **Settings → Hexmap World Creator** to configure:

| Setting | Description |
|---------|-------------|
| **World folder** | Root folder for world notes (used by the Features file picker). |
| **Hex folder** | Folder where hex notes are stored, e.g. `RPG/world/hexes`. Each map becomes a subfolder here. |
| **Towns folder** | Scopes the Towns picker to a specific folder. |
| **Dungeons folder** | Scopes the Dungeons picker to a specific folder. |
| **Quests folder** | Scopes the Quests picker to a specific folder. |
| **Factions folder** | Scopes the Factions picker to a specific folder. |
| **Tables folder** | Folder for random table files. Terrain tables are created in a `terrain/` subfolder here. |
| **Workflows folder** | Folder for workflow definition files and their templates. |
| **Default die** | Die size used when creating new table files (d4–d100). |
| **Icons folder** | Folder containing `.png` icon files available as custom terrain/hex icons. |
| **Template path** | Path to a custom hex note template. Supports `{{x}}`, `{{y}}`, `{{title}}` and `{{map}}` placeholders. Leave blank to use the built-in template. |
| **Hex gap** | Gap between hexes in pixels. |
| **Hex orientation** | `flat` (default) or `pointy` top hex style. |
| **Path types** | Named path types used by the Path drawing tool. Each type has a name, colour, width, line style, and routing mode. Manage them from the Path button on the hex map toolbar. |
| **Palettes folder** | Folder holding one note per terrain palette (default `{world folder}/palettes`). |
| **Terrain palettes** | Named palettes of terrain types. Each palette has a name and a list of terrain entries (name, colour, optional icon and icon tint). Palettes are assigned to maps at creation time. Edit palette contents from the terrain tool on the hex map, or as a table in the palette's note — copy a palette note into another vault's palettes folder to share it. **Add palette** offers built-in presets: *Limited* and *Expanded* (fantasy overland), plus *Space - Sector* (star charts, one hex per parsec; adds Jump route and Trade route path types) and *Space - System* (stars, planets, belts, stations) for sci-fi games such as Traveller. New-map palette menus list uninstalled presets too. |
| **Generate** | ⚠️ Configure all folders first. Creates missing terrain table files and links each hex's terrain encounters table into the hex note. |

---

## Map notes

Each map has one **map note** at `{hexFolder}/{map}/_{map}.md` (e.g. `RPG/world/hexes/Overworld/_Overworld.md`). It holds the map's settings in its frontmatter and a table with one row per hex that has map data: terrain, icon, GM icons, region, submap and locked. Hexes with only the map's base terrain (or nothing) have no row. Painting updates the table; you can also edit the table by hand and the map follows. Anything you write in the note outside the "Hexes" and "Paths" tables is left alone.

Older versions kept terrain and the rest in each hex note's frontmatter. The first time this version starts, it moves that data into map notes, keeps a JSON backup in the plugin folder's `backups/`, and replaces those frontmatter fields with a `hexmaker-map:` link to the map note. Note text is never changed or deleted. Older plugin versions on other devices don't read map notes, so update every device that shares the vault.

## Hex notes

Each hex note lives at `{hexFolder}/{map}/{x}_{y}.md` (e.g. `RPG/world/hexes/Overworld/3_7.md`). Hex notes hold descriptions and links, and are created when a hex first gets some (you open it, write in the editor, or link something); painting terrain doesn't create one. Its frontmatter links to the map note:

```yaml
---
hexmaker-map: "[[_Overworld]]"
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
| `### Quests` | Links | Active quest links |
| `### Factions` | Links | Faction links (used by the faction overlay) |
| `### Encounters Table` | Links | Random table links (linked to terrain by Generate) |
| `### hidden` | Text | Discoverable with effort |
| `### secret` | Text | Revealed only through investigation |
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
npm test           # run the test suite
```

The built output is `main.js` in the repo root. Obsidian loads this file directly from the plugin folder.

**Reload the plugin after a build:**
```js
// Paste in Obsidian developer console (Ctrl+Shift+I)
app.plugins.disablePlugin('hexmaker-plugin');
app.plugins.enablePlugin('hexmaker-plugin');
```

### Source layout

```
main.ts                               ← re-exports HexmakerPlugin
src/
  HexmakerPlugin.ts                   ← plugin entry point
  HexmakerSettingTab.ts               ← settings UI
  HexmakerModal.ts                    ← base modal class (makeDraggable, shared behaviour)
  types.ts                            ← interfaces and type constants
  constants.ts                        ← runtime constants and defaults
  frontmatter.ts                      ← terrain/icon/submap YAML read/write
  sections.ts                         ← markdown section read/write helpers
  utils.ts                            ← shared utilities
  defaultHexTemplate.md               ← built-in hex note template
  hex-map/
    HexMapView.ts                     ← interactive hex grid (ItemView)
    HexSidePanel.ts                   ← collapsible side panels (drawing tools, overlays)
    HexEditorModal.ts                 ← right-click hex editor (Modal)
    MapModal.ts                       ← map management (switch, create, rename, delete, terrain theme)
    SubmapPickerModal.ts              ← link submap to a hex (picker + create)
    TerrainPickerModal.ts             ← terrain palette picker
    TerrainEntryEditorModal.ts        ← edit a single terrain entry
    IconPickerModal.ts                ← icon override picker
    PathPickerModal.ts                ← path type picker
    PathTypeEditorModal.ts            ← edit a single path type
    FolderTreePickerModal.ts          ← table picker (collapsible folder tree)
    FileLinkSuggestModal.ts           ← file picker scoped to a folder
    PainterContextMenu.ts             ← right-click context menu for painter tools
    TokenModal.ts                     ← create/edit a token (icon, shape, colour)
    TokenInfoModal.ts                 ← token info card (jump to hex, open note)
    MapLinkModal.ts                   ← link an existing note to a hex section
    newMapFields.ts                   ← shared new-map form fields (name, size, palette)
  hex-table/
    HexTableView.ts                   ← hex reference table (ItemView)
    HexCellModal.ts                   ← inline cell editor
    HexTerrainPickerModal.ts          ← terrain picker in table view
  random-tables/
    RandomTableView.ts                ← random tables + workflows panel (ItemView)
    FolderTree.ts                     ← buildTree + renderFolderTree shared utilities
    RandomTableModal.ts               ← inline roll modal
    RandomTableEditorModal.ts         ← edit table entries
    WorkflowEditorModal.ts            ← edit workflow definition
    WorkflowWizardModal.ts            ← execute a workflow
    randomTable.ts                    ← parse/roll/odds utilities
    workflow.ts                       ← workflow parse/serialize utilities
```

### Troubleshooting

- **"Failed to load plugin"** — `main.js` is missing. Run `npm run build`.
- **Viewing logs** — Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac) to open the developer console.

---

## Third-party libraries

This plugin bundles [MiniSearch](https://github.com/lucaong/minisearch) (© Luca Ongaro, MIT License) for in-memory full-text search.

The space icon pack (`icons/space-*`) uses icons from [game-icons.net](https://game-icons.net) by Lorc and Delapouite (CC BY 3.0), [Material Design Icons](https://pictogrammers.com/library/mdi/) (Apache 2.0), [Tabler Icons](https://tabler.io/icons) (MIT), and [Kenney Simple Space](https://kenney.nl/assets/simple-space) (CC0). Full per-icon credits and licence texts are in [`icons/CREDITS.md`](icons/CREDITS.md).
