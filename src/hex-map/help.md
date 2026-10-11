## Navigation

| Action | Result |
|--------|--------|
| **Middle-mouse drag** (or click + drag on empty space) | Pan the map |
| **Scroll wheel** | Zoom in / out |
| **Left-click** a hex | Open the hex editor (terrain, notes, links) |
| **Right-click** a hex | Context menu: center on hex, open note, enter its region or locations, new map from this hex, link a map, link table, swap hex, create token here, clear terrain |
| **Double-right-click** anywhere | Exit the active tool and return to normal mode |

---

## Submaps: regions and locations

A hex can open into maps of its own. There are two kinds:

- **Location**: a separate place in the hex, like a town, a dungeon or a ship, with its own size and palette. A hex can have any number. Every submap made before regions is a location.
- **Region** (Advanced): the hex itself, up close. Every region of a map uses the same shape and size, so regions line up with each other. A hex has at most one.

Hexes with locations show a small ring at the top, with a count once there are two or more. A hex with a region has a thin outline inside it.

| Action | Result |
|--------|--------|
| **Right-click → New map from this hex…** | Pick **Region** or **Location**, then set the map up and go straight into it. A location is named after the hex, or the map name and the hex's coordinates; click the name to type your own |
| **Right-click → Enter region / Open: …** | Go into the hex's region, or one of its (up to two) locations |
| **Right-click → Locations (3)…** | From three locations on: a list to search, open, unlink and drag into order. Also **Manage locations…** |
| **Right-click → Link existing map…** | Add a map you already have as one of the hex's locations |
| **Click the ring**, or **Ctrl/Cmd+click** the hex | Enter the hex's region, or its location (the list when there are several) |
| **Ctrl/Cmd+Shift+click** the hex | Open it in a new tab |
| Hex editor **Maps** strip | The region chip (outlined) and one chip per location; **+** for a new map, linking one, or the locations list |
| **←** / **Alt+←** | Back to the map you were on before |
| **↑** / **Alt+↑** | Up to the parent map; the hex you came from flashes |
| **→** / **Alt+→** | Forward again after going back |
| Breadcrumb (top left) | Jump to any map above this one |
| Small hex flower after the arrows (a region of an overworld) | The six regions around this one, each in its direction. Hover a petal for its name, click to go there. An empty petal's **+** makes the region there (pick or roll its biome) |
| **◀ ▲ ▼ ▶** after the arrows (neighbouring maps) | Go to the map on that side; hover for its name. **+** on an empty side makes new land there. Inside a submap they go to its parent's neighbours |

The arrows are always ← ↑ → in that order; one that doesn't apply right now is greyed out. Hover any of them for the map it goes to.

**Region settings.** The first region you make on a map asks once how its regions cover its hexes: **Hex flower** (a hex of 7, 19, 37, 61 or 91 hexes) or **Rectangle** (6×6, 8×8, 10×10 or your own size), the palette, and how far neighbouring regions blend. They stay in the map menu's **Regions** tab, which also lists the regions. Shape, size and palette are fixed once a region exists, so every region lines up; delete the regions to change them. Blend stays editable and applies to regions made afterwards.

"Go up to parent map", "Go back to previous map" and "Go forward to the next map" are also commands, so you can bind your own hotkeys. A palette can suggest the palette for its submaps with a `child-palette:` line in its note's frontmatter. *Space - Sector* suggests *Space - System*.

---

## Where the map is stored

Hex names, terrain, icons, GM icons, regions, region maps and locations live in the map's **map note** (`_<map>.md` in the map's folder): one table row per hex. Edit it by hand if you like; the map follows. Hex notes are only for descriptions and links, and appear when a hex gets some.

The **How to edit this note** box at the top of the map note explains the columns. Regions, locations and region maps are links (`[[Basin]]`, `[[_saltmere]]`), so renaming the note in Obsidian keeps the map right; plain names work too and become links on the next save. Notes from older versions (a single Submap column) are converted once, after a backup. Column order, header case and `3_4` vs `3, 4` don't matter, and your own columns and text are kept. A row that can't be read stays as you wrote it and is listed in a warning box until you fix it. If the note can't be read at all, the plugin stops saving to it and tells you, rather than writing over it.

