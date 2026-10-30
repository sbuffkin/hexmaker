/**
 * "Start exploring" (HF11, owner pick 1): explore a finished map with fog
 * of war. Asks where the party starts, how far it sees and which token is
 * the party (one of the map's tokens, or a new one); when the map was
 * explored before, whether to carry on or start over. Laid out for touch
 * too: Party sees is one tap.
 */

import type { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { getTokenDataFromCache } from "../frontmatter";
import { hexKey, hexPair } from "../hexKey";
import { parseReveal } from "./explore";
import type { ExploreMap } from "./exploreFields";
import type { FogService, FogStart } from "./FogService";

/** The Start exploring dialog's choices before anything is picked. */
export interface StartDefaults {
  start: string;
  sees: number;
  /** Tokens to pick from (party ones first): note path and name. */
  tokens: { path: string; name: string }[];
  /** Hexes seen in an earlier game on this map (0: none). */
  seenBefore: number;
}

/** What the dialog starts with: `hex` (clicked), else where the party last stood, else the middle. Pure. */
export function startDefaults(map: ExploreMap, hex: string | undefined, fog: Pick<FogService, "lastStood" | "middle" | "seenBefore">, tokens: { path: string; name: string; party?: boolean; map: string }[]): StartDefaults {
  const own = tokens.filter((t) => t.map === map.name);
  const order = [...own.filter((t) => t.party), ...own.filter((t) => !t.party), ...tokens.filter((t) => t.map !== map.name && t.party)];
  return {
    start: hex ?? fog.lastStood(map.name) ?? fog.middle(map),
    sees: map.exploreReveal ? parseReveal(map.exploreReveal) : 1,
    tokens: order.map((t) => ({ path: t.path, name: t.map === map.name ? t.name : `${t.name} (on another map)` })),
    seenBefore: fog.seenBefore(map.name),
  };
}

/** "4, 3" or "4_3" → "4_3" (undefined: not a hex). */
export function readHexInput(text: string): string | undefined {
  const m = /^\s*(-?\d+)\s*[,_ ]\s*(-?\d+)\s*$/.exec(text);
  return m ? hexKey(Number(m[1]), Number(m[2])) : undefined;
}

export class StartExploringModal extends HexmakerModal {
  protected surfaceId = "StartExploring";

  constructor(app: App, private plugin: HexmakerPlugin, private fog: FogService, private map: ExploreMap, private hex: string | undefined, private onStart: (how: FogStart) => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Start exploring");
    const el = this.contentEl;
    el.addClass("duckmage-start-exploring");
    const app = this.plugin.app;
    const tokens = app.vault.getMarkdownFiles().flatMap((f) => {
      const t = getTokenDataFromCache(app, f);
      return t ? [{ path: t.filePath, name: t.title, party: t.party, map: t.map }] : [];
    });
    const d = startDefaults(this.map, this.hex, this.fog, tokens);
    el.createEl("p", { cls: "duckmage-export-tab-hint", text: "The party explores this map as it is: everything is hidden until the party sees it. Nothing on the map changes, and stopping lifts the fog." });

    const form = el.createDiv({ cls: "duckmage-export-tab-options" });
    const startRow = form.createDiv({ cls: "duckmage-export-tab-row" });
    startRow.createEl("label", { text: "Party starts at", cls: "duckmage-export-tab-label", attr: { for: "duckmage-explore-start" } });
    const [sx, sy] = hexPair(d.start);
    const startInput = startRow.createEl("input", { type: "text", cls: "duckmage-export-tab-text", attr: { id: "duckmage-explore-start", inputmode: "numeric", placeholder: "4, 3" } });
    startInput.value = `${sx}, ${sy}`;

    const seesRow = form.createDiv({ cls: "duckmage-export-tab-row" });
    seesRow.createSpan({ text: "Party sees", cls: "duckmage-export-tab-label" });
    const seg = seesRow.createDiv({ cls: "duckmage-explore-sees", attr: { role: "radiogroup", "aria-label": "Party sees" } });
    let sees = d.sees;
    const seeBtns = [0, 1, 2, 3].map((n) => {
      const b = seg.createEl("button", { text: String(n), attr: { role: "radio", title: n ? `${n} ring${n === 1 ? "" : "s"} around the party` : "Only the party's own hex" } });
      b.addEventListener("click", () => { sees = n; sync(); });
      return b;
    });
    const sync = () => seeBtns.forEach((b, n) => { b.toggleClass("is-active", n === sees); b.setAttr("aria-checked", String(n === sees)); });
    sync();

    const tokenRow = form.createDiv({ cls: "duckmage-export-tab-row" });
    tokenRow.createEl("label", { text: "Party token", cls: "duckmage-export-tab-label", attr: { for: "duckmage-explore-token" } });
    const tokenSelect = tokenRow.createEl("select", { cls: "duckmage-export-tab-select", attr: { id: "duckmage-explore-token" } });
    tokenSelect.createEl("option", { value: "", text: "A new party token" });
    for (const t of d.tokens) tokenSelect.createEl("option", { value: t.path, text: t.name });
    if (d.tokens.length) tokenSelect.value = d.tokens[0].path;

    let resetSelect: HTMLSelectElement | undefined;
    if (d.seenBefore) {
      const row = form.createDiv({ cls: "duckmage-export-tab-row" });
      row.createEl("label", { text: "Seen before", cls: "duckmage-export-tab-label", attr: { for: "duckmage-explore-reset" } });
      resetSelect = row.createEl("select", { cls: "duckmage-export-tab-select", attr: { id: "duckmage-explore-reset" } });
      resetSelect.createEl("option", { value: "keep", text: `Carry on (${d.seenBefore} hex${d.seenBefore === 1 ? "" : "es"} already seen)` });
      resetSelect.createEl("option", { value: "reset", text: "Start over (everything hidden again)" });
    }
    const problem = form.createDiv({ cls: "duckmage-explore-problem" });

    this.footer({
      primary: {
        text: "Start exploring",
        onClick: () => {
          const start = readHexInput(startInput.value);
          const o = this.map.gridOffset ?? { x: 0, y: 0 };
          const [x, y] = start ? hexPair(start) : [NaN, NaN];
          if (!start || x < o.x || y < o.y || x >= o.x + this.map.gridSize.cols || y >= o.y + this.map.gridSize.rows) {
            problem.setText("Pick a hex on this map, like 4, 3.");
            return;
          }
          this.close();
          this.onStart({ start, sees, ...(tokenSelect.value ? { token: tokenSelect.value } : {}), ...(resetSelect?.value === "reset" ? { reset: true } : {}) });
        },
      },
      cancel: () => this.close(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
