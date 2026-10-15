/**
 * The space set as random tables (plan-tables-everywhere §4, phase 3).
 *
 * A World types note converts, once, into ordinary random table notes in
 * a tidy tree under the tables folder (T1):
 *
 *   {tables}/space/<name>/
 *     Sector/Charted sector.md      what a star system hex is (Star scatter)
 *     Sector/Unexplored sector.md   the same, with some hexes left for arrival
 *     Sector/Mainworlds.md          a system's mainworld, with its map setup
 *     Sector/Uncharted.md           what an uncharted hex turns out to be
 *     System/Stars.md               the star at a system's centre (Orbits)
 *     System/Inner orbits.md        a body per orbit, by zone
 *     System/Habitable orbits.md
 *     System/Outer orbits.md
 *
 * The World types note is kept (T2). It gets a `## Tables` section that
 * links each generator role to its table — that list is what the
 * generators read from then on, so pointing Sector hexes at Unexplored
 * sector is one edit — and the tables embedded below it, so they can be
 * rolled from the note.
 *
 * The converted tables give the same odds as the note did (T4: different
 * draws). Rows keep their setup columns (Mainworld, Size, Generator,
 * Options, Palette, Base) as row attributes, and their limits as When.
 * Weights are scaled to whole numbers where that keeps the odds exact.
 *
 * Nothing is special-cased by name: every set is built from the note's
 * own rows. The Unexplored and Uncharted tables are built the same way
 * for every note (their shares are just weights; edit them freely).
 *
 * Pure: no Obsidian imports.
 */

import { rangeCellTexts, type RowType } from "../random-tables/randomTable";
import { formatWhen } from "../random-tables/tableConditions";
import { ENGINE_ROLES, type RoleId } from "../worldgen/tableRoles";
import { attrsOf, conditionsOf } from "./worldTypesSource";
import { ORBIT_ZONES, type OrbitZone, type WorldTypeRow, type WorldTypeTable } from "./worldTypes";

/** The subfolder of the tables folder that holds space sets. */
export const SPACE_TABLES_FOLDER = "space";

/** The folder a set named `name` converts into. */
export function spaceSetFolder(tablesFolder: string, name: string): string {
  const base = tablesFolder.replace(/^\/+|\/+$/g, "");
  return `${base ? `${base}/` : ""}${SPACE_TABLES_FOLDER}/${name}`;
}

/** A table to write. */
export interface TableSpec {
  title: string;
  /** Plain text under the title. */
  description: string;
  rows?: RowType;
  terrainTypes?: readonly string[];
  /** Extra columns after Weight, in order (only those a row fills are written). */
  columns: readonly string[];
  entries: { result: string; link?: string; weight: number; cells?: Record<string, string> }[];
}

const STANDARD_DICE = [2, 3, 4, 6, 8, 10, 12, 20, 100];
const SCALES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 25, 30, 40, 50, 60, 75, 100, 120, 150, 200, 300, 600, 1000];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** The smallest multiplier that makes every weight whole (1 when none does). */
export function wholeScale(weights: readonly number[]): number {
  return SCALES.find((n) => weights.every((w) => near(w * n, Math.round(w * n)))) ?? 1;
}

const fmtWeight = (w: number) => (near(w, Math.round(w)) ? String(Math.round(w)) : String(Math.round(w * 1e6) / 1e6));
const esc = (s: string) => s.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");

/** A link cell: `[[path\|Name]]` (the escaped pipe keeps the table whole). */
export function linkCell(path: string): string {
  const target = path.replace(/\.md$/i, "");
  const name = target.slice(target.lastIndexOf("/") + 1);
  return `[[${target}\\|${name}]]`;
}

