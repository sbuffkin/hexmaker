---
hex-wfc: 1
name: biome-savanna
example-hexes: 920
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
speck-size: 1
edge-smoothing: 0.3
counts: "water 3-6"
paths: "River: jungle > edge = follow 2; River: path > water = follow 2"
---

# biome-savanna

A hand-written biome preset (not learned from a map) for tropical savanna: open grassland with patches of bare red earth (desert), scattered single trees (forest, `scatter`), thornbush (cactus clumps, the odd cactus heavy thicket) and small rocky kopjes (hills fringed with desert rocky, kept within 2 hexes of a hill by *Near*). Seasonal waterholes (single water hexes) are ringed by marsh (*Near* water 2). One gallery forest runs from a lake to the map edge: a 2-wide jungle line drawn as a *Feature*, flanked by jungle heavy (*Near* jungle 2), with a river that follows it (`follow 2`), a tributary from a waterhole and a game trail between pools. No *Layout*, so the biome is uniform and blends cleanly with neighbours. To tweak it: raise desert for a drier, more Sahelian look, or forest for wooded savanna; change `counts` for more or fewer waterholes; set the Feature count to 0 to drop the gallery forest (and switch off the River rows), or 2 for two rivers.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| grass | 420 |  | none |  |  |  | 1 |  |
| desert | 100 | 0.8 | blob |  |  |  | 1 |  |
| forest | 55 |  | scatter |  |  | 2 | 1 |  |
| cactus | 70 | 0.3 | blob |  |  |  | 1 |  |
| cactus heavy | 20 |  | scatter |  |  | 4 | 0.8 |  |
| hills | 60 | 0.3 | blob |  |  |  | 1 |  |
| desert rocky | 50 |  | none |  |  |  | 1 | hills 2 |
| jungle | 30 |  | line | 0.2 | 2 |  | 1 |  |
| jungle heavy | 60 |  | none |  |  |  | 1 | jungle 2 |
| marsh | 40 |  | none |  |  |  | 0.5 | water 2 |
| water | 15 |  | scatter |  |  | 7 | 0.2 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| grass | grass | 500 |
| grass | desert | 80 |
| desert | desert | 100 |
| grass | forest | 120 |
| desert | forest | 10 |
| grass | cactus | 50 |
| desert | cactus | 40 |
| cactus | cactus | 5 |
| cactus | cactus heavy | 10 |
| grass | cactus heavy | 10 |
| desert | cactus heavy | 10 |
| hills | hills | 12 |
| grass | hills | 60 |
| hills | desert rocky | 40 |
| desert rocky | desert rocky | 5 |
| grass | desert rocky | 30 |
| desert | desert rocky | 30 |
| desert | hills | 15 |
| hills | cactus | 5 |
| hills | forest | 5 |
| water | grass | 20 |
| water | water | 3 |
| water | marsh | 30 |
| water | jungle | 15 |
| water | jungle heavy | 10 |
| marsh | marsh | 10 |
| marsh | grass | 30 |
| marsh | jungle | 10 |
| marsh | jungle heavy | 10 |
| jungle | jungle | 30 |
| jungle | grass | 40 |
| jungle | jungle heavy | 60 |
| jungle | hills | 5 |
| jungle | desert | 5 |
| jungle heavy | jungle heavy | 30 |
| jungle heavy | grass | 30 |
| jungle heavy | forest | 5 |

## Features

| Terrain | From | To | Count |
| --- | --- | --- | ---: |
| jungle | water | edge | 1 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | jungle | edge | 1 | 0 | 50 | jungle 85%; jungle heavy 10%; grass 5% |
| River | path | water | 1 | 0 | 50 | jungle 85%; jungle heavy 10%; grass 5% |
| River | water | path | 1 | 0.3 | 25 | grass 60%; jungle heavy 20%; marsh 20% |
| trail | water | water | 1 | 0.3 | 40 | grass 70%; desert 20%; desert rocky 10% |
