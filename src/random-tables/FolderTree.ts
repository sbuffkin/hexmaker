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
 * Folders sort before files; each group is sorted alphabetically.
 */
export function buildTree(files: TFile[], prefix: string): TreeNode[] {
  const root: FolderNode = {
    type: "folder",
    name: "",
    path: "",
    children: [],
  };

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
