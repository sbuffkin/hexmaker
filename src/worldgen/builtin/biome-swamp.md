---
hex-wfc: 1
name: biome-swamp
example-hexes: 875
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
directional-bias: 1
speck-size: 1
edge-smoothing: 0.2
impassable: "shallows; bog"
---

# biome-swamp

A hand-made wetland biome (not learned from a map): a mosaic of swamp, reed marsh and peat bog, threaded by meandering water channels and dotted with open meres (shallows), with drier hummocks of heavy and mixed forest and the odd wet meadow (grass). A slow river wanders across it from west to east with two tributaries, creeks drain the channels, and two causeway trails lead off the drier forest islands into the swamp. There are no hills and no coast, so it blends evenly with neighbouring biomes.

To tweak it: change *Weight* to shift the mix (raise bog for a peatland, marsh for open fen, swamp for a drowned forest). The water *Turn* and *Patch %* set how much the channels meander and how long they run, and the `water | water` adjacency weight how wide they get (raise it for lakes instead of channels). Forest only touches swamp, marsh, grass or other forest, never open water, so it always sits on islands. The Layout is mild (a little more open water in the middle) so the biome blends well with neighbours; set `directional-bias: 0` to drop it.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| swamp | 270 |  | none |  |  |  | 1 |  |
| marsh | 160 | 0.8 | blob |  |  |  | 1 |  |
| bog | 110 | 0.7 | blob |  |  |  | 1 |  |
| water | 85 | 0.3 | line | 0.7 | 1 |  | 1 |  |
| shallows | 20 | 0.3 | blob |  |  |  | 0.6 | water 1 |
| forest heavy | 80 | 0.6 | blob |  |  |  | 1 |  |
| mixed forest | 50 | 0.5 | blob |  |  |  | 1 |  |
| mixed forest heavy | 50 |  | none |  |  |  | 1 |  |
| grass | 50 |  | none |  |  |  | 1 |  |

## Adjacency

Wet ladder: open water (shallows, water) touches only wetland; forest and meadow sit on hummocks ringed by swamp and marsh.

| Terrain | Next to | Weight |
| --- | --- | ---: |
| shallows | shallows | 40 |
| shallows | water | 40 |
| shallows | marsh | 15 |
| water | water | 15 |
| water | swamp | 80 |
| water | marsh | 60 |
| water | bog | 25 |
| swamp | swamp | 300 |
| swamp | marsh | 120 |
| swamp | bog | 90 |
| swamp | forest heavy | 70 |
| swamp | mixed forest heavy | 40 |
| swamp | mixed forest | 20 |
| marsh | marsh | 160 |
| marsh | bog | 60 |
| marsh | grass | 50 |
| marsh | mixed forest | 30 |
| marsh | forest heavy | 15 |
| bog | bog | 120 |
| bog | mixed forest heavy | 15 |
| grass | grass | 30 |
| grass | mixed forest | 40 |
| forest heavy | forest heavy | 120 |
| forest heavy | mixed forest heavy | 50 |
| forest heavy | mixed forest | 30 |
| mixed forest heavy | mixed forest heavy | 40 |
| mixed forest heavy | mixed forest | 40 |
| mixed forest | mixed forest | 80 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | edge-W | edge-E | 1 | 0.6 | 60 | swamp 50%; marsh 35%; water 15% |
| River | path | none | 2 | 0.6 | 20 | swamp 60%; marsh 40% |
| trail | mixed forest | none | 2 | 0.5 | 25 | swamp 30%; marsh 25%; forest heavy 25%; mixed forest 20% |
| creek | water | none | 2 | 0.6 | 15 | swamp 60%; marsh 40% |

## Layout

Mild: a little more open water toward the middle, a little more forest toward the rim.

| Terrain | NW | N | NE | W | C | E | SW | S | SE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shallows | 0.6 | 0.8 | 0.6 | 0.8 | 2 | 0.8 | 0.6 | 0.8 | 0.6 |
| water | 0.9 | 1 | 0.9 | 1 | 1.4 | 1 | 0.9 | 1 | 0.9 |
| forest heavy | 1.3 | 1.1 | 1.3 | 1.1 | 0.7 | 1.1 | 1.3 | 1.1 | 1.3 |
| mixed forest | 1.3 | 1.1 | 1.3 | 1.1 | 0.7 | 1.1 | 1.3 | 1.1 | 1.3 |