/** A random table note (frontmatter, roller block, title, description, table). */
export function tableNoteMarkdown(spec: TableSpec): string {
  const scale = wholeScale(spec.entries.map((e) => e.weight));
  const entries = spec.entries.map((e) => ({ ...e, weight: e.weight * scale }));
  const total = entries.reduce((a, e) => a + e.weight, 0);
  const dice = near(total, Math.round(total)) && STANDARD_DICE.includes(Math.round(total)) ? Math.round(total) : 0;
  const ranges = dice ? rangeCellTexts(dice, entries.map((e) => ({ result: e.result, weight: e.weight })), "regenerate") : [];
  const cols = spec.columns.filter((c) => entries.some((e) => e.cells?.[c]));
  const head = [...(dice ? [`d${dice}`] : []), "Result", "Weight", ...cols];
  const lines = [
    "---",
    `dice: ${dice}`,
    ...(spec.rows ? [`rows: ${spec.rows}`] : []),
    ...(spec.terrainTypes?.length ? [`terrain-type: ${spec.terrainTypes.join(", ")}`] : []),
    "---",
    "",
    "```duckmage-roller",
    "```",
    "",
    `# ${spec.title}`,
    "",
    spec.description,
    "",
    `| ${head.join(" | ")} |`,
    `| ${head.map((h) => (h === "Weight" ? "---:" : "---")).join(" | ")} |`,
    ...entries.map((e, i) => {
      const cells = [
        ...(dice ? [ranges[i] || "—"] : []),
        e.link ? linkCell(e.link) : esc(e.result),
        fmtWeight(e.weight),
        ...cols.map((c) => esc(e.cells?.[c] ?? "")),
      ];
      return `| ${cells.join(" | ")} |`;
    }),
    "",
  ];
  return lines.join("\n");
}

// ── converting a World types note ────────────────────────────────────────

export interface SpaceSet {
  /** The set's folder. */
  folder: string;
  /** Notes to write (path → text). Existing notes are never overwritten. */
  files: { path: string; content: string }[];
  /** Each role's table (vault path with .md). */
  roles: Partial<Record<RoleId, string>>;
}

export interface ConvertOptions {
  /** The tables folder (setting). */
  tablesFolder: string;
  /**
   * What a "somewhat known" hex of the Unexplored sector shows until
   * someone arrives: a terrain of the sector palette whose type is
   * star-system (found by type by the caller). Blank: the background.
   */
  shownAs?: string;
  /** Rows of the note that couldn't be read, as written (copied into the set's notes). */
  unreadable?: readonly string[];
}

const SETUP_COLUMNS = ["When", "Mainworld", "Size", "Generator", "Options", "Palette", "Base", "Notes"] as const;
const SECTOR_TYPES = ["world", "gas-giant", "asteroids", "station", "starport", "jump-point", "anomaly"];
const BODY_TYPES = ["world", "gas-giant", "asteroids"];
const ZONE_FILE: Record<OrbitZone, string> = { inner: "Inner orbits", habitable: "Habitable orbits", outer: "Outer orbits" };
const ZONE_ROLE: Record<OrbitZone, RoleId> = { inner: "inner-orbits", habitable: "habitable-orbits", outer: "outer-orbits" };

function worldEntry(r: WorldTypeRow): TableSpec["entries"][number] {
  const cells: Record<string, string> = { ...attrsOf(r) };
  const when = conditionsOf(r);
  if (when.length) cells.When = formatWhen(when);
  return { result: r.world.trim(), weight: r.weight ?? 1, cells };
}

const lc = (s: string) => s.trim().toLowerCase();

/**
 * A World types table as a space set: the notes to write and each role's
 * table. The same odds as the note (worldTypesSource reads it the same
 * way). Pure: the caller writes the files.
 */
