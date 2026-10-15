---
hex-wfc: 1
name: preset-volcanic
example-hexes: 1000
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
directional-bias: 2.5
speck-size: 1
counts: "volcano 1-3; volcano dormant 2-5"
---

# preset-volcanic

A hand-written preset (not learned from a map) for a volcanic region: one to three active volcanoes, each with a rim of mountain and cliffs (with the odd lava breach), set among brokenlands lava flows that stay within four hexes of a volcano (the *Near* column); a few dormant cones; ash plains (desert rocky) and badlands, grading out to hills and evergreen forest at the western margins; the odd crater lake; and the sea along the east side. Volcanoes may only touch mountain, cliffs or brokenlands, and never each other. To tweak it, change `counts` for more or fewer volcanoes and cones, and the volcano *Spacing* to push them further apart. Edit the Layout rows to move the sea, or set `directional-bias: 0` to let it fall anywhere. Change the evergreen and hills weights for a greener or barer region, and the brokenlands *Patch %*/*Width* for longer or thicker lava flows.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| desert rocky | 257 |  | none |  |  |  | 0.8 |  |
| brokenlands | 110 | 2 | line | 0.3 | 2 |  | 0.5 | volcano 4 |
| mountain | 110 | 1.5 | blob |  |  |  | 0.6 |  |
| hills | 110 | 3 | blob |  |  |  | 1.6 |  |
| badlands | 90 | 2 | blob |  |  |  | 0.8 |  |
| evergreen | 80 | 3 | blob |  |  |  | 2 |  |
| ocean | 55 | 5 | blob |  |  |  | 1.5 |  |
| foothills | 50 |  | none |  |  |  | 1.2 |  |
| cliffs | 40 |  | none |  |  |  | 0.8 | volcano 3 |
| shallows | 40 |  | none |  |  |  | 1.2 |  |
| evergreen hills | 40 |  | none |  |  |  | 1.8 |  |
| volcano dormant | 6 |  | scatter |  |  | 6 | 0.5 |  |
| water | 6 | 0.4 | blob |  |  |  | 0.3 |  |
| volcano | 6 |  | scatter |  |  | 10 | 0.1 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| volcano | mountain | 10 |
| volcano | cliffs | 10 |
| volcano | brokenlands | 5 |
| volcano dormant | mountain | 4 |
| volcano dormant | hills | 3 |
| volcano dormant | cliffs | 2 |
| volcano dormant | brokenlands | 2 |
| volcano dormant | desert rocky | 2 |
| mountain | mountain | 30 |
| mountain | cliffs | 15 |
| mountain | brokenlands | 30 |
| mountain | hills | 15 |
| mountain | foothills | 10 |
| mountain | desert rocky | 5 |
| mountain | badlands | 5 |
| mountain | evergreen hills | 5 |
| mountain | water | 3 |
| cliffs | cliffs | 5 |
| cliffs | brokenlands | 25 |
| cliffs | desert rocky | 5 |
| cliffs | badlands | 5 |
| cliffs | hills | 3 |
| cliffs | shallows | 4 |
| cliffs | water | 2 |
| brokenlands | brokenlands | 60 |
| brokenlands | badlands | 15 |
| brokenlands | desert rocky | 20 |
| brokenlands | foothills | 3 |
| brokenlands | shallows | 3 |
| badlands | badlands | 40 |
| badlands | desert rocky | 25 |
| badlands | hills | 8 |
| badlands | foothills | 5 |
| desert rocky | desert rocky | 150 |
| desert rocky | hills | 25 |
| desert rocky | foothills | 15 |
| desert rocky | evergreen | 5 |
| desert rocky | shallows | 10 |
| desert rocky | water | 3 |
| hills | hills | 50 |
| hills | foothills | 10 |
| hills | evergreen | 15 |
| hills | evergreen hills | 15 |
| hills | shallows | 5 |
| foothills | foothills | 10 |
| foothills | evergreen | 8 |
| foothills | evergreen hills | 8 |
| evergreen | evergreen | 60 |
| evergreen | evergreen hills | 20 |
| evergreen | shallows | 4 |
| evergreen hills | evergreen hills | 15 |
| water | water | 4 |
| shallows | shallows | 30 |
| shallows | ocean | 25 |
| ocean | ocean | 100 |

## Layout

| Terrain | NW | N | NE | W | C | E | SW | S | SE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ocean | 0.02 | 0.02 | 3 | 0.02 | 0.02 | 4 | 0.02 | 0.02 | 3 |
| shallows | 0.05 | 0.1 | 2.5 | 0.05 | 0.3 | 3 | 0.05 | 0.1 | 2.5 |
| volcano | 0.3 | 0.6 | 0.3 | 0.8 | 3 | 0.5 | 0.3 | 0.6 | 0.3 |
| evergreen | 2 | 1.5 | 0.5 | 2.5 | 0.3 | 0.3 | 2 | 1.5 | 0.5 |
| evergreen hills | 2 | 1.5 | 0.5 | 2.5 | 0.3 | 0.3 | 2 | 1.5 | 0.5 |
