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
| Crumbs after the map button ("East: Cole's Ford") | Jump to a neighbouring region. Inside a submap they show its parent's neighbours ("beside Thornwood: South: Cole's Ford") |

"Go up to parent map" and "Go back to previous map" are also commands, so you can bind your own hotkeys. A palette can suggest the palette for its submaps with a `child-palette:` line in its note's frontmatter. *Space - Sector* suggests *Space - System*.

---

## Where the map is stored

Hex names, terrain, icons, GM icons, regions and submap links live in the map's **map note** (`_<map>.md` in the map's folder): one table row per hex. Edit it by hand if you like; the map follows. Hex notes are only for descriptions and links, and appear when a hex gets some.

---

## Expand buttons

The **+** buttons at the edges of the map grow the grid one column or row in that direction, shifting the coordinate origin if needed.

---

## Drawing tools

### Road / River
Paint a connected chain of road or river hexes. Left-click hexes to extend the chain; right-click a hex already in the chain to remove it. Each chain is drawn as a colored line connecting adjacent hexes.

**Auto-route** (in the path picker, or the bar at the top while drawing): click a start hex, then an end hex, and the path finds its own way around impassable terrain, keeping close to the straight line. In the picker, choose how to draw first, then the path type; you can switch either way later from the bar. Mark terrains impassable in the palette editor (water is impassable by default). Each path type chooses whether it avoids them (roads do, rivers don't); tick **Cross impassable** in the bar to go through once.

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

## Badges and legend

The layers button (top right) turns these on and off.

- **Link badges**: a small badge at a hex's right side for each kind of link in its note (towns, dungeons, features, quests, factions). Hover the hex to see what it links. Click ▸ to pick which kinds show.
- **Legend**: the terrains used on this map, bottom right. **S / M / L** sets its size, **×** hides it.

## Names and labels

Name a hex in the **Name** box at the top of the hex editor. The name shows on the map, in the hover text and in the hex table. If the hex has a note, the name is added to the note's aliases, so the quick switcher finds it.

Tokens show their name underneath. The layers panel's **Labels** group turns coordinates, hex names and token names on and off; a hidden token name still shows on hover. Long hex names wrap onto two lines inside the hex, in a colour that reads on the terrain. **Export** can include hex names, tokens, link badges and a legend, and lets you pick the PDF table's columns and the manual's parts for a handout. It starts from what the map shows and remembers your choices per map.

---

## Simple and Advanced

**Simple** has everything you need to run a hexcrawl: paint maps, write hex notes, roll on encounter tables, export. **Advanced** adds terrain generators, workflows (chained table rolls), custom palettes and neighbouring regions (maps joined into one world).

Turn on any one of them from the hint (✦) where it would appear, or all of them in **Settings → Features**. Switching back hides them again; nothing you made is deleted.

Neighbouring regions share one set of hex numbers: a new region carries on from the map it was placed next to, so each hex number names one place in the world. Maps you join later keep their own numbers.

A road or river that ends on the edge of a region, next to where the neighbour's road of the same type ends, is drawn on to the shared edge on both maps, so the two join up.

With generators on, new maps can also use the built-in **biomes and presets** (Grassland, Taiga, Swamp, Archipelago, Volcanic and more). They place terrain by type, so they work with any palette whose terrains have types.

**New map…** (in Maps) is one form: generator cards with a live preview, Next to (Advanced), and **More** for starting coordinates, stagger and a background image (pick one from the vault, or drop one from your computer). A new map starts on Overland; pick Blank to paint by hand.

Pickers that link notes (to hexes, tokens, sections) never offer template notes (the hex template, workflow templates, a Templates folder); pickers for choosing a template do. Notes starting with `_` are never offered.

## Palettes

**Expanded** is the default fantasy palette: more terrains (coasts, wetlands, forest and mountain kinds) and it matches the generators. **Limited** has fewer, simpler terrains and is quicker to paint.

## Rolling from a hex

Rolls made from the hex editor (🎲 on an encounter table, 📖 on a section) have **Add to this hex**: pick a section and the result is appended to it. Weather and Hooks & Rumors (under Notes) roll the map's weather and rumours tables, set in **Maps → Properties**; ⋯ next to the roll button picks a table for one hex.