export function convertWorldTypes(table: WorldTypeTable, opts: ConvertOptions): SpaceSet {
  const folder = spaceSetFolder(opts.tablesFolder, table.name);
  const path = (rel: string) => `${folder}/${rel}.md`;
  const P = {
    charted: path("Sector/Charted sector"),
    unexplored: path("Sector/Unexplored sector"),
    mainworlds: path("Sector/Mainworlds"),
    uncharted: path("Sector/Uncharted"),
    stars: path("System/Stars"),
  };
  const files: SpaceSet["files"] = [];
  const roles: SpaceSet["roles"] = {};
  const unreadable = opts.unreadable?.length
    ? `\n\nRows of the World types note that couldn't be read, copied as written:\n\n${opts.unreadable.map((l) => `    ${l}`).join("\n")}`
    : "";

  // Mainworlds: the rows for a sector (Map sector or blank).
  const sectorRows = table.rows.filter((r) => r.map !== "system" && r.world.trim());
  files.push({
    path: P.mainworlds,
    content: tableNoteMarkdown({
      title: "Mainworlds",
      description: `A star system's mainworld, and what its own map is made with. Converted from the ${table.name} world types.${unreadable}`,
      rows: "terrain",
      terrainTypes: BODY_TYPES,
      columns: SETUP_COLUMNS,
      entries: sectorRows.map(worldEntry),
    }),
  });

  // Sector features by their chance, then the systems (as worldTypesSource).
  const features: { name: string; weight: number }[] = [];
  let left = 1;
  for (const f of table.features ?? []) {
    const name = f.feature.trim();
    if (!name || !(f.chance > 0)) continue;
    const chance = Math.max(0, Math.min(f.chance, left));
    left -= chance;
    const same = features.find((x) => lc(x.name) === lc(name));
    if (same) same.weight += chance;
    else if (chance > 0) features.push({ name, weight: chance });
  }
  const rest = left > 1e-12 ? left : 0;
  const featureEntries = features.map((f) => ({ result: f.name, weight: f.weight, cells: { Roll: "now" } }));

  files.push({
    path: P.charted,
    content: tableNoteMarkdown({
      title: "Charted sector",
      description: "What each star system hex of a sector is: a special hex, or a system typed by its mainworld. Everything is known from the start.",
      rows: "terrain",
      terrainTypes: SECTOR_TYPES,
      columns: [],
      entries: [
        ...features.map((f) => ({ result: f.name, weight: f.weight })),
        ...(rest ? [{ result: "Mainworlds", link: P.mainworlds, weight: rest }] : []),
      ],
    }),
  });
  roles["sector-hexes"] = P.charted;

  // Unexplored: the systems split charted / somewhat known / uncharted, 2 : 1 : 1.
  const shown = opts.shownAs?.trim() ?? "";
  files.push({
    path: P.unexplored,
    content: tableNoteMarkdown({
      title: "Unexplored sector",
      description: "Like Charted sector, but only half the systems are known. A somewhat known hex shows a system whose world isn't known yet; an uncharted one shows nothing. Both are rolled the first time someone goes there (Roll: on arrival). Change the weights to make the sector more or less known.",
      rows: "terrain",
      terrainTypes: SECTOR_TYPES,
      columns: ["Roll", "Shown as", "Notes"],
      entries: [
        ...featureEntries,
        ...(rest ? [
          { result: "Mainworlds", link: P.mainworlds, weight: rest / 2, cells: { Roll: "now", Notes: "charted" } },
          { result: "Mainworlds", link: P.mainworlds, weight: rest / 4, cells: { Roll: "on arrival", ...(shown ? { "Shown as": shown } : {}), Notes: "somewhat known: a system is there, its world isn't known" } },
          { result: "Uncharted", link: P.uncharted, weight: rest / 4, cells: { Roll: "on arrival", Notes: "uncharted" } },
        ] : []),
      ],
    }),
  });

  files.push({
    path: P.uncharted,
    content: tableNoteMarkdown({
      title: "Uncharted",
      description: "What an uncharted hex turns out to be when someone gets there.",
      rows: "terrain",
      terrainTypes: SECTOR_TYPES,
      columns: ["Notes"],
      entries: [
        { result: "Mainworlds", link: P.mainworlds, weight: 6, cells: { Notes: "an ordinary system after all" } },
        ...features.map((f) => ({ result: f.name, weight: 1 })),
        { result: "(nothing)", weight: 2, cells: { Notes: "empty space" } },
      ],
    }),
  });

  if (table.stars?.length) {
    files.push({
      path: P.stars,
      content: tableNoteMarkdown({
        title: "Stars",
        description: "The star at the centre of a system, when Orbits' Star option is Random.",
        rows: "terrain",
        terrainTypes: ["star"],
        columns: ["Notes"],
        entries: table.stars.filter((s) => s.star.trim()).map((s) => ({ result: s.star.trim(), weight: s.weight ?? 1, ...(s.notes ? { cells: { Notes: s.notes } } : {}) })),
      }),
    });
    roles.star = P.stars;
  }

  // Orbits by zone: the rows for a system (Map system or blank) whose Orbit allows the zone.
  const systemRows = table.rows.filter((r) => r.map !== "sector" && r.world.trim());
  for (const z of ORBIT_ZONES) {
    const p = path(`System/${ZONE_FILE[z]}`);
    files.push({
      path: p,
      content: tableNoteMarkdown({
        title: ZONE_FILE[z],
        description: `The body on each orbit in the ${z} zone of a system, and what its own map is made with.`,
        rows: "terrain",
        terrainTypes: BODY_TYPES,
        columns: SETUP_COLUMNS,
        entries: systemRows.filter((r) => !r.zones?.length || r.zones.includes(z)).map(worldEntry),
      }),
    });
    roles[ZONE_ROLE[z]] = p;
  }
  return { folder, files, roles };
}

