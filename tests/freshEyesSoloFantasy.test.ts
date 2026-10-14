/**
 * Fresh-eyes pass 2026-10-13 (solo fantasy player): the clear bugs.
 * KB: projects/duckmage-plugin/notes/impl/fresh-eyes-findings-2026-10-13-solo-fantasy.md
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { linkDisplayName, tableTitle } from "../src/encounterLinks";
import { padButtonText, PAD_SIDES } from "../src/maps/mapNav";
import { tokenGroupOffsets, tokenNamePlacement, tokenNameSide } from "../src/hex-map/tokenDefaults";
import { sizeForScalePick } from "../src/sizeInput";
import { overlayInsets, OVERLAY_GAP, fitToSafeArea } from "../src/hex-map/safeArea";
import { toolModeLabel } from "../src/hex-map/toolMode";
import { iconLabel } from "../src/utils";
import { clearFieldError, showFieldError, type ErrorField } from "../src/ui/fieldError";
import { keepScroll, type ScrollBox } from "../src/ui/keepScroll";
import { neighbourSeaText } from "../src/worldgen/NewMapSetupModal";
import { overlandDescription } from "../src/worldgen/procedural/planetSurface";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { startupWritesWait } from "../src/setupPlaceholder";
import { readSurface, readSource } from "./helpers/source";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** The body of `name` in `src` (a method at two-space indent, or a function at column 0). */
function body(src: string, start: string): string {
	const at = src.indexOf(start);
	expect(at).toBeGreaterThan(-1);
	const end = src.indexOf("\n  }\n", at);
	return src.slice(at, end < 0 ? undefined : end);
}

