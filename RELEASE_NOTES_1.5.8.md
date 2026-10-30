# 1.5.8

- Fix: a hex map opened while Obsidian was still indexing (first start, a cache rebuild, or Sync bringing in many notes) drew hexes blank and kept them blank until the map was reopened. The map now fills in by itself as Obsidian reads the notes.
