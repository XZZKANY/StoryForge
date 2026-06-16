/**
 * 资源管理器
 * 展示项目文件树，支持文件夹层级递归
 */

import { useEffect, useState, useMemo, memo, useCallback } from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';

type ResourceExplorerProps = {
  projectPath: string | null;
  currentFile: string | null;
  onFileSelect: (filePath: string) => void;
};

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
};

function buildTree(entries: FileEntry[], projectPath: string): TreeNode[] {
  const normalizedRoot = projectPath.replace(/[/\\]+$/, '');
  const rootNodes: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  for (const entry of entries) {
    const relative = entry.path.slice(normalizedRoot.length).replace(/^[/\\]+/, '');
    const segments = relative.split(/[/\\]/);

    let currentLevel = rootNodes;
    let currentPath = normalizedRoot;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentPath = `${currentPath}/${segment}`;

      const isFile = i === segments.length - 1 && !entry.isDir;

      if (isFile) {
        currentLevel.push({
          name: segment,
          path: entry.path,
          isDir: false,
          children: []
        });
      } else {
        let dirNode = dirMap.get(currentPath);
        if (!dirNode) {
          dirNode = {
            name: segment,
            path: currentPath,
            isDir: true,
            children: []
          };
          dirMap.set(currentPath, dirNode);
          currentLevel.push(dirNode);
        }
        currentLevel = dirNode.children;
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach(node => sortNodes(node.children));
  };

  sortNodes(rootNodes);
  return rootNodes;
}

export function ResourceExplorer({ projectPath, currentFile, onFileSelect }: ResourceExplorerProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!projectPath) {
      setFiles([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const entries = await TauriFileSystem.listDir(projectPath, true);
        const filteredEntries = entries
          .filter((e) => !/[/\\]\.storyforge[/\\]/.test(e.path))
          .filter((e) => e.isDir || e.extension === 'md' || e.extension === 'markdown');

        if (!cancelled) {
          setFiles(filteredEntries);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载文件失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const tree = useMemo(() => {
    if (!projectPath) return [];
    return buildTree(files, projectPath);
  }, [files, projectPath]);

  const handleCollapse = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  return (
    <div className="h-full flex flex-col bg-[#252526]">
      {/* 标题栏 */}
      <div className="h-[36px] px-3 border-b border-[#2D2D30] flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-[#CCCCCC]">资源管理器</span>
        <button
          onClick={handleCollapse}
          className="w-5 h-5 rounded hover:bg-[#2D2D30] flex items-center justify-center text-[#CCCCCC]"
          title={collapsed ? '展开' : '折叠'}
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* 文件树 */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto py-1">
          {!projectPath ? (
            <div className="mt-8 mx-4 text-center">
              <p className="text-sm text-[#858585]">尚未打开项目</p>
            </div>
          ) : loading ? (
            <div className="p-8 text-center text-sm text-[#858585]">加载中...</div>
          ) : error ? (
            <div className="mx-2 p-2 rounded bg-[#5A1D1D] text-[#F48771] text-xs">{error}</div>
          ) : tree.length === 0 ? (
            <div className="mt-8 mx-4 text-center">
              <p className="text-sm text-[#858585]">空空如也</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {tree.map(node => (
                <TreeNodeItem
                  key={node.path}
                  node={node}
                  level={0}
                  currentFile={currentFile}
                  onFileSelect={onFileSelect}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TreeNodeItem = memo(function TreeNodeItem({
  node,
  level,
  currentFile,
  onFileSelect
}: {
  node: TreeNode;
  level: number;
  currentFile: string | null;
  onFileSelect: (filePath: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isActive = node.path === currentFile;

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const handleSelect = useCallback(() => {
    onFileSelect(node.path);
  }, [node.path, onFileSelect]);

  const indentBlocks = Array.from({ length: level }).map((_, i) => (
    <div key={i} className="w-[12px] h-full flex-shrink-0 border-l border-[#2D2D30]/50 ml-[6px]" />
  ));

  if (node.isDir) {
    return (
      <div className="flex flex-col">
        <button
          onClick={handleToggle}
          className="flex items-center w-full text-left h-[22px] hover:bg-[#2A2D2E] text-[#CCCCCC] transition-colors group cursor-pointer"
        >
          <div className="flex items-center h-full pl-[4px]">
            {indentBlocks}
          </div>

          <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
            <svg className={`w-3.5 h-3.5 transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>

          <span className="text-[13px] truncate">{node.name}</span>
        </button>
        {isOpen && (
          <div className="flex flex-col">
            {node.children.map(child => (
              <TreeNodeItem
                key={child.path}
                node={child}
                level={level + 1}
                currentFile={currentFile}
                onFileSelect={onFileSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleSelect}
      className={`
        flex items-center w-full text-left h-[22px] transition-colors group cursor-pointer
        ${isActive ? 'bg-[#37373D] text-white' : 'text-[#CCCCCC] hover:bg-[#2A2D2E]'}
      `}
    >
      <div className="flex items-center h-full pl-[4px]">
        {indentBlocks}
      </div>

      <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
        <svg className={`w-3 h-3 ${isActive ? 'text-[#4A9EFF]' : 'opacity-50 group-hover:opacity-80'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>

      <span className="text-[13px] truncate flex-1">{node.name}</span>
    </button>
  );
});
