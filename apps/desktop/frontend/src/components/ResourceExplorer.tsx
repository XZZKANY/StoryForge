/**
 * 资源管理器
 * 展示项目文件树，支持文件夹层级递归 + 右键菜单（新建 / 重命名 / 删除，#10/#17）。
 */

import {
  useEffect,
  useState,
  useMemo,
  memo,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';
import { isVisibleProjectTreeEntry } from '../lib/project/entry-visibility';
import { buildProjectTree, type ProjectTreeNode } from '../lib/project/tree';
import { parentDir } from '../lib/fs-path-ops';
import { FolderIcon, MarkdownFileIcon } from './StoryIcons';
import { ContextMenu, type ContextMenuItem } from './shell/ContextMenu';
import type { FileTreeActions } from './app/useFileTreeActions';

type ContextTarget = { path: string; isDir: boolean };
type NodeContextMenuHandler = (event: ReactMouseEvent, target: ContextTarget) => void;

type ResourceExplorerProps = {
  projectPath: string | null;
  currentFile: string | null;
  previewFile?: string | null;
  refreshVersion?: number;
  onFileSelect: (filePath: string) => void;
  // 单击预览（可覆盖的斜体页签），双击固定；不传则单击直接固定（旧行为）。
  onFilePreview?: (filePath: string) => void;
  // 右键文件操作（新建 / 重命名 / 删除）；不传则无右键菜单。
  fileActions?: FileTreeActions;
};

export function ResourceExplorer({
  projectPath,
  currentFile,
  previewFile = null,
  refreshVersion = 0,
  onFileSelect,
  onFilePreview,
  fileActions,
}: ResourceExplorerProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  useEffect(() => {
    if (!projectPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 无项目时同步清空资源树派生态，React18 合法模式
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
        const filteredEntries = entries.filter(isVisibleProjectTreeEntry);

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
  }, [projectPath, refreshVersion]);

  const tree = useMemo(() => {
    if (!projectPath) return [];
    return buildProjectTree(files, projectPath);
  }, [files, projectPath]);

  const buildMenuItems = useCallback(
    (target: ContextTarget | null): ContextMenuItem[] => {
      if (!fileActions || !projectPath) return [];
      const dir = target ? (target.isDir ? target.path : parentDir(target.path)) : projectPath;
      const items: ContextMenuItem[] = [
        { label: '新建文件', onSelect: () => void fileActions.onNewFile(dir) },
        { label: '新建文件夹', onSelect: () => void fileActions.onNewFolder(dir) },
      ];
      if (target) {
        items.push(
          { type: 'separator' },
          { label: '重命名', onSelect: () => void fileActions.onRename(target.path, target.isDir) },
          {
            label: target.isDir ? '删除文件夹' : '删除文件',
            danger: true,
            onSelect: () => void fileActions.onDelete(target.path, target.isDir),
          },
        );
      }
      return items;
    },
    [fileActions, projectPath],
  );

  const openMenu = useCallback(
    (event: ReactMouseEvent, target: ContextTarget | null) => {
      if (!fileActions || !projectPath) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu({ x: event.clientX, y: event.clientY, items: buildMenuItems(target) });
    },
    [buildMenuItems, fileActions, projectPath],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 文件树 */}
      <div
        className="flex-1 overflow-y-auto py-2"
        data-testid="file-list"
        data-project-path={projectPath ?? ''}
        onContextMenu={(event) => openMenu(event, null)}
      >
        {!projectPath ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-subtle">尚未打开项目</p>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-sm text-subtle">加载中...</div>
        ) : error ? (
          <div className="mx-2 p-2 rounded bg-error/10 text-error text-xs">{error}</div>
        ) : tree.length === 0 ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-subtle">空空如也</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <div className="pl-2">
              {tree.map((node) => (
                <TreeNodeItem
                  key={node.path}
                  node={node}
                  level={0}
                  currentFile={currentFile}
                  previewFile={previewFile}
                  onFileSelect={onFileSelect}
                  onFilePreview={onFilePreview}
                  onNodeContextMenu={fileActions ? openMenu : undefined}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

const TreeNodeItem = memo(function TreeNodeItem({
  node,
  level,
  currentFile,
  previewFile,
  onFileSelect,
  onFilePreview,
  onNodeContextMenu,
}: {
  node: ProjectTreeNode;
  level: number;
  currentFile: string | null;
  previewFile: string | null;
  onFileSelect: (filePath: string) => void;
  onFilePreview?: (filePath: string) => void;
  onNodeContextMenu?: NodeContextMenuHandler;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isActive = node.path === currentFile;
  const isPreview = !isActive && node.path === previewFile;

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleSelect = useCallback(() => {
    if (onFilePreview) onFilePreview(node.path);
    else onFileSelect(node.path);
  }, [node.path, onFileSelect, onFilePreview]);

  const handlePin = useCallback(() => {
    onFileSelect(node.path);
  }, [node.path, onFileSelect]);

  const indentBlocks = Array.from({ length: level }).map((_, i) => (
    <div key={i} className="w-[12px] h-full flex-shrink-0 border-l border-border/50 ml-[6px]" />
  ));

  if (node.isDir) {
    return (
      <div className="flex flex-col">
        <button
          onClick={handleToggle}
          onContextMenu={(event) => onNodeContextMenu?.(event, { path: node.path, isDir: true })}
          className="sf-tree-row text-muted transition-colors hover:bg-elevated group cursor-pointer"
        >
          <div className="flex items-center h-full pl-[4px]">{indentBlocks}</div>

          <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4V4z" />
            </svg>
          </div>
          <span
            className={`mr-1.5 flex h-4 w-4 flex-shrink-0 items-center justify-center ${isOpen ? 'text-foreground' : 'text-muted group-hover:text-foreground'}`}
          >
            <FolderIcon className="h-3.5 w-3.5" />
          </span>

          <span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
        </button>
        {isOpen && (
          <div className="flex flex-col">
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                level={level + 1}
                currentFile={currentFile}
                previewFile={previewFile}
                onFileSelect={onFileSelect}
                onFilePreview={onFilePreview}
                onNodeContextMenu={onNodeContextMenu}
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
      onDoubleClick={handlePin}
      onContextMenu={(event) => onNodeContextMenu?.(event, { path: node.path, isDir: false })}
      data-testid="file-item"
      data-file-name={node.name}
      data-file-path={node.path}
      data-preview={isPreview ? 'true' : undefined}
      className={`
        sf-tree-row transition-colors group cursor-pointer
        ${
          isActive
            ? 'bg-elevated text-foreground'
            : isPreview
              ? 'bg-elevated/60 italic text-foreground outline-dashed outline-1 -outline-offset-1 outline-border-strong'
              : 'text-muted hover:bg-elevated'
        }
      `}
    >
      <div className="flex items-center h-full pl-[4px]">{indentBlocks}</div>

      <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
        <MarkdownFileIcon
          className={`h-3.5 w-3.5 ${isActive ? 'text-accent' : 'text-muted opacity-70 group-hover:opacity-100'}`}
        />
      </div>

      <span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
    </button>
  );
});
