import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { declineModuleOffer, moduleOfferFor, moduleOfferText, resetModuleOffers } from "../src/maps/moduleOffer";
import { readSurface, readSource, ownerFile } from "./helpers/source";

/**
 * Owner call CM6: a map whose module is off still loads; opening it on
 * purpose (maps picker, region menu) offers to turn the module on; "New …"
 * flows never do.
 */

const kinds: Record<string, string | undefined> = { kerrigan: "space", gullmouth: "world", blank: undefined, odd: "dungeon" };
const kindFor = (m: string) => kinds[m];

describe("CM6: the offer itself", () => {
  beforeEach(() => resetModuleOffers());

  it("offers the map's module when it's off", () => {
    expect(moduleOfferFor("kerrigan", kindFor, { mapKinds: ["world"] })).toEqual({ kind: "space", label: "Space" });
    expect(moduleOfferFor("gullmouth", kindFor, { mapKinds: ["space"] })).toEqual({ kind: "world", label: "World" });
  });

  it("offers nothing when the module is on, the map has no type, or the type isn't a module here", () => {
    expect(moduleOfferFor("kerrigan", kindFor, { mapKinds: ["world", "space"] })).toBeUndefined();
    expect(moduleOfferFor("kerrigan", kindFor, {})).toBeUndefined(); // unset = all on
    expect(moduleOfferFor("blank", kindFor, { mapKinds: ["world"] })).toBeUndefined();
    expect(moduleOfferFor("odd", kindFor, { mapKinds: ["world"] })).toBeUndefined();
  });

  it("'Not now' holds for the session, per module", () => {
    declineModuleOffer("space");
    expect(moduleOfferFor("kerrigan", kindFor, { mapKinds: ["world"] })).toBeUndefined();
    expect(moduleOfferFor("gullmouth", kindFor, { mapKinds: ["space"] })).toBeDefined();
    resetModuleOffers();
    expect(moduleOfferFor("kerrigan", kindFor, { mapKinds: ["world"] })).toBeDefined();
  });

  it("says plainly what's off and that the map opens anyway", () => {
    const t = moduleOfferText("Kerrigan", { kind: "space", label: "Space" });
    expect(t.heading).toBe("Turn on Space?");
    expect(t.confirm).toBe("Turn on Space");
    expect(t.message).toMatch(/"Kerrigan" is a Space map/);
    expect(t.message).toMatch(/opens either way/);
  });
});

// ── Where it's offered: open/navigate only, never from New … flows ─────────

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...sources(rel));
    else if (name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

describe("CM6: offered only when a map is opened on purpose", () => {
  const src = sources("src");

  it("only the maps picker, the region menu and the hex editor's map chips ask for it", () => {
    const sites = src.flatMap((f) => read(f).split("\n").flatMap((line, i) => (/offerModule:\s*true/.test(line) ? [`${ownerFile(f)}:${line.trim()}`] : [])));
    expect(sites.map((s) => s.split(":")[0]).sort()).toEqual([
      "src/hex-map/HexMapView.ts", // hex menu: Enter region
      "src/hex-map/HexMapView.ts", // hex menu: Open location
      "src/hex-map/HexMapView.ts", // hex editor's Maps chips (onSwitchMap)
      "src/hex-map/MapModal.ts", // maps picker (the map tree)
      "src/hex-map/MapModal.ts", // the map's Regions list
    ]);
    expect(sites.some((s) => /Enter region/.test(s))).toBe(true);
    expect(sites.some((s) => /onSwitchMap/.test(s))).toBe(true);
  });

  it("New … flows never offer or turn on a module", () => {
    const newFlows = [
      "src/worldgen/NewMapSetupModal.ts",
      "src/hex-map/newChildMap.ts",
      "src/overworld/OverworldModals.ts",
      "src/overworld/WalkRegionModal.ts",
      "src/SetupWizardView.ts",
    ];
    for (const f of newFlows) expect({ f, hit: /offerModule|offerModuleFor|enableMapKind/.test(readSource(f)) }).toEqual({ f, hit: false });
    // The New map form in the maps dialog switches without the offer.
    const modal = readSurface("map-modal");
    const newMap = modal.slice(modal.indexOf("private openNewMap("), modal.indexOf("private openNewMap(") + 400);
    expect(newMap).toMatch(/switchMapFromModal\(name\)/);
    expect(newMap).not.toMatch(/offerModule/);
  });

  it("navigating by default never offers; only the opt-in does", () => {
    const view = readSurface("map-view");
    expect(view).toMatch(/if \(opts\.offerModule\) this\.plugin\.offerModuleFor\(name\);/);
    // Maps made by a New … flow are entered with a plain navigateToMap.
    expect(view).toMatch(/if \(this\.activeMapName === parentMap\) this\.navigateToMap\(name\);/);
  });

  it("a module is turned on only through the offer (or Settings → Map types)", () => {
    const callers = [...new Set(src.filter((f) => /\.enableMapKind\(/.test(read(f))).map(ownerFile))];
    expect(callers).toEqual(["src/HexmakerPlugin.ts"]);
    expect(readSurface("plugin")).toMatch(/\(\) => void this\.enableMapKind\(offer\.kind\)/);
  });
});
