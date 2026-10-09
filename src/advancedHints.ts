/**
 * The ways a Simple user finds Advanced features (see src/featureLevel.ts):
 * a small "More" line where a hidden feature would sit, a "Turn on …?" box
 * when they reach for one, and a one-time "Ready for more?" check-in. Every
 * hint turns on just that feature or all of Advanced, and can be closed.
 */

import { App } from "obsidian";
import type HexmakerPlugin from "./HexmakerPlugin";
import { HexmakerModal } from "./HexmakerModal";
import { ADVANCED_FEATURES, hasFeature, type AdvancedFeature } from "./featureLevel";

const info = (f: AdvancedFeature) => ADVANCED_FEATURES.find((x) => x.id === f)!;

/**
 * A one-line "More: …" hint in `parent` for a feature that's off, unless
 * it's on or this spot's hint was closed. `spot` names the place (one id per
 * screen), so closing it there doesn't hide it elsewhere. `text` overrides
 * the feature's own pitch with one that fits the spot.
 */
export function renderAdvancedHint(
  parent: HTMLElement,
  plugin: HexmakerPlugin,
  feature: AdvancedFeature,
  spot: string,
  text?: string,
): HTMLElement | null {
  const s = plugin.settings;
  if (hasFeature(s, feature) || s.dismissedHints.includes(spot)) return null;
  const f = info(feature);
  const el = parent.createDiv({ cls: "duckmage-advanced-hint" });
  el.createSpan({ text: "✦", cls: "duckmage-advanced-hint-mark" });
  el.createSpan({ text: text ?? f.pitch, cls: "duckmage-advanced-hint-text" });
  const on = el.createEl("button", { text: `Turn on ${f.label.toLowerCase()}`, cls: "duckmage-advanced-hint-on" });
  on.addEventListener("click", () => void plugin.enableAdvancedFeature(feature));
  const close = el.createEl("button", { text: "✕", cls: "duckmage-advanced-hint-close", attr: { "aria-label": "Hide this hint", title: "Hide this hint (the features section of settings can show it again)" } });
  close.addEventListener("click", () => {
    s.dismissedHints = [...new Set([...s.dismissedHints, spot])];
    void plugin.saveSettings();
    el.remove();
  });
  return el;
}

/** "Turn on <feature>?": shown when a Simple user reaches for an Advanced feature. */
export class EnableFeatureModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private feature: AdvancedFeature,
    private onEnabled: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    const f = info(this.feature);
    this.titleEl.setText(`Turn on ${f.label.toLowerCase()}?`);
    const { contentEl } = this;
    contentEl.createEl("p", { text: f.pitch });
    contentEl.createEl("p", {
      text: "It's one of the advanced features. Turn on just this, or all of them; either can be turned off again in settings, and nothing you've made is touched.",
      cls: "duckmage-map-origin-desc",
    });
    const row = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    const one = row.createEl("button", { text: `Turn on ${f.label.toLowerCase()}`, cls: "mod-cta" });
    one.addEventListener("click", () => void this.enable(false));
    row.createEl("button", { text: "Turn on all advanced features" }).addEventListener("click", () => void this.enable(true));
    row.createEl("button", { text: "Not now" }).addEventListener("click", () => this.close());
  }

  private async enable(all: boolean): Promise<void> {
    if (all) await this.plugin.setFeatureLevel("advanced");
    else await this.plugin.enableAdvancedFeature(this.feature);
    this.close();
    this.onEnabled();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Run `then` now if the feature is on, else after the user turns it on. */
export function withFeature(plugin: HexmakerPlugin, feature: AdvancedFeature, then: () => void): void {
  if (hasFeature(plugin.settings, feature)) then();
  else new EnableFeatureModal(plugin.app, plugin, feature, then).open();
}

/** The one-time "Ready for more?" check-in (see shouldNudge). */
export class AdvancedNudgeModal extends HexmakerModal {
  constructor(app: App, private plugin: HexmakerPlugin) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Ready for more?");
    const { contentEl } = this;
    contentEl.createEl("p", { text: "You've got the hang of the basics. Advanced adds:" });
    const list = contentEl.createEl("ul");
    for (const f of ADVANCED_FEATURES) {
      if (hasFeature(this.plugin.settings, f.id)) continue;
      const li = list.createEl("li");
      li.createEl("strong", { text: `${f.label}: ` });
      li.appendText(f.pitch);
    }
    contentEl.createEl("p", { text: "You can switch back any time in settings; nothing you've made is touched.", cls: "duckmage-map-origin-desc" });
    const row = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    const on = row.createEl("button", { text: "Turn on advanced features", cls: "mod-cta" });
    on.addEventListener("click", () => {
      void this.plugin.setFeatureLevel("advanced");
      this.close();
    });
    row.createEl("button", { text: "Not now" }).addEventListener("click", () => this.close());
    row.createEl("button", { text: "Don't ask again" }).addEventListener("click", () => {
      this.plugin.settings.advancedNudgeOff = true;
      void this.plugin.saveSettings();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
