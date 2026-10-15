/**
 * The first-map form pieces the setup wizard and New map share (owner
 * 2026-10-12): "What are you mapping?" (one card per map scale, from the
 * modules, src/mapScales.ts), the generator's tuning sliders (each form's
 * Advanced) and a scale's own choices (World maps' Biomes: "Make every
 * region now"). Each form keeps its own state; these only draw and report.
 */

import type { MapScaleDef } from "../mapScales";
import type { ScaleChoice } from "../modules/types";
import { tuneKey, type TuningDef } from "../worldgen/procedural/common";
import { tuningText } from "../wizardText";
import type { Disclosure } from "./disclosure";
import { renderLabeledSlider } from "./sliders";

/**
 * "What are you mapping?": a radio group of scale cards in `parent`
 * (labelled by the element with id `labelId`). Clicking, Enter / Space and
 * the arrow keys pick; `sync()` redraws which one is ticked.
 */
export function renderScaleCards(
	parent: HTMLElement,
	scales: readonly MapScaleDef[],
	opts: { labelId: string; selected: () => string | undefined; pick: (scale: MapScaleDef) => void },
): { sync: () => void } {
	const row = parent.createDiv({
		cls: "duckmage-wizard-orient-row duckmage-wizard-scale-row",
		attr: { role: "radiogroup", "aria-labelledby": opts.labelId },
	});
	const cards: { id: string; el: HTMLElement; mark: HTMLElement }[] = [];
	const sync = () => {
		const at = opts.selected();
		for (const c of cards) {
			const on = at === c.id;
			c.el.toggleClass("is-active", on);
			c.el.setAttr("aria-checked", on ? "true" : "false");
			c.el.setAttr("tabindex", on ? "0" : "-1");
			c.mark.setText(on ? "✓ Selected" : "");
		}
	};
	for (const s of scales) {
		const card = row.createDiv({ cls: "duckmage-wizard-orient-btn duckmage-wizard-scale-btn", attr: { role: "radio", "data-scale": s.id } });
		const head = card.createDiv({ cls: "duckmage-wizard-orient-head" });
		head.createSpan({ text: s.label, cls: "duckmage-wizard-orient-label" });
		const mark = head.createSpan({ cls: "duckmage-wizard-orient-mark" });
		card.createSpan({ text: s.description, cls: "duckmage-wizard-orient-desc" });
		cards.push({ id: s.id, el: card, mark });
		card.addEventListener("click", () => opts.pick(s));
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.pick(s); }
			if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
				e.preventDefault();
				const i = scales.findIndex((x) => x.id === opts.selected());
				const next = scales[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? scales.length - 1 : 1)) % scales.length];
				opts.pick(next);
				cards.find((c) => c.id === next.id)?.el.focus();
			}
		});
	}
	sync();
	return { sync };
}

/**
 * A generator's tuning sliders, each placed by `placementId` (Advanced on
 * both forms) with a reset to its default. A slider at its default is left
 * out of `options` (the engine as it is); the Advanced header counts the
 * moved ones. `changed` runs after every move (the caller re-previews).
 */
export function renderTuningSliders(
	host: HTMLElement,
	defs: readonly TuningDef[] | undefined,
	options: Record<string, string>,
	disclosure: Disclosure,
	placementId: string,
	changed: () => void,
): HTMLElement[] {
	const rows: HTMLElement[] = [];
	for (const t of defs ?? []) {
		const key = tuneKey(t.key);
		const isMoved = () => options[key] !== undefined;
		// The shared slider (value shown, reset to the default, dimmed while at it).
		const slider = renderLabeledSlider(host, {
			label: t.label,
			title: t.help,
			help: `${t.help} Default ${tuningText(t.default)}.`,
			min: t.min,
			max: t.max,
			step: t.step,
			value: isMoved() ? Number(options[key]) : t.default,
			format: tuningText,
			layout: "stacked",
			cls: "duckmage-wizard-tuning",
			reset: {
				value: t.default,
				onReset: () => {
					delete options[key];
					disclosure.refreshSet();
					changed();
				},
			},
			isSet: isMoved,
			onInput: (v) => {
				if (v === t.default) delete options[key];
				else options[key] = String(v);
				disclosure.refreshSet();
				changed();
			},
		});
		const row = slider.el;
		rows.push(row);
		// A row taken off the form (generator changed) no longer counts.
		const isSet = () => row.isConnected && isMoved();
		disclosure.place(placementId, row, isSet);
	}
	return rows;
}

/**
 * A map scale's own choices (checkboxes), each placed by its id for
 * `surface`. `values` holds the ones changed from their default.
 */
export function renderScaleChoices(
	host: HTMLElement,
	choices: readonly ScaleChoice[],
	values: Record<string, boolean>,
	disclosure: Disclosure,
	surface: keyof ScaleChoice["ids"],
): HTMLElement[] {
	const rows: HTMLElement[] = [];
	for (const c of choices) {
		const row = host.createDiv({ cls: "duckmage-scale-choice" });
		rows.push(row);
		const label = row.createEl("label", { cls: "duckmage-scale-choice-label" });
		const box = label.createEl("input", { type: "checkbox" });
		box.checked = values[c.key] ?? c.default;
		label.createSpan({ text: c.label });
		row.createDiv({ cls: "setting-item-description", text: c.desc });
		const isSet = () => row.isConnected && (values[c.key] ?? c.default) !== c.default;
		box.addEventListener("change", () => {
			if (box.checked === c.default) delete values[c.key];
			else values[c.key] = box.checked;
			disclosure.refreshSet();
		});
		disclosure.place(c.ids[surface], row, isSet);
	}
	return rows;
}
