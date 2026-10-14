/** Minimal Obsidian API stubs for unit tests. */

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
export class Modal { app: App; contentEl = { empty() {}, addClass() {}, createDiv() { return this; }, createEl() { return this; }, createSpan() { return this; }, setText() { return this; }, style: {} } as any; constructor(app: App) { this.app = app; } }
export class SuggestModal<T> { constructor(_app: App) {} getSuggestions(_q: string): T[] { return []; } renderSuggestion(_v: T, _el: HTMLElement): void {} onChooseSuggestion(_v: T, _e: MouseEvent | KeyboardEvent): void {} }
/** Records every notice shown (tests read and clear `Notice.shown`). */
export class Notice {
	static shown: { message: string; timeout?: number }[] = [];
	constructor(msg: string, timeout?: number) { Notice.shown.push({ message: msg, timeout }); }
	hide() {}
}

/** A fake element: records text and children, enough for views and settings to render. */
export function fakeEl(tag = "div"): any {
	const el: any = {
		tag, text: "", children: [] as any[], classes: new Set<string>(), style: {},
		empty() { el.children = []; el.text = ""; },
		addClass(c: string) { el.classes.add(c); }, removeClass(c: string) { el.classes.delete(c); },
		toggleClass() {}, setText(t: string) { el.text = t; return el; },
		createEl(t: string, o?: { text?: string; cls?: string }) { const c = fakeEl(t); if (o?.text) c.text = o.text; el.children.push(c); return c; },
		createDiv(o?: { text?: string; cls?: string }) { return el.createEl("div", o); },
		createSpan(o?: { text?: string; cls?: string }) { return el.createEl("span", o); },
		addEventListener() {}, setAttr() {}, show() {}, hide() {},
		/** All text in this element and below. */
		allText(): string { return [el.text, ...el.children.map((c: any) => c.allText())].join(" "); },
	};
	return el;
}

export class Component {
	load() {} unload() {}
	register(_cb: () => void) {}
	registerEvent(_ref: unknown) {}
	registerDomEvent() {}
	registerInterval(id: number) { return id; }
}

export class WorkspaceLeaf { app: any; view: any; constructor(app?: any) { this.app = app; } }
export class View extends Component {
	app: any; leaf: WorkspaceLeaf; containerEl = fakeEl(); contentEl = fakeEl();
	constructor(leaf: WorkspaceLeaf) { super(); this.leaf = leaf; this.app = leaf?.app; }
}
export class ItemView extends View {}
export class MarkdownView extends View { file: TFile | null = null; }
export class Menu { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() {} }
export class Scope { register() {} unregister() {} }
export class MarkdownRenderer { static render() { return Promise.resolve(); } }
export function setIcon() {}

export class Setting {
	settingEl = fakeEl(); controlEl = fakeEl(); nameEl = fakeEl(); descEl = fakeEl();
	constructor(containerEl: any) { containerEl?.children?.push?.(this.settingEl); this.settingEl.children.push(this.nameEl, this.descEl); }
	setName(n: string) { this.nameEl.text = n; return this; }
	setDesc(d: string) { this.descEl.text = d; return this; }
	setHeading() { return this; } setClass() { return this; }
	addText() { return this; } addToggle() { return this; } addDropdown() { return this; }
	addButton() { return this; } addSlider() { return this; } addColorPicker() { return this; }
	addExtraButton() { return this; } addTextArea() { return this; }
}

export class PluginSettingTab {
	app: App; plugin: unknown; containerEl = fakeEl();
	constructor(app: App, plugin: unknown) { this.app = app; this.plugin = plugin; }
}

/**
 * Plugin: records what it registers. `loadData` returns `__data` (set it
 * before onload); `saveData` records into `__saves`.
 */
export class Plugin extends Component {
	app: any; manifest: any;
	__data: unknown = null;
	__saves: unknown[] = [];
	views = new Map<string, (leaf: WorkspaceLeaf) => View>();
	commands: any[] = [];
	events: unknown[] = [];
	protocolHandlers = new Map<string, (params: Record<string, string>) => void>();
	settingTabs: PluginSettingTab[] = [];
	codeBlocks: string[] = [];
	constructor(app: App, manifest: any) { super(); this.app = app; this.manifest = manifest; }
	loadData(): Promise<unknown> { return Promise.resolve(this.__data === null ? null : JSON.parse(JSON.stringify(this.__data))); }
	saveData(data: unknown): Promise<void> { this.__saves.push(JSON.parse(JSON.stringify(data))); return Promise.resolve(); }
	registerView(type: string, factory: (leaf: WorkspaceLeaf) => View) { this.views.set(type, factory); }
	addCommand(cmd: any) { this.commands.push(cmd); return cmd; }
	addRibbonIcon() { return fakeEl(); }
	addSettingTab(tab: PluginSettingTab) { this.settingTabs.push(tab); }
	registerEvent(ref: unknown) { this.events.push(ref); }
	registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => void) { this.protocolHandlers.set(action, handler); }
	registerMarkdownCodeBlockProcessor(lang: string) { this.codeBlocks.push(lang); }
}

export function normalizePath(path: string): string {
	return path.replace(/[\\/]+/g, "/").replace(/\u00A0/g, " ").normalize().replace(/^\/+|\/+$/g, "");
}
