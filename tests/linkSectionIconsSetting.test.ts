/**
 * P3 (owner 2026-10-16): the default icons for linked notes (Towns →
 * village, Dungeons → dungeon gate, Features → ruins) must be editable.
 * Drives settings → Map look → "Icons for linked notes" and checks the
 * icon the hex editor's "Show on map" then offers.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { fakeRoot } from "./helpers/fakeDom";
import { DEFAULT_SETTINGS } from "../src/constants";
import { HexmakerSettingTab } from "../src/HexmakerSettingTab";
import { IconPickerModal } from "../src/hex-map/IconPickerModal";
import { DEFAULT_LINK_SECTION_ICONS, linkSectionIcon, showOnMapOffer } from "../src/play/linkIcons";
import { LINK_SECTIONS } from "../src/types";

type Item = { name?: string; items?: Item[]; render?: (s: { controlEl: HTMLElement }) => void };
type Pick = (icon: string | null, gmOnly: boolean) => void;

/** The setting's control, rendered into a fake element; picks go through `pick`. */
function iconsSetting() {
  // The picker is a modal: capture its callback instead of opening it.
  let opened: { title?: string; onSelect: Pick } | null = null;
  (IconPickerModal.prototype as unknown as { open(): void }).open = function (this: unknown) {
    const m = this as { onSelect: Pick; opts: { title?: string } };
    opened = { title: m.opts.title, onSelect: m.onSelect };
  };
  let saves = 0;
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, maps: [], terrainPalettes: [] } as typeof DEFAULT_SETTINGS,
    missingDefaultPalettes: () => [],
    saveSettings: async () => { saves++; },
    vaultIconsSet: new Set<string>(),
    manifest: { dir: "plugin" },
    app: { vault: { adapter: { getResourcePath: (p: string) => `res:${p}` } } },
  };
  const store = { loadLocalStorage: () => null, saveLocalStorage: () => {} };
  const tab = new HexmakerSettingTab(store as never, plugin as never);
  const all = (items: Item[]): Item[] => items.flatMap((i) => [i, ...all(i.items ?? [])]);
  const item = all(tab.getSettingDefinitions() as Item[]).find((i) => i.name === "Icons for linked notes")!;
  const { root, el } = fakeRoot();
  item.render!({ controlEl: el });
  const button = (section: string) => root.buttons().find((b) => b.attrs["aria-label"] === `Icon for ${section}`);
  const imgOf = (section: string) => button(section)?.all((e) => e.tag === "img")[0]?.attrs.src;
  const pick = (section: string, icon: string | null) => {
    opened = null;
    button(section)!.fire("click");
    const m = opened as { title?: string; onSelect: Pick } | null;
    expect(m?.title).toBe(`Icon for ${section}`);
    m!.onSelect(icon, false);
  };
  return { plugin, root, button, imgOf, pick, saves: () => saves };
}

/** What "Show on map" offers for a hex with one link in `section` and no icon yet. */
const offered = (settings: Parameters<typeof linkSectionIcon>[0], section: string) =>
  showOnMapOffer({ icon: linkSectionIcon(settings, section), linkCount: 1, hexIcon: null, available: () => true });

describe("Icons for linked notes (P3): every default is editable", () => {
  it("ships Towns → village, Dungeons → dungeon gate, Features → ruins, the rest none", () => {
    expect(DEFAULT_LINK_SECTION_ICONS.Towns).toBe("place-village.svg");
    expect(DEFAULT_LINK_SECTION_ICONS.Dungeons).toBe("place-dungeon-gate.svg");
    expect(DEFAULT_LINK_SECTION_ICONS.Features).toBe("place-ancient-ruins.svg");
    for (const s of ["Quests", "Factions", "Encounters Table"]) expect(DEFAULT_LINK_SECTION_ICONS[s]).toBe("");
  });

  it("has a control for every link section, showing its current icon", () => {
    const { button, imgOf } = iconsSetting();
    for (const s of LINK_SECTIONS) expect(button(s)).toBeDefined();
    expect(imgOf("Towns")).toContain("place-village.svg");
    expect(imgOf("Quests")).toBeUndefined();
  });

  it("changing a section's icon changes the icon Show on map uses", () => {
    const { plugin, imgOf, pick, saves } = iconsSetting();
    expect(offered(plugin.settings, "Towns")).toBe("place-village.svg");
    pick("Towns", "place-castle.svg");
    expect(plugin.settings.linkSectionIcons?.Towns).toBe("place-castle.svg");
    expect(saves()).toBe(1);
    expect(offered(plugin.settings, "Towns")).toBe("place-castle.svg");
    // The control redraws with the new icon; the other sections keep theirs.
    expect(imgOf("Towns")).toContain("place-castle.svg");
    expect(offered(plugin.settings, "Dungeons")).toBe("place-dungeon-gate.svg");
  });

  it("a default can be turned off (None), and a section without one can get one", () => {
    const { plugin, imgOf, pick } = iconsSetting();
    pick("Features", null);
    expect(offered(plugin.settings, "Features")).toBeNull();
    expect(imgOf("Features")).toBeUndefined();
    pick("Quests", "place-tavern-sign.svg");
    expect(offered(plugin.settings, "Quests")).toBe("place-tavern-sign.svg");
    expect(imgOf("Quests")).toContain("place-tavern-sign.svg");
  });

  it("the choice survives a reload (kept in the plugin settings)", () => {
    const { plugin, pick } = iconsSetting();
    pick("Dungeons", "place-cave-entrance.svg");
    const reloaded = JSON.parse(JSON.stringify(plugin.settings)) as typeof plugin.settings;
    expect(linkSectionIcon(reloaded, "Dungeons")).toBe("place-cave-entrance.svg");
  });
});
