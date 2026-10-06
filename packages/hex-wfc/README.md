# hex-wfc

Wave function collapse for hex maps, with no dependencies. Draw an example map, learn a generator from it, then generate new maps that follow the same rules.

It works with any terrain names. Terrains are plain strings, so it doesn't matter whether they're called "Deep Sea" or "lava".

It lives inside the [Hexmaker](https://github.com/sbuffkin/hexmaker) Obsidian plugin for now, but it doesn't depend on Hexmaker or Obsidian. The plan is to publish it as its own package. It has no build step yet: import the TypeScript sources directly, or bundle them.

## How it works

- **Learning**: `learnModel` counts how often each terrain appears and how often each pair of terrains touches. If two terrains never touch in the example, they can never touch in generated maps. That includes a terrain next to itself.
- **Solving**: `solve` runs WFC with propagation, backtracking and restarts. Pairs with weight 0 are hard rules. Pair weights are also soft rules: each choice is scored from the neighbours that are already decided, so a lake in the example grows as a lake rather than scattering. `neighbourInfluence` sets how strong that effect is.
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

| Terrain | Weight |
| --- | ---: |
| Grass | 120 |
| Water | 40 |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| Grass | Grass | 300 |
| Grass | Water | 25 |
| Water | Water | 90 |
```

- A pair that isn't listed, or has weight 0, can never touch.
- Pairs work in both directions, so *A | B* also covers *B | A*.
- Extra frontmatter keys are kept in `model.meta`.

## Limits

- This is the simple tiled model: only which terrain sits next to which. It learns blobs (lakes, forests, coastlines) well, but not long thin features. A river drawn as hex terrain comes back as streaks and clumps, not as a connected line.
- The solver scans every cell on each step, so the cost grows with roughly the square of the map size. 60×60 takes well under a second.

## License

MIT
