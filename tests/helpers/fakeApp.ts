/**
 * An in-memory Obsidian App for loading the real HexmakerPlugin in tests.
 * Every write (vault, adapter, file manager) is recorded in `writes`
 * instead of happening, so a test can assert "nothing was written".
 */

import { TFile, TFolder, WorkspaceLeaf, type View } from "obsidian";

type Handler = (...args: unknown[]) => unknown;

export interface FakeApp {
  app: any;
  /** Every write attempted, as "method path". */
  writes: string[];
  /** Run the onLayoutReady callbacks. */
  layoutReady(): void;
  /** Fire a vault event (create / delete / rename / modify). */
  fire(event: string, ...args: unknown[]): Promise<void>;
  /** Make a leaf showing a registered view type (calls the plugin's factory + onOpen). */
  openView(type: string): Promise<View>;
  file(path: string): TFile | TFolder | null;
}

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split("/").pop() ?? path;
  f.basename = f.name.replace(/\.[^.]+$/, "");
  f.extension = f.name.includes(".") ? f.name.split(".").pop()! : "";
  return f;
}

function makeFolder(path: string): TFolder {
  const f = new TFolder();
  f.path = path;
  f.name = path.split("/").pop() ?? path;
  return f;
}

/** Simple frontmatter (key: value lines) → object. */
function frontmatterOf(text: string): Record<string, unknown> | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

/** Build a fake app over `files` (vault path → text). */
export function fakeApp(files: Record<string, string>, plugin: () => { views: Map<string, (leaf: WorkspaceLeaf) => View> }): FakeApp {
  const writes: string[] = [];
  const content = new Map(Object.entries(files));
  const nodes = new Map<string, TFile | TFolder>();
  const root = makeFolder("");
  nodes.set("", root);
  const folder = (path: string): TFolder => {
    const got = nodes.get(path);
    if (got instanceof TFolder) return got;
    const f = makeFolder(path);
    const parent = folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    f.parent = parent;
    parent.children.push(f);
    nodes.set(path, f);
    return f;
  };
  for (const path of content.keys()) {
    const f = makeFile(path);
    const parent = folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    f.parent = parent;
    parent.children.push(f);
    nodes.set(path, f);
  }

  const handlers = new Map<string, Handler[]>();
  const on = (name: string, cb: Handler) => {
    handlers.set(name, [...(handlers.get(name) ?? []), cb]);
    return { name };
  };
  const write = (method: string) => (target: unknown) => {
    const p = typeof target === "string" ? target : (target as { path?: string })?.path ?? "?";
    writes.push(`${method} ${p}`);
    return Promise.resolve(null);
  };
  const layoutCbs: (() => void)[] = [];
  const leaves: WorkspaceLeaf[] = [];

  const makeLeaf = (): WorkspaceLeaf => {
    const leaf = new WorkspaceLeaf(app) as WorkspaceLeaf & { setViewState: (s: { type: string }) => Promise<void>; type?: string };
    leaf.setViewState = async ({ type }) => {
      leaf.type = type;
      const factory = plugin().views.get(type);
      leaf.view = factory ? factory(leaf) : null;
      const v = leaf.view as unknown as { onOpen?: () => Promise<void> };
      if (v?.onOpen) await v.onOpen();
    };
    leaves.push(leaf);
    return leaf;
  };

  const text = (f: TFile | string) => {
    const p = typeof f === "string" ? f : f.path;
    const t = content.get(p);
    return t === undefined ? Promise.reject(new Error(`no file ${p}`)) : Promise.resolve(t);
  };

  const app: any = {
    vault: {
      adapter: {
        exists: (p: string) => Promise.resolve(content.has(p) || nodes.get(p) instanceof TFolder),
        list: (p: string) => {
          const f = nodes.get(p);
          if (!(f instanceof TFolder)) return Promise.reject(new Error(`no folder ${p}`));
          return Promise.resolve({
            files: f.children.filter((c) => c instanceof TFile).map((c) => c.path),
            folders: f.children.filter((c) => c instanceof TFolder).map((c) => c.path),
          });
        },
        read: (p: string) => text(p),
        write: write("adapter.write"),
        writeBinary: write("adapter.writeBinary"),
        append: write("adapter.append"),
        mkdir: write("adapter.mkdir"),
        remove: write("adapter.remove"),
        rename: write("adapter.rename"),
      },
      getName: () => "fake",
      on,
      getAbstractFileByPath: (p: string) => nodes.get(p) ?? null,
      getMarkdownFiles: () => [...nodes.values()].filter((n): n is TFile => n instanceof TFile && n.extension === "md"),
      getFiles: () => [...nodes.values()].filter((n): n is TFile => n instanceof TFile),
      getAllLoadedFiles: () => [...nodes.values()],
      read: text,
      cachedRead: text,
      modify: write("vault.modify"),
      process: write("vault.process"),
      create: write("vault.create"),
      createFolder: write("vault.createFolder"),
      createBinary: write("vault.createBinary"),
      modifyBinary: write("vault.modifyBinary"),
      append: write("vault.append"),
      rename: write("vault.rename"),
      delete: write("vault.delete"),
      trash: write("vault.trash"),
      copy: write("vault.copy"),
    },
    fileManager: {
      processFrontMatter: write("fileManager.processFrontMatter"),
      renameFile: write("fileManager.renameFile"),
      trashFile: write("fileManager.trashFile"),
    },
    metadataCache: {
      on,
      getFileCache: (f: TFile) => {
        const t = content.get(f.path);
        return t === undefined ? null : { frontmatter: frontmatterOf(t) };
      },
      fileToLinktext: (f: TFile) => f.basename,
      getFirstLinkpathDest: () => null,
      resolvedLinks: {},
    },
    workspace: {
      on,
      onLayoutReady: (cb: () => void) => layoutCbs.push(cb),
      getLeavesOfType: (type: string) => leaves.filter((l) => (l as { type?: string }).type === type),
      getLeaf: () => makeLeaf(),
      getActiveViewOfType: () => null,
      getActiveFile: () => null,
      revealLeaf: () => Promise.resolve(),
    },
  };

  return {
    app,
    writes,
    layoutReady: () => layoutCbs.splice(0).forEach((cb) => cb()),
    fire: async (event, ...args) => {
      for (const h of handlers.get(event) ?? []) await h(...args);
    },
    openView: async (type) => {
      const leaf = makeLeaf() as WorkspaceLeaf & { setViewState: (s: { type: string }) => Promise<void> };
      await leaf.setViewState({ type });
      return leaf.view as View;
    },
    file: (p) => nodes.get(p) ?? null,
  };
}