The map note's **Summary** (above the Hexes table) and the *Route* column in Paths are written by the plugin: extent, base terrain, a terrain legend with counts, regions, each path's ends, forks and length, and a ⚠ for any terrain or path type not in the palette. They update on each save, so edits there are replaced.

Paths are named. The **Paths** table lists each path (name, type, your notes); **Path routes** lists the hexes each one passes through in order, like `0, 8 → 9, 8 → 13, 8`, and the map draws the way between them. A path's `main` row is its main line; other rows are forks that leave it at their first hex. The tables are linked by name, so to rename a path edit it in both. Older notes that listed every hex of a path are converted once, after a backup, with a report of what changed beside it.

---

## Expand buttons

The **+** buttons at the edges of the map grow the grid one column or row in that direction, shifting the coordinate origin if needed.

---

## Drawing tools

### Paths
Pick a path type in the path picker (choose **Hex by hex** or **Auto-route** first; switch either way later from the bar at the top). Every path has a name and shows up under **Paths on this map** in the picker, with its ends, forks and size; click one there to select it.

- **Draw:** click a hex to start, then keep clicking. Each click adds a point and the path finds its way there from the end, around impassable terrain, so you can click far away. In hex-by-hex mode, click neighbouring hexes (a click further away is routed too, and the bar says so), or press and drag: every hex you pass becomes a point, and going back a hex takes the last one away. The whole drag is one undo step. Click the end again, press **Esc** or **Done** to finish.
- **Select:** click a path. Its points show as handles; the bigger ones are its ends.
- **Continue or fork:** with a path selected, click an end to carry on from it, or click anywhere else on it to start a fork there. A path and its forks are one path in the map note.
- **Reshape:** drag any part of the selected path (in hex-by-hex mode, dragging from an end carries the path on instead). Grabbing a point moves it; grabbing the line adds a point there. The new route shows as you drag; let go to keep it, or drop it back where it was to cancel.
- **New path:** **Alt-click**, or **New path** in the bar, starts a new path even on top of another one (a crossroads of two roads).
- **Delete:** right-click a handle, or hover one and press **Backspace**. Backspace while drawing removes the last point. Right-click a path: its own items come first (**Split here**, **Delete this fork**, **Delete path**, **Rename…**, **Change type…**, **Reverse**), then the tool's. In erase mode (the picker's ✕), click a path to split it there.
- **Esc** steps out one level: finish the branch, then deselect, then leave the tool. **Ctrl/Cmd+Z** undoes each change.

