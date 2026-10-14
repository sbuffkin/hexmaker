import { describe, it } from "node:test";
import expect from "expect";
import { crc32, readZip, writeZip } from "../src/packs/zip";
import { formatManifest, inferManifest, parseManifest, type PackManifest } from "../src/packs/packManifest";
import {
  coreKinds,
  fixTableNote,
  isSafePackPath,
  keepBothPath,
  kindOf,
  notesByKind,
  packPathOf,
  rewriteFolderLinks,
  vaultPathOf,
  type PackKind,
} from "../src/packs/packKinds";
import { decodeText, loadPack, planImport, resolveSteps, type PackFile, type PlanItem } from "../src/packs/packPlan";
import { buildPack, packFileName, runImport, type PackWriteHost } from "../src/packs/packIO";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const kindsFor = (world: string, over: Record<string, string> = {}): PackKind[] =>
  coreKinds({ worldFolder: world, ...over }, { palettes: `${world}/palettes`, generators: `${world}/generators` });

describe("content packs: zip", () => {
  it("round-trips files, names with spaces and accents, empty files", async () => {
    const files = [
      { path: "pack.md", data: enc("# Pack\n") },
      { path: "tables/Wandering monsters.md", data: enc("| Result | Weight |\n|---|---|\n| Wolves | 3 |\n".repeat(40)) },
      { path: "towns/Café du Nord.md", data: enc("Ünïcode ✓") },
      { path: "towns/empty.md", data: new Uint8Array(0) },
    ];
    const back = await readZip(await writeZip(files));
    expect(back.map((f) => f.path)).toEqual(files.map((f) => f.path));
    back.forEach((f, i) => expect(dec(f.data)).toBe(dec(files[i].data)));
  });

  it("deflates text that compresses (smaller than the notes)", async () => {
    const big = enc("a hex of forest and hills\n".repeat(500));
    const zip = await writeZip([{ path: "a.md", data: big }]);
    expect(zip.length).toBeLessThan(big.length / 4);
  });

  it("refuses a damaged zip and non-zips", async () => {
    const zip = await writeZip([{ path: "a.md", data: enc("hello there") }]);
    await expect(readZip(enc("not a zip at all"))).rejects.toThrow(/not a zip/);
    const bad = zip.slice();
    // Flip a byte of the stored data (stored: short text doesn't compress).
    bad[30 + "a.md".length] ^= 0xff;
    await expect(readZip(bad)).rejects.toThrow(/damaged/);
  });

  it("crc32 matches the standard check value", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  });
});

describe("content packs: pack.md manifest", () => {
  const m: PackManifest = {
    format: 1,
    name: "Coast | tables \"v2\"",
    description: "Tables for the coast.\n\nTwo paragraphs.",
    madeWith: "Hexmap World Creator 1.6.0",
    date: "2026-10-14",
    kinds: [
      { id: "tables", label: "Random tables", from: "world/tables", files: ["tables/Weather.md", "tables/sea/Ships.md"] },
      { id: "towns", label: "Towns", from: "my towns", files: ["towns/Saltwatch.md"] },
    ],
  };

  it("round-trips", () => {
    expect(parseManifest(formatManifest(m))).toEqual(m);
  });

  it("is readable: a title, a contents table and a file list", () => {
    const text = formatManifest(m);
    expect(text).toContain("| Random tables | tables | world/tables | 2 |");
    expect(text).toContain("### Towns\n- towns/Saltwatch.md");
    expect(text).toMatch(/^---\nhexmaker-pack: 1\n/);
  });

  it("reads a hand-edited one with parts missing", () => {
    const p = parseManifest("# Just a title\n\nSome words.\n", "fallback");
    expect(p).toMatchObject({ name: "Just a title", description: "Some words.", kinds: [] });
    expect(parseManifest("", "From zip").name).toBe("From zip");
    // CRLF and a BOM (edited on Windows).
    const crlf = "\uFEFF" + formatManifest(m).replace(/\n/g, "\r\n");
    expect(parseManifest(crlf)).toEqual(m);
  });

  it("infers one from folder names when there's no pack.md", () => {
    const inf = inferManifest(["tables/a.md", "towns/b.md", "misc/c.md"], [{ id: "tables", label: "Random tables" }, { id: "towns", label: "Towns" }], "x");
    expect(inf.kinds.map((k) => [k.id, k.files])).toEqual([["tables", ["tables/a.md"]], ["towns", ["towns/b.md"]]]);
  });
});

