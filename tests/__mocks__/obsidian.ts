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
export class Modal { constructor(_app: App) {} }
export class Notice { constructor(_msg: string) {} }
export class Plugin { constructor(_app: App, _manifest: any) {} }
