---
hex-wfc: 1
name: biome-taiga
example-hexes: 942
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
directional-bias: 1
speck-size: 1
counts: "water 8-"
---

# biome-taiga

A hand-written preset (not learned from a map) for taiga / boreal forest: dark evergreen and dense evergreen forest studded with many small lakes (1-3 hex blobs), bogs and marsh that stay within two hexes of open water (the *Near* column), rolling evergreen hills with the odd forested ridge and bare rocky hill, snow patches in the north and a fringe of mixed forest in the south (a mild 5×5 *Layout*, so the biome stays roughly uniform and blends well). Rivers drain from a lake to the map edge and short streams link bogs to lakes. Forests only meet water, bog, marsh or snow directly; mountains and bare hills sit inside the hills. To tweak it: raise the water weight (or `counts`) for more lakes, or its *Patch %* for bigger ones; raise bog/marsh for a wetter mire country; raise snow and its R1 Layout values for a colder north (or set `directional-bias: 0` to drop the north-south grading); edit the Paths counts for more or fewer rivers.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| evergreen | 330 | 4 | blob |  |  |  | 1 |  |
| evergreen heavy | 220 | 2 | blob |  |  |  | 1 |  |
| evergreen hills | 100 | 2 | blob |  |  |  | 1 |  |
| water | 110 | 0.2 | blob |  |  |  | 0.8 |  |
| bog | 45 | 0.35 | blob |  |  |  | 0.8 | water 2 |
| marsh | 25 |  | none |  |  |  | 0.8 | water 2 |
| snow | 25 | 1.5 | blob |  |  |  | 1.2 |  |
| hills | 25 |  | none |  |  |  | 1 |  |
| evergreen mountains | 22 | 1 | blob |  |  |  | 1 |  |
| mixed forest | 40 | 2 | blob |  |  |  | 1 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| evergreen | evergreen | 400 |
| evergreen | evergreen heavy | 200 |
| evergreen | evergreen hills | 60 |
| evergreen | water | 70 |
| evergreen | bog | 40 |
| evergreen | marsh | 20 |
| evergreen | snow | 30 |
| evergreen | hills | 15 |
| evergreen | mixed forest | 40 |
| evergreen heavy | evergreen heavy | 300 |
| evergreen heavy | evergreen hills | 40 |
| evergreen heavy | water | 50 |
| evergreen heavy | bog | 30 |
| evergreen heavy | mixed forest | 15 |
| evergreen hills | evergreen hills | 120 |
| evergreen hills | hills | 25 |
| evergreen hills | snow | 20 |
| evergreen hills | evergreen mountains | 40 |
| evergreen hills | water | 10 |
| water | water | 12 |
| water | bog | 40 |
| water | marsh | 25 |
| water | snow | 8 |
| water | mixed forest | 10 |
| bog | bog | 25 |
| bog | marsh | 20 |
| marsh | marsh | 10 |
| marsh | mixed forest | 8 |
| snow | snow | 80 |
| snow | hills | 15 |
| snow | evergreen mountains | 15 |
| hills | hills | 15 |
| hills | evergreen mountains | 10 |
| evergreen mountains | evergreen mountains | 60 |
| mixed forest | mixed forest | 80 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | water | edge | 3 | 0.3 | 45 | evergreen 45%; evergreen heavy 30%; bog 15%; water 10% |
| stream | bog | water | 2 | 0.4 | 15 | evergreen 50%; evergreen heavy 30%; bog 20% |

## Layout

| Terrain | R1C1 | R1C2 | R1C3 | R1C4 | R1C5 | R2C1 | R2C2 | R2C3 | R2C4 | R2C5 | R3C1 | R3C2 | R3C3 | R3C4 | R3C5 | R4C1 | R4C2 | R4C3 | R4C4 | R4C5 | R5C1 | R5C2 | R5C3 | R5C4 | R5C5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| snow | 4 | 4 | 4 | 4 | 4 | 1.2 | 1.2 | 1.2 | 1.2 | 1.2 | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 0.03 | 0.03 | 0.03 | 0.03 | 0.03 | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 |
| mixed forest | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 2.5 | 2.5 | 2.5 | 2.5 | 2.5 |
