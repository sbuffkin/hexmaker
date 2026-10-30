---
hex-wfc: 1
name: biome-badlands
example-hexes: 855
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
speck-size: 1
edge-smoothing: 0.3
counts: "Salt Flats 1-3"
impassable: "Mountain Ridge"
---

# biome-badlands

A hand-written preset (not learned from a map) for badlands canyon country: a red rock maze of eroded badlands and stony desert, cut by winding brokenland canyons whose floors are walled by cliffs (a canyon floor may only touch cliffs or more canyon, and cliffs are kept within one hex of a canyon by the *Near* column). Flat-topped mesas (hills with Mountain Ridge escarpments) rise between them, with sparse cactus scrub, patches of open desert and one to three dry Salt Flats basins. A river follows the canyons across the map and a trail runs out from a salt flat to the map edge. There is no Layout, so the country is roughly uniform and blends well with neighbouring biomes.

To tweak it: raise the brokenlands and cliffs *Weight* for a denser canyon maze (or lower them for open badlands); its *Patch %* sets canyon length and *Turn* how much they wind. Raise hills / Mountain Ridge for more mesas, and `counts` for more salt basins. Adding a `brokenlands | badlands` adjacency row lets canyons open without cliff walls. Edit the Paths table for more rivers or trails.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| badlands | 200 | 2 | blob |  |  |  | 1 |  |
| desert rocky | 150 |  | none |  |  |  | 1 |  |
| brokenlands | 160 | 0.4 | line | 0.5 | 1 |  | 0.5 |  |
| cliffs | 150 |  | none |  |  |  | 1 | brokenlands 1 |
| hills | 60 | 0.3 | blob |  |  |  | 1 |  |
| Mountain Ridge | 30 | 0.3 | line | 0.3 | 1 |  | 0.8 |  |
| desert | 45 |  | none |  |  |  | 1 |  |
| cactus | 30 |  | scatter |  |  | 2 | 1 |  |
| Salt Flats | 30 | 1 | blob |  |  |  | 0.7 |  |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| brokenlands | brokenlands | 5 |
| brokenlands | cliffs | 60 |
| cliffs | cliffs | 10 |
| cliffs | badlands | 40 |
| cliffs | desert rocky | 20 |
| cliffs | hills | 15 |
| cliffs | Mountain Ridge | 10 |
| badlands | badlands | 120 |
| badlands | desert rocky | 60 |
| badlands | hills | 25 |
| badlands | cactus | 25 |
| badlands | desert | 10 |
| desert rocky | desert rocky | 120 |
| desert rocky | hills | 25 |
| desert rocky | desert | 40 |
| desert rocky | cactus | 20 |
| desert rocky | Salt Flats | 15 |
| hills | hills | 20 |
| hills | Mountain Ridge | 40 |
| Mountain Ridge | desert rocky | 10 |
| Mountain Ridge | badlands | 10 |
| Mountain Ridge | Mountain Ridge | 15 |
| desert | desert | 40 |
| desert | cactus | 20 |
| desert | Salt Flats | 30 |
| Salt Flats | Salt Flats | 60 |
| cactus | cactus | 5 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | edge | edge | 1 | 0.3 | 110 | brokenlands 80%; badlands 10%; desert rocky 10% |
| trail | Salt Flats | edge | 1 | 0.3 | 60 | desert rocky 50%; desert 30%; badlands 20% |
