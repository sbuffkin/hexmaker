## Navigation

| Action | Result |
|--------|--------|
| **Middle-mouse drag** (or click + drag on empty space) | Pan the map |
| **Scroll wheel** | Zoom in / out |
| **Left-click** a hex | Open the hex editor (terrain, notes, links) |
| **Right-click** a hex | Context menu: center on hex, open note, create / link submap, link table, swap hex, create token here, clear terrain |
| **Double-right-click** anywhere | Exit the active tool and return to normal mode |

---

## Submaps

A hex can drill down into its own map: a star system inside a sector, a dungeon inside a region. Hexes with a submap show a small ring at the top.

| Action | Result |
|--------|--------|
| **Right-click → Create / link submap…** | Create a submap for this hex (auto-named after the map and hex, with the suggested palette pre-selected) and go straight into it, or link an existing map |
| **Click the ring**, or **Ctrl/Cmd+click** the hex | Enter the submap |
| **Ctrl/Cmd+Shift+click** the hex | Open the submap in a new tab |
| **↑ up** button / **Alt+↑** | Back up to the parent map; the hex you came from flashes |
| **← back** button / **Alt+←** | Return to the previously viewed map |
| Breadcrumb (top left) | Jump to any map above this one |

"Go up to parent map" and "Go back to previous map" are also commands, so you can bind your own hotkeys. A palette can suggest the palette for its submaps with a `child-palette:` line in its note's frontmatter. *Space - Sector* suggests *Space - System*.

---

## Where the map is stored

Terrain, icons, GM icons, regions and submap links live in the map's **map note** (`_<map>.md` in the map's folder): one table row per hex. Edit it by hand if you like; the map follows. Hex notes are only for descriptions and links, and appear when a hex gets some.

---

## Expand buttons

The **+** buttons at the edges of the map grow the grid one column or row in that direction, shifting the coordinate origin if needed.

---

## Drawing tools

### Road / River
Paint a connected chain of road or river hexes. Left-click hexes to extend the chain; right-click a hex already in the chain to remove it. Each chain is drawn as a colored line connecting adjacent hexes.

### Terrain
Opens the terrain palette. Select a color/icon to enter paint mode, then left-click hexes to apply that terrain. Use **Pick** (⌖) to sample terrain from an existing hex. Use **Clear** to erase terrain from hexes. Right-click the terrain button to open the palette editor where you can reorder, rename, recolor, and add terrain types.

### Icon
Opens the icon palette. Select an icon to enter paint mode, then left-click hexes to apply a custom icon override (independent of the terrain icon). Useful for marking notable locations. Every icon list (here, in the token editor, and in the hex editor) has a filter box and **All / Terrain / Space / Custom** tabs; drag the bottom edge of an inline icon list to make it taller.

### Link table
Opens a folder-tree picker scoped to your Tables folder. Select a random-encounter table, then left-click hexes to link that table into each hex's **Encounters Table** section.

### Factions
Opens a folder-tree picker scoped to your Factions folder. Select a faction note, then left-click hexes to link it into each hex's **Factions** section.

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
