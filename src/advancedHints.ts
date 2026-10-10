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

/**
 * One "More options" line for a screen where several Advanced features would
 * sit, instead of a stack of single hints. Lists whichever of `features` are
 * still off; "Show" opens MoreFeaturesModal to turn them on one by one. With
 * only one left it's an ordinary single hint.
 */
export function renderAdvancedHints(
  parent: HTMLElement,
  plugin: HexmakerPlugin,
  features: { feature: AdvancedFeature; text: string }[],
  spot: string,
): HTMLElement | null {
  const s = plugin.settings;
  const off = features.filter((f) => !hasFeature(s, f.feature));
  if (!off.length || s.dismissedHints.includes(spot)) return null;
  if (off.length === 1) return renderAdvancedHint(parent, plugin, off[0].feature, spot, off[0].text);
  const el = parent.createDiv({ cls: "duckmage-advanced-hint" });
  el.createSpan({ text: "✦", cls: "duckmage-advanced-hint-mark" });
  el.createSpan({
    text: `More options: ${off.map((f) => info(f.feature).label.toLowerCase()).join(", ")}.`,
    cls: "duckmage-advanced-hint-text",
  });
  el.createEl("button", { text: "Show", cls: "duckmage-advanced-hint-on" })
    .addEventListener("click", () => new MoreFeaturesModal(plugin.app, plugin, off).open());
  const close = el.createEl("button", { text: "✕", cls: "duckmage-advanced-hint-close", attr: { "aria-label": "Hide this hint", title: "Hide this hint (the features section of settings can show it again)" } });
  close.addEventListener("click", () => {
    s.dismissedHints = [...new Set([...s.dismissedHints, spot])];
    void plugin.saveSettings();
    el.remove();
  });
  return el;
}

/** The features behind a "More options" hint, each with its own Turn on. */
export class MoreFeaturesModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private features: { feature: AdvancedFeature; text: string }[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-more-features-modal");
    this.titleEl.setText("More options");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: "These are advanced features. Turn on the ones you want; they can be turned off again in settings, and nothing you've made is touched.",
      cls: "duckmage-map-origin-desc",
    });
    const list = contentEl.createDiv({ cls: "duckmage-more-features" });
    for (const f of this.features) {
      const row = list.createDiv({ cls: "duckmage-more-features-row" });
      const text = row.createDiv({ cls: "duckmage-more-features-text" });
      text.createEl("strong", { text: info(f.feature).label });
      text.createDiv({ text: f.text });
      if (hasFeature(this.plugin.settings, f.feature)) {
        row.createSpan({ text: "On", cls: "duckmage-more-features-on" });
      } else {
        row.createEl("button", { text: "Turn on" }).addEventListener("click", () => {
          void this.plugin.enableAdvancedFeature(f.feature).then(() => this.render());
        });
      }
    }
    const row = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    row.createEl("button", { text: "Turn on all advanced features" }).addEventListener("click", () => {
      void this.plugin.setFeatureLevel("advanced").then(() => this.close());
    });
    row.createEl("button", { text: "Done", cls: "mod-cta" }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
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
