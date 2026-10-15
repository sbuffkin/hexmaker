# Shipping tuned biomes

Dev-only and git-only. Nothing here is bundled into `main.js`.

The built-in biomes ship as data in the World maps module:
`src/modules/world-maps/biomePresets.ts`, one biome per line (`SHIPPED_BIOMES`).
`src/overworld/biomePresets.ts` reads them. Open sea's mix lives there too
(tables phase 6). On first run, the plugin writes each biome into a note in
the vault's biomes folder. From then on the notes are what counts.

To ship the values you tuned in a vault:

1. Tune the biomes in a test vault. Turn on Debug mode, open the generator
   page's **Biome (blend field)** view, and use the Debug sections. You can
   also edit the biome notes by hand, or use **Blend into <biome>…**.
2. Run a dry run against that vault's biomes folder. It shows what would
   change, biome by biome and field by field, and writes nothing:

   ```
   node dev/biomes/export-tuned-biomes.mjs "<vault>/world/biomes"
   node dev/biomes/export-tuned-biomes.mjs "<vault>/world/biomes" --only tundra,coast
   ```

3. Write the changes:

   ```
   node dev/biomes/export-tuned-biomes.mjs "<vault>/world/biomes" --write
   ```

4. Run `npm test`, then commit `src/modules/world-maps/biomePresets.ts`.

## What it copies

The script copies the fields that shape generation and placement: Mix, Terrain
weights, Transitions, `blend`, `land-share`, `min-islands`, `shore`, the
climate keys and the **Tuning** table. It leaves out the label, the colour,
`generator` (a vault link) and `parent`.

It skips notes that aren't a shipped biome (your own biomes) and names them in
the output. If a note has rows it can't read, the output says so too.

## Files

- `export-tuned-biomes.mjs` is the command. It loads the TypeScript parser with
  tsx.
- `exportTuned.mjs` holds the pure part: the diff (`planExport`), its text
  (`formatPlan`) and the data file's format (`shippedBiomesSource`). It's
  tested in `tests/biomeBlend.test.ts`, which also checks that the shipped
  file is exactly what the script writes.

## Notes

Changing a shipped biome's tuning changes what new vaults get. Existing vaults
keep their notes. **Restore default** on the biome page rewrites a note from
the shipped data, after backing up the old note.
