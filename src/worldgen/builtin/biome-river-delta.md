---
hex-wfc: 1
name: biome-river-delta
example-hexes: 935
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
directional-bias: 2
speck-size: 1
edge-smoothing: 0.3
counts: "urban 1-3"
impassable: "ocean; shallows"
---

# biome-river-delta

A hand-written preset (not learned from a map) for a great river delta: one big river enters from the north and runs to the sandbars at the middle of the delta front, with distributaries splitting off it to the shallows and beaches, across flat marsh, swamp and wet grassland. Braided water channels (thin *line* water, fed by streams) wind between the islands; sandbars (beach, kept within 2 hexes of the shallows by *Near*) fringe the shallows, which ring the open sea along the south side, with the sea coming in closest at the south corners so the delta lobe bulges out in the middle. A little riverine forest, one to three hamlets (urban, with a trail out) sit on the drier ground upstream. To tweak it: raise the water weight or *Patch %* for more channels; add `paths: "River: path > beach = count 2"` (or the same for `path > shallows`) for more distributaries, although each extra copy of a route tends to run beside the first; edit the ocean, shallows and beach Layout rows to move the sea to another side (and change the main River's `edge-N` to the opposite side); lower `directional-bias` for a softer coast when blending with another biome.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| grass | 90 |  | none |  |  |  | 1 |  |
| marsh | 220 | 3 | blob |  |  |  | 1 |  |
| ocean | 170 |  | none |  |  |  | 1 |  |
| shallows | 120 |  | none |  |  |  | 1 |  |
| water | 130 | 3 | line | 0.3 | 1 |  | 0.3 |  |
| swamp | 110 | 2 | blob |  |  |  | 0.8 |  |
| beach | 40 | 0.5 | line | 0.3 | 1 |  | 0.6 | shallows 2 |
| forest | 20 | 1.5 | blob |  |  |  | 1 |  |
| bog | 30 | 0.6 | blob |  |  |  | 0.6 |  |
| urban | 5 |  | scatter |  |  | 8 | 0.3 |  |

## Adjacency

Land never touches the open ocean: it meets the sea through shallows. Channels (water) run through every wet terrain and out into the shallows.

| Terrain | Next to | Weight |
| --- | --- | ---: |
| ocean | ocean | 150 |
| ocean | shallows | 40 |
| shallows | shallows | 80 |
| shallows | beach | 30 |
| shallows | water | 25 |
| shallows | marsh | 20 |
| shallows | swamp | 5 |
| beach | beach | 15 |
| beach | marsh | 20 |
| beach | grass | 15 |
| beach | water | 10 |
| water | water | 30 |
| water | marsh | 60 |
| water | swamp | 30 |
| water | grass | 40 |
| water | bog | 5 |
| water | forest | 8 |
| water | urban | 3 |
| marsh | marsh | 120 |
| marsh | swamp | 40 |
| marsh | grass | 60 |
| marsh | bog | 20 |
| swamp | swamp | 60 |
| swamp | grass | 15 |
| swamp | bog | 15 |
| swamp | forest | 15 |
| bog | bog | 10 |
| grass | grass | 180 |
| grass | forest | 40 |
| grass | urban | 6 |
| forest | forest | 50 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | edge-N | beach | 1 | 0.3 | 70 | grass 30%; marsh 40%; swamp 15%; water 15% |
| River | path | shallows | 1 | 0.8 | 35 | marsh 45%; swamp 20%; grass 15%; water 20% |
| River | path | beach | 1 | 0.8 | 35 | marsh 50%; swamp 25%; water 15%; beach 10% |
| stream | water | shallows | 1 | 0.4 | 20 | marsh 60%; swamp 20%; beach 20% |
| stream | water | beach | 1 | 0.5 | 20 | marsh 60%; swamp 25%; grass 15% |
| trail | urban | edge | 1 | 0.4 | 30 | grass 70%; marsh 30% |

## Layout

Rows run north (R1, upstream) to south (R5, the sea). The delta front bulges out in the middle, so open sea comes in closer at the south corners.

| Terrain | R1C1 | R1C2 | R1C3 | R1C4 | R1C5 | R2C1 | R2C2 | R2C3 | R2C4 | R2C5 | R3C1 | R3C2 | R3C3 | R3C4 | R3C5 | R4C1 | R4C2 | R4C3 | R4C4 | R4C5 | R5C1 | R5C2 | R5C3 | R5C4 | R5C5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ocean | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.005 | 0.005 | 0.005 | 0.005 | 0.005 | 0.3 | 0.1 | 0.03 | 0.1 | 0.3 | 2.5 | 1 | 0.2 | 1 | 2.5 | 6 | 5 | 4 | 5 | 6 |
| shallows | 0.005 | 0.005 | 0.005 | 0.005 | 0.005 | 0.1 | 0.1 | 0.05 | 0.1 | 0.1 | 0.8 | 0.5 | 0.3 | 0.5 | 0.8 | 3 | 3 | 2 | 3 | 3 | 2 | 2.5 | 3 | 2.5 | 2 |
| beach | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.5 | 0.6 | 0.8 | 0.6 | 0.5 | 1.5 | 2.5 | 4 | 2.5 | 1.5 | 0.8 | 1.2 | 2 | 1.2 | 0.8 |
| water | 0.8 | 0.9 | 1 | 0.9 | 0.8 | 1 | 1.2 | 1.3 | 1.2 | 1 | 1.2 | 1.4 | 1.5 | 1.4 | 1.2 | 1 | 1.3 | 1.5 | 1.3 | 1 | 0.05 | 0.1 | 0.2 | 0.1 | 0.05 |
| marsh | 0.8 | 0.9 | 1 | 0.9 | 0.8 | 1 | 1.1 | 1.2 | 1.1 | 1 | 1.4 | 1.5 | 1.6 | 1.5 | 1.4 | 1.2 | 1.4 | 1.6 | 1.4 | 1.2 | 0.2 | 0.4 | 0.6 | 0.4 | 0.2 |
| swamp | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 1.2 | 1.2 | 1.2 | 1.2 | 1.2 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1 | 1 | 1.2 | 1 | 1 | 0.2 | 0.2 | 0.3 | 0.2 | 0.2 |
| grass | 1.8 | 1.8 | 1.8 | 1.8 | 1.8 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1 | 1 | 1 | 1 | 1 | 0.4 | 0.5 | 0.6 | 0.5 | 0.4 | 0.1 | 0.1 | 0.2 | 0.1 | 0.1 |
| forest | 2.5 | 2.5 | 2.5 | 2.5 | 2.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 |
| urban | 2 | 2 | 2 | 2 | 2 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 |
