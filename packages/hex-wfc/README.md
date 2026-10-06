# hex-wfc

Wave function collapse for hex maps, with no dependencies. Draw an example map, learn a generator from it, then generate new maps that follow the same rules.

It works with any terrain names. Terrains are plain strings, so it doesn't matter whether they're called "Deep Sea" or "lava".

It lives inside the [Hexmaker](https://github.com/sbuffkin/hexmaker) Obsidian plugin for now, but it doesn't depend on Hexmaker or Obsidian. The plan is to publish it as its own package. It has no build step yet: import the TypeScript sources directly, or bundle them.

## What it learns from an example map

- **Rules**: how often each terrain appears and how often each pair touches. If two terrains never touch in the example, they can never touch in generated maps. That includes a terrain next to itself.
- **Shape** of each terrain's patches, using shape alone and never names:
  - `blob`: compact patches, e.g. lakes and forests.
  - `line`: thin and stretched, e.g. ridges and rivers. Width and turn rate are also learned.
  - `scatter`: single hexes, e.g. towns. The smallest gap between them is also learned.
  - `none`: backgrounds, and shores that run between two different terrains.
- **Size** of a typical patch, stored as a share of the map, so features scale with the map.
- **Layout**: where each terrain sat (a 3×3 grid), and how common it is along the map border.
- **Guaranteed features**: a line whose two ends are anchored becomes a feature that's always placed. Anchored means edge to edge, or edge to a lake. A river painted from the map edge into a lake is learned as "River: edge → Water".

## What the solver does

`solve` runs these steps in order:
1. Lays down the fixed parts first:
   - an explicit edge terrain, e.g. a wavy water border for islands;
   - the guaranteed features: a river is drawn as a wandering path, with a lake at its mouth.
2. Runs WFC with propagation, backtracking and restarts.
3. Applies post passes: smoothing, connected land, and topping up minimum counts.

The rules are hard throughout: no setting ever produces a pair the example didn't allow. The same model, options and seed always give the same map. Pass hexes that are already painted as `fixed` and they're never changed.

### Settings

Settings can be passed to `solve` or saved in the model file:

| Setting | What it does |
| --- | --- |
| `featureSize` | Multiplier on learned patch sizes. 0 turns growth off. |
| `lineWidth` | Thickness of line terrains: 0 = as learned, otherwise 1–3. |
| `smoothing` | 0–1. Cleans up lone specks and ragged edges. |
| `symmetry` | `none`, `left-right`, `top-bottom` or `both`. Symmetric wherever the rules allow. |
| `edgeTerrain`, `edgeStrength` | What the border prefers. Name a terrain for e.g. islands, or leave blank to follow the learned edge preference. |
| `directionalBias` | 0–1. Keeps terrain where it sat in the example. |
| `spacing` | Multiplier on the learned gap between scattered hexes (towns). |
| `randomness` | 0–1 share of choices made by weight alone, ignoring neighbours. Peppers rare terrain around the map. |
| `features` | Lay down the guaranteed features. |
| `connected`, `impassable` | Make all land one connected area, filling cut-off pockets with impassable terrain. |
| `mix` | Per-terrain weight multipliers, e.g. `{ Forest: 1.5 }`. |
| `counts` | Per-terrain min/max number of patches, e.g. `{ Town: { min: 3, max: 3 } }`. |
| `neighbourInfluence`, `frequencyFeedback`, `scatter` | Advanced tuning: clumping, how closely the terrain mix follows the example, and randomness in where features start. |

`result.warnings` lists soft goals that weren't fully met, such as a count or a feature that didn't fit.

## Usage

```ts
import { learnModel, solve, modelToMarkdown, parseModelMarkdown } from "hex-wfc";

const painted = new Map([["0_0", "Water"], ["1_0", "Water"], ["2_0", "Grass"] /* ... */]);
const model = learnModel(painted, { name: "lakes", orientation: "flat" });

const result = solve(model, { cols: 30, rows: 20, orientation: "flat", seed: 42, smoothing: 0.5 });
if (result.ok) result.cells; // Map<"x_y", terrain>
else console.warn(result.reason, result.message);

const text = modelToMarkdown(model);               // save it
const { model: again } = parseModelMarkdown(text); // load it
```

Coordinates are offset coordinates keyed as `"x_y"`. Flat-top grids stagger columns and pointy-top grids stagger rows. `stagger: "odd" | "even"` chooses which columns or rows are shifted.

## File format

Models save as Markdown with frontmatter and a few tables, so you can edit them by hand:

```markdown
---
hex-wfc: 1
name: lakes
example-hexes: 2500
feature-size: 1.5
counts: "Town 3; Lake 1-"
palette: Default
---
## Terrains

| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Grass | 2100 | 87 | none | | | | 1.1 |
| Water | 80 | 3.4 | blob | | | | 0.2 |
| River | 40 | 1.6 | line | 0.25 | 1 | | |
| Town | 25 | 0.04 | scatter | | | 5 | |

## Adjacency

| Terrain | Next to | Weight |
| --- | --- | ---: |
| Grass | Grass | 3000 |
| Grass | Water | 25 |
| River | Water | 3 |

## Features

| Terrain | From | To | Count |
| --- | --- | --- | ---: |
| River | edge | Water | 1 |
```

- **Adjacency:** a pair that isn't listed, or has weight 0, can never touch. Pairs work in both directions.
- **Optional parts:** every column after *Weight*, and the *Features* and *Layout* tables, are optional. A file with only *Terrain* and *Weight* still works.
- **Lists and maps in frontmatter** separate items with `; `, so terrain names can contain commas: `mix: "Forest 1.5; Water 0.5"`, `counts: "Town 3; Lake 1-; Ruin 0-2"`, `impassable: "Water; High peaks"`.
- **Other frontmatter keys** are kept in `model.meta`.

## Tuning

The defaults were tuned by eye and by comparing the terrain mix across map sizes. To check changes, run the scripts in the Hexmaker repo's `dev/` folder:
- `wfc-mix.mts`: terrain mix at four sizes against the example.
- `wfc-ascii.mts`, `wfc-controls.mts`, `wfc-bias.mts` and `wfc-river.mts`: print sample maps.

Three findings from tuning:
- **Scatter:** without it, enclosed features (a lake inside its shore) never start.
- **Growth-aware scoring:** without it, the most common terrain swallows the map.
- **Seed odds scaled by patch size:** without it, coverage grows with map size.

## Limits

- This is the simple tiled model plus growth. It learns blobs, lines and scatter well. It doesn't learn larger patterns, such as a castle surrounded by a moat surrounded by farmland, beyond what the pair rules imply.
- Guaranteed features are lines with anchored ends. Branching rivers (tributaries) aren't learned yet.
- The solver scans every cell on each step, so the cost grows with roughly the square of the map size. 60×60 takes about 0.15 s and 100×100 under a second.

## License

MIT
