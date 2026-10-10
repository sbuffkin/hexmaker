---
hex-wfc: 1
name: preset-archipelago
example-hexes: 920
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
edge-terrain: ocean
edge-strength: 0.6
scatter: 15
mix-strength: 1.5
speck-size: 2
counts: "beach 4-; urban 1-4"
---

# preset-archipelago

A hand-written archipelago preset (not learned from a map): open ocean with trench basins, a fixed ocean border (`edge-terrain`), and a few islands of varied size between them. The rings come from the adjacency rules: land may only touch beach, beach only land or shallows, and shallows only beach or ocean. So every island gets a beach rim and a band of shallows. Jungle islands can rise through heavy jungle and jungle hills to a mountain and peak. Grass and forest make smaller plain islands, a dormant volcano can sit on an islet, and urban ports sit just inside the beach. The beach and shallows weights are deliberately low: their rings are forced anyway, and higher weights grow sandbars that stitch islands together. To tweak: `counts: "beach N-"` asks for at least N separate shorelines (the solver keeps the best of several tries). Lower the ocean weight or raise `mix-strength` for more land, which also means more merging. Raise the jungle *Patch %* for bigger islands. `edge-strength` sets the width of the open-ocean border.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| ocean | 520 |  | none |  |  |  |  |
| trench | 40 | 2 | blob |  |  |  |  |
| shallows | 130 |  | none |  |  |  |  |
| beach | 20 |  | none |  |  |  |  |
| jungle | 80 | 1 | blob |  |  |  |  |
| grass | 30 | 0.6 | blob |  |  |  |  |
| forest | 25 | 0.6 | blob |  |  |  |  |
| jungle heavy | 25 | 0.8 | blob |  |  |  |  |
| jungle hills | 25 | 0.8 | blob |  |  |  |  |
| jungle mountain | 10 | 0.4 | blob |  |  |  |  |
| peak | 5 |  | scatter |  |  | 6 |  |
| urban | 4 |  | scatter |  |  | 8 |  |
| volcano dormant | 6 |  | scatter |  |  | 7 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| ocean | ocean | 1500 |
| ocean | trench | 120 |
| ocean | shallows | 300 |
| trench | trench | 200 |
| shallows | shallows | 40 |
| shallows | beach | 300 |
| beach | beach | 30 |
| beach | jungle | 1200 |
| beach | grass | 500 |
| beach | forest | 400 |
| beach | jungle heavy | 150 |
| beach | urban | 60 |
| beach | volcano dormant | 200 |
| jungle | jungle | 1600 |
| jungle | jungle heavy | 250 |
| jungle | jungle hills | 250 |
| jungle | urban | 30 |
| jungle | volcano dormant | 80 |
| grass | grass | 500 |
| grass | urban | 50 |
| forest | forest | 400 |
| jungle heavy | jungle heavy | 400 |
| jungle heavy | jungle hills | 150 |
| jungle heavy | jungle mountain | 100 |
| jungle hills | jungle hills | 400 |
| jungle hills | jungle mountain | 250 |
| jungle hills | volcano dormant | 80 |
| jungle mountain | jungle mountain | 150 |
| jungle mountain | peak | 120 |