describe("content packs: folder mapping", () => {
  it("core kinds follow the folder settings, blank = under the world folder", () => {
    const k = kindsFor("world", { tablesFolder: "Lore/Tables" });
    const by = Object.fromEntries(k.map((x) => [x.id, x.folder]));
    expect(by).toMatchObject({
      tables: "Lore/Tables",
      workflows: "world/workflows",
      templates: "world/templates",
      towns: "world/towns",
      areas: "world/regions",
      palettes: "world/palettes",
      generators: "world/generators",
    });
  });

  it("files a note under the deepest kind folder; skips _ notes and non-notes", () => {
    const k = kindsFor("world", { workflowsFolder: "world/tables/flows" });
    expect(kindOf("world/tables/flows/a.md", k)?.id).toBe("workflows");
    const by = notesByKind(["world/tables/b.md", "world/tables/_check.md", "world/tables/x.png", "world/tables/flows/a.md", "world/hexes/m/1_1.md"], k);
    expect([...by]).toEqual([["tables", ["world/tables/b.md"]], ["workflows", ["world/tables/flows/a.md"]]]);
  });

  it("maps a note into another vault's folder for the same kind", () => {
    const a = kindsFor("world");
    const b = kindsFor("Campaign", { townsFolder: "Places/Towns" });
    const tables = a.find((x) => x.id === "tables")!;
    const p = packPathOf(tables, "world/tables/sea/Ships.md");
    expect(p).toBe("tables/sea/Ships.md");
    expect(vaultPathOf(p, b)?.path).toBe("Campaign/tables/sea/Ships.md");
    expect(vaultPathOf("towns/Saltwatch.md", b)?.path).toBe("Places/Towns/Saltwatch.md");
    expect(vaultPathOf("spells/Fireball.md", b)).toBeNull();
  });

  it("rejects unsafe pack paths", () => {
    for (const bad of ["../x.md", "/abs.md", "C:/x.md", "tables/../../x.md", "tables/.obsidian/x.md", "a\\b.md", "tables//x.md"]) expect(isSafePackPath(bad)).toBe(false);
    expect(isSafePackPath("tables/sea/Ships 2.md")).toBe(true);
  });

  it("rewrites folder-path links to this vault's folder, once", () => {
    const t = "[[world/tables/Weather]] [[Weather]] [roll](world/tables/Weather.md) [[world/tablesX/a]]";
    expect(rewriteFolderLinks(t, "world/tables", "world/tables/sub")).toBe("[[world/tables/sub/Weather]] [[Weather]] [roll](world/tables/sub/Weather.md) [[world/tablesX/a]]");
    expect(rewriteFolderLinks("[x](my%20tables/a.md)", "my tables", "lore")).toBe("[x](lore/a.md)");
    expect(rewriteFolderLinks(t, "world/tables", "world/tables")).toBe(t);
  });

  it("swaps an old roller link (it named the old path) and leaves other tables alone", () => {
    const legacy = "---\ndice: 6\n---\n[Open in roller](obsidian://duckmage-roll?file=world%2Ftables%2FW.md)\n\n| Result | Weight |\n|---|---|\n| a | 1 |\n";
    const fixed = fixTableNote(legacy);
    expect(fixed).not.toContain("duckmage-roll?");
    expect(fixed).toContain("```duckmage-roller");
    const plain = "| Result | Weight |\n|---|---|\n| a | 1 |\n";
    expect(fixTableNote(plain)).toBe(plain);
  });
});

describe("content packs: conflicts", () => {
  it("keep both: Name 2, then 3…", () => {
    const taken = new Set(["t/Name 2.md"]);
    expect(keepBothPath("t/Name.md", (p) => taken.has(p))).toBe("t/Name 3.md");
    expect(keepBothPath("t/v1.2/Name", () => false)).toBe("t/v1.2/Name 2");
  });

  it("resolves choices; keep-both names miss notes and other items' targets", () => {
    const item = (target: string, status: PlanItem["status"]): PlanItem => ({ packPath: target, kindId: "tables", target, text: "", status });
    const items = [item("t/A.md", "conflict"), item("t/A 2.md", "new"), item("t/B.md", "conflict"), item("t/C.md", "same"), item("t/D.md", "conflict")];
    const choice = (i: PlanItem) => (i.target === "t/B.md" ? "replace" : i.target === "t/D.md" ? "skip" : "both");
    const steps = resolveSteps(items, choice, (p) => ["t/A.md", "t/B.md", "t/C.md", "t/D.md"].includes(p));
    expect(steps.map((s) => [s.action, s.path])).toEqual([
      ["create", "t/A 3.md"],
      ["create", "t/A 2.md"],
      ["replace", "t/B.md"],
      ["skip", "t/C.md"],
      ["skip", "t/D.md"],
    ]);
  });
});

