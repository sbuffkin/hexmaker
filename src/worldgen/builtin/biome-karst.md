---
hex-wfc: 1
name: biome-karst
example-hexes: 757
palette: Default
created: 2026-10-09
hexmaker-version: 1.5.6
speck-size: 1
edge-smoothing: 0.2
impassable: "Mountain Ridge; cliffs"
---

# biome-karst

A hand-written preset (not learned from a map) for karst / limestone country, in the manner of Guilin or Ha Long on land: flat grass and mixed-forest valley floors studded with tower karst. Each tower is a scattered Mountain Ridge core (the limestone pinnacle, kept at least 3 hexes from the next) wrapped in cliffs and a skirt of hills and forested hills (the *Near* column keeps hills within 1 hex and forested hills within 2 hexes of a core, so they form separate knots rather than ranges). Sinkhole lakes (water) and cave country (brokenlands) stay within a few hexes of a tower, with the odd marshy paddy beside a lake. Rivers enter from the map edge and vanish underground part way across (they end at *none*), short streams drain sinkholes into the caves, a road crosses the valley floors west to east and trails climb into the towers. There is no Layout, so the country is even and blends cleanly with neighbouring biomes. To tweak it: raise the Mountain Ridge weight or lower its *Spacing* for denser towers (or raise grass for wider plains); raise forested hills vs hills for greener towers; change the water weight for more sinkholes; edit the Paths counts for more or fewer vanishing rivers. Cliffs and Mountain Ridge are `impassable`, so paths wind between the towers.

## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge | Near |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| grass | 230 |  | none |  |  |  | 1 |  |
| mixed forest | 130 | 2 | blob |  |  |  | 1 |  |
| forested hills | 100 |  | none |  |  |  | 1 | Mountain Ridge 2 |
| hills | 80 |  | none |  |  |  | 1 | Mountain Ridge 1 |
| Mountain Ridge | 100 |  | scatter |  |  | 3 | 1 |  |
| cliffs | 40 |  | none |  |  |  | 1 | Mountain Ridge 1 |
| brokenlands | 30 | 0.4 | blob |  |  |  | 1 | Mountain Ridge 2 |
| water | 35 |  | scatter |  |  | 3 | 1 | Mountain Ridge 3 |
| marsh | 12 |  | none |  |  |  | 1 | water 2 |

## Adjacency

Towers: Mountain Ridge touches only hills, forested hills and cliffs, so every pinnacle sits in a skirt; cliffs never touch mixed forest or marsh. The valley floor (grass, mixed forest) never touches Mountain Ridge directly.

| Terrain | Next to | Weight |
| --- | --- | ---: |
| grass | grass | 300 |
| grass | mixed forest | 100 |
| grass | hills | 60 |
| grass | forested hills | 60 |
| grass | cliffs | 20 |
| grass | water | 20 |
| grass | brokenlands | 15 |
| grass | marsh | 15 |
| mixed forest | mixed forest | 150 |
| mixed forest | forested hills | 50 |
| mixed forest | hills | 15 |
| mixed forest | water | 8 |
| mixed forest | brokenlands | 10 |
| mixed forest | marsh | 5 |
| hills | hills | 15 |
| hills | forested hills | 40 |
| hills | Mountain Ridge | 30 |
| hills | cliffs | 25 |
| hills | brokenlands | 20 |
| hills | water | 10 |
| forested hills | forested hills | 20 |
| forested hills | Mountain Ridge | 30 |
| forested hills | cliffs | 20 |
| forested hills | brokenlands | 10 |
| forested hills | water | 8 |
| Mountain Ridge | Mountain Ridge | 4 |
| Mountain Ridge | cliffs | 50 |
| cliffs | cliffs | 5 |
| cliffs | water | 10 |
| cliffs | brokenlands | 10 |
| brokenlands | brokenlands | 20 |
| brokenlands | water | 8 |
| water | water | 5 |
| water | marsh | 10 |
| marsh | marsh | 5 |

## Paths

| Path | From | To | Count | Turn | Length % | Through |
| --- | --- | --- | ---: | ---: | ---: | --- |
| River | edge | none | 2 | 0.3 | 45 | grass 70%; mixed forest 30% |
| stream | water | brokenlands | 2 | 0.4 | 15 | grass 60%; mixed forest 25%; forested hills 15% |
| Road | edge-W | edge-E | 1 | 0.3 | 100 | grass 80%; mixed forest 20% |
| trail | edge | hills | 2 | 0.4 | 25 | grass 40%; hills 40%; forested hills 20% |
