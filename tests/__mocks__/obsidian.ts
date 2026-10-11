/** Minimal Obsidian API stubs for unit tests. */

import { parseMiniYaml } from "../helpers/miniYaml";

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "md";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot() { return false; }
}

export class App {}
export class MarkdownView {}
export class Modal { app: App; contentEl = { empty() {}, addClass() {}, createDiv() { return this; }, createEl() { return this; }, createSpan() { return this; }, setText() { return this; }, style: {} } as any; constructor(app: App) { this.app = app; } }
export class SuggestModal<T> { constructor(_app: App) {} getSuggestions(_q: string): T[] { return []; } renderSuggestion(_v: T, _el: HTMLElement): void {} onChooseSuggestion(_v: T, _e: MouseEvent | KeyboardEvent): void {} }
export class Notice {
	/** Every notice shown, for tests to check (clear it yourself). */
	static shown: { msg: string; timeout?: number; hidden: boolean }[] = [];
	private rec: { msg: string; timeout?: number; hidden: boolean };
	constructor(msg: string, timeout?: number) { this.rec = { msg, timeout, hidden: false }; Notice.shown.push(this.rec); }
	setMessage(_msg: string) { return this; }
	hide() { this.rec.hidden = true; }
}
/** A built menu item (title, icon, disabled, checked, click), for tests to read. */
export class MenuItem {
	title = ""; icon: string | null = null; disabled = false; checked: boolean | null = null; click: (() => void) | null = null;
	setTitle(t: string) { this.title = String(t); return this; }
	setIcon(i: string | null) { this.icon = i; return this; }
	setDisabled(d: boolean) { this.disabled = d; return this; }
	setChecked(c: boolean | null) { this.checked = c; return this; }
	onClick(cb: () => void) { this.click = cb; return this; }
	setSection(_s: string) { return this; }
	setWarning(_w: boolean) { return this; }
	setIsLabel(_l: boolean) { return this; }
}
export class Menu {
	/** Every menu shown, for tests to check (clear it yourself). */
	static shown: Menu[] = [];
	items: (MenuItem | "separator")[] = [];
	addItem(cb: (item: MenuItem) => unknown) { const i = new MenuItem(); cb(i); this.items.push(i); return this; }
	addSeparator() { this.items.push("separator"); return this; }
	showAtMouseEvent(_e: unknown) { Menu.shown.push(this); return this; }
	showAtPosition(_p: unknown) { Menu.shown.push(this); return this; }
	hide() { return this; }
}
export class Plugin { constructor(_app: App, _manifest: any) {} }
export class PluginSettingTab { app: App; containerEl: any = {}; constructor(app: App, _plugin: unknown) { this.app = app; } display(): void {} hide(): void {} }
export class Setting { constructor(_el: unknown) {} }
export function setIcon(_el: HTMLElement, _icon: string): void {}
export function getIcon(_icon: string): SVGSVGElement | null { return null; }

export function normalizePath(path: string): string {
	return path.replace(/[\\/]+/g, "/").replace(/\u00A0/g, " ").normalize().replace(/^\/+|\/+$/g, "");
}

export function parseYaml(src: string): unknown {
	return parseMiniYaml(src);
}
