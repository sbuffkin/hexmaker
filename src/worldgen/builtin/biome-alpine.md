---
hex-wfc: 1
name: biome-alpine
example-hexes: 1120
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
speck-size: 1
mix-strength: 4
counts: "water 2-5"
edge-smoothing: 0.3
impassable: "peak; water; cliffs"
---

# biome-alpine

A hand-written preset (not learned from a map) for alpine highlands: a mass of bare mountain and snowfields (mountains snow, with glaciers of snow), cut by Mountain Ridge chains and cliff bands, with snowy peaks that always stand within two hexes of mountains snow (the *Near* column). The ranges step down through foothills, evergreen mountain and evergreen hills into forested valley floors with hills and alpine meadows (grass), and two to five small high lakes (water) sit among the mountains and valleys. A pass road crosses from the west edge to the east edge, a river drains a lake to the map edge, and streams run from the glaciers to the lakes. There is no Layout, so the highlands are roughly uniform and blend cleanly with neighbouring biomes. The Adjacency table is an elevation ladder (valley, slopes, high mountain, snow line): bands only touch their neighbours, so removing a row can make the map impossible. To tweak it: raise mountains snow / snow / peak for a higher, icier range or evergreen / grass / hills for greener valleys; change `counts` for more or fewer lakes; lower `mix-strength` for more seed-to-seed variety; change the Road *From*/*To* to `edge-N`/`edge-S` for a north-south pass. `impassable` keeps roads off peaks, cliffs and lakes; add `mountains snow` to force the pass to a snow-free saddle (it can then fail on maps where the snow line spans the map).

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| mountain | 260 | 1.5 | blob |  |  |  | 1 |  |
| evergreen | 100 | 2 | blob |  |  |  | 1 |  |
| mountains snow | 180 | 3 | blob |  |  |  | 1 |  |
| foothills | 100 |  | none |  |  |  | 1 |  |
| evergreen mountain | 110 | 2 | blob |  |  |  | 1 |  |
| hills | 50 | 1.5 | blob |  |  |  | 1 |  |
| Mountain Ridge | 70 | 1.5 | line | 0.3 | 1 |  | 1 |  |
| evergreen hills | 50 |  | none |  |  |  | 1 |  |
| grass | 40 | 2 | blob |  |  |  | 1 |  |
| snow | 50 | 2 | blob |  |  |  | 1 |  |
| cliffs | 50 |  | none |  |  |  | 1 |  |
| peak | 40 |  | scatter |  |  | 2 | 1 | mountains snow 2 |
| water | 20 | 0.6 | blob |  |  |  | 1 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| grass | grass | 80 |
| grass | evergreen | 60 |
| grass | hills | 40 |
| grass | water | 20 |
| grass | evergreen hills | 20 |
| grass | foothills | 15 |
| evergreen | evergreen | 200 |
| evergreen | evergreen hills | 50 |
| evergreen | hills | 30 |
| evergreen | water | 15 |
| evergreen | evergreen mountain | 60 |
| evergreen | foothills | 20 |
| hills | hills | 60 |
| hills | evergreen hills | 30 |
| hills | foothills | 60 |
| evergreen hills | evergreen hills | 50 |
| evergreen hills | foothills | 30 |
| evergreen hills | evergreen mountain | 40 |
| foothills | foothills | 60 |
| foothills | mountain | 80 |
| foothills | evergreen mountain | 40 |
| foothills | cliffs | 15 |
| evergreen mountain | evergreen mountain | 120 |
| evergreen mountain | mountain | 90 |
| evergreen mountain | cliffs | 10 |
| mountain | mountain | 180 |
| mountain | Mountain Ridge | 80 |
| mountain | cliffs | 40 |
| mountain | mountains snow | 100 |
| mountain | peak | 20 |
| mountain | water | 8 |
| mountain | snow | 20 |
| Mountain Ridge | Mountain Ridge | 60 |
| Mountain Ridge | mountains snow | 40 |
| Mountain Ridge | peak | 20 |
| Mountain Ridge | cliffs | 15 |
| cliffs | cliffs | 10 |
| cliffs | water | 10 |
| cliffs | mountains snow | 15 |
| mountains snow | mountains snow | 200 |
| mountains snow | peak | 60 |
| mountains snow | snow | 60 |
| snow | snow | 60 |
| snow | water | 5 |
| peak | snow | 15 |
| water | water | 150 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Road | edge-W | edge-E | 1 | 0.3 | 100 | foothills 30%; grass 15%; evergreen 20%; mountain 20%; evergreen hills 15% |
| River | water | edge | 1 | 0.3 | 35 | evergreen 30%; grass 25%; hills 25%; foothills 20% |
| stream | snow | water | 2 | 0.3 | 20 | mountain 40%; foothills 30%; evergreen mountain 30% |
