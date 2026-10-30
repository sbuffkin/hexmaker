---
hex-wfc: 1
name: biome-tundra
example-hexes: 974
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
directional-bias: 1.5
speck-size: 1
mix-strength: 1.5
edge-smoothing: 0.3
impassable: "mountains snow"
---

# biome-tundra

A hand-made arctic tundra biome (not learned from a map): a bleak, open mosaic of snowfields, low hills and summer tundra (grass), pocked with many small frozen lakes ringed by bog, with frost-shattered stony ground (desert rocky), sheltered pockets of sparse evergreen toward the south, and a snow-capped range rising through foothills along the north side. A meltwater river runs from the foothills south across the tundra, with lakes draining into it, and a trail crosses from west to east.

To tweak it: change *Weight* to shift the mix (raise snow for deep winter, grass for summer). Lakes are single-hex `scatter`: raise water *Spacing* for sparser lakes, or switch it to `blob` with a small *Patch %* for bigger ones. Bog and marsh must stay within reach of a lake (*Near*). The *Layout* table keeps the range in the north and the trees in the south: set `directional-bias: 0` for a uniform tundra, or move the mountains snow row to put the range on another side. The Adjacency table keeps mountains off the lakes and bogs (they climb through foothills), and trees out of the snowfields.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| snow | 250 | 1.2 | blob |  |  |  | 1 |  |
| grass | 200 | 1 | blob |  |  |  | 1 |  |
| hills | 140 | 0.7 | blob |  |  |  | 1 |  |
| water | 100 |  | scatter |  |  | 2 | 0.7 |  |
| bog | 45 | 0.2 | blob |  |  |  | 0.6 | water 1 |
| desert rocky | 40 | 0.6 | blob |  |  |  | 1 |  |
| foothills | 55 |  | none |  |  |  | 1 |  |
| mountains snow | 62 |  | none |  |  |  | 1.5 |  |
| evergreen | 28 | 0.4 | blob |  |  |  | 1 |  |
| evergreen hills | 14 |  | none |  |  |  | 1 |  |
| marsh | 15 | 0.3 | blob |  |  |  | 0.5 | water 2 |
| cliffs | 25 |  | none |  |  |  | 1 |  |

## Adjacency

Lakes sit in the lowland mosaic, ringed by bog; the range climbs through foothills and cliffs; trees only touch the tundra, not snowfields.

| Terrain | Next to | Weight |
| --- | --- | ---: |
| snow | snow | 300 |
| snow | grass | 120 |
| snow | hills | 120 |
| snow | water | 60 |
| snow | bog | 20 |
| snow | desert rocky | 40 |
| snow | foothills | 60 |
| snow | cliffs | 15 |
| grass | grass | 220 |
| grass | hills | 110 |
| grass | water | 90 |
| grass | bog | 70 |
| grass | marsh | 30 |
| grass | desert rocky | 40 |
| grass | evergreen | 60 |
| grass | evergreen hills | 20 |
| grass | foothills | 20 |
| hills | hills | 140 |
| hills | water | 40 |
| hills | bog | 15 |
| hills | desert rocky | 50 |
| hills | foothills | 80 |
| hills | evergreen | 30 |
| hills | evergreen hills | 30 |
| hills | cliffs | 15 |
| water | water | 6 |
| water | bog | 70 |
| water | marsh | 30 |
| water | desert rocky | 10 |
| bog | bog | 40 |
| bog | marsh | 20 |
| bog | evergreen | 15 |
| marsh | marsh | 10 |
| desert rocky | desert rocky | 40 |
| desert rocky | foothills | 30 |
| desert rocky | cliffs | 15 |
| foothills | foothills | 70 |
| foothills | mountains snow | 120 |
| foothills | cliffs | 25 |
| foothills | evergreen hills | 15 |
| cliffs | mountains snow | 40 |
| cliffs | cliffs | 10 |
| mountains snow | mountains snow | 300 |
| evergreen | evergreen | 70 |
| evergreen | evergreen hills | 40 |
| evergreen hills | evergreen hills | 30 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | foothills | edge-S | 1 | 0.6 | 60 | snow 30%; grass 30%; hills 20%; bog 10%; foothills 10% |
| River | water | path | 2 | 0.5 | 20 | grass 40%; snow 25%; bog 20%; hills 15% |
| trail | edge-W | edge-E | 1 | 0.6 | 60 | grass 40%; snow 30%; hills 30% |

## Layout

R1 is the north edge. The range hugs the north; trees sit in sheltered southern pockets; the rest is a fairly even mosaic so the biome blends well.

| Terrain | R1C1 | R1C2 | R1C3 | R1C4 | R1C5 | R2C1 | R2C2 | R2C3 | R2C4 | R2C5 | R3C1 | R3C2 | R3C3 | R3C4 | R3C5 | R4C1 | R4C2 | R4C3 | R4C4 | R4C5 | R5C1 | R5C2 | R5C3 | R5C4 | R5C5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mountains snow | 5 | 5 | 5 | 5 | 5 | 1 | 1 | 1 | 1 | 1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 |
| foothills | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 |
| cliffs | 2 | 2 | 2 | 2 | 2 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 |
| water | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1.1 | 1.1 | 1.1 | 1.1 | 1.1 |
| bog | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.7 | 0.7 | 0.7 | 0.7 | 0.7 | 1.2 | 1.2 | 1.2 | 1.2 | 1.2 | 1.4 | 1.4 | 1.4 | 1.4 | 1.4 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 |
| evergreen | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 1.8 | 1.8 | 1.8 | 1.8 | 1.8 | 3 | 3 | 3 | 3 | 3 |
| evergreen hills | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 1.8 | 1.8 | 1.8 | 1.8 | 1.8 | 3 | 3 | 3 | 3 | 3 |
| snow | 1.4 | 1.4 | 1.4 | 1.4 | 1.4 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 | 1 | 1 | 1 | 1 | 1 | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 |
