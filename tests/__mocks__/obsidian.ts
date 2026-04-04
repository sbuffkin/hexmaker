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
export class Notice { constructor(_msg: string) {} }
export class Plugin { constructor(_app: App, _manifest: any) {} }

export function normalizePath(path: string): string {
	return path.replace(/[\\/]+/g, "/").replace(/\u00A0/g, " ").normalize().replace(/^\/+|\/+$/g, "");
}
