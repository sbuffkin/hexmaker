/**
 * Content packs end to end (SF1): export the sim-vault fixture's notes
 * (read from disk) to a .zip, then import that zip into a second vault
 * whose folders are set up differently. Every note must land in the
 * second vault's folder for its kind, byte for byte as it was; a second
 * import finds them all already there; a note the second vault already
 * had is kept, with the pack's copy added as "Name 2".
 */

import { describe, it } from "node:test";
import expect from "expect";
import fs from "node:fs";
import path from "node:path";

import { coreKinds, notesByKind, type PackKind } from "../../src/packs/packKinds";
import { buildPack, runImport, type PackWriteHost } from "../../src/packs/packIO";
import { loadPack, planImport, resolveSteps } from "../../src/packs/packPlan";
import { readZip } from "../../src/packs/zip";
import { parseManifest } from "../../src/packs/packManifest";

const ROOT = path.resolve(__dirname, "../fixtures/sim-vault");

function walk(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? walk(dir, r) : [r];
  });
}

/** Vault A: the fixture, its content folders at the vault root. */
const kindsA: PackKind[] = coreKinds(
  {
    worldFolder: "",
    tablesFolder: "tables",
    workflowsFolder: "workflows",
    townsFolder: "towns",
    dungeonsFolder: "dungeons",
    featuresFolder: "features",
    questsFolder: "quests",
    factionsFolder: "factions",
    regionsFolder: "regions",
    templatesFolder: "templates",
  },
  { palettes: "palettes", generators: "generators" },
);

/** Vault B: everything under "Campaign", towns somewhere else. */
const kindsB: PackKind[] = coreKinds({ worldFolder: "Campaign", townsFolder: "Places/Towns" }, { palettes: "Campaign/palettes", generators: "Campaign/generators" });

function vaultB(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const host: PackWriteHost = {
    exists: (p) => files.has(p),
    read: async (p) => files.get(p)!,
    create: async (p, t) => {
      if (files.has(p)) throw new Error(`exists ${p}`);
      files.set(p, t);
    },
    modify: async (p, t) => { files.set(p, t); },
    ensureFolderPath: async () => {},
    backup: async () => "backup",
  };
  return { files, host };
}

async function exportFixture() {
  const all = walk(ROOT);
  const byKind = notesByKind(all, kindsA);
  const picked = kindsA.filter((k) => byKind.has(k.id)).map((k) => ({ kind: k, files: byKind.get(k.id)! }));
  const { bytes } = await buildPack(
    { read: async (p) => fs.readFileSync(path.join(ROOT, p), "utf8") },
    { name: "Sim vault", description: "Everything in the sim vault.", madeWith: "Hexmap World Creator test", when: new Date(2026, 9, 14), picked },
  );
  return { bytes, picked };
}

async function importInto(b: ReturnType<typeof vaultB>, bytes: Uint8Array) {
  const pack = loadPack(await readZip(bytes), kindsB, "Sim vault.zip");
  const plan = await planImport(pack, kindsB, async (p) => b.files.get(p) ?? null);
  const steps = resolveSteps(plan.items, () => "both", b.host.exists);
  return { pack, plan, report: await runImport(b.host, steps, pack.manifest.name) };
}

describe("content pack: export then import into a second vault", () => {
  it("exports every content note (no hex notes, no README) with a readable pack.md", async () => {
    const { bytes, picked } = await exportFixture();
    const entries = await readZip(bytes);
    const manifest = parseManifest(new TextDecoder().decode(entries.find((e) => e.path === "pack.md")!.data));
    expect(manifest.name).toBe("Sim vault");
    expect(manifest.kinds.map((k) => k.id)).toEqual(picked.map((p) => p.kind.id));
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("tables/treasure/gold pile.md");
    expect(paths.some((p) => p.startsWith("hexes/") || p === "README.md")).toBe(false);
    expect(paths.length).toBe(1 + picked.reduce((n, p) => n + p.files.length, 0));
  });

  it("imports every note into the other vault's folders, byte-identical", async () => {
    const { bytes, picked } = await exportFixture();
    const b = vaultB();
    const { plan, report } = await importInto(b, bytes);
    expect(plan.skipped).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(report.failed).toEqual([]);
    const expected = picked.flatMap((p) => p.files);
    expect(report.created.length).toBe(expected.length);
    for (const src of expected) {
      const kind = kindsA.find((k) => src.startsWith(k.folder + "/"))!;
      const dest = kindsB.find((k) => k.id === kind.id)!.folder + src.slice(kind.folder.length);
      const want = fs.readFileSync(path.join(ROOT, src));
      expect({ dest, bytes: Buffer.from(b.files.get(dest) ?? "", "utf8").equals(want) }).toEqual({ dest, bytes: true });
    }
    expect(b.files.has("Places/Towns/Saltwatch.md")).toBe(true);
    expect(b.files.has("Campaign/tables/treasure/gold pile.md")).toBe(true);
  });

  it("a second import finds everything already there and changes nothing", async () => {
    const { bytes } = await exportFixture();
    const b = vaultB();
    await importInto(b, bytes);
    const before = new Map(b.files);
    const { plan, report } = await importInto(b, bytes);
    expect(plan.items.every((i) => i.status === "same")).toBe(true);
    expect(report.created).toEqual([]);
    expect(b.files).toEqual(before);
  });

  it("keeps the second vault's own note and adds the pack's as Name 2", async () => {
    const { bytes } = await exportFixture();
    const b = vaultB({ "Places/Towns/Saltwatch.md": "my own Saltwatch" });
    const { report } = await importInto(b, bytes);
    expect(b.files.get("Places/Towns/Saltwatch.md")).toBe("my own Saltwatch");
    expect(report.keptBoth).toEqual([{ target: "Places/Towns/Saltwatch.md", path: "Places/Towns/Saltwatch 2.md" }]);
    expect(b.files.get("Places/Towns/Saltwatch 2.md")).toBe(fs.readFileSync(path.join(ROOT, "towns/Saltwatch.md"), "utf8"));
  });
});
