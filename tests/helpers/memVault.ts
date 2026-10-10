/**
 * In-memory vault for store/migration tests: just enough of App (vault,
 * adapter, metadataCache, fileManager) for MapStore. Frontmatter uses a
 * small YAML subset (scalars, quoted strings, inline and dash lists) —
 * the shapes hex notes actually carry.
 */
import { TFile, TFolder } from "obsidian";
import { parseMiniYaml } from "./miniYaml";

export { parseMiniYaml };

function dumpMiniYaml(fm: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [k, v] of Object.entries(fm)) {
		if (v === undefined) continue;
		if (Array.isArray(v)) {
			lines.push(`${k}:`);
			for (const i of v) lines.push(`  - ${String(i)}`);
		} else if (typeof v === "string" && /^\[\[|[:#]/.test(v)) {
			lines.push(`${k}: ${JSON.stringify(v)}`);
		} else {
			lines.push(`${k}: ${String(v)}`);
		}
	}
	return lines.join("\n");
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class MemVault {
	files = new Map<string, string>();
	folders = new Set<string>([""]);
	/** Files written with adapter.writeBinary (backups). */
	binaries = new Map<string, Uint8Array>();
	/** Test hook: make adapter.writeBinary fail. */
	failBinary = false;
	writes: string[] = [];
	/** Test hook: mangle content on its way to disk (simulates a bad write). */
	corrupt: ((path: string, content: string) => string) | null = null;

	constructor(initial: Record<string, string> = {}) {
		for (const [p, c] of Object.entries(initial)) this.put(p, c);
	}

	private ensureFolder(path: string): void {
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
	}

	private put(path: string, content: string): void {
		const slash = path.lastIndexOf("/");
		if (slash > 0) this.ensureFolder(path.slice(0, slash));
		this.files.set(path, this.corrupt ? this.corrupt(path, content) : content);
	}

	private node(path: string): TFile | TFolder | null {
		if (this.files.has(path)) {
			const f = new TFile();
			f.path = path;
			f.name = path.slice(path.lastIndexOf("/") + 1);
			f.basename = f.name.replace(/\.md$/, "");
			return f;
		}
		if (this.folders.has(path)) {
			const d = new TFolder();
			d.path = path;
			d.name = path.slice(path.lastIndexOf("/") + 1);
			const prefix = path ? path + "/" : "";
			const kids = [...this.files.keys(), ...this.folders]
				.filter((p) => p && p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
			d.children = kids.map((k) => this.node(k)!);
			return d;
		}
		return null;
	}

	frontmatter(path: string): Record<string, unknown> | undefined {
		const c = this.files.get(path);
		const m = c ? FM.exec(c) : null;
		return m ? parseMiniYaml(m[1]) : undefined;
	}

	body(path: string): string {
		return (this.files.get(path) ?? "").replace(FM, "");
	}

	app() {
		const v = this;
		return {
			vault: {
				getAbstractFileByPath: (p: string) => v.node(p),
				getMarkdownFiles: () => [...v.files.keys()].filter((p) => p.endsWith(".md")).map((p) => v.node(p) as TFile),
				read: async (f: TFile) => v.files.get(f.path) ?? "",
				cachedRead: async (f: TFile) => v.files.get(f.path) ?? "",
				modify: async (f: TFile, c: string) => { v.writes.push(f.path); v.put(f.path, c); },
				process: async (f: TFile, fn: (c: string) => string) => {
					const c = v.files.get(f.path) ?? "";
					const next = fn(c);
					if (next !== c) { v.writes.push(f.path); v.put(f.path, next); }
					return next;
				},
				create: async (p: string, c: string) => {
					if (v.files.has(p)) throw new Error("exists " + p);
					v.writes.push(p);
					v.put(p, c);
					return v.node(p);
				},
				createFolder: async (p: string) => { v.ensureFolder(p); },
				adapter: {
					exists: async (p: string) => v.files.has(p) || v.folders.has(p) || v.binaries.has(p),
					mkdir: async (p: string) => { v.ensureFolder(p); },
					write: async (p: string, c: string) => { v.put(p, c); },
					writeBinary: async (p: string, data: ArrayBuffer) => {
						if (v.failBinary) throw new Error("disk full");
						v.binaries.set(p, new Uint8Array(data));
					},
				},
			},
			metadataCache: {
				getFileCache: (f: TFile) => (v.files.has(f.path) ? { frontmatter: v.frontmatter(f.path) } : null),
				getCache: (p: string) => (v.files.has(p) ? { frontmatter: v.frontmatter(p) } : null),
			},
			fileManager: {
				processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
					const c = v.files.get(f.path) ?? "";
					const fm = v.frontmatter(f.path) ?? {};
					fn(fm);
					const body = c.replace(FM, "");
					const yaml = dumpMiniYaml(fm);
					v.writes.push(f.path);
					v.put(f.path, (yaml ? `---\n${yaml}\n---\n` : "") + body);
				},
				renameFile: async (f: TFile, to: string) => {
					const c = v.files.get(f.path)!;
					v.files.delete(f.path);
					v.put(to, c);
				},
			},
		};
	}
}