describe("content packs: planning an import", () => {
  const kinds = kindsFor("world");
  const file = (path: string, text: string | Uint8Array): PackFile => ({ path, data: typeof text === "string" ? enc(text) : text });

  it("finds the pack root under a wrapping folder and reports what it can't import", async () => {
    const pack = loadPack([
      file("My pack/pack.md", formatManifest({ format: 1, name: "My pack", description: "", madeWith: "", date: "", kinds: [{ id: "tables", label: "Random tables", from: "lore", files: ["tables/a.md", "tables/gone.md"] }] })),
      file("My pack/tables/a.md", "see [[lore/b]]"),
      file("My pack/tables/pic.png", "x"),
      file("My pack/spells/fire.md", "x"),
      file("My pack/tables/bin.md", new Uint8Array([0xff, 0xfe, 0x00, 0x41])),
      file("__MACOSX/My pack/._a.md", "junk"),
      file("other/stray.md", "outside the root"),
    ], kinds, "zip");
    expect(pack.inferred).toBe(false);
    expect(pack.files.map((f) => f.path).sort()).toEqual(["spells/fire.md", "tables/a.md", "tables/bin.md", "tables/pic.png"]);
    const vault = new Map([["world/tables/a.md", "see [[world/tables/b]]"]]);
    const plan = await planImport(pack, kinds, async (p) => vault.get(p) ?? null);
    expect(plan.items).toEqual([{ packPath: "tables/a.md", kindId: "tables", target: "world/tables/a.md", text: "see [[world/tables/b]]", status: "same" }]);
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual(["not a note (.md)", "not readable text", "this vault has no place for \"spells\""]);
    expect(plan.missing).toEqual(["tables/gone.md"]);
  });

  it("reads a pack with no pack.md by its folder names", () => {
    const pack = loadPack([file("tables/a.md", "x"), file("towns/b.md", "y")], kinds, "Loose");
    expect(pack.inferred).toBe(true);
    expect(pack.manifest.name).toBe("Loose");
    expect(pack.manifest.kinds.map((k) => k.id)).toEqual(["tables", "towns"]);
  });

  it("keeps a byte order mark and CRLF as they were", () => {
    expect(decodeText(enc("\uFEFFa\r\nb"))).toBe("\uFEFFa\r\nb");
  });
});

describe("content packs: export and import through hosts", () => {
  it("names the zip safely", () => {
    expect(packFileName("Coast: tables/v2?")).toBe("Coast tables v2.zip");
    expect(packFileName("  ")).toBe("Content pack.zip");
  });

  it("puts each picked note under its kind, with pack.md first", async () => {
    const kinds = kindsFor("world");
    const notes = new Map([["world/tables/W.md", "w"], ["world/towns/T.md", "t"]]);
    const { bytes, manifest } = await buildPack({ read: async (p) => notes.get(p)! }, {
      name: "P", description: "", madeWith: "Hexmap World Creator 9.9.9", when: new Date(2026, 9, 14),
      picked: [{ kind: kinds.find((k) => k.id === "tables")!, files: ["world/tables/W.md"] }, { kind: kinds.find((k) => k.id === "towns")!, files: [] }],
    });
    expect(manifest.date).toBe("2026-10-14");
    expect(manifest.kinds.map((k) => k.id)).toEqual(["tables"]);
    expect((await readZip(bytes)).map((e) => e.path)).toEqual(["pack.md", "tables/W.md"]);
  });

  function memHost(files: Map<string, string>, failBackup = false) {
    const backups: { path: string; text: string }[][] = [];
    const host: PackWriteHost = {
      exists: (p) => files.has(p),
      read: async (p) => files.get(p)!,
      create: async (p, t) => {
        if (files.has(p)) throw new Error("exists");
        files.set(p, t);
      },
      modify: async (p, t) => { files.set(p, t); },
      ensureFolderPath: async () => {},
      backup: async (notes) => {
        if (failBackup) throw new Error("disk full");
        backups.push(notes);
        return "backups/x.json.gz";
      },
    };
    return { host, backups };
  }

  const item = (target: string, text: string, status: PlanItem["status"]): PlanItem => ({ packPath: target, kindId: "tables", target, text, status });

  it("backs up every note it replaces before writing any", async () => {
    const files = new Map([["t/A.md", "mine"], ["t/B.md", "mine B"]]);
    const { host, backups } = memHost(files);
    const steps = resolveSteps([item("t/A.md", "theirs", "conflict"), item("t/B.md", "theirs B", "conflict"), item("t/C.md", "new", "new")], (i) => (i.target === "t/A.md" ? "replace" : "both"), host.exists);
    const r = await runImport(host, steps, "P");
    expect(backups).toEqual([[{ path: "t/A.md", text: "mine" }]]);
    expect(r).toMatchObject({ replaced: ["t/A.md"], created: ["t/C.md"], keptBoth: [{ target: "t/B.md", path: "t/B 2.md" }], backup: "backups/x.json.gz" });
    expect(files.get("t/B.md")).toBe("mine B");
    expect(files.get("t/B 2.md")).toBe("theirs B");
  });

  it("replaces nothing when the backup fails", async () => {
    const files = new Map([["t/A.md", "mine"]]);
    const { host } = memHost(files, true);
    const r = await runImport(host, resolveSteps([item("t/A.md", "theirs", "conflict"), item("t/N.md", "n", "new")], () => "replace", host.exists), "P");
    expect(files.get("t/A.md")).toBe("mine");
    expect(r.replaced).toEqual([]);
    expect(r.created).toEqual(["t/N.md"]);
    expect(r.failed[0].reason).toMatch(/back up/);
  });
});
