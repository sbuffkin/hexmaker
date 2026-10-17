---
hex-wfc: 1
name: Fixture vale
example-hexes: 120
palette: Expanded
---

# Fixture vale

A wave function collapse generator. You can edit the tables and settings by hand.

- **Terrains**: *Weight* is how common the terrain is; 0 means the solver never places it.
  *Share* is worked out by the plugin (editing it does nothing): the terrain's share of
  the map by weight, and what the frontmatter `mix`, `counts` and `near` change.
  *Patch %* is the size of a typical patch as a share of the map, so patches scale
  with the map. *Shape* is how it spreads: `blob` (compact patches), `line` (long
  thin runs), `scatter` (single hexes) or `none` (left to the neighbour rules).
  *Turn* is how often a `line` changes direction (0 to 1) and *Width* its
  thickness (1 to 3). *Spacing* is the closest two `scatter` hexes may be.
  *Edge* is how common the terrain is along the map border (1 = as anywhere).
  *Near* keeps a terrain within some hexes of another, e.g. `volcano 3` for lava
  fields (steered while generating, strength from `clumping`, then enforced).
- **Adjacency**: pairs that may touch, and how often (higher is more likely).
  A pair that isn't listed can never touch, including a terrain next to itself.
  Order doesn't matter, so *A | B* also covers *B | A*.
- **Features** (optional): lines of terrain that are always placed. *From* and *To*
  are `edge`, `none` or a terrain name.
- **Paths** (optional): paths drawn over the terrain. *From* and *To* are `edge`,
  `edge-N`, `edge-E`, `edge-S`, `edge-W` (one side of the map), `none`, `path`
  (joins another path of the same type) or a terrain. *Through*
  is the share of the path on each terrain.
- **Layout** (optional): where each terrain sat in the example map, in a 3×3
  grid (NW … SE) or a finer 5×5 one (R1C1 … R5C5). 1 means as common there as
  anywhere; 3 means three times as common. Values blend smoothly between cells
  and `directional-bias` sets how strongly they apply (patches grow along them too).
- Frontmatter settings (optional): `feature-size`, `directional-bias`, `clumping`,
  `mix-strength`, `scatter`, `randomness`, `edge-strength`, `edge-terrain`,
  `line-width`, `edge-smoothing`, `speck-size`, `keep-rare`, `symmetry`, `spacing`,
  `connected`, `impassable`, `near`,
  `mix`, `counts`, `features`, `draw-paths` and `paths` (per route, e.g.
  `Road: edge > peak = count 2, wiggle 1.5, as Trade road`).

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near | Share |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| water | 30 | 25 | blob |  |  |  | 1.32 |  | 25% |
| forest | 28 | 14.76 | blob |  |  |  | 1.07 |  | 23% |
| grass | 28 | 23.33 | blob |  |  |  | 0.5 |  | 23% |
| hills | 24 | 20 | blob |  |  |  | 1.24 |  | 20% |
| shallows | 10 | 8.33 | none |  |  |  | 0.68 | water 1 | 8% |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| water | water | 65 |
| water | shallows | 19 |
| forest | forest | 49 |
| forest | grass | 41 |
| forest | hills | 6 |
| forest | shallows | 2 |
| grass | grass | 49 |
| grass | shallows | 12 |
| grass | hills | 9 |
| hills | hills | 51 |
| hills | shallows | 5 |
| shallows | shallows | 9 |

## Layout

| Terrain | NW | N | NE | W | C | E | SW | S | SE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| water | 2.6 | 0.2 | 0.2 | 2.5 | 0.25 | 0.25 | 2.5 | 0.25 | 0.25 |
| forest | 0.2 | 0.41 | 0.84 | 0.25 | 1.05 | 2.66 | 0.25 | 0.79 | 2.93 |
| grass | 0.2 | 0.84 | 0.41 | 0.25 | 2.66 | 1.05 | 0.25 | 2.93 | 0.79 |
| hills | 0.2 | 3.2 | 3.2 | 0.25 | 0.25 | 0.25 | 0.25 | 0.25 | 0.25 |
| shallows | 2.6 | 0.2 | 0.2 | 2.5 | 0.25 | 0.25 | 2.5 | 0.25 | 0.25 |
