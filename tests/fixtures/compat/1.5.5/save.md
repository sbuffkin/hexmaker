---
hexmaker-save: 1
hexmaker-version: 1.5.5
name: compat-example-7
generator: compat-example
generator-path: world/generators/compat-example.md
palette: Default
seed: 7
size: 14x10
stagger: odd
orientation: flat
created: 2026-10-08
---

# compat-example-7

Generator save from **compat-example**: seed 7, 14×10. Load it from the terrain generator page.

## Settings

~~~~json
{
  "featureSize": 1.25,
  "randomness": 0.2,
  "edgeSmoothing": 0.5,
  "speckSize": 1,
  "keepRare": 0.05,
  "impassable": [
    "shallows"
  ],
  "connected": true,
  "mix": {
    "forest": 1.5
  },
  "counts": {
    "shallows": {
      "min": 1,
      "max": 2
    }
  },
  "drawPaths": true,
  "paths": {
    "Road: edge > edge": {
      "count": 1,
      "wiggle": 0.5,
      "as": "Road"
    }
  }
}
~~~~

## Terrain

~~~~hexmaker-terrain
legend: hills; forest; grass; shallows
0*7 1*7
0*7 1*7
0*7 1*7
2*2 0 2 0*3 1*7
2*3 3 2*3 1*7
2 3*5 2*2 1*6
2 3*6 2 1*6
2*2 3 2 3*3 2 1*6
2*8 1*6
2*8 1*6
~~~~

## Paths

~~~~json
[{"type":"Road","route":"Road: edge > edge","hexes":["6_9","7_8","7_7","7_6","7_5","6_5","5_4","4_4","3_3","2_4","1_3","0_3"]},{"type":"River","route":"River: edge > none","hexes":["5_0","6_1","7_1","8_2","9_1","10_1","11_0"]}]
~~~~

## Generator

~~~~hex-wfc
---
hex-wfc: 1
name: compat-example
example-hexes: 140
feature-size: 1.25
randomness: 0.2
edge-smoothing: 0.5
speck-size: 1
keep-rare: 0.05
connected: true
impassable: "shallows"
mix: "forest 1.5"
counts: "shallows 1-2"
draw-paths: true
paths: "Road: edge > edge = count 1, wiggle 0.5, as Road"
palette: Default
source-map: compat-example
created: 2026-10-08
hexmaker-version: 1.5.5
---

# compat-example

A wave function collapse generator. You can edit the tables and settings by hand.

- **Terrains**: *Weight* is how common the terrain is; 0 means the solver never places it.
  *Patch %* is the size of a typical patch as a share of the map, so patches scale
  with the map. *Shape* is how it spreads: `blob` (compact patches), `line` (long
  thin runs), `scatter` (single hexes) or `none` (left to the neighbour rules).
  *Turn* is how often a `line` changes direction (0 to 1) and *Width* its
  thickness (1 to 3). *Spacing* is the closest two `scatter` hexes may be.
  *Edge* is how common the terrain is along the map border (1 = as anywhere).
- **Adjacency**: pairs that may touch, and how often (higher is more likely).
  A pair that isn't listed can never touch, including a terrain next to itself.
  Order doesn't matter, so *A | B* also covers *B | A*.
- **Features** (optional): lines of terrain that are always placed. *From* and *To*
  are `edge`, `none` or a terrain name.
- **Paths** (optional): paths drawn over the terrain. *From* and *To* are `edge`,
  `none`, `path` (joins another path of the same type) or a terrain. *Through*
  is the share of the path on each terrain.
- **Layout** (optional): where each terrain sat in the example map, in a 3×3
  grid. 1 means as common there as anywhere; 3 means three times as common.
- Frontmatter settings (optional): `feature-size`, `directional-bias`, `clumping`,
  `mix-strength`, `scatter`, `randomness`, `edge-strength`, `edge-terrain`,
  `line-width`, `edge-smoothing`, `speck-size`, `keep-rare`, `symmetry`, `spacing`,
  `connected`, `impassable`,
  `mix`, `counts`, `features`, `draw-paths` and `paths` (per route, e.g.
  `Road: edge > peak = count 2, wiggle 1.5, as Trade road`).

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| grass | 59 | 42.14 | none |  |  |  | 0.95 |
| forest | 40 | 28.57 | blob |  |  |  | 1.21 |
| shallows | 21 | 15 | blob |  |  |  | 0.05 |
| hills | 20 | 14.29 | blob |  |  |  | 1.71 |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| grass | grass | 125 |
| grass | shallows | 34 |
| grass | hills | 19 |
| grass | forest | 15 |
| forest | forest | 93 |
| forest | hills | 4 |
| shallows | shallows | 46 |
| hills | hills | 37 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Road | edge | edge | 1 | 1 | 100 | grass 71%; forest 29% |
| River | edge | none | 1 | 0 | 43 | shallows 50%; hills 33%; grass 17% |

## Layout

| Terrain | NW | N | NE | W | C | E | SW | S | SE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| grass | 0.96 | 1.06 | 0.2 | 0.96 | 1.33 | 0.25 | 1.83 | 1.96 | 0.25 |
| forest | 0.17 | 0.17 | 3 | 0.21 | 0.21 | 2.88 | 0.21 | 0.21 | 2.88 |
| shallows | 0.72 | 0.44 | 0.2 | 3.37 | 2.32 | 0.25 | 0.91 | 0.56 | 0.25 |
| hills | 3.08 | 3.08 | 0.2 | 0.21 | 0.21 | 0.25 | 0.21 | 0.21 | 0.25 |
~~~~
