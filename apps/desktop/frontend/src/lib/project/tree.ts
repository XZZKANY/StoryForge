import type { FileEntry } from '../tauri-fs';

export type ProjectTreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: ProjectTreeNode[];
};

export function buildProjectTree(entries: FileEntry[], projectPath: string): ProjectTreeNode[] {
  const normalizedRoot = projectPath.replace(/[/\\]+$/, '');
  const rootNodes: ProjectTreeNode[] = [];
  const dirMap = new Map<string, ProjectTreeNode>();

  for (const entry of entries) {
    const relative = entry.path.slice(normalizedRoot.length).replace(/^[/\\]+/, '');
    if (!relative) continue;
    const segments = relative.split(/[/\\]/);
    let currentLevel = rootNodes;
    let currentPath = normalizedRoot;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentPath = `${currentPath}/${segment}`;
      const isFile = i === segments.length - 1 && !entry.isDir;
      if (isFile) {
        currentLevel.push({ name: segment, path: entry.path, isDir: false, children: [] });
        continue;
      }
      let dirNode = dirMap.get(currentPath);
      if (!dirNode) {
        dirNode = { name: segment, path: currentPath, isDir: true, children: [] };
        dirMap.set(currentPath, dirNode);
        currentLevel.push(dirNode);
      }
      currentLevel = dirNode.children;
    }
  }

  const sortNodes = (nodes: ProjectTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(rootNodes);
  return rootNodes;
}
