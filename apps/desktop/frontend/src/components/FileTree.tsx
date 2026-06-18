/**
 * 文件树组件（受控）
 * 支持真正的文件夹层级递归，Cursor 风格的视觉体验。
 */

import { useEffect, useState, useMemo } from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';

type FileTreeProps = {
  projectPath: string | null;
  currentFile: string | null;
  onFileSelect: (filePath: string) => void;
  onToggleCollapse?: () => void;
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

  // Map to store directory nodes for quick lookup
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
      
      // If it's a file, or if it's a directory and we are at the last segment
      if (isFile) {
         currentLevel.push({
           name: segment,
           path: entry.path,
           isDir: false,
           children: []
         });
      } else {
         // It's a directory segment
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

  // Sort: directories first, then files, both alphabetically
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

export function FileTree({ projectPath, currentFile, onFileSelect }: FileTreeProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          .filter((e) => !/[/\\]\.storyforge[/\\]/.test(e.path)) // Exclude internal dirs
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

  return (
    <div className="h-full flex flex-col bg-panel">
      {/* 标题 */}
      <div className="h-10 px-3 border-b border-border/5 flex items-center justify-between flex-shrink-0">
         <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            {projectPath ? `资源管理器` : '文件'}
         </span>
      </div>

      {/* 文件树 */}
      <div
        className="flex-1 overflow-y-auto py-2"
        data-testid="file-list"
        data-project-path={projectPath ?? ''}
      >
        {!projectPath ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-muted">尚未打开项目</p>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-sm text-muted">加载中...</div>
        ) : error ? (
          <div className="mx-2 p-2 rounded bg-error/10 text-error text-xs">{error}</div>
        ) : tree.length === 0 ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-muted">空空如也</p>
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
    </div>
  );
}

function TreeNodeItem({
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
  
  // 每一级缩进12px
  const indentBlocks = Array.from({ length: level }).map((_, i) => (
    <div key={i} className="w-[12px] h-full flex-shrink-0 border-l border-border/20 ml-[6px]" />
  ));

  if (node.isDir) {
    return (
      <div className="flex flex-col">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center w-full text-left h-[22px] hover:bg-white/[0.04] text-muted/70 hover:text-muted transition-colors group cursor-pointer"
        >
          {/* 占位缩进区域 */}
          <div className="flex items-center h-full pl-[4px]">
             {indentBlocks}
          </div>
          
          {/* Chevron 容器，固定宽度保证对齐 */}
          <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
            <svg className={`w-3.5 h-3.5 transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 4l4 4-4 4V4z" />
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
      onClick={() => onFileSelect(node.path)}
      className={`
        flex items-center w-full text-left h-[22px] transition-colors group cursor-pointer
        ${isActive ? 'bg-[#37373D] text-[#ffffff]' : 'text-muted hover:bg-white/[0.04] hover:text-[#cccccc]'}
      `}
    >
      <div className="flex items-center h-full pl-[4px]">
         {indentBlocks}
      </div>

      {/* 文件图标容器，尺寸与 Chevron 容器严格一致以保证文字左对齐 */}
      <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
         <svg className={`w-3 h-3 ${isActive ? 'text-accent' : 'opacity-50 group-hover:opacity-80'}`} viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h7l2 2h3v10H2V2zm1 1v10h10V5h-3l-2-2H3z" />
         </svg>
      </div>
      
      <span className="text-[13px] truncate flex-1">{node.name}</span>
    </button>
  );
}


