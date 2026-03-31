import { TFile } from "obsidian";

export interface FileNode {
  type: "file";
  file: TFile;
}
export interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}
export type TreeNode = FileNode | FolderNode;

/**
 * Build a sorted folder tree from a flat list of files.
 * `prefix` is the vault-relative folder path prefix (e.g. "world/tables/") —
 * it is stripped before building relative folder paths.
 * `extraFolderPaths` is an optional list of vault-relative folder paths to
 * include even when they contain no files (so empty folders appear in the tree).
 * Folders sort before files; each group is sorted alphabetically.
 */
export function buildTree(
  files: TFile[],
  prefix: string,
  extraFolderPaths: string[] = [],
): TreeNode[] {
  const root: FolderNode = {
    type: "folder",
    name: "",
    path: "",
    children: [],
  };

  const ensureFolder = (rel: string) => {
    const parts = rel.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const folderName = parts[i];
      const folderPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find(
        (c): c is FolderNode => c.type === "folder" && c.name === folderName,
      );
      if (!child) {
        child = {
          type: "folder",
          name: folderName,
          path: folderPath,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
    return current;
  };

  // Ensure all known vault folders are present (including empty ones)
  for (const folderPath of extraFolderPaths) {
    const rel = prefix ? folderPath.slice(prefix.length) : folderPath;
    if (rel) ensureFolder(rel);
  }

  for (const file of files) {
    const rel = prefix ? file.path.slice(prefix.length) : file.path;
    const parts = rel.split("/");
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const folderPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find(
        (c): c is FolderNode => c.type === "folder" && c.name === folderName,
      );
      if (!child) {
        child = {
          type: "folder",
          name: folderName,
          path: folderPath,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
    current.children.push({ type: "file", file });
  }

  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      const aName = a.type === "folder" ? a.name : a.file.basename;
      const bName = b.type === "folder" ? b.name : b.file.basename;
      return aName.localeCompare(bName);
    });
    for (const node of nodes) {
      if (node.type === "folder") sortChildren(node.children);
    }
  };
  sortChildren(root.children);

  return root.children;
}
