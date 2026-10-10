---
hex-wfc: 1
name: biome-grassland
example-hexes: 985
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
speck-size: 1
edge-smoothing: 0.3
counts: "water 2-5; Mountain Ridge 1-2"
---

# biome-grassland

A hand-written preset (not learned from a map) for open grassland and steppe: about two-thirds grass, with rolling hill country, patches of stony dry steppe (desert rocky), small copses of forest and mixed forest, and two to five lakes, each ringed by marsh (water may only touch marsh, so every shore is reedy). There is usually one lone ridge (Mountain Ridge, a short `line`) wrapped in foothills, which stay within two hexes of it (*Near*). Rivers run from the lakes to the map edge with a tributary up into the foothills, a road crosses the map west to east, and trails wander in to a lakeshore and out to the hills. There is no Layout, so it blends evenly with neighbouring biomes. To tweak it: raise grass (or lower hills) for flatter, emptier steppe; raise desert rocky for a drier steppe; change `counts` for more lakes or ridges; raise the forest Patch % for bigger woods; edit the Paths counts for more roads and rivers.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| grass | 580 |  | none |  |  |  | 1 |  |
| hills | 120 | 1.5 | blob |  |  |  | 1 |  |
| desert rocky | 40 | 1 | blob |  |  |  | 1 |  |
| forest | 45 | 0.3 | blob |  |  |  | 1 |  |
| mixed forest | 40 | 0.3 | blob |  |  |  | 1 |  |
| water | 40 | 0.8 | blob |  |  |  | 0.5 |  |
| marsh | 40 |  | none |  |  |  | 0.7 | water 2 |
| foothills | 45 |  | none |  |  |  | 1 | Mountain Ridge 2 |
| Mountain Ridge | 35 | 0.8 | line | 0.2 | 1 |  | 0.6 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| grass | grass | 1000 |
| grass | hills | 120 |
| grass | desert rocky | 40 |
| grass | forest | 60 |
| grass | mixed forest | 60 |
| grass | marsh | 40 |
| grass | foothills | 50 |
| hills | hills | 300 |
| hills | foothills | 50 |
| hills | forest | 15 |
| hills | mixed forest | 15 |
| hills | desert rocky | 20 |
| desert rocky | desert rocky | 100 |
| forest | forest | 120 |
| forest | mixed forest | 25 |
| mixed forest | mixed forest | 120 |
| forest | marsh | 5 |
| water | water | 60 |
| water | marsh | 100 |
| marsh | marsh | 30 |
| foothills | foothills | 50 |
| foothills | Mountain Ridge | 80 |
| Mountain Ridge | Mountain Ridge | 60 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | water | edge | 2 | 0.4 | 40 | grass 75%; marsh 10%; forest 5%; mixed forest 5%; hills 5% |
| River | path | foothills | 1 | 0.4 | 25 | grass 60%; hills 30%; foothills 10% |
| Road | edge-W | edge-E | 1 | 0.2 | 100 | grass 85%; hills 10%; desert rocky 5% |
| trail | edge | marsh | 1 | 0.5 | 40 | grass 90%; hills 10% |
| trail | path | hills | 1 | 0.5 | 25 | grass 80%; hills 20% |
