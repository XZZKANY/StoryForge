import { joinPath } from '../fs-path-ops';
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
    // 文件夹节点可能先由下层条目推出来，手里没有它自己的条目路径：照作品根的分隔符拼，
    // 与宿主列出的条目同一种写法。
    let currentPath = projectPath;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentPath = joinPath(currentPath, segment);
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

  // 点开头的（.草稿 .留底 .资料 .storyforge 这类作者 / 应用的工作区）排在同类后面：
  // 打开文件树先看到的应该是正文，而不是一屏点目录（作者 10-16：「正文在最底下」）。
  const dotted = (node: ProjectTreeNode) => node.name.startsWith('.');
  const sortNodes = (nodes: ProjectTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (dotted(a) !== dotted(b)) return dotted(a) ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(rootNodes);
  return rootNodes;
}
