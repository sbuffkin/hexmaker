/**
 * New map's "Explore as you go" setup (HF8 B2–B3, the NewMapModeContribution
 * render): which generators power the map. One generator by default (it
 * makes the home area, round the party's start); "Add another area" puts a
 * second generator's area near, far or really far in one of the six hex
 * directions (plan-hf6-generator-realms). A direction where another area
 * already holds the land is off, its tooltip saying which. Each area is
 * picked with New map's generator list; under it, the terrain mix its flower
 * will roll on. Everything is written into the Hex flower generator's
 * options (exploreSetup.ts), so the preview follows at once.
 */

import type { NewMapModeContext } from "../modules/types";
import type { TerrainGeneratorKind } from "../worldgen/registry";
import { newPickerState, pickerSettings, renderGeneratorPicker, type PickerState } from "../worldgen/newMapSetup/generatorPicker";
import { hashSeed } from "../arrival/arrival";
import { exploreOf } from "./context";
import { EXPLORE_OPTION, formatAreas, parseAreas, setupRealms, startHexOf, type SetupArea } from "./exploreSetup";
import { REACH_LABEL, blockedDirections, directions, type Geometry } from "./realms";
import { FROM_GENERATORS } from "./flowerGenerator";
import { topShares } from "./realmFlowers";

/** Which area the list edits (0 = home) and the list's own state, per form. */
interface SetupUi {
  selected: number;
  picker: PickerState;
}
const forms = new WeakMap<object, SetupUi>();

const AREA_REACHES: SetupArea["reach"][] = ["near", "far", "really far"];

