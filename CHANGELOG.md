# Changelog

One short sentence per change. The upgrade note a vault gets after updating
("Hexmaker upgrade <date>", in the world folder) lists the points newer than
the version it came from.

## Unreleased

### Before you update

- Update every device that shares this vault first: older versions can't read the new map notes.
- The first start after updating moves your data into notes and backs everything up first; it can take a few minutes on a big vault.

### Your data

- Each map's terrain, icons, areas and paths now live in one map note, `_<map>.md`, in the map's folder.
- Hex notes keep all their text and link their map note under `map:`.
- Terrain palettes are now notes in the palettes folder that you can read and edit.
- Random tables show each row's roll range for their die, so you can roll them by hand.
- Old filled Terrain and Region lines in hex notes move into the note's Map data box.
- Every upgrade backs up what it changes first, under the plugin's backups folder.
- A "Hexmaker upgrade <date>" note in your world folder lists what changed, the backups, and anything to check.
- New commands open the backups folder and restore notes from an upgrade backup.
- Named zones on a map are called areas everywhere, in notes too (`> Area:`, an Area column); old names still read.
- data.json carries a data format number, so an older version can tell the vault was updated.

### Maps

- Maps can have region and location submaps, listed as a tree in the Maps list.
- The breadcrumb shows the maps above this one and the maps beside it.
- Maps can be each other's submaps; navigation handles it without changing anything.
- Hexes can have names, shown on the map with your choice of font.
- A small legend in the corner shows the map's terrains and folds to a chip.
- Maps have work modes (Build, Play, God) that decide what a click can change, each with its own undo.

### Paths

- Paths are named, with anchors, and the map routes the way between them.
- Path types belong to palettes, and every behaviour of a type is an option you set.
- Routes stay where they are when the terrain changes, unless you reroute them.

### Generators and setup

- The setup wizard asks what you'll map and installs only what that needs.
- New maps can be generated with a preview, Reroll and a few tuning sliders.
- Expanded is the default palette for new vaults, with savanna and river delta added to existing copies.
<!-- slice:worldmaps -->
### World maps

- Overworlds: one biome per hex, each hex opening into a region that blends with its neighbours.
- Biomes are notes you can edit, with their own mix, climate and transitions.
- Paths that cross from one region into another show on the overworld.
<!-- /slice -->
<!-- slice:space -->
### Space

- Space maps: star sectors, star systems and planet surfaces, with their own palettes and generators.
- World types notes decide which worlds the space generators place.
<!-- /slice -->

### Tables and workflows

- Tables can roll on other tables, with typed rows and conditions.
- Workflows write readable results notes and keep their template in step.
- Hex editor rolls can go straight into a section of the hex note.

### Everything else

- Each page has an Advanced dropdown for the less common options, and a Debug section in debug mode.
- Places icons: settlements, castles, towers, ruins, temples, camps and caves.
- Exported notes say where they came from.
