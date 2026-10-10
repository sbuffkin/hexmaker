---
hex-wfc: 1
name: biome-jungle
example-hexes: 983
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
speck-size: 1
edge-smoothing: 0.3
counts: "urban 0-2; grass 1-4"
---

# biome-jungle

A hand-made tropical jungle biome (not learned from a map): dense jungle heavy
as the background, lighter jungle and jungle hills in patches, a few jungle-clad
mountain massifs (jungle mountain hexes only inside jungle mountains), and wide
brown rivers. The rivers are a guaranteed water *Feature* (two hexes wide) that
flows out of an inland swamp basin to the map edge; swamp and marsh only grow
within a few hexes of water (*Near* column), so the wetlands line the rivers.
River paths feed in from the edges, creeks run down from the mountains, and the
rare clearing (grass) and lost ruin (urban) sit only next to jungle. No roads.

To tweak it: change *Count* in Features for more or fewer big rivers (they scale
with map size), and the water *Width* (1 to 3) for narrower or broader rivers.
Raise swamp/marsh *Weight* or their *Near* distance for wider wetland belts.
Raise jungle mountains for a more mountainous interior, or grass and the `counts`
for more clearings and ruins. Adjacency is the main structure: unlisted pairs can
never touch (mountains never touch rivers or swamp; grass never touches heavy jungle).

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| jungle heavy | 420 |  | none |  |  |  | 1 |  |
| jungle | 200 | 3 | blob |  |  |  | 1 |  |
| jungle hills | 110 | 3 | blob |  |  |  | 1.2 |  |
| swamp | 90 | 2.5 | blob |  |  |  | 0.8 | water 3 |
| jungle mountains | 35 | 2 | blob |  |  |  | 1.3 |  |
| water | 40 | 4 | line | 0.3 | 2 |  | 1 |  |
| marsh | 45 | 0.8 | blob |  |  |  | 0.8 | water 2 |
| jungle mountain | 25 |  | none |  |  |  | 1 |  |
| grass | 15 | 0.4 | blob |  |  |  | 0.5 |  |
| urban | 3 |  | scatter |  |  | 10 | 0.3 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| jungle heavy | jungle heavy | 300 |
| jungle heavy | jungle | 120 |
| jungle heavy | jungle hills | 40 |
| jungle heavy | swamp | 70 |
| jungle heavy | marsh | 25 |
| jungle heavy | water | 15 |
| jungle heavy | urban | 3 |
| jungle | jungle | 100 |
| jungle | jungle hills | 50 |
| jungle | swamp | 25 |
| jungle | marsh | 25 |
| jungle | water | 25 |
| jungle | grass | 20 |
| jungle | urban | 5 |
| jungle hills | jungle hills | 80 |
| jungle hills | jungle mountains | 40 |
| jungle hills | jungle mountain | 30 |
| jungle hills | grass | 5 |
| jungle hills | urban | 3 |
| jungle mountains | jungle mountains | 60 |
| jungle mountains | jungle mountain | 30 |
| jungle mountain | jungle mountain | 10 |
| swamp | swamp | 60 |
| swamp | marsh | 50 |
| swamp | water | 40 |
| marsh | marsh | 30 |
| marsh | water | 50 |
| marsh | grass | 5 |
| water | water | 100 |
| grass | grass | 10 |
| grass | urban | 5 |
| urban | water | 2 |

## Features

| Terrain | From | To | Count |
| --- | --- | --- | ---: |
| water | swamp | edge | 2 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | edge | water | 1 | 0.6 | 40 | jungle heavy 50%; jungle 25%; swamp 15%; marsh 10% |
| creek | jungle mountains | water | 1 | 0.6 | 35 | jungle hills 50%; jungle heavy 30%; jungle 20% |
