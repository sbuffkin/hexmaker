---
hex-wfc: 1
name: biome-temperate-forest
example-hexes: 974
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
speck-size: 1
edge-smoothing: 0.3
counts: "water 2-4; urban 1-2"
impassable: "water"
---

# biome-temperate-forest

A hand-written biome preset (not learned from a map) for broadleaf and mixed temperate woodland: a matrix of mixed forest with large stands of heavy old-growth, lighter broadleaf forest, wooded hill country, grassy glades, a few small lakes fringed with marsh, streams and creeks running between them, and a road with a village or two. To tweak it: change *Weight* to shift the mix (raise grass for more open glades, mixed forest heavy for a darker wood), *Patch %* for bigger or smaller stands, `counts` for the number of lakes and villages, and the Paths table for more or fewer streams and roads.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| mixed forest | 290 |  | none |  |  |  | 1.3 |  |
| mixed forest heavy | 190 | 2.5 | blob |  |  |  | 0.8 |  |
| forest | 120 | 2 | blob |  |  |  | 1.2 |  |
| forest heavy | 50 | 1.5 | blob |  |  |  | 0.8 |  |
| forested hills | 80 | 2.5 | blob |  |  |  | 1 |  |
| mixed forest hills | 60 | 2 | blob |  |  |  | 1 |  |
| hills | 25 |  | none |  |  |  | 1 |  |
| grass | 80 | 0.4 | blob |  |  |  | 1 |  |
| water | 45 | 0.8 | blob |  |  |  | 0.4 |  |
| marsh | 30 |  | none |  |  |  | 0.6 | water 2 |
| urban | 4 |  | scatter |  |  | 10 | 0.3 |  |

## Adjacency

Lakes sit in glades or light wood (never against old-growth); hills stay inside the wooded hill country.

| Terrain | Next to | Weight |
| --- | --- | ---: |
| mixed forest | mixed forest | 250 |
| mixed forest | mixed forest heavy | 120 |
| mixed forest | forest | 90 |
| mixed forest | forest heavy | 20 |
| mixed forest | forested hills | 40 |
| mixed forest | mixed forest hills | 50 |
| mixed forest | grass | 50 |
| mixed forest | water | 15 |
| mixed forest | marsh | 15 |
| mixed forest | urban | 4 |
| mixed forest heavy | mixed forest heavy | 300 |
| mixed forest heavy | forest heavy | 50 |
| mixed forest heavy | mixed forest hills | 30 |
| mixed forest heavy | forested hills | 15 |
| mixed forest heavy | grass | 5 |
| forest | forest | 150 |
| forest | forest heavy | 50 |
| forest | forested hills | 40 |
| forest | grass | 40 |
| forest | water | 10 |
| forest | marsh | 10 |
| forest | urban | 3 |
| forest heavy | forest heavy | 100 |
| forest heavy | forested hills | 20 |
| forested hills | forested hills | 120 |
| forested hills | mixed forest hills | 50 |
| forested hills | hills | 30 |
| forested hills | grass | 10 |
| mixed forest hills | mixed forest hills | 90 |
| mixed forest hills | hills | 20 |
| hills | hills | 20 |
| hills | grass | 20 |
| grass | grass | 80 |
| grass | water | 20 |
| grass | marsh | 20 |
| grass | urban | 8 |
| water | water | 80 |
| water | marsh | 30 |
| marsh | marsh | 20 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Road | edge-W | edge-E | 1 | 0.3 | 100 | mixed forest 40%; forest 25%; grass 25%; mixed forest heavy 10% |
| Road | path | urban | 1 | 0.4 | 30 | grass 40%; mixed forest 40%; forest 20% |
| stream | water | edge | 2 | 0.5 | 40 | mixed forest 35%; forest 25%; mixed forest heavy 20%; grass 10%; marsh 10% |
| creek | forested hills | water | 1 | 0.5 | 30 | forested hills 30%; mixed forest 40%; forest 30% |