/** The generator a new explore map starts on: the first built-in engine listed (Overland on a world map), else the first. */
export function defaultHome(kinds: readonly Pick<TerrainGeneratorKind, "id" | "source" | "needsContext">[]): string | undefined {
  return (kinds.find((k) => k.source === "built-in" && !k.needsContext) ?? kinds[0])?.id;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function renderExploreSetup(el: HTMLElement, ctx: NewMapModeContext): void {
  const kinds = ctx.generators;
  const ex = exploreOf(ctx.plugin);
  ex?.useKinds(kinds);
  const o = ctx.options;
  if (!o[EXPLORE_OPTION.home] || !kinds.some((k) => k.id === o[EXPLORE_OPTION.home])) o[EXPLORE_OPTION.home] = defaultHome(kinds) ?? "";
  const ui = forms.get(o) ?? { selected: 0, picker: newPickerState() };
  forms.set(o, ui);
  const areas = parseAreas(o[EXPLORE_OPTION.areas]);
  if (ui.selected > areas.length) ui.selected = 0;
  const label = (id: string) => kinds.find((k) => k.id === id)?.label ?? id;
  const g: Geometry = { orientation: ctx.plugin.settings.hexOrientation, stagger: ctx.grid().stagger };
  const start = startHexOf(ctx.grid(), o[EXPLORE_OPTION.startHex]);
  const setAreas = (next: SetupArea[]) => { o[EXPLORE_OPTION.areas] = formatAreas(next); };

  const box = el.createDiv({ cls: "duckmage-explore-setup" });
  const head = box.createDiv({ cls: "duckmage-setup-row" });
  head.createEl("label", { cls: "duckmage-setup-label", text: "Powered by" });
  const control = head.createDiv({ cls: "duckmage-setup-control" });
  if ((o.flower ?? FROM_GENERATORS) !== FROM_GENERATORS) {
    control.createDiv({ cls: "setting-item-description", text: "Rolling on your own flower (Advanced → Make your own flower): the generators below aren't used." });
  }

  // The areas: Home, then each one added, then "Add another area".
  const chips = control.createDiv({ cls: "duckmage-explore-areas" });
  const chip = (i: number, text: string, remove?: () => void) => {
    const c = chips.createEl("button", { cls: `duckmage-explore-area${ui.selected === i ? " is-active" : ""}`, text, attr: { "aria-pressed": ui.selected === i ? "true" : "false" } });
    c.addEventListener("click", () => { ui.selected = i; ctx.changed({ options: true }); });
    if (remove) {
      const x = c.createSpan({ cls: "duckmage-explore-area-remove", text: "✕", attr: { role: "button", "aria-label": `Remove ${text}`, title: "Remove this area" } });
      x.addEventListener("click", (e) => { e.stopPropagation(); remove(); });
    }
  };
  chip(0, `Home: ${label(o[EXPLORE_OPTION.home])}`);
  areas.forEach((a, i) => chip(i + 1, `${titleCase(a.dir)}, ${a.reach}: ${label(a.id)}`, () => {
    setAreas(areas.filter((_, j) => j !== i));
    ui.selected = 0;
    ctx.changed({ options: true });
  }));
  const add = chips.createEl("button", { cls: "duckmage-explore-area-add", text: "Add another area", attr: { title: "A second generator's area, in a direction and at a distance from the start" } });
  add.addEventListener("click", () => {
    const blocked = blocking(areas.length, "far");
    const dir = directions(g.orientation).find((d) => !blocked.has(d.word))?.word ?? directions(g.orientation)[0].word;
    setAreas([...areas, { id: o[EXPLORE_OPTION.home], dir, reach: "far" }]);
    ui.selected = areas.length + 1;
    ctx.changed({ options: true });
  });

  /** The directions blocked for area `skip` (its own place left out) at `reach`. */
  function blocking(skip: number, reach: SetupArea["reach"]): Map<string, string> {
    const others = { ...o, [EXPLORE_OPTION.areas]: formatAreas(areas.filter((_, j) => j !== skip)) };
    return blockedDirections(start, reach, setupRealms(others, start, ctx.seed(), g, label), g, ctx.seed());
  }

  // An added area: which way and how far.
  const area = ui.selected > 0 ? areas[ui.selected - 1] : undefined;
  if (area) {
    const at = ui.selected - 1;
    const where = control.createDiv({ cls: "duckmage-explore-where" });
    where.createSpan({ cls: "duckmage-explore-where-label", text: "Which way?" });
    const blocked = blocking(at, area.reach);
    const ring = where.createDiv({ cls: `duckmage-explore-ring is-${g.orientation}`, attr: { role: "radiogroup", "aria-label": "Which way?" } });
    for (const d of directions(g.orientation)) {
      const by = blocked.get(d.word);
      const b = ring.createEl("button", {
        cls: `duckmage-explore-dir is-${d.word}${area.dir === d.word ? " is-active" : ""}`,
        text: d.word.split("-").map((w) => w[0].toUpperCase()).join(""),
        attr: { role: "radio", "aria-checked": area.dir === d.word ? "true" : "false", "aria-label": d.word, title: by ? `${by} lies that way` : titleCase(d.word) },
      });
      b.disabled = !!by && area.dir !== d.word;
      b.addEventListener("click", () => {
        setAreas(areas.map((a, j) => (j === at ? { ...a, dir: d.word } : a)));
        ctx.changed({ options: true });
      });
    }
    where.createSpan({ cls: "duckmage-explore-where-label", text: "How far?" });
    const far = where.createEl("select", { attr: { "aria-label": "How far?" } });
    for (const r of AREA_REACHES) far.createEl("option", { value: r, text: REACH_LABEL[r] });
    far.value = area.reach;
    far.addEventListener("change", () => {
      setAreas(areas.map((a, j) => (j === at ? { ...a, reach: far.value as SetupArea["reach"] } : a)));
      ctx.changed({ options: true });
    });
  }

  // The list picks the selected area's generator.
  const current = area ? area.id : o[EXPLORE_OPTION.home];
  renderGeneratorPicker(control.createDiv(), {
    kinds,
    terrains: ctx.terrains,
    selected: current,
    state: ui.picker,
    ...pickerSettings(ctx.plugin),
    pick: (k) => {
      if (area) setAreas(areas.map((a, j) => (j === ui.selected - 1 ? { ...a, id: k.id } : a)));
      else o[EXPLORE_OPTION.home] = k.id;
      ctx.changed({ options: true });
    },
  });

  // What its flower rolls on (the palette gap check: nothing of this palette, said here).
  const kind = kinds.find((k) => k.id === current);
  const mix = control.createDiv({ cls: "setting-item-description duckmage-explore-mix" });
  if (kind && ex) {
    const s = ex.realmFlowers.sharesOf(kind, ctx.paletteName, ctx.terrains, hashSeed(ctx.seed() >>> 0, "realm-sample"), g.orientation);
    if ("error" in s) mix.setText(`⚠ ${s.error}`);
    else {
      const top = topShares(s, ctx.terrains.map((t) => t.name));
      const sum = top.reduce((a, b) => a + b.weight, 0) || 1;
      mix.setText(`Rolls on: ${top.map((t) => `${t.terrain} ${Math.round((t.weight / sum) * 100)}%`).join(", ")}.`);
    }
  }
}