// ── the role list in a note (`## Tables`) ───────────────────────────────

const TABLES_HEADING = /^##\s+tables\s*$/i;
const roleByName = new Map<string, RoleId>(ENGINE_ROLES.flatMap((r) => [[lc(r.name), r.id], [r.id, r.id]] as [string, RoleId][]));

const splitCells = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  const s = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "[" && s[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
    if (s[i] === "]" && s[i + 1] === "]" && depth) { depth--; cur += "]]"; i++; continue; }
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|" && !depth) { out.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  out.push(cur.trim());
  return out;
};

/** A link cell's target (`[[a/b|c]]` → `a/b`), or the plain text. */
export function linkTarget(cell: string): string {
  const m = /^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(cell.trim());
  return (m ? m[1] : cell).trim();
}

/**
 * The `## Tables` section of a note: role → table link target (as written,
 * without `.md`). Rows naming no known role are left out. Empty when the
 * note has no such section.
 */
export function readRoleTables(content: string): Partial<Record<RoleId, string>> {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out: Partial<Record<RoleId, string>> = {};
  const start = lines.findIndex((l) => TABLES_HEADING.test(l.trim()));
  if (start < 0) return out;
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|") && !/^#{1,2}\s/.test(lines[i])) i++;
  if (i >= lines.length || !lines[i].trim().startsWith("|")) return out;
  const head = splitCells(lines[i]).map(lc);
  const rc = head.indexOf("role"), tc = head.indexOf("table");
  if (rc < 0 || tc < 0) return out;
  for (let j = i + 1; j < lines.length && lines[j].trim().startsWith("|"); j++) {
    const c = splitCells(lines[j]);
    const role = roleByName.get(lc(c[rc] ?? ""));
    const target = linkTarget(c[tc] ?? "");
    if (role && target && !/^-+:?$/.test(target)) out[role] = target.replace(/\.md$/i, "");
  }
  return out;
}

/** Whether a World types note was converted (it has a role list). */
export function isConverted(content: string): boolean {
  return Object.keys(readRoleTables(content)).length > 0;
}

/**
 * The World types note after converting (T2): a short callout, the
 * `## Tables` role list right under the title, the tables embedded so
 * they can be rolled here, and `converted-to:` in the frontmatter. Every
 * line of the old note stays. Unchanged when it was converted already.
 */
export function markConverted(content: string, set: Pick<SpaceSet, "folder" | "roles">): string {
  if (isConverted(content)) return content;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  // converted-to: in the frontmatter.
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0 && !lines.slice(1, end).some((l) => /^converted-to\s*:/.test(l))) lines.splice(end, 0, `converted-to: ${JSON.stringify(set.folder)}`);
  }
  const rows = ENGINE_ROLES.filter((r) => set.roles[r.id]).map((r) => `| ${r.name} | ${linkCell(set.roles[r.id]!)} |`);
  const embeds = ENGINE_ROLES.filter((r) => set.roles[r.id]).map((r) => `![[${set.roles[r.id]!.replace(/\.md$/i, "")}]]`);
  const block = [
    "> [!info] Converted to tables",
    `> The space generators roll on the tables linked below (in ${set.folder}). To use another table for a role, change its link. The world types further down are the old copy, kept as they were.`,
    "",
    "## Tables",
    "",
    "| Role | Table |",
    "| --- | --- |",
    ...rows,
    "",
    ...embeds.flatMap((e) => [e, ""]),
  ];
  const fmEnd = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) + 1 : 0;
  const h1 = lines.findIndex((l, i) => i >= fmEnd && /^#\s+\S/.test(l));
  const at = h1 >= 0 ? h1 + 1 : fmEnd;
  lines.splice(at, 0, "", ...block.slice(0, -1));
  return lines.join(eol);
}
