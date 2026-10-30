---
hex-wfc: 1
name: preset-valley
example-hexes: 950
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
directional-bias: 2
speck-size: 1
edge-smoothing: 0.3
counts: "water 1-2"
paths: "Road: path > mountain = as trail"
---

# preset-valley

A hand-made river valley (not learned from a map): a green valley floor running
west to east with a lake near the middle, rivers flowing from the lake out to the
valley ends, roads along the floor and a trail climbing into the hills. The valley
rises through hills and foothills into forested and bare mountains on both sides,
with snowy peaks along the north and south edges.

To tweak it: change *Weight* to shift the mix (raise grass for a wider floor).
The *Layout* table places the bands: swap the N/S and W/E columns for a
north-south valley. The Adjacency table is an elevation ladder: each band only
touches its neighbours, so removing a row can make the map impossible. Raise
`directional-bias` for stricter bands, or edit the Paths table (counts, Turn for
wiggle) for more or fewer rivers, roads and trails. Wide maps work best.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| grass | 320 |  | none |  |  |  | 1 |
| forest | 110 | 2 | blob |  |  |  | 1 |
| marsh | 20 | 0.8 | blob |  |  |  | 0.5 |
| water | 30 | 2 | blob |  |  |  | 0.2 |
| hills | 65 | 1.5 | blob |  |  |  | 1 |
| forested hills | 65 | 1.5 | blob |  |  |  | 1 |
| foothills | 65 |  | none |  |  |  | 1 |
| forested mountains | 90 |  | none |  |  |  | 0.7 |
| mountain | 80 |  | none |  |  |  | 1.2 |
| peak | 60 |  | none |  |  |  | 2 |
| mountains snow | 45 |  | none |  |  |  | 2.5 |

## Adjacency

Elevation ladder: each band may only touch itself and the bands next to it.

| Terrain | Next to | Weight |
| --- | --- | ---: |
| water | water | 60 |
| water | marsh | 15 |
| water | grass | 20 |
| water | forest | 8 |
| marsh | marsh | 15 |
| marsh | grass | 20 |
| marsh | forest | 10 |
| grass | grass | 300 |
| grass | forest | 80 |
| grass | hills | 50 |
| grass | forested hills | 25 |
| forest | forest | 150 |
| forest | forested hills | 40 |
| forest | hills | 15 |
| hills | hills | 80 |
| hills | forested hills | 40 |
| hills | foothills | 50 |
| forested hills | forested hills | 80 |
| forested hills | foothills | 40 |
| forested hills | forested mountains | 30 |
| foothills | foothills | 60 |
| foothills | forested mountains | 40 |
| foothills | mountain | 40 |
| forested mountains | forested mountains | 150 |
| forested mountains | mountain | 50 |
| forested mountains | peak | 10 |
| mountain | mountain | 120 |
| mountain | peak | 50 |
| mountain | mountains snow | 20 |
| peak | peak | 120 |
| peak | mountains snow | 50 |
| mountains snow | mountains snow | 90 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | water | edge-E | 2 | 0 | 35 | grass 70%; forest 20%; marsh 10% |
| River | path | peak | 2 | 0.3 | 30 | forested hills 30%; hills 20%; foothills 25%; forested mountains 25% |
| Road | grass | edge-W | 2 | 0 | 25 | grass 85%; forest 15% |
| Road | path | mountain | 1 | 0.5 | 35 | hills 30%; foothills 30%; forested hills 20%; mountain 20% |

## Layout

The valley sits in the middle row (W, C, E); mountains and snow sit in the top and bottom rows.

| Terrain | NW | N | NE | W | C | E | SW | S | SE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| grass | 0.05 | 0.05 | 0.05 | 3 | 3 | 3 | 0.05 | 0.05 | 0.05 |
| forest | 0.1 | 0.1 | 0.1 | 2.6 | 2.6 | 2.6 | 0.1 | 0.1 | 0.1 |
| marsh | 0.02 | 0.02 | 0.02 | 2 | 4 | 2 | 0.02 | 0.02 | 0.02 |
| water | 0.02 | 0.02 | 0.02 | 0.3 | 6 | 0.3 | 0.02 | 0.02 | 0.02 |
| hills | 0.6 | 0.6 | 0.6 | 1.5 | 1.5 | 1.5 | 0.6 | 0.6 | 0.6 |
| forested hills | 0.7 | 0.7 | 0.7 | 1.4 | 1.4 | 1.4 | 0.7 | 0.7 | 0.7 |
| foothills | 1.2 | 1.2 | 1.2 | 0.5 | 0.5 | 0.5 | 1.2 | 1.2 | 1.2 |
| forested mountains | 1.6 | 1.6 | 1.6 | 0.15 | 0.15 | 0.15 | 1.6 | 1.6 | 1.6 |
| mountain | 1.8 | 1.8 | 1.8 | 0.1 | 0.1 | 0.1 | 1.8 | 1.8 | 1.8 |
| peak | 3 | 3 | 3 | 0.01 | 0.01 | 0.01 | 3 | 3 | 3 |
| mountains snow | 3 | 3 | 3 | 0.01 | 0.01 | 0.01 | 3 | 3 | 3 |
