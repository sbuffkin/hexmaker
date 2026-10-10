---
hex-wfc: 1
name: preset-deep-forest
example-hexes: 1000
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
edge-strength: 1
speck-size: 1
edge-smoothing: 0.3
counts: "urban 1-2; marsh 1-"
directional-bias: 1
---

# preset-deep-forest

A hand-written preset for a deep, old forest: heavy mixed, evergreen and broadleaf woods, thinning to lighter forest near the map edge, with small clearings, boggy hollows, wooded hills, a stream or two, a winding trail and one or two tiny hamlets. To tweak it: raise or lower a terrain's *Weight* to change how much of it there is, its *Patch %* to change patch size, and its *Edge* to push it toward (above 1) or away from (below 1) the border. Use `mix` in the frontmatter (e.g. `mix: "evergreen heavy 1.5"`) for quick changes and `counts` for the number of hamlets.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| mixed forest heavy | 235 | 6 | blob |  |  |  | 0.6 |
| evergreen heavy | 200 | 5 | blob |  |  |  | 0.6 |
| forest heavy | 150 | 4 | blob |  |  |  | 0.6 |
| mixed forest | 90 |  | none |  |  |  | 2.5 |
| forest | 60 |  | none |  |  |  | 2.5 |
| evergreen | 50 |  | none |  |  |  | 2.5 |
| forested hills | 60 | 1.2 | blob |  |  |  | 0.5 |
| mixed forest hills | 40 | 1 | blob |  |  |  | 0.5 |
| evergreen hills | 35 | 1 | blob |  |  |  | 0.5 |
| grass | 32 | 0.5 | blob |  |  |  | 0.5 |
| marsh | 18 | 0.35 | blob |  |  |  | 0.5 |
| bog | 12 | 0.25 | blob |  |  |  | 0.3 |
| urban | 3 |  | scatter |  |  | 12 | 0.5 |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| mixed forest heavy | mixed forest heavy | 600 |
| evergreen heavy | evergreen heavy | 500 |
| forest heavy | forest heavy | 400 |
| mixed forest | mixed forest | 120 |
| forest | forest | 80 |
| evergreen | evergreen | 70 |
| forested hills | forested hills | 80 |
| mixed forest hills | mixed forest hills | 50 |
| evergreen hills | evergreen hills | 40 |
| grass | grass | 30 |
| marsh | marsh | 10 |
| bog | bog | 8 |
| mixed forest heavy | evergreen heavy | 120 |
| mixed forest heavy | forest heavy | 120 |
| mixed forest heavy | mixed forest | 80 |
| mixed forest heavy | forest | 20 |
| mixed forest heavy | evergreen | 20 |
| mixed forest heavy | mixed forest hills | 40 |
| mixed forest heavy | forested hills | 20 |
| mixed forest heavy | grass | 6 |
| mixed forest heavy | marsh | 10 |
| mixed forest heavy | bog | 6 |
| mixed forest heavy | urban | 3 |
| evergreen heavy | evergreen | 70 |
| evergreen heavy | mixed forest | 50 |
| evergreen heavy | evergreen hills | 40 |
| evergreen heavy | mixed forest hills | 25 |
| evergreen heavy | grass | 4 |
| evergreen heavy | bog | 8 |
| forest heavy | forest | 60 |
| forest heavy | mixed forest | 25 |
| forest heavy | forested hills | 40 |
| forest heavy | grass | 6 |
| forest heavy | marsh | 10 |
| mixed forest | forest | 40 |
| mixed forest | evergreen | 40 |
| mixed forest | mixed forest hills | 15 |
| mixed forest | grass | 25 |
| mixed forest | marsh | 10 |
| mixed forest | urban | 4 |
| forest | grass | 25 |
| forest | forested hills | 15 |
| forest | marsh | 8 |
| forest | urban | 4 |
| evergreen | evergreen hills | 15 |
| evergreen | grass | 15 |
| evergreen | bog | 6 |
| evergreen | urban | 2 |
| forested hills | mixed forest hills | 15 |
| mixed forest hills | evergreen hills | 15 |
| grass | marsh | 8 |
| grass | urban | 8 |
| marsh | bog | 10 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| stream | marsh | edge | 1 | 0.5 | 45 | forest heavy 30%; mixed forest heavy 25%; marsh 15%; grass 10%; mixed forest 10%; forest 10% |
| stream | none | marsh | 1 | 0.5 | 35 | forest heavy 30%; mixed forest heavy 30%; evergreen heavy 15%; marsh 15%; grass 10% |
| trail | edge | urban | 1 | 0.65 | 60 | mixed forest heavy 40%; forest heavy 20%; evergreen heavy 15%; grass 15%; mixed forest 5%; forest 5% |
| trail | path | edge | 1 | 0.65 | 50 | mixed forest heavy 40%; forest heavy 20%; evergreen heavy 15%; grass 15%; mixed forest 5%; forest 5% |

## Layout

| Terrain | NW | N | NE | W | C | E | SW | S | SE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| urban | 0.3 | 0.7 | 0.3 | 0.7 | 3 | 0.7 | 0.3 | 0.7 | 0.3 |
