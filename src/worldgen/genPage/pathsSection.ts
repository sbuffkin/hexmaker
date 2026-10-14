/**
 * The generator page's "Paths" section: one group per learned path type
 * (on/off, amount and type-wide sliders) and, in its fold (Advanced →
 * Paths), each single route (on, count, drawn as, wiggle / length /
 * follow). Hovering a route highlights it on the preview.
 */

import { Fold } from "../../ui/disclosure";
import { makeScrubbable } from "../../ui/scrub";
import { renderLabeledSlider, renderMultiplierSlider } from "../../ui/sliders";
import { pathColors } from "../generators";
import { generatorPageState } from "../generatorPageState";
import {
  pathsEnabled,
  pathRouteKey,
  effectivePathTweaks,
  edgeSide,
  type PathTweak,
  type PathTypeTweak,
  type PathFeature,
} from "../../../packages/hex-wfc/src";
import { toggle } from "./controls";
import type { GeneratorPageCtx } from "./ctx";

/** Paths: one row per learned route (type + what its ends connect to). Nothing when the generator learned none. */
export function renderPathsSection(ctx: GeneratorPageCtx, main: HTMLElement): void {
  const { plugin, model, s, save, place } = ctx;
  // Paths: one row per learned route (type + what its ends connect to)
  if (model.paths?.length) {
    const el = ctx.section(main, "Paths");
    el.createEl("p", {
      text: "Roads and rivers drawn over the terrain, grouped by type. Each type's checkbox and sliders apply to all its routes; Amount turns off the routes the example had least of. Single routes (how many, how they wind, what they're drawn as) are in the advanced section below.",
      cls: "duckmage-map-origin-desc",
    });
    const tweaks: Record<string, PathTweak> = Object.fromEntries(Object.entries(s().paths).map(([k, t]) => [k, { ...t }]));
    const saveTweak = (route: string, patch: Partial<PathTweak>) => {
      const t: PathTweak = { ...(tweaks[route] ?? {}), ...patch };
      for (const k of Object.keys(t) as (keyof PathTweak)[]) if (t[k] === undefined || t[k] === false) delete t[k];
      if (Object.keys(t).length) tweaks[route] = t;
      else delete tweaks[route];
      save({ paths: Object.keys(tweaks).length ? { ...tweaks } : undefined });
    };
    const types: Record<string, PathTypeTweak> = Object.fromEntries(Object.entries(s().pathTypes).map(([k, t]) => [k, { ...t }]));
    const effective = () => effectivePathTweaks(model.paths ?? [], tweaks, types);
    const saveType = (type: string, patch: Partial<PathTypeTweak>) => {
      const t: PathTypeTweak = { ...(types[type] ?? {}), ...patch };
      for (const k of Object.keys(t) as (keyof PathTypeTweak)[]) if (t[k] === undefined || t[k] === false) delete t[k];
      if (Object.keys(t).length) types[type] = t;
      else delete types[type];
      save({ pathTypes: Object.keys(types).length ? { ...types } : undefined });
      refreshGroups();
    };
    const table = el.createDiv({ cls: "duckmage-wfc-paths" });
    /** Each type's single routes (Advanced → Paths): dimmed with the rest when paths are off. */
    const routeLists: HTMLElement[] = [];
    const showPathsOn = (on: boolean) => {
      table.toggleClass("is-off", !on);
      for (const r of routeLists) r.toggleClass("is-off", !on);
    };
    toggle(table, "Draw paths", "", pathsEnabled(model), (v) => {
      save({ drawPaths: v });
      showPathsOn(v);
    });
    const mapTypes = plugin.getPathTypes(generatorPageState.paletteName).map((t) => t.name);
    const typeColors = pathColors(plugin, generatorPageState.paletteName);
    const swatchFor = (parent: HTMLElement, type: string) =>
      parent.createSpan({ cls: "duckmage-wfc-swatch" }).setCssProps({ "--duckmage-wfc-swatch": typeColors.get(type) ?? "var(--background-modifier-border)" });

    // One group per path type, most common type first: its on/off and
    // type-wide sliders here; its single routes in their own collapsible
    // list (Advanced → Paths).
    const byType = new Map<string, PathFeature[]>();
    for (const f of model.paths) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
    const groupOrder = [...byType].sort((a, b) =>
      b[1].reduce((n, f) => n + f.count, 0) - a[1].reduce((n, f) => n + f.count, 0) || a[0].localeCompare(b[0]));
    const groupRefreshers: (() => void)[] = [];
    const refreshGroups = () => groupRefreshers.forEach((r) => r());
    for (const [type, routes] of groupOrder) {
      const group = table.createDiv({ cls: "duckmage-wfc-path-group" });
      const head = group.createDiv({ cls: "duckmage-wfc-path-group-head" });
      const title = head.createDiv({ cls: "duckmage-wfc-path-group-title" });
      const all = title.createEl("input", { type: "checkbox", attr: { "aria-label": `Draw ${type} paths` } });
      const name = title.createSpan({ cls: "duckmage-wfc-terrain-name" });
      swatchFor(name, type);
      name.createSpan({ text: type });
      const summary = title.createSpan({ cls: "duckmage-map-origin-desc duckmage-wfc-path-group-summary" });
      const placedEl = title.createSpan({ cls: "duckmage-wfc-path-placed", text: "–" });
      all.addEventListener("change", () => {
        if (all.checked) {
          // Turning a type on also turns its routes back on.
          for (const f of routes) {
            const key = pathRouteKey(f);
            if (tweaks[key]?.off) {
              const { off: _off, ...rest } = tweaks[key];
              if (Object.keys(rest).length) tweaks[key] = rest;
              else delete tweaks[key];
            }
          }
          save({ paths: Object.keys(tweaks).length ? { ...tweaks } : undefined });
          saveType(type, { off: undefined });
        } else saveType(type, { off: true });
      });

      // Settings for the whole type: how many of its routes, and multipliers
      // on every route's own wiggle, length and terrain following.
      const knobs = head.createDiv({ cls: "duckmage-wfc-path-knobs duckmage-wfc-path-group-knobs" });
      const amountCell = knobs.createSpan({ cls: "duckmage-wfc-mix" });
      renderLabeledSlider(amountCell, {
        label: "Amount", ariaLabel: `${type} amount`,
        title: `How many of the ${type} routes to draw. Lower turns off the ones the example had least of.`,
        min: 0, max: 100, step: 5, value: Math.round((types[type]?.keep ?? 1) * 100),
        format: (v) => (v === 100 ? "All" : `${Math.round(v)}%`),
        reset: { value: 100, text: "All" },
        onChange: (v) => saveType(type, { keep: v === 100 ? undefined : v / 100 }),
      });
      const typeKnob = (label: string, key: "wiggle" | "length" | "follow", title: string) => {
        const cell = knobs.createSpan({ cls: "duckmage-wfc-mix" });
        renderMultiplierSlider(cell, { label, ariaLabel: `${type} ${label.toLowerCase()}`, title, value: types[type]?.[key], onChange: (v) => saveType(type, { [key]: v }) });
      };
      typeKnob("Wiggle", "wiggle", `Multiplies every ${type} route's wiggle.`);
      if (routes.some((f) => f.to === "none" || f.to === "edge")) typeKnob("Length", "length", `Multiplies every ${type} route's length.`);
      typeKnob("Follow terrain", "follow", `Multiplies how strongly every ${type} route keeps to its terrains.`);

      // The type's single routes: a collapsible list (its fold, closed by
      // default), moved to Advanced → Paths with everything in it.
      const detail = table.createDiv({ cls: "duckmage-wfc-paths duckmage-wfc-path-group duckmage-wfc-path-routes" });
      routeLists.push(detail);
      // Guarantee: never over impassable terrain (on unless turned off).
      const impassableList = s().impassable;
      const avoid = detail.createEl("label", {
        cls: "duckmage-wfc-toggle duckmage-wfc-path-avoid",
        attr: {
          title: impassableList.length
            ? `${type} paths never start, run or end on ${impassableList.join(", ")}, except where an end is that terrain (a river into the shallows), and keep off the map border except at their ends. Set the list under Guarantees.`
            : "Paths keep off the map border except at their ends. No terrain is marked impassable yet (Guarantees, Impassable terrain).",
        },
      });
      const avoidBox = avoid.createEl("input", { type: "checkbox" });
      avoidBox.checked = !types[type]?.crossImpassable;
      avoid.createSpan({ text: `${type}: avoid impassable terrain and the map border` });
      avoidBox.addEventListener("change", () => saveType(type, { crossImpassable: avoidBox.checked ? undefined : true }));

      // The shared Fold (src/ui/disclosure.ts), closed until opened; remembered on this device.
      const fold = new Fold(detail, {
        title: `${type} routes`,
        open: false,
        store: plugin.app,
        surface: "GenPage/routes",
        summaryCls: "duckmage-wfc-path-group-title",
        bodyCls: "duckmage-wfc-path-group-body",
      });
      swatchFor(fold.summary, type);
      fold.summary.insertBefore(fold.summary.lastElementChild!, fold.titleEl);
      const body = fold.body;
      body.createEl("p", {
        text: "Count is how many to draw (blank = the learned amount for this map size; drag or scroll on it). Hover a route to highlight it on the preview.",
        cls: "duckmage-map-origin-desc",
      });
      const rowEls: { route: string; row: HTMLElement; on: HTMLInputElement; why: HTMLElement }[] = [];
      for (const f of [...routes].sort((a, b) => b.count - a.count || pathRouteKey(a).localeCompare(pathRouteKey(b)))) {
        const route = pathRouteKey(f);
        const sides = { N: "north edge", E: "east edge", S: "south edge", W: "west edge" } as const;
        const end = (e: string) => (e === "edge" ? "map edge" : edgeSide(e) ? sides[edgeSide(e)!] : e === "path" ? `a ${f.type}` : e === "none" ? "anywhere" : e);
        const tw = tweaks[route] ?? {};
        const row = body.createDiv({ cls: "duckmage-wfc-path-row" });
        row.addEventListener("mouseenter", () => {
          ctx.preview.hoveredRoute = route;
          ctx.preview.lastDraw?.(route);
        });
        row.addEventListener("mouseleave", () => {
          ctx.preview.hoveredRoute = undefined;
          ctx.preview.lastDraw?.();
        });

        // Line 1: on, route, count, becomes, placed
        const top = row.createDiv({ cls: "duckmage-wfc-path-top" });
        const on = top.createEl("input", { type: "checkbox", attr: { "aria-label": `Draw ${f.type} (${end(f.from)} to ${end(f.to)})` } });
        on.checked = !tw.off;
        on.addEventListener("change", () => {
          saveTweak(route, { off: !on.checked || undefined });
          refreshGroups();
        });
        const routeName = top.createSpan({ cls: "duckmage-wfc-terrain-name" });
        swatchFor(routeName, tw.as ?? f.type);
        routeName.createSpan({ text: `${end(f.from)} → ${end(f.to)}` });
        const why = top.createSpan({ cls: "duckmage-map-origin-desc duckmage-wfc-path-route" });

        const countWrap = top.createSpan({ cls: "duckmage-wfc-path-count" });
        countWrap.createSpan({ text: "Count", cls: "duckmage-map-origin-label" });
        const count = countWrap.createEl("input", { type: "number", cls: "duckmage-wfc-num", attr: { min: "0", placeholder: "Auto" } });
        count.value = tw.count === undefined ? "" : String(tw.count);
        const rowState = { placed: top.createSpan({ cls: "duckmage-wfc-path-placed", text: "–" }), count, auto: 1 };
        makeScrubbable(count, { min: 0, max: 99, pxPerStep: 8, initial: () => rowState.auto });
        count.addEventListener("input", () => {
          if (count.hasClass("is-scrubbing")) {
            tweaks[route] = { ...(tweaks[route] ?? {}), count: Number(count.value) };
            model.settings = { ...(model.settings ?? {}), paths: { ...tweaks } };
            ctx.schedulePreview();
          }
        });
        count.addEventListener("change", () => {
          saveTweak(route, { count: count.value === "" ? undefined : Math.max(0, Math.floor(Number(count.value) || 0)) });
        });

        const asWrap = top.createSpan({ cls: "duckmage-wfc-path-as" });
        asWrap.createSpan({ text: "As", cls: "duckmage-map-origin-label" });
        const asSel = asWrap.createEl("select", { attr: { title: "Path type it is drawn as on the map" } });
        const learnedKnown = mapTypes.includes(f.type);
        asSel.createEl("option", { value: "", text: learnedKnown ? f.type : `${f.type} (no such type: skipped)` });
        for (const t of mapTypes) if (t !== f.type) asSel.createEl("option", { value: t, text: t });
        asSel.value = tw.as && mapTypes.includes(tw.as) ? tw.as : "";
        asSel.addEventListener("change", () => saveTweak(route, { as: asSel.value || undefined }));
        top.appendChild(rowState.placed);
        ctx.pathRows.set(route, rowState);

        // Line 2: shape of the route
        const routeKnobs = row.createDiv({ cls: "duckmage-wfc-path-knobs" });
        const knob = (label: string, title: string, key: "wiggle" | "length" | "follow", max: number) => {
          const cell = routeKnobs.createSpan({ cls: "duckmage-wfc-mix" });
          renderMultiplierSlider(cell, { label, ariaLabel: `${route} ${label.toLowerCase()}`, title, max, value: tw[key], onChange: (v) => saveTweak(route, { [key]: v }) });
        };
        knob("Wiggle", "How much it meanders, on top of the type's. 0 = as straight as the terrain allows.", "wiggle", 3);
        if (f.to === "none" || f.to === "edge") knob("Length", "How long it runs, relative to the example.", "length", 3);
        knob("Follow terrain", "How strongly it keeps to the terrains it ran through in the example. 0 = ignores terrain.", "follow", 3);
        rowEls.push({ route, row, on, why });
      }
      // The list carries the route controls (GenPage.route*) and the
      // avoid switch (GenPage.pathTypeAvoid): all placed with it.
      place("GenPage.pathTypeFold", detail);

      // Header checkbox, summary and each row's on/off state, from the
      // route settings with the type's applied.
      groupRefreshers.push(() => {
        const eff = effective();
        const own = rowEls.filter((r) => !tweaks[r.route]?.off).length;
        const drawn = rowEls.filter((r) => !eff[r.route]?.off).length;
        const typeOff = !!types[type]?.off;
        all.checked = !typeOff && own > 0;
        all.indeterminate = !typeOff && own > 0 && own < rowEls.length;
        group.toggleClass("is-off", drawn === 0);
        summary.setText(`${drawn} of ${rowEls.length} route${rowEls.length === 1 ? "" : "s"} on`);
        for (const r of rowEls) {
          const ownOff = !!tweaks[r.route]?.off;
          const byType = !ownOff && !!eff[r.route]?.off;
          r.on.checked = !ownOff;
          r.row.toggleClass("is-off", ownOff || byType);
          r.why.setText(byType ? (typeOff ? `off: all ${type} off` : `off: ${type} amount`) : "");
        }
      });
      ctx.pathGroupPlaced.set(type, { el: placedEl, routes: rowEls.map((r) => r.route) });
    }
    showPathsOn(pathsEnabled(model));
    refreshGroups();
  }
}
