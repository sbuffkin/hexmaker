import { App, SuggestModal, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import type { NotePickPurpose } from "../templateNotes";

/** A "+ New …" row: make a note with the typed name. */
interface NewNoteItem {
	create: string;
}

export interface FileLinkSuggestOptions {
	/** Reorder the matches (default: by name). The user's own tables first, say. */
	order?: (files: TFile[]) => TFile[];
	/** Offer "+ New "<typed name>"" when no match has that name exactly. */
	onCreate?: (name: string) => void;
	/** What the "+ New" row makes ("table" → `+ New table "Name"`). */
	createNoun?: string;
}

export class FileLinkSuggestModal extends SuggestModal<TFile | NewNoteItem> {
	constructor(
		app: App,
		private plugin: HexmakerPlugin,
		private onChoose: (file: TFile) => void,
		private folderOverride?: string,
		/** If set, only files with one of these (lowercase, no leading dot) extensions are returned. */
		private extensionFilter?: string[],
		/** "link" (default) hides template notes; "template" is for pickers
		 *  that choose a template (a template path, a workflow template). */
		private purpose: NotePickPurpose = "link",
		private opts: FileLinkSuggestOptions = {},
	) {
		super(app);
		this.setPlaceholder("Search for a file to link...");
	}

	getSuggestions(query: string): (TFile | NewNoteItem)[] {
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
		const matches = files
			.filter(f => (f.extension === "md" ? this.plugin.isLinkableNote(f, this.purpose) : !f.basename.startsWith("_")))
			.filter(f => !exts || exts.includes(f.extension.toLowerCase()))
			.filter(f => f.basename.toLowerCase().contains(query.toLowerCase()))
			.sort((a, b) => a.basename.localeCompare(b.basename));
		const ordered: (TFile | NewNoteItem)[] = this.opts.order ? this.opts.order(matches) : matches;
		const name = query.trim();
		if (this.opts.onCreate && name && !matches.some((f) => f.basename.toLowerCase() === name.toLowerCase())) {
			ordered.push({ create: name });
		}
		return ordered;
	}

	renderSuggestion(item: TFile | NewNoteItem, el: HTMLElement): void {
		if (!(item instanceof TFile)) {
			el.createSpan({ text: `+ New ${this.opts.createNoun ?? "note"} "${item.create}"` });
			return;
		}
		el.createSpan({ text: item.basename });
		el.createEl("small", { text: ` — ${item.path}`, cls: "duckmage-suggestion-path" });
	}

	onChooseSuggestion(item: TFile | NewNoteItem, _evt: MouseEvent | KeyboardEvent): void {
		if (item instanceof TFile) this.onChoose(item);
		else this.opts.onCreate?.(item.create);
	}
}
