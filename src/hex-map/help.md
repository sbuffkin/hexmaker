## Navigation

| Action | Result |
|--------|--------|
| **Middle-mouse drag** (or click + drag on empty space) | Pan the map |
| **Scroll wheel** | Zoom in / out |
| **Left-click** a hex | Open or create that hex's note |
| **Right-click** a hex | Open the hex editor (terrain, notes, links) |
| **Double-right-click** anywhere | Exit the active tool and return to normal mode |

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
Opens the icon palette. Select an icon to enter paint mode, then left-click hexes to apply a custom icon override (independent of the terrain icon). Useful for marking notable locations.

### Link table
Opens a folder-tree picker scoped to your Tables folder. Select a random-encounter table, then left-click hexes to link that table into each hex's **Encounters Table** section.

### Link faction
Opens a folder-tree picker scoped to your Factions folder. Select a faction note, then left-click hexes to link it into each hex's **Factions** section.

### Swap
Swap the contents of two hex positions by renaming their files.

1. **Select** the first hex — highlighted amber (source)
2. **Select** a second hex — highlighted purple (destination)
3. **Select the destination again** to confirm the swap

Selecting the source hex again cancels the selection. Selecting a different hex while a destination is already highlighted changes the destination.

---

## View buttons

| Button | Action |
|--------|--------|
| **⊞** | Open the Hex Table — a spreadsheet view of all hex notes with filters and sorting |
| **🎲** | Open the Random Tables browser — roll on any table, view odds, edit entries |
| **⌖** | Go to a specific hex by entering X, Y coordinates |
