## Navigation

| Action | Result |
|--------|--------|
| **Middle-mouse drag** (or click + drag on empty space) | Pan the map |
| **Scroll wheel** | Zoom in / out |
| **Left-click** a hex | Open the hex editor (terrain, notes, links) |
| **Right-click** a hex | Context menu: its region and locations first, then center on hex, open note, new map from this hex (**Add another map…** once it has one), link a map, link table, swap hex, create token here, clear terrain. On a token: the token's items, then the hex's |
| **Double-right-click** anywhere | Exit the active tool and return to normal mode |

---

## Submaps: regions and locations

A hex can open into maps of its own. There are two kinds:

- **Location**: a separate place in the hex, like a town, a dungeon or a ship, with its own size and palette. A hex can have any number. Every submap made before regions is a location.
- **Region**: the hex itself, up close. Every region of a map uses the same shape and size, so regions line up with each other. A hex has at most one.

Hexes with locations show a small ring at the top, with a count once there are two or more. A hex with a region has a thin outline inside it.

| Action | Result |
|--------|--------|
| **Right-click → New map from this hex…** | Pick **Region** or **Location** (on space maps, a star system or planet is a Location), then set the map up and go straight into it. Maps the hex already has are listed first. A location is named after the hex, or its terrain and coordinates ("Barren world 12, 5"); click the name to type your own |
| **Right-click → Enter region / Open: …** | Go into the hex's region, or one of its (up to two) locations |
| **Right-click → Locations (3)…** | From three locations on: a list to search, open, unlink and drag into order. Also **Manage locations…** |
| **Right-click → Link existing map…** | Add a map you already have as one of the hex's locations |
| **Click the ring**, or **Ctrl/Cmd+click** the hex | Enter the hex's region, or its location (the list when there are several) |
| **Ctrl/Cmd+Shift+click** the hex | Open it in a new tab |
| Hex editor **Maps** strip | The region chip (outlined) and one chip per location; **+** for a new map, linking one, or the locations list |
| **←** / **Alt+←** | Back to the map you were on before |
| **↑** / **Alt+↑** | Up to the parent map; the hex you came from flashes |
| **→** / **Alt+→** | Forward again after going back |
| Breadcrumb (top left) | Jump to any map above this one; it ends with what this map's hex is on the parent ("from: barren world") |
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

**Map data in hex notes.** Hex notes from the built-in template have a **Map data** box: the hex's terrain, region and name (and its region map, locations and, on an overworld, biome). You can edit Terrain, Region or Name there: when you leave the note or open the hex editor, the change goes onto the map. It doesn't if the map changed that value since (the map wins), if the mode locks it (Play), or if the terrain isn't in the palette; then the box keeps a `Not applied:` line saying why. Lines it can't read become `Not read:` lines. A hand-filled `**Terrain:**` or `**Region:**` line from an older template moves into the box as an `Old terrain:` / `Old region:` line; it never changes the map. A hex note links its map note with `map: "[[_coast]]"` (older notes: `hexmaker-map:`).

Paths are named. The **Paths** table lists each path (name, type, your notes); **Path routes** lists the hexes each one passes through in order, like `0, 8 → 9, 8 → 13, 8`, and the map draws the way between them. A path's `main` row is its main line; other rows are forks that leave it at their first hex. The tables are linked by name, so to rename a path edit it in both. Older notes that listed every hex of a path are converted once, after a backup, with a report of what changed beside it.

---

## Expand buttons

The **+** buttons at the edges of the map grow the grid one column or row in that direction, shifting the coordinate origin if needed.

---

## Drawing tools

### Paths
Pick a path type in the path picker (choose **Hex by hex** or **Auto-route** first; switch either way later from the bar at the top). Every path has a name and shows up under **Paths on this map** in the picker, with its ends, forks and size; click one there to select it (the tool switches to its type).

There's no separate edit mode. While the tool is on a type (say Road), every Road on the map shows its points as handles (the bigger ones are ends), and you can work on any of them straight away. Paths of other types are left alone: clicking on a river starts a new road there, and hovering one says which type to switch to. Right-click it for **Switch to River**.

