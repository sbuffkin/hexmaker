# hex-wfc

Wave function collapse for hex maps, with no dependencies. Draw an example map, learn a generator from it, then generate new maps that follow the same rules.

It works with any terrain names. Terrains are plain strings, so it doesn't matter whether they're called "Deep Sea" or "lava".

It lives inside the [Hexmaker](https://github.com/sbuffkin/hexmaker) Obsidian plugin for now, but it doesn't depend on Hexmaker or Obsidian. The plan is to publish it as its own package. It has no build step yet: import the TypeScript sources directly, or bundle them.

## How it works

- **Learning**: `learnModel` counts how often each terrain appears and how often each pair of terrains touches. If two terrains never touch in the example, they can never touch in generated maps. That includes a terrain next to itself.
- **Solving**: `solve` runs WFC with propagation, backtracking and restarts. Pairs with weight 0 are hard rules. Pair weights are also soft rules: each choice is scored from the neighbours that are already decided, so a lake in the example grows as a lake rather than scattering. `neighbourInfluence` sets how strong that effect is.
- **Growth**: learning also measures the shape of each terrain's patches. Compact patches (lakes, forests) become `blob`, stretched ones (ranges, ridges) become `line`, and backgrounds, shores and scattered hexes become `none`. When the solver starts a new patch of a `blob` or `line` terrain, it gets extra moves to spread: outward for blobs, forward with occasional turns for lines. Every move still obeys the hard rules.
- **Scale**: patch sizes are stored as a share of the map, not a hex count. A generator learned on a 50×50 map makes lakes and ranges of the same relative size on a 20×20 map, and the overall terrain mix stays close to the example's at any size. `featureSize` multiplies on top: below 1 gives more, smaller features, above 1 fewer, bigger ones.
- **Fixed hexes**: pass hexes that are already painted as `fixed`. They are never changed, and the rest of the map is filled around them.
- **Deterministic**: the same model, options and seed always give the same map.

## Usage

```ts
import { learnModel, solve, modelToMarkdown, parseModelMarkdown } from "hex-wfc";

const painted = new Map([["0_0", "Water"], ["1_0", "Water"], ["2_0", "Grass"] /* ... */]);
const model = learnModel(painted, { name: "lakes", orientation: "flat" });

const result = solve(model, { cols: 30, rows: 20, orientation: "flat", seed: 42 });
if (result.ok) result.cells; // Map<"x_y", terrain>
else console.warn(result.reason, result.message);

const text = modelToMarkdown(model);            // save it
const { model: again } = parseModelMarkdown(text); // load it
```

Coordinates are offset coordinates keyed as `"x_y"`. Flat-top grids stagger columns and pointy-top grids stagger rows. `stagger: "odd" | "even"` chooses which columns or rows are shifted.

## File format

Models save as Markdown with frontmatter and two tables, so you can edit them by hand:

```markdown
---
hex-wfc: 1
name: lakes
palette: Default
---
## Terrains

| Terrain | Weight | Patch % | Shape | Turn |
| --- | ---: | ---: | --- | ---: |
| Grass | 120 | 80 | none | |
| Water | 40 | 3.5 | blob | |
| Ridge | 10 | 1.2 | line | 0.2 |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| Grass | Grass | 300 |
| Grass | Water | 25 |
| Water | Water | 90 |
```

- A pair that isn't listed, or has weight 0, can never touch.
- *Patch %*, *Shape* and *Turn* are optional. A file with only *Terrain* and *Weight* still works, without growth.
- Pairs work in both directions, so *A | B* also covers *B | A*.
- Extra frontmatter keys are kept in `model.meta`.

## Tuning

The defaults were tuned by eye and by comparing terrain mix across sizes. Run `dev/wfc-ascii.mts` and `dev/wfc-mix.mts` in the Hexmaker repo to check changes. Without `scatter`, enclosed features (a lake inside its shore) never start. Without growth-aware scoring, the most common terrain swallows the map.

## Limits

- Growth gives ridges and ranges a direction, but nothing guarantees a feature exists or reaches anywhere in particular. A river that must run from a map edge to the sea needs a placed feature (planned).
- Learned `line` features are one hex wide, even if the example's are wider.
- The solver scans every cell on each step, so the cost grows with roughly the square of the map size. 60×60 takes well under a second.

## License

MIT
