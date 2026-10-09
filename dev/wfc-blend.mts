// Blend generator files with compass directions and write the result.
//   npx tsx dev/wfc-blend.mts <out.md> <gen.md>:<dir>[:<influence>] ...
//   e.g. dev/wfc-blend.mts /tmp/b.md preset-valley.md:W preset-deep-forest.md:E
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { isCompass, mergeModels, modelToMarkdown, parseModelMarkdown, type Compass } from "../packages/hex-wfc/src";

const [out, ...specs] = process.argv.slice(2);
const models = [], dirs: Compass[] = [], influence: number[] = [];
for (const spec of specs) {
  const [file, dir = "C", inf = "50"] = spec.split(":");
  const parsed = parseModelMarkdown(readFileSync(file, "utf8"));
  if (!("model" in parsed)) throw new Error(`can't read ${file}`);
  if (!isCompass(dir)) throw new Error(`bad direction ${dir}`);
  models.push(parsed.model); dirs.push(dir); influence.push(Number(inf));
}
const name = specs.map((s) => basename(s.split(":")[0], ".md")).join("-to-");
writeFileSync(out, modelToMarkdown(mergeModels(models, name, { palette: "Default" }, influence, dirs)));
console.log("wrote", out);
