---
hex-wfc: 1
name: biome-coastal-fjord
example-hexes: 930
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
directional-bias: 2
speck-size: 1
edge-smoothing: 0.3
impassable: "ocean; shallows; water; mountains snow; peak"
---

# biome-coastal-fjord

A hand-written preset (not learned from a map) for a fjord coast: open sea on the west, a shallows shelf, and long narrow inlets of water (the *Features* table) cutting east from the sea deep into steep land, each ending in a small beach at its head. Inlet water may only touch cliffs, bare mountain, beach and the odd wooded hill, so the fjords are walled. Evergreen forest and evergreen hills cover the slopes, rising through evergreen mountains to snowy mountains and peaks in the east. A coastal road runs north-south around the inlet heads, and streams run down from the snow to the fjords. To tweak it: change the Features *Count* for more or fewer inlets and the water *Patch %* for longer ones (water *Width* 2 for broader fjords, *Turn* for more bends); edit the ocean and shallows Layout rows to move the sea (the water row in the small 3×3 table picks the side the inlets start from); change the evergreen weights for a greener or barer coast.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| ocean | 150 |  | none |  |  |  | 2 |  |
| shallows | 80 |  | none |  |  |  | 1 |  |
| water | 50 | 3 | line | 0.2 | 1 |  | 0.5 |  |
| beach | 10 | 0.4 | none |  |  |  | 0.3 |  |
| cliffs | 60 |  | none |  |  |  | 0.6 |  |
| grass | 25 | 0.6 | blob |  |  |  | 0.5 |  |
| evergreen | 70 | 3 | blob |  |  |  | 1 |  |
| evergreen heavy | 40 | 2 | blob |  |  |  | 1 |  |
| evergreen hills | 150 | 2 | blob |  |  |  | 1 |  |
| evergreen mountains | 110 | 2 | blob |  |  |  | 1 |  |
| mountain | 90 | 1.5 | line | 0.3 | 2 |  | 1 |  |
| mountains snow | 75 | 3 | blob |  |  |  | 1.5 |  |
| peak | 20 |  | scatter |  |  | 3 | 1 |  |

## Adjacency

Coast and slope ladder: ocean only meets shallows (and inlet mouths); inlet water only meets cliffs, mountain, beach and a little wooded hill; snow sits above the evergreen mountains.

| Terrain | Next to | Weight |
| --- | --- | ---: |
| ocean | ocean | 400 |
| ocean | shallows | 80 |
| shallows | shallows | 80 |
| shallows | water | 20 |
| shallows | cliffs | 30 |
| shallows | beach | 8 |
| shallows | evergreen | 6 |
| shallows | evergreen hills | 6 |
| shallows | mountain | 6 |
| water | water | 60 |
| water | cliffs | 50 |
| water | mountain | 25 |
| water | beach | 10 |
| water | evergreen hills | 5 |
| beach | beach | 4 |
| beach | grass | 6 |
| beach | evergreen | 6 |
| beach | cliffs | 4 |
| cliffs | cliffs | 20 |
| cliffs | mountain | 20 |
| cliffs | evergreen | 10 |
| cliffs | evergreen hills | 20 |
| cliffs | evergreen mountains | 15 |
| grass | grass | 10 |
| grass | evergreen | 15 |
| grass | evergreen hills | 6 |
| evergreen | evergreen | 120 |
| evergreen | evergreen heavy | 40 |
| evergreen | evergreen hills | 50 |
| evergreen heavy | evergreen heavy | 50 |
| evergreen heavy | evergreen hills | 25 |
| evergreen hills | evergreen hills | 80 |
| evergreen hills | evergreen mountains | 40 |
| evergreen hills | mountain | 25 |
| evergreen mountains | evergreen mountains | 80 |
| evergreen mountains | mountain | 30 |
| evergreen mountains | mountains snow | 25 |
| mountain | mountain | 60 |
| mountain | mountains snow | 30 |
| mountain | peak | 10 |
| mountains snow | mountains snow | 80 |
| mountains snow | peak | 20 |

## Features

Fjord inlets: lines of water from the west edge into the land, each ending in a small beach.

| Terrain | From | To | Count |
| --- | --- | --- | ---: |
| water | edge | beach | 3 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Road | edge-N | edge-S | 1 | 0.2 | 0 | evergreen 40%; grass 15%; beach 10%; evergreen hills 25%; cliffs 10% |
| stream | mountains snow | water | 2 | 0.3 | 25 | evergreen mountains 30%; evergreen hills 30%; evergreen 25%; mountain 15% |

## Layout

Columns run west (C1, open sea) to east (C5, snowy mountains); the rows are alike, so the coast runs north-south.

