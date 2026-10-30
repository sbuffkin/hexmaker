---
hexmaker-map: 3
display-name: Compat Example
palette: Default
cols: 14
rows: 10
offset-x: 0
offset-y: 0
stagger: odd
base-terrain: grass
swatch-terrain: forest
weather-table: "[[world/tables/weather]]"
created-with: "1.5.6"
show-coords: true
show-gm-layer: false
hidden-link-badges: [Quests]
grid-display-scale-x: 1.0123
grid-display-offset-x: -3.3333
parent: "[[_compat-world]]"
parent-hex: 3, 4
world: w-compat
world-x: 1
world-y: -1
background-image: "[[world/maps/compat example.png]]"
background-x: 12.5
background-y: -4
background-scale: 1.25
background-rotation: 0
background-opacity: 0.8
biome: preset-valley
biome-from: [preset-deep-forest]
hexmaker-origin-x: 2
---
# Compat Example

> [!info]- How to edit this note
> This note holds the map's data. Painting on the map updates it, and your edits here update the map.
> - **Hexes**: one row per hex that has something set. *Hex* is the column and row, like `3_4`. *Terrain* uses names from the map's palette; *Region* links the region's note. *Icon* and *GM icons* are icon file names; separate several with commas. *Locations* links the maps that open from the hex (towns, dungeons…), separated by commas; *Region map*, when there is one, is the map of the hex itself. *Locked* `yes` keeps generators off it.
> - **Paths**: *Type* is a path type (Road, River…). *Hexes* lists its hexes in order, separated by spaces.
> - Columns can be in any order, and you can add your own; they're kept. A row that can't be read is kept as written and flagged.
> - The properties at the top are the map's settings. Delete one to reset it. Keys starting with `hexmaker-` come from other versions of the plugin; leave them be.
> - Everything else in this note, like text you write below the tables, is yours: the plugin never changes it.

## Hexes

| Hex | Name | Terrain | Icon | GM icons | Region | Region map | Locations | Locked | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6_2 |  | grass |  |  |  |  |  |  | a newer build's column |
| 3_3 |  | shallows |  |  |  |  |  |  |  |
| 4_3 |  | shallows |  |  |  |  |  |  |  |
| 5_3 |  | shallows |  |  |  |  |  |  |  |
| 2_4 |  | shallows |  |  |  |  |  |  |  |
| 3_4 | Glass Wastes | hills | bw-castle.png | skull.png, trap.png | [[Basin]] | [[_compat-example-region]] | [[_compat-example-3-4]], [[_compat-example-inn]] | yes |  |
| 4_4 |  | shallows |  |  |  |  |  |  |  |
| 5_4 |  | shallows |  |  |  |  |  |  |  |
| 6_4 |  | shallows |  |  |  |  |  |  |  |
| 2_5 |  | shallows |  |  |  |  |  |  |  |
| 3_5 |  | shallows |  |  |  |  |  |  |  |
| 4_5 |  | shallows |  |  |  |  |  |  |  |
| 5_5 |  | shallows |  |  |  |  |  |  |  |
| 6_5 |  | shallows |  |  |  |  |  |  |  |
| 2_6 |  | shallows |  |  |  |  |  |  |  |
| 3_6 |  | shallows |  |  |  |  |  |  |  |
| 4_6 |  | shallows |  |  |  |  |  |  |  |
| 5_6 |  | shallows |  |  |  |  |  |  |  |
| 6_6 |  | shallows |  |  |  |  |  |  |  |
| 3_7 |  | shallows |  |  |  |  |  |  |  |
| 4_7 |  | shallows |  |  |  |  |  |  |  |
| 5_7 |  | shallows |  |  |  |  |  |  |  |

## Paths

| Type | Hexes |
| --- | --- |
| Road | 0_8 1_8 2_8 3_8 4_8 5_8 6_8 7_8 8_8 9_8 10_8 11_8 12_8 13_8 |
| River | 4_0 4_1 4_2 4_3 4_4 4_5 |
