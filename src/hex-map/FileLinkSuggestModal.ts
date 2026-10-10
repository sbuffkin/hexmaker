import { App, SuggestModal, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";

export class FileLinkSuggestModal extends SuggestModal<TFile> {
	constructor(
		app: App,
		private plugin: HexmakerPlugin,
		private onChoose: (file: TFile) => void,
		private folderOverride?: string,
		/** If set, only files with one of these (lowercase, no leading dot) extensions are returned. */
		private extensionFilter?: string[],
	) {
		super(app);
		this.setPlaceholder("Search for a file to link...");
	}

	getSuggestions(query: string): TFile[] {
		const rootFolder = this.folderOverride
			?? normalizeFolder(this.plugin.settings.worldFolder?.trim() ?? "");
		let files: TFile[];
		if (rootFolder) {
			files = this.app.vault.getFiles().filter(
				f => f.path.startsWith(rootFolder + "/") || f.path === rootFolder,
			);
		} else {
			files = this.app.vault.getFiles();
		}
		const exts = this.extensionFilter;
		return files
			.filter(f => (f.extension === "md" ? this.plugin.isLinkableNote(f) : !f.basename.startsWith("_")))
			.filter(f => !exts || exts.includes(f.extension.toLowerCase()))
			.filter(f => f.basename.toLowerCase().contains(query.toLowerCase()))
			.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createSpan({ text: file.basename });
		el.createEl("small", { text: ` — ${file.path}`, cls: "duckmage-suggestion-path" });
	}

	onChooseSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}