| Terrain | R1C1 | R1C2 | R1C3 | R1C4 | R1C5 | R2C1 | R2C2 | R2C3 | R2C4 | R2C5 | R3C1 | R3C2 | R3C3 | R3C4 | R3C5 | R4C1 | R4C2 | R4C3 | R4C4 | R4C5 | R5C1 | R5C2 | R5C3 | R5C4 | R5C5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ocean | 6 | 0.5 | 0.03 | 0.02 | 0.02 | 6 | 0.5 | 0.03 | 0.02 | 0.02 | 6 | 0.5 | 0.03 | 0.02 | 0.02 | 6 | 0.5 | 0.03 | 0.02 | 0.02 | 6 | 0.5 | 0.03 | 0.02 | 0.02 |
| shallows | 2.5 | 1.6 | 0.15 | 0.05 | 0.02 | 2.5 | 1.6 | 0.15 | 0.05 | 0.02 | 2.5 | 1.6 | 0.15 | 0.05 | 0.02 | 2.5 | 1.6 | 0.15 | 0.05 | 0.02 | 2.5 | 1.6 | 0.15 | 0.05 | 0.02 |
| beach | 0.5 | 2 | 1.5 | 0.8 | 0.3 | 0.5 | 2 | 1.5 | 0.8 | 0.3 | 0.5 | 2 | 1.5 | 0.8 | 0.3 | 0.5 | 2 | 1.5 | 0.8 | 0.3 | 0.5 | 2 | 1.5 | 0.8 | 0.3 |
| cliffs | 0.5 | 2.5 | 1.5 | 1 | 0.6 | 0.5 | 2.5 | 1.5 | 1 | 0.6 | 0.5 | 2.5 | 1.5 | 1 | 0.6 | 0.5 | 2.5 | 1.5 | 1 | 0.6 | 0.5 | 2.5 | 1.5 | 1 | 0.6 |
| grass | 0.2 | 1.5 | 1.5 | 1 | 0.5 | 0.2 | 1.5 | 1.5 | 1 | 0.5 | 0.2 | 1.5 | 1.5 | 1 | 0.5 | 0.2 | 1.5 | 1.5 | 1 | 0.5 | 0.2 | 1.5 | 1.5 | 1 | 0.5 |
| evergreen | 0.1 | 1.8 | 1.8 | 1.2 | 0.6 | 0.1 | 1.8 | 1.8 | 1.2 | 0.6 | 0.1 | 1.8 | 1.8 | 1.2 | 0.6 | 0.1 | 1.8 | 1.8 | 1.2 | 0.6 | 0.1 | 1.8 | 1.8 | 1.2 | 0.6 |
| evergreen heavy | 0.1 | 1.2 | 1.8 | 1.4 | 0.8 | 0.1 | 1.2 | 1.8 | 1.4 | 0.8 | 0.1 | 1.2 | 1.8 | 1.4 | 0.8 | 0.1 | 1.2 | 1.8 | 1.4 | 0.8 | 0.1 | 1.2 | 1.8 | 1.4 | 0.8 |
| evergreen hills | 0.1 | 1.2 | 1.6 | 1.5 | 1 | 0.1 | 1.2 | 1.6 | 1.5 | 1 | 0.1 | 1.2 | 1.6 | 1.5 | 1 | 0.1 | 1.2 | 1.6 | 1.5 | 1 | 0.1 | 1.2 | 1.6 | 1.5 | 1 |
| evergreen mountains | 0.05 | 0.6 | 1.2 | 1.6 | 1.6 | 0.05 | 0.6 | 1.2 | 1.6 | 1.6 | 0.05 | 0.6 | 1.2 | 1.6 | 1.6 | 0.05 | 0.6 | 1.2 | 1.6 | 1.6 | 0.05 | 0.6 | 1.2 | 1.6 | 1.6 |
| mountain | 0.1 | 1 | 1.2 | 1.4 | 1.5 | 0.1 | 1 | 1.2 | 1.4 | 1.5 | 0.1 | 1 | 1.2 | 1.4 | 1.5 | 0.1 | 1 | 1.2 | 1.4 | 1.5 | 0.1 | 1 | 1.2 | 1.4 | 1.5 |
| mountains snow | 0.02 | 0.1 | 0.6 | 2.2 | 4 | 0.02 | 0.1 | 0.6 | 2.2 | 4 | 0.02 | 0.1 | 0.6 | 2.2 | 4 | 0.02 | 0.1 | 0.6 | 2.2 | 4 | 0.02 | 0.1 | 0.6 | 2.2 | 4 |
| peak | 0.02 | 0.1 | 0.5 | 1.8 | 3 | 0.02 | 0.1 | 0.5 | 1.8 | 3 | 0.02 | 0.1 | 0.5 | 1.8 | 3 | 0.02 | 0.1 | 0.5 | 1.8 | 3 | 0.02 | 0.1 | 0.5 | 1.8 | 3 |

Inlet water uses a 3×3 row: it picks the map side the inlets start from (west).

| Terrain | NW | N | NE | W | C | E | SW | S | SE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| water | 1 | 0.05 | 0.05 | 10 | 1 | 0.05 | 1 | 0.05 | 0.05 |
