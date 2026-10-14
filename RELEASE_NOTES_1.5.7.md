# 1.5.7 (draft)

- Safety: if a synced vault was updated by a newer Hexmap World Creator on another device, this version now shows a notice and goes read-only instead of showing blank maps.
- Read-only means it writes nothing: no settings, no hex notes, no map data, no palettes, no tables.
- The hex map, hex table, random tables and setup views show the notice instead, and the settings tab only explains what happened.
- It detects the newer version from the `dataFormat` stamp in the plugin's settings, or from a newer map note in the hexes folder (for when settings don't sync).
- Settings keys added by newer versions are kept when this version saves (they already were; now covered by a test).