Mark terrains impassable in the palette editor (every water-type terrain is impassable by default). Each path type chooses whether it goes around them (roads do, rivers don't) and whether it winds. Tick **Cross impassable** in the bar to let the next legs go through. If painting terrain, changing the palette, resizing the map or changing a type's routing would move an existing path, it keeps its route (points are added to hold it) and a notice offers **Reroute instead**; undoing the paint stroke undoes that too.

### Terrain
Opens the terrain palette. Select a color/icon to enter paint mode, then left-click hexes to apply that terrain. Use **Pick** (⌖) to sample terrain from an existing hex. Use **Clear** to erase terrain from hexes. Right-click the terrain button to open the palette editor where you can reorder, rename, recolor, and add terrain types.

### Icon
Opens the icon palette. Select an icon to enter paint mode, then left-click hexes to apply a custom icon override (independent of the terrain icon). Useful for marking notable locations. Every icon list (here, in the token editor, and in the hex editor) has a filter box and **All / Terrain / Places / Space / Custom** tabs (Space only when space maps are on). **Places** holds settlement, castle, tower, ruin, temple, camp and cave icons, with a row of chips to narrow it down (Settlements, Castles…); drag the bottom edge of an inline icon list to make it taller.

### Link table
Opens a folder-tree picker scoped to your Tables folder. Select a random-encounter table, then left-click hexes to link that table into each hex's **Encounters Table** section.

### Factions
Opens a folder-tree picker scoped to your Factions folder. Select a faction note, then left-click hexes to link it into each hex's **Factions** section.

### Region areas
Opens a picker of your Regions folder's notes. Select a region note (a named area like a basin or a kingdom), then left-click hexes to paint its colour on them (pick **Remove** in the picker to erase instead). This is the region overlay. It's not the same as a hex's region map (the map you enter on an overworld).

### Swap
Swap the contents of two hex positions by renaming their files.

1. **Select** the first hex — highlighted amber (source)
2. **Select** a second hex — highlighted purple (destination)
3. **Select the destination again** to confirm the swap

Selecting the source hex again cancels the selection. Selecting a different hex while a destination is already highlighted changes the destination.

### Token
Create a note-backed token (icon, shape, size, colors, description) and place it on the map. The **Token** button opens the token editor, then left-click a hex to place it. Alternatively, **right-click a hex → "Create token here"** creates the token directly on that hex with no placement step. Right-click a placed token to edit, open its note, or remove it.

---

## View buttons

| Button | Action |
|--------|--------|
| **⊞** | Open the Hex Table — a spreadsheet view of all hex notes with filters and sorting |
| **🎲** | Open the Random Tables browser — roll on any table, view odds, edit entries |
| **⌖** | Go to a specific hex by entering X, Y coordinates |

## Badges and legend

The layers button (top right) turns these on and off.

- **Link badges**: a coloured icon badge at a hex's right side for each kind of link in its note (towns, dungeons, features, quests, factions). **S / M / L** beside the toggle sets their size for this map. Hover the hex to see what it links. Click ▸ to pick which kinds show.
- **Legend**: the terrains used on this map and the badge kinds shown, at the bottom left (hover a cut-short name for the full one). **S / M / L** sets its size, **–** folds it to a small **Legend** button, **×** hides it.

Opening the layers panel or the drawing tools never moves the map.

## Names and labels

Name a hex in the **Name** box at the top of the hex editor. The name shows on the map, in the hover text and in the hex table. If the hex has a note, the name is added to the note's aliases, so the quick switcher finds it. Hex notes also get their map name and coordinates as an alias ("Gloomwood 3, 4"), so you can find a hex by typing them.

Tokens show their name underneath. The layers panel's **Labels** group turns coordinates, hex names and token names on and off; a hidden token name still shows on hover. Hex names never get smaller than readable on screen: a long name shrinks and wraps at spaces (never mid-word) to fit inside the hex, clear of its badges, and spills past the hex when it can't fit at a readable size. **Aa** beside the Labels heading picks this map's hex-name font, size, bold and italic (the default is in settings); the PNG export uses it too. **Export** can include hex names, tokens, link badges and a legend, and lets you pick the PDF table's columns and the manual's parts for a handout. It starts from what the map shows and remembers your choices per map.

---

## Simple and Advanced

**Simple** has everything you need to run a hexcrawl: paint maps, write hex notes, roll on encounter tables, export. **Advanced** adds terrain generators, workflows (chained table rolls), custom palettes, and regions and overworlds (a region map per hex at one scale, and maps joined into one world). Locations (towns, dungeons… inside a hex) are in Simple too.

Turn on any one of them from the hint (✦) where it would appear, or all of them in **Settings → Features**. Switching back hides them again; nothing you made is deleted.

**Overworlds** (Advanced: Regions and overworlds). **Maps → New overworld…** makes a map of biomes whose hexes each open into a rectangle region; regions next to each other share one grid, so they join hex for hex. The switch at the bottom right picks the view (the one showing is highlighted): **Regions** shows every region's hexes stitched together, with blank bricks where there's no region yet (hover for a region's name, click to go in at that spot; the terrain tool paints the regions' own hexes, across seams), **Biomes** shows one biome per hex (hover for its region's name). In both views a click on a hex or brick that has a region goes into it, in every mode; a click on an empty one sets its biome and makes its region (Build and God). To change a placed region, right-click it → **Edit region…** (God mode; in Build and Play it's greyed out and says "Switch to God to change a placed region."). The terrain tool always paints the regions: picking a terrain switches to the Regions view, the brush (any size) paints the regions' own hexes across seams and they update as you draw, on the overworld and in any open view of those regions. A stroke is one undo step. Where there's no region yet the brush does nothing ("No region here yet; place a biome first"); in Play it says "Switch to Build to paint the regions." The minimap at the bottom right shows the overworld from any of its regions. Hand-painted region hexes are locked, so remaking a region keeps them.

**Work modes: Play, Build, God.** Each map has a mode, shown on the toolbar next to the map button; click it to switch. The map keeps its mode (it's the `mode:` line in the map note) and opens in it next time. New maps are in **Build**. For now the mode guards two things on overworlds. Changing what's already placed (swapping a placed biome, **Reroll**, applying **Settings…** to an existing region) needs **God**; in Build and Play those buttons are greyed out and say "Switch to God to change a placed biome." Placing a biome on an empty hex (which makes its region) needs **Build** or God; in Play the biome picker is greyed out and says "Switch to Build to place a biome.", and **New map from this hex… → Region** says "Switch to Build to make a region." Notes stay editable in every mode, and settings and palettes are never locked. No confirm boxes: the mode is the safety catch.

**Walking into new land.** In a region, the hex flower on the toolbar shows a **+** on each neighbour that has no region yet ("New region to the east"). Click it, pick the biome that lies there or **Roll** for one (the seed is shown; the same seed rolls the same biome), watch the preview of the new region blended with the regions around it, then **Create and go**. A different biome makes border country in between. Past the overworld's edge, the overworld grows by a hex to fit the new region. The hex editor's neighbour flower does the same on the hexes past the region's edge, and maps joined side by side get a **+** on the empty sides of their arrow pad. Needs Build or God: in Play the **+** says "Switch to Build to make a region."

Neighbouring regions share one set of hex numbers: a new region carries on from the map it was placed next to, so each hex number names one place in the world. Maps you join later keep their own numbers.

A road or river that ends on the edge of a region, next to where the neighbour's road of the same type ends, is drawn on to the shared edge on both maps, so the two join up.

With generators on, new maps can also use the built-in **biomes and presets** (Grassland, Taiga, Swamp, Archipelago, Volcanic and more). They place terrain by type, so they work with any palette whose terrains have types.

**New map…** (in Maps) is one form: generator cards with a live preview, Next to (Advanced), and **More** for starting coordinates, stagger and a background image (pick one from the vault, or drop one from your computer). A new map starts on Overland; pick Blank to paint by hand.

Pickers that link notes (to hexes, tokens, sections) never offer template notes (the hex template, workflow templates, a Templates folder); pickers for choosing a template do. Notes starting with `_` are never offered.

On **space maps** (a palette with space terrain types, or a map under one), the hex editor, hex table, badge legend and exports call the link sections **Settlements**, **Sites**, **Points of Interest** and **Missions** instead of Towns, Dungeons, Features and Quests. Only the labels change: notes keep their usual headings, so links keep working.

Every new terrain (from the terrain tool, the palette editor, a new palette or a palette note) gets its description and encounter tables right away, empty. Renaming a terrain renames its tables.

**Templates**: the plugin keeps its note templates in one folder (**Settings → Templates folder**, `templates` in the world folder by default): `hex.md` for hex notes and `town.md` for new towns made from the hex editor. Edit them there and new notes follow.

## Palettes

**Expanded** is the default fantasy palette on new installs (if you used the plugin before, new maps keep starting on your first palette): more terrains (coasts, wetlands, forest and mountain kinds) and it matches the generators. **Limited** has fewer, simpler terrains and is quicker to paint. Pick any palette as the start for new maps in **Settings → Palette for new maps**. Expanded now has **savanna** and **river delta** too (World biomes paints those biomes with them); an Expanded palette you already have gets them once, after a backup, unless it already has terrains of those names. Delete them and they stay deleted.

No palette or terrain is special because of its name. What a terrain does comes from its **Type**: water types are impassable to auto-routes, generators place terrain by type, Orbits puts the *moon*-type terrain beside planets and the *jump point* past the last orbit. Rename anything, or build a palette from scratch, and it works the same once its terrains have types. A terrain with no type gets no defaults and generators skip it; **Guess types from names** in the palette editor fills the Type column for you to check.

## Rolling from a hex

Rolls made from the hex editor (🎲 on an encounter table, 📖 on a section) have **Add to this hex**: pick a section and the result is appended to it. With workflows on, **Run workflow** beside the hex title runs a workflow for this hex, and its result can be added the same way. Weather and Hooks & Rumors (under Notes) roll the map's weather and rumours tables, set in **Maps → Properties**; ⋯ next to the roll button picks a table for one hex.