describe("F4: a token's name never hides the hex coordinate", () => {
	it("goes above the token with coordinates at the bottom (the default), below otherwise", () => {
		expect(tokenNameSide("bottom")).toBe("above");
		expect(tokenNameSide(undefined)).toBe("above");
		expect(tokenNameSide("top")).toBe("below");
		expect(tokenNameSide("middle")).toBe("below");
	});

	it("tokens sharing a hex list their names over the group, stacking upward", () => {
		const three = tokenGroupOffsets(3);
		const minY = Math.min(...three.map(([, dy]) => dy));
		expect(tokenNamePlacement(three, 0, "above")).toEqual({ dx: 0, dy: minY, line: 2 });
		expect(tokenNamePlacement(three, 2, "above")).toEqual({ dx: 0, dy: minY, line: 0 });
		// Below is unchanged.
		expect(tokenNamePlacement(three, 2).line).toBe(2);
	});

	it("the map marks each name with its side, and the CSS lifts .is-above over the token", () => {
		const view = readSurface("map-view");
		expect(view).toContain("tokenNameSide(this.plugin.settings.coordPlacement)");
		expect(view).toContain("is-${nameSide}");
		const css = read("styles.css");
		expect(css).toMatch(/\.duckmage-token-name\.is-above \{\n\s+transform: translate\(-50%, calc\(-100% -/);
	});
});

describe("F6: the Icon tool", () => {
	it("the paint bar names the icon as the picker does", () => {
		const label = toolModeLabel({ mode: "icon", erasing: false, iconName: iconLabel("place-village.png") });
		expect(label).toBe("Painting icon: village");
		expect(iconLabel("bw-desert.png")).toBe("desert");
		expect(readSurface("map-view")).toContain("iconName: this.paintIconName ? iconLabel(this.paintIconName) : this.paintIconName");
	});

	it("clicking the active Icon button reopens the picker, as Terrain does", () => {
		const view = readSurface("map-view");
		const handler = body(view, "  private handleIconButton(");
		expect(handler).not.toMatch(/exitIconMode\(\)/);
		expect(handler).toContain("this.openIconPicker()");
	});

	it("the picker shows whole tiles: a grid of whole rows that snaps, names wrapped", () => {
		expect(read("src/hex-map/IconPickerModal.ts")).toContain("duckmage-icon-picker duckmage-icon-picker-full");
		const css = read("styles.css");
		const grid = css.slice(css.indexOf(".duckmage-icon-picker.duckmage-icon-picker-full {"));
		expect(grid).toMatch(/height: calc\(5 \* var\(--duckmage-icon-tile-h\) \+ 4 \* var\(--duckmage-icon-tile-gap\)\)/);
		expect(grid).toMatch(/scroll-snap-type: y mandatory/);
		expect(css).toMatch(/\.duckmage-icon-picker-full \.duckmage-icon-option-name \{[^}]*white-space: normal/);
	});
});

describe("F7: New map → Next to: the locked starting coordinates agree with the summary", () => {
	it("lockMore writes the neighbour's offset and stagger into the locked fields", () => {
		const modal = readSurface("new-map-setup");
		const lock = modal.slice(modal.indexOf("lockMore = (locked) => {"), modal.indexOf("// ── Preview ──"));
		expect(lock).toContain("xIn.value = String(p ? p.offset.x : this.originX)");
		expect(lock).toContain("yIn.value = String(p ? p.offset.y : this.originY)");
		expect(lock).toContain("stagSel.value = p ? p.stagger : this.stagger");
	});
});

describe("F8 / C8: the generator list isn't a scroller inside the form", () => {
	it("the list grows to its content", () => {
		const css = read("styles.css");
		const rule = css.slice(css.indexOf(".duckmage-setup-generators {"), css.indexOf("}", css.indexOf(".duckmage-setup-generators {")));
		expect(rule).not.toMatch(/max-height|overflow/);
	});

	it("picking a card keeps every scrolled ancestor where it was and focuses the card without scrolling", () => {
		const outer: ScrollBox = { parentElement: null, scrollTop: 340 };
		const form: ScrollBox = { parentElement: outer, scrollTop: 0 };
		const list: ScrollBox = { parentElement: form, scrollTop: 0 };
		const focused: unknown[] = [];
		const card = { focus: (o?: FocusOptions) => focused.push(o), scrollIntoView: (o?: ScrollIntoViewOptions) => focused.push(o) };
		keepScroll(list, () => { outer.scrollTop = 0; }, () => card);
		expect(outer.scrollTop).toBe(340);
		expect(focused).toEqual([{ preventScroll: true }, { block: "nearest" }]);
		for (const f of ["src/worldgen/NewMapSetupModal.ts", "src/SetupWizardView.ts"]) expect(readSource(f)).toContain("keepScroll(genList, ");
	});
});

describe("C9: switching Overland / Biomes keeps a size the user chose", () => {
	it("a chosen size is kept; untouched, the scale's own size", () => {
		expect(sizeForScalePick({ cols: 40, rows: 16 }, { cols: 16, rows: 12 })).toEqual({ cols: 40, rows: 16 });
		expect(sizeForScalePick(null, { cols: 16, rows: 12 })).toEqual({ cols: 16, rows: 12 });
	});

	it("both forms use it; the wizard's reset goes back to following the scale", () => {
		const wiz = readSurface("setup-wizard");
		expect(wiz).toContain("sizeForScalePick(ctx.sizeChosen ? { cols: ctx.mapCols, rows: ctx.mapRows } : null, s.size)");
		expect(wiz).toMatch(/resetBtn\.addEventListener\("click", \(\) => \{[\s\S]*?ctx\.sizeChosen = false;/);
		expect(readSurface("new-map-setup")).toContain("sizeForScalePick(this.sizeChosen ?");
	});
});

describe("C10: a missing map name is said at the field", () => {
	function stubField() {
		const children: { cls: string; text: string; removed: boolean; setText(t: string): void; remove(): void }[] = [];
		const host = {
			querySelector: () => children.find((c) => !c.removed) ?? null,
			createDiv: (o: { cls: string }) => {
				const el = { cls: o.cls, text: "", removed: false, setText(t: string) { el.text = t; }, remove() { el.removed = true; } };
				children.push(el);
				return el;
			},
		};
		const attrs = new Map<string, string | null>();
		const classes = new Set<string>();
		const calls: string[] = [];
		let onInput: (() => void) | undefined;
		const field = {
			parentElement: host,
			setAttr: (n: string, v: string | null) => attrs.set(n, v),
			toggleClass: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
			addEventListener: (_t: "input", fn: () => void) => { onInput = fn; },
			scrollIntoView: () => calls.push("scroll"),
			focus: () => calls.push("focus"),
		};
		return { field: field as unknown as ErrorField, children, attrs, classes, calls, input: () => onInput?.() };
	}

	it("shows the message under the field, marks it, scrolls to it and focuses it; typing clears it", () => {
		const s = stubField();
		showFieldError(s.field, "Enter a map name.");
		expect(s.children.filter((c) => !c.removed).map((c) => c.text)).toEqual(["Enter a map name."]);
		expect(s.attrs.get("aria-invalid")).toBe("true");
		expect(s.classes.has("duckmage-field-invalid")).toBe(true);
		expect(s.calls).toEqual(["scroll", "focus"]);
		// Twice: still one message.
		showFieldError(s.field, "Enter a map name.");
		expect(s.children.filter((c) => !c.removed)).toHaveLength(1);
		s.input();
		expect(s.children.filter((c) => !c.removed)).toHaveLength(0);
		expect(s.classes.has("duckmage-field-invalid")).toBe(false);
		clearFieldError(s.field);
	});

	it("New map checks the name first and says every name problem at the field", () => {
		const modal = readSurface("new-map-setup");
		const at = modal.indexOf("  private async create(");
		const create = modal.slice(at, modal.indexOf("\n  }\n", at));
		expect(create.indexOf('this.nameProblem("Enter a map name.")')).toBeGreaterThan(-1);
		expect(create.indexOf('this.nameProblem("Enter a map name.")')).toBeLessThan(create.indexOf("this.generate("));
		expect(create).toContain("this.nameProblem(result.error)");
		expect(create).not.toContain("new Notice(result.error)");
	});
});

describe("F11: the finished wizard and the legend", () => {
	it("the final step has no Remind me later / Don't show again", () => {
		const wiz = readSurface("setup-wizard");
		const render = wiz.slice(wiz.indexOf("private renderView() {"), wiz.indexOf("private updateNextBtn()"));
		expect(render.indexOf("if (isFinal) return;")).toBeGreaterThan(-1);
		expect(render.indexOf("if (isFinal) return;")).toBeLessThan(render.indexOf('"Remind me later"'));
	});

	it("the legend (bottom-left) pushes the fitted map right of it", () => {
		const clip = { left: 100, top: 50, right: 1100, bottom: 850 };
		const legend = { left: 108, top: 500, right: 250, bottom: 840 };
		const ins = overlayInsets(clip, [], [], OVERLAY_GAP, [legend]);
		expect(ins.left).toBe(250 - 100 + OVERLAY_GAP);
		const fit = fitToSafeArea(1000, 800, 600, 600, ins);
		expect(fit.panX).toBeGreaterThanOrEqual(ins.left);
		expect(readSurface("map-view")).toContain('querySelectorAll<HTMLElement>(":scope > .duckmage-terrain-legend")');
	});
});

describe("F12: the Tables / Workflows toggle shows which is selected", () => {
	it("the shown mode gets the accent fill (specific enough to beat Obsidian's button fill)", () => {
		const css = read("styles.css");
		expect(css).toMatch(/\.duckmage-rt-mode-tabs \.duckmage-rt-mode-tab\.is-active \{\n\s+background: var\(--interactive-accent\);/);
		const plain = css.slice(css.indexOf(".duckmage-rt-mode-tabs .duckmage-rt-mode-tab {"), css.indexOf(".duckmage-rt-mode-tabs .duckmage-rt-mode-tab.is-active"));
		expect(plain).not.toContain("background");
	});

	it("both tabs say whether they're pressed, from one helper", () => {
		const view = readSurface("table-view");
		expect(view).toContain('btn?.setAttr("aria-pressed", String(mode === m))');
		expect(view.match(/toggleClass\("is-active", mode ===/g)?.length).toBe(1);
	});
});

describe("F14 → SF8: the Overland card says it draws the palette's path types", () => {
	it("in its palette-aware description and the static one", () => {
		expect(overlandDescription(DEFAULT_TERRAIN_PALETTE)).toMatch(/It draws your path types too \(roads, rivers…\): set how many of each\.$/);
		expect(read("src/modules/world/runtime.ts")).toContain("${OVERLAND_TAIL}");
	});
});

describe("F16 / C12: the table editor", () => {
	const editor = () => readSurface("table-editor");
	it("entries have column headers laid out like the rows", () => {
		const src = editor();
		expect(src).toContain('cls: "duckmage-table-editor-row duckmage-table-editor-cols"');
		for (const h of ['text: "Roll"', 'text: "Result"', 'text: "Weight"', 'text: "Odds"']) expect(src).toContain(h);
	});

	it("the new row's weight box has a label", () => {
		const src = editor();
		expect(src).toMatch(/newWeightLabel\.createSpan\(\{ text: "Weight"/);
		expect(src).toContain("const newWeight = newWeightLabel.createEl(\"input\"");
	});

	it("focus on open goes to a new row, not the Name field", () => {
		const src = editor();
		const open = src.slice(src.indexOf("  async onOpen()"), src.indexOf("  /** Sync entries ↔ notes"));
		expect(open).toMatch(/newResult\.focus\(\);\n\s+window\.setTimeout\(\(\) => \{\n\s+if \(newResult\.isConnected && activeDocument\.activeElement === nameInput\) newResult\.focus\(\);/);
	});
});

describe("F18 / C11: the neighbour pad says which way each button goes", () => {
	it("an empty side shows its arrow with a plain +", () => {
		expect(PAD_SIDES.map((s) => padButtonText(s.glyph, true))).toEqual(["◀+", "▲+", "▼+", "▶+"]);
		expect(padButtonText("◀", false)).toBe("◀");
		expect(readSurface("map-view")).toContain("text: padButtonText(glyph, b.plus)");
	});

	it("no full-width plus in the link combo's Create item", () => {
		expect(readSurface("hex-editor")).not.toContain("＋");
	});
});

describe("F19: the wizard writes nothing before the world folder is confirmed", () => {
	it("map-type content is installed in the folder step's Next, after the folder is set", () => {
		const wiz = readSurface("setup-wizard");
		const welcome = wiz.slice(wiz.indexOf("function makeWelcomeStep"), wiz.indexOf("function makeFolderStep"));
		expect(welcome).not.toContain("applyKindContent");
		const folders = wiz.slice(wiz.indexOf("function makeFolderStep"), wiz.indexOf("function makeMapStep"));
		const next = folders.slice(folders.indexOf("async onNext("));
		expect(next.indexOf("plugin.settings.worldFolder = world")).toBeLessThan(next.indexOf("plugin.releaseStartupWrites()"));
		expect(next.indexOf("await plugin.storesStarted")).toBeLessThan(next.indexOf("applyKindContent({ fromSetup: true })"));
	});

	it("a fresh install's stores wait for the folder; anything else starts at once", async () => {
		const none = () => false;
		const held = startupWritesWait({}, none);
		expect(held.held).toBe(true);
		let started = false;
		void held.wait.then(() => { started = true; });
		await Promise.resolve();
		expect(started).toBe(false);
		held.release();
		await held.wait;
		expect(started).toBe(true);
		// Setup done or put off, or a world folder already there: no wait.
		expect(startupWritesWait({ setupComplete: true }, none).held).toBe(false);
		expect(startupWritesWait({ setupDismissed: true }, none).held).toBe(false);
		expect(startupWritesWait({ worldFolder: "RPG/" }, (p) => p === "RPG").held).toBe(false);
	});

	it("the plugin starts its stores through the gate; closing the wizard or opening a map releases it", () => {
		const plugin = readSurface("plugin");
		expect(plugin).toContain("const storesReady = gate.wait.then(() => this.paletteStore.init()).then(() => this.mapStore.init());");
		expect(readSurface("setup-wizard")).toMatch(/async onClose\(\) \{\n\t\t\/\/[^\n]*\n\t\tthis\.plugin\.releaseStartupWrites\(\);/);
		expect(readSurface("map-view")).toMatch(/onOpen\(\): Promise<void> \{\n[^\n]*\n\s+this\.plugin\.releaseStartupWrites\(\);/);
	});
});

describe("F20: explanations name the map, not its folder", () => {
	it("the sea hint takes the name it's given", () => {
		expect(neighbourSeaText({ why: "dry", side: "west" } as never, "Vale of Embers")).toBe("Picked from Vale of Embers: its shared edge has no water, so no sea by default.");
	});

	it("New map passes the map's label everywhere it names the neighbour", () => {
		const modal = readSurface("new-map-setup");
		expect(modal).toContain('neighbourSeaText(seaHint, anchor ? this.plugin.mapLabel(anchor) : "the neighbouring map")');
		expect(modal).toContain('const anchor = this.placement?.anchor ? this.plugin.mapLabel(this.placement.anchor) : "the neighbouring map";');
		expect(modal).not.toMatch(/\$\{anchor \?\? "the neighbour"\}/);
	});
});

describe("F21: a table is titled as its links say", () => {
	it("a terrain table keeps its kind; a plain table is its name", () => {
		expect(tableTitle("world/tables/terrain/encounters/mixed forest heavy.md")).toBe("mixed forest heavy encounters");
		expect(tableTitle("world/tables/terrain/encounters/mixed forest heavy.md")).toBe(linkDisplayName("world/tables/terrain/encounters/mixed forest heavy"));
		expect(tableTitle("world/tables/weather.md")).toBe("weather");
	});

	it("the roll dialog, table editor and roller view all use it", () => {
		expect(read("src/random-tables/RandomTableModal.ts")).toContain('headerRow.createEl("strong", { text: tableTitle(file.path) })');
		expect(readSurface("table-editor")).toContain("this.titleEl.setText(`Edit: ${tableTitle(this.file.path)}`)");
		expect(readSurface("table-view")).toContain("text: tableTitle(file.path),");
	});
});