- **Draw:** click empty ground to start, then keep clicking. Each click adds a point and the path finds its way there from the end, around impassable terrain, so you can click far away. In hex-by-hex mode, click neighbouring hexes (a click further away is routed too, and the bar says so), or press and drag: every hex you pass becomes a point, and going back a hex takes the last one away. The whole drag is one undo step. Click the end again, press **Esc** or **Done** to finish.
- **Move a point:** drag it. The new route shows as you drag; let go to keep it (one undo step), or drop it back where it was to cancel. This works while drawing too.
- **Reshape the line:** drag the line itself: a new point is added where you grabbed it, and moves with the pointer.
- **Delete a point:** right-click it, or hover it and press **Backspace**. A branch left with one point goes, and so does a path; the map says so and undo brings it back. Backspace while drawing removes the last point.
- **Continue:** click an end to carry on from it.
- **Select and fork:** click a path's line to select it (it's highlighted and its name shows in the bar; click the name to rename it). Click the selected path's line again to start a fork there. A path and its forks are one path in the map note. Forks stay attached: drag the point a fork leaves from and the fork comes along; delete it and the fork joins the nearest point that is left. If a main line goes, its forks become paths of their own (one undo step).
- **New path:** click empty ground. **Alt-click**, or **New path** in the bar, starts a new path even on top of a path of the same type (a crossroads of two roads).
- **Path menu:** right-click a path's line, or **Shift**+right-click a point: its own items come first (**Split here**, **Delete this fork**, **Delete path**, **Rename…**, **Change type…**, **Reverse**), then the tool's. In erase mode (the picker's ✕), click a path of the tool's type to split it there.
- **Esc** steps out one level: finish the branch, then deselect, then leave the tool. **Ctrl/Cmd+Z** undoes each change.

Mark terrains impassable in the palette editor (every water-type terrain is impassable by default). Each path type chooses whether it goes around them (roads do, rivers don't) and whether it winds. Tick **Cross impassable** in the bar to let the next legs go through. If painting terrain, changing the palette, resizing the map or changing a type's routing would move an existing path, it keeps its route (points are added to hold it) and a notice offers **Reroute instead**; undoing the paint stroke undoes that too.

### Biome (overworlds only)
Opens a palette of biomes, like the terrain palette. Pick one, then click or drag over the overworld's hexes (in either view): each hex gets that biome and its region is made straight away, no window. A hex with no region yet can be painted in Build or God. Changing the biome of a hex that already has a region needs God, and only remakes the region where the biome is different: painting the same biome again does nothing. A stroke that remakes regions is one undo step (in the mode it was done in); making a region for the first time isn't undone (it makes a map). **Custom (blank)** paints a blank region to fill by hand.

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
Create a note-backed token (icon, shape, size, colors, description) and place it on the map. The **Token** button opens the token editor, then left-click a hex to place it. Alternatively, **right-click a hex → "Create token here"** creates the token directly on that hex with no placement step. Right-click a placed token to edit, open its note, or remove it; the hex it sits on has its items below the token's.

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
- **Legend**: the terrains used on this map and the badge kinds shown, at the bottom left, by full name (only very long names are cut; hover one for the full name). **S / M / L** sets its size, **–** folds it to a small **Legend** button, **×** hides it.

Opening the layers panel or the drawing tools never moves the map.

## Names and labels

Name a hex in the **Name** box at the top of the hex editor. The name shows on the map, in the hover text and in the hex table. If the hex has a note, the name is added to the note's aliases, so the quick switcher finds it. Hex notes also get their map name and coordinates as an alias ("Gloomwood 3, 4"), so you can find a hex by typing them.

Tokens show their name underneath. The layers panel's **Labels** group turns coordinates, hex names and token names on and off; a hidden token name still shows on hover. Hex names never get smaller than readable on screen: a long name shrinks and wraps at spaces (never mid-word) to fit inside the hex, clear of its badges, and spills past the hex when it can't fit at a readable size. **Aa** beside the Labels heading picks this map's hex-name font, size, bold and italic (the default is in settings); the PNG export uses it too. **Export** can include hex names, tokens, link badges and a legend, and lets you pick the PDF table's columns and the manual's parts for a handout. It starts from what the map shows and remembers your choices per map.

---

## Advanced dropdowns and Debug mode

Every feature is always there: there's no Simple or Advanced level to switch. Each page keeps the everyday options on top; options most people never change sit in a collapsed **Advanced** dropdown at the bottom of that page. Inside it, related options can have their own collapsible sections: in Settings, **Folders**, **New map sizes** and **Palettes** (with **Generate terrain tables & hex links** at the top: the fix when a table or table link is missing); on the terrain generator page, **Engine tuning** (clumping, smoothing, scatter, near rules, mix strength and the like), **Paths** (single routes) and **Seed**. In the setup wizard, the per-folder paths and the generator's options. Open them when you want them; each stays open or closed on that page next time (on this device).

**Debug mode** shows backend controls, such as the Biomes, Biome pools and World types folder settings, in a **Debug** section inside each Advanced dropdown, and offers the maintenance commands (Add roll ranges to tables, Check tables, the map data commands) in the command palette. Turn it on with **Settings → Debug mode**, at the very bottom; the first time, it asks to make sure. While it's on, **Debug** shows in the status bar: click it to turn debug mode off. It's kept per device and never synced.

**Map types.** What the setup installs follows the map types you pick: World gets the Expanded and Limited palettes and the biome notes; Space alone gets Space - Sector, Space - System and Space - Planet and nothing fantasy. Turning a type on later in **Settings → Map types** installs its content then. Planets and moons open on **Space - Planet**, a land palette for surfaces. Note pickers list only what they're for: the token form's Note list shows the tokens, towns, dungeons, features, quests, factions and regions folders, never biomes, palettes, tables or other plugin notes.

**Overworlds**. **Maps → New overworld…** makes a map of biomes whose hexes each open into a rectangle region; regions next to each other share one grid, so they join hex for hex. The switch at the bottom right picks the view (the one showing is highlighted): **Regions** shows every region's hexes stitched together, with blank bricks where there's no region yet (hover for a region's name, click to go in at that spot; the terrain tool paints the regions' own hexes, across seams), **Biomes** shows one biome per hex (hover for its region's name). In both views a click on a hex or brick that has a region goes into it, in every mode; a click on an empty one sets its biome and makes its region (Build and God). Right-click a region → **Edit region…** for its name, the hex it's on, **Enter region**, **Open map note**, its biome, facts (size, palette, terrain counts, neighbouring regions, locations) and notes (kept in its map note under `## Notes`, editable in every mode). The biome can only be changed in God mode: there it's a picker with **Reroll** and **Settings…**; in Build and Play it's shown with "Switch to God to change it." The overworld has no hex editor: right-click shows only region-level items. The **Biome** tool sets biomes (see Drawing tools). The terrain tool paints the regions and only works in the Regions view (the Biomes view shows biomes only, so the terrain tool is off there): the brush (any size) paints the regions' own hexes across seams and they update as you draw, on the overworld and in any open view of those regions. A stroke is one undo step. Where there's no region yet the brush does nothing ("No region here yet; place a biome first"); in Play it says "Switch to Build to paint the regions." The minimap at the bottom right shows the overworld from any of its regions. Hand-painted region hexes are locked, so remaking a region keeps them.

**Work modes: Play, Build, God.** Each map has a mode, shown on the toolbar next to the map button; click it to switch. The map keeps its mode (the `mode:` line in its map note) and opens in it next time; new maps are in **Build**.

- **Play** is for running a game: move, place and remove tokens, open and edit notes, roll tables, link tables and factions to hexes, turn layers on and off. The map itself stays as it is. The drawing panel shows only the tools Play allows, with one line naming the mode for the rest ("Switch to Build to edit the map."); the grid's **+** / **−** buttons are hidden, the hex editor shows "Switch to Build to paint terrain." where the terrain and icon pickers were, the map's properties say "Switch to Build to change the map's properties.", and the right-click menu leaves out what's locked and ends with one such line.
- **Build** adds and edits: paint terrain, icons and region areas, draw paths, link maps to hexes, grow the map, make maps and regions from a hex, change the map's properties, place a biome on an empty overworld hex.
- **God** can do everything, including changing a placed biome (**Reroll**, **Settings…**), swapping hexes, shrinking the grid and deleting the map.

Notes, settings and palettes are never locked. There are no confirm boxes for these: the mode is the safety catch.

**Undo per mode.** Each map has its own undo queue in each mode, kept until you close the vault. Undo (**↩** or Ctrl+Z) and redo take back the last thing done on this map in the mode it's in now: undoing a token move in Play never undoes Build's terrain, and switching back to Build picks its queue up where you left it. If something was changed again in another mode since (a token moved in Build, then again in Play), Build's undo skips it rather than moving it back. Terrain, icons, region areas, paths, tokens, swaps, hex editor edits and biome changes (reroll, swap) are all undoable. The buttons' tooltips name the mode.

**Your own biomes.** Each biome is a note in the biomes folder (default `{world folder}/biomes`); the built-in ones are written there once, so you can edit them. A note lists terrain *types* with weights (**Mix**), **Transitions** (biomes it shouldn't touch, and what goes between), and `blend`, `land-share`, `min-islands` and an optional `generator` link. In the **Biomes** view, **Biomes…** lists them with **Add biome…**, **Edit…** (built-ins also have **Restore default**) and **Edit generator…**; the form has a live preview of one region. Needs Build or God. Inside a region, click the middle of the hex flower for **Edit region…**; right-click an overworld hex for **Create token here**.

**The Biome column.** An overworld's map note keeps each hex's biome in its **Hexes** table's **Biome** column, by name ("Temperate forest"), for every hex with a biome. Any spelling of a biome's name or id reads; a name that isn't a biome is left as you wrote it and the hex goes by its terrain. Overworlds made before this get the column filled once.

**Blank biomes.** **Custom (blank)** (and any biome whose note says `blank: yes`, or with **Regions start blank** ticked in its form) makes an empty region to paint by hand: nothing is generated, the overworld hex has no terrain (the Biome column names it), and the regions around it don't blend into it. It's offered wherever biomes are: the Biome tool, **Set biome…**, **Edit region…** and walking into new land. **New overworld…** has **Blank hexes**: that many hexes (land first, spread out) start blank.

**Biome climates.** Optional keys in a biome note (or the form's folded **Climate** section) say where generated overworlds put it: `temperature` (cold, cool, mild, warm, hot, or `0.2–0.5`), `moisture` (dry, moderate, wet), `elevation` (low, mid, high, sea, mouth), `coastal: yes`, `chance` (like `50%`) and `rare: yes`. Set, World biomes can choose it like a built-in; blank, it's only placed by hand.

**Generate overworld.** **New overworld…** lays out a **biome pool** (a note in `{world folder}/biome-pools` listing biomes, with an optional weight each; **All biomes** ships). Add or remove biomes, save the pool, watch the preview, then **Create**: the map and every region are made. At the top of the form, **Biomes without a climate** says what the pool's biomes with no climate do: **Fill gaps only** (the default: only hexes nothing else in the pool fits) or **Never place them** (set them by hand). The overworld remembers it (`no-climate-biomes:` in its map note). **Coast** has a climate (coastal lowland), so World biomes puts it on land by the sea; existing overworlds only change if you regenerate them. It's a first pass; edit any region afterwards. Map menu → **Regions** → **Generate overworld…** redoes the whole map (God only): locked hexes and their regions stay, other regions are remade in place.

**Walking into new land.** In a region, the hex flower on the toolbar shows a **+** on each neighbour that has no region yet ("New region to the east"). Click it, pick the biome that lies there or **Roll** for one (the seed is shown; the same seed rolls the same biome), watch the preview of the new region blended with the regions around it, then **Create and go**. A different biome makes border country in between. Past the overworld's edge, the overworld grows by a hex to fit the new region. The hex editor's neighbour flower does the same on the hexes past the region's edge, and maps joined side by side get a **+** on the empty sides of their arrow pad. Needs Build or God: in Play the **+** says "Switch to Build to make a region."

**Roads and rivers on an overworld** are drafts (drawn faded) until you confirm them: select one with the path tool and click **Confirm into regions** (top bar, the path's right-click menu, or **Edit region…**). It's routed through every region it crosses, through each region's own terrain, and the neighbouring regions agree where it crosses each seam, so it joins up. If its path type **carves** terrain (River carves water by default; set it in the path type's editor), those hexes change too, except locked ones. Palettes from before carving get River's `water` once, only where it was never set; a value you set or cleared stays. Paths you drew in a region are never touched. Reshaping the overworld path makes it a draft again; **Update regions** redoes it, **Remove from regions** takes it out. New and rerolled regions pick up confirmed paths. Build or God; one undo step.

Neighbouring regions share one set of hex numbers: a new region carries on from the map it was placed next to, so each hex number names one place in the world. Maps you join later keep their own numbers.

A road or river that ends on the edge of a region, next to where the neighbour's road of the same type ends, is drawn on to the shared edge on both maps, so the two join up.

**World types** (space). Star scatter and Orbits roll on a World types table note in `{world folder}/world-types`: which worlds they place, how often, and how each world's own map is made. Their **World types** option picks the table (**Default** is Default space, which ships with the usual odds; **None** is equal odds, and the generator says so). Each row: a **World** (a terrain of the palette), a **Weight** (decimals are fine), optional limits (**Map** sector or system, **Orbit** inner / habitable / outer or rings like `2–4`, **Stars**, **Temperature**), a sector world's **Mainworld** (the body Orbits makes its mainworld) and, for the world's map, **Size** (`20×14` or `16–24 × 10–14`), **Generator**, **Options**, **Palette** and **Base** (Default space opens its planets on **Space - Planet**). A row that isn't a terrain of the palette is never placed, and the warnings name it. **Edit world types…** (in the Star scatter and Orbits options, or the command) edits the rows, and its preview rolls for a palette, map, orbit and star just as the generators do, so its odds are the real odds. The same note also has a **Stars** table (the star Orbits picks when its Star choice is Random, by **Weight**) and a **Sector features** table (Star scatter's special hexes, each with a **Chance** per star system hex, like `1 in 50` or `2%`); the editor has a tab and a preview for each. Changes save automatically (no Save button); a row marked incomplete isn't saved until it's finished, and is dropped when you close the editor. Hand edits to the note made meanwhile are kept. Needs Build or God.

**More in a table** (all optional; old tables read the same). Weights can be decimals (`3.5`) or percentages. Extra columns are kept and shown in the Random Tables view. The columns **Roll** (`now` / `on arrival`), **Shown as**, **Once** (`per world` / `per map`) and **When** (`zone: outer; star: red dwarf`), and `rows:` in the frontmatter (text, note, table, generator, terrain, biome or any), are read and checked (**Check tables**).

**Space tables.** The command **Convert world types to tables** (or the button under **Generator tables** in a space map's properties) turns each World types note into ordinary random tables in `{tables folder}/space/<name>/`: `Sector/` has **Charted sector** (what a star system hex is), **Unexplored sector** (the same, but only half the systems are known), **Mainworlds** and **Uncharted** (what an unknown hex turns out to be); `System/` has **Stars** and **Inner**, **Habitable** and **Outer orbits**. They give the same odds as the note did and roll like any table. The old note is backed up first and kept: it gets a **Tables** list linking each generator role to its table (change a link there to use another table) and the tables shown below it, so you can roll them from the note. Converting twice changes nothing.

**Generator tables** (map properties, space maps). One line per generator role (Sector hexes, Star, Inner, Habitable and Outer orbits): pick the table it rolls on for this map and every map made under it. Unset lines follow the map above, then the World types picked when generating. Pick **Unexplored sector** for Sector hexes to start a sector with unknown systems.

**Unknown hexes.** A table row whose **Roll** is `on arrival` isn't rolled when the map is made: the hex shows its **Shown as** terrain (a somewhat known system shows as a star system; an uncharted hex shows nothing) and the map note's Hexes table gets an **On arrival** cell naming the table to roll. You can type a table into any hex's On arrival cell by hand. The first time the hex is opened, the table is rolled (with the map's seed, so the same world gives the same result), the hex gets what came up and the cell is cleared: the sector learns what the system is. **New map from this hex…** rolls it first too, and the form starts from the rolled row.

**Arriving somewhere new.** In map properties, **Arriving somewhere new** can be set to **Make the place, in any mode** (maps under it do the same unless they say otherwise; unset everywhere is off and nothing changes). Then a hex with no map gets **Go there** in its right-click menu (Ctrl+click does the same): its On arrival table is rolled and its map is made at once, with no form and no preview, from the row's Size, Generator, Options, Palette and Base, else the palette's submap settings. This works in Play. The new map opens in the mode you were in, and its note gets an **Arrival** section saying what was rolled and how the map was made. Until you lock it, the bar next to the mode switch has **Reroll** (makes the place again, in any mode) and **Lock**; once locked (`arrival: locked` in its note), only God can reroll it. A locked hex is never arrived into. On an overworld, going to a hex with a biome and no region yet (click it, or **Go there**) makes its region from that biome, seeded, with no form, and the same Reroll/Lock rules. Hexes still waiting for their On arrival roll show a small **?** (layers menu → Labels → **Uncharted (?)**).

**Once-only rows.** A row whose **Once** column says `per world` or `per map` comes up only once; blank means it can repeat. When the map rolls one (arriving, or a generator), it's written in an **## Events** table: in the top map's note for `per world`, in the map's own note for `per map`. After that the row is skipped and the other rows' odds grow. Delete its row in **## Events** to make it possible again. Rolls by hand in the Random Tables view aren't tracked, and say so.

With generators on, new maps can also use the built-in **biomes and presets** (Grassland, Taiga, Swamp, Archipelago, Volcanic and more). They place terrain by type, so they work with any palette whose terrains have types.

**New map…** (in Maps) is one form: generator cards with a live preview, Next to, and **More** for starting coordinates, stagger and a background image (pick one from the vault, or drop one from your computer). A new map starts on Overland; pick Blank to paint by hand.

Pickers that link notes (to hexes, tokens, sections) never offer template notes (the hex template, workflow templates, a Templates folder); pickers for choosing a template do. Notes starting with `_` are never offered.

On **space maps** (a palette with space terrain types, or a map under one), the hex editor, hex table, badge legend and exports call the link sections **Settlements**, **Sites**, **Points of Interest** and **Missions** instead of Towns, Dungeons, Features and Quests. Only the labels change: notes keep their usual headings, so links keep working.

Every new terrain (from the terrain tool, the palette editor, a new palette or a palette note) gets its description and encounter tables right away, empty. Renaming a terrain renames its tables. Table pickers (the Random Tables list, workflow steps, the roll dropdown) list your own tables first and these, with the region encounter tables, under a collapsed **Made by the map** heading.

**Links between plugin notes.** A map note's palette, a palette's child palette, a generator's palette, source regions and blended generators, a save's generator and a world types row's Palette are links to those notes (`palette: "[[world/palettes/Default]]"`), so renaming one in Obsidian updates them. Plain names still read. Older notes were converted once, after a backup.

**Deep maps.** When the breadcrumb doesn't fit beside the top **+** / **−** buttons, its middle maps fold into **…** (hover to see them, click to go one level up from the last one shown).

**Templates**: the plugin keeps its note templates in one folder (**Settings → Templates folder**, `templates` in the world folder by default): `hex.md` for hex notes and `town.md` for new towns made from the hex editor. Edit them there and new notes follow.

## Missing maps

If a map's folder and map note were deleted outside the plugin, the map isn't re-created empty. It shows with a ⚠ in the map list, and opening it shows **Restore** (puts its map note back from the last saved copy: hexes, paths and settings) and **Remove** (drops it from the list; no files are deleted).

## Make a generator from a region

**Edit region… → Make generator…** (or right-click a map in **Maps**) learns a generator from the region as you painted it. Choose **New generator** or **Overwrite existing**; the list puts the region's own biome's generator and its parent biomes' first. Overwriting keeps a backup. A new generator gets a biome that copies the region's biome (climate, islands, transitions, shore, mix).

## Palettes

Deleted palettes stay deleted, the last one too. **Settings → Add default palettes** puts the built-in ones back.


**Expanded** is the default fantasy palette on new installs (if you used the plugin before, new maps keep starting on your first palette): more terrains (coasts, wetlands, forest and mountain kinds) and it matches the generators. **Limited** has fewer, simpler terrains and is quicker to paint. Pick any palette as the start for new maps in **Settings → Palette for new maps**. Expanded now has **savanna** and **river delta** too (World biomes paints those biomes with them); an Expanded palette you already have gets them once, after a backup, unless it already has terrains of those names. Delete them and they stay deleted.

No palette or terrain is special because of its name. What a terrain does comes from its **Type**: water types are impassable to auto-routes, generators place terrain by type, Orbits puts the *moon*-type terrain beside planets and the *jump point* past the last orbit. Rename anything, or build a palette from scratch, and it works the same once its terrains have types. On space maps a faint dashed tether joins each moon to the planet beside it (hidden with the paths; the PNG export draws it when paths are included).

Palette menus (setup, New map, new submap) show the picked palette's terrains as colour swatches; hover one for its name. A terrain with no type gets no defaults and generators skip it; **Guess types from names** in the palette editor fills the Type column for you to check.

## Rolling from a hex

Rolls made from the hex editor (🎲 on an encounter table, 📖 on a section) have **Add to this hex**: pick a section and the result is appended to it. With workflows on, **Run workflow** beside the hex title runs a workflow for this hex, and its result can be added the same way. Weather and Hooks & Rumors (under Notes) roll the map's weather and rumours tables, set in **Maps → Properties**; ⋯ next to the roll button picks a table for one hex.
