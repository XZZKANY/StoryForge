/**
 * 资源管理器
 * 展示项目文件树，支持文件夹层级递归 + 右键菜单（新建 / 重命名 / 删除，#10/#17）。
 */

import {
  useRef,
  useState,
  useMemo,
  memo,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useAsyncEffect } from '../../lib/async-guards';
import { TauriFileSystem, FileEntry } from '../../lib/host/tauri-fs';
import { isVisibleProjectTreeEntry } from '../../lib/project/entry-visibility';
import { buildProjectTree, type ProjectTreeNode } from '../../lib/project/tree';
import { parentDir } from '../../lib/fs-path-ops';
import { ChevronRight, FilePlus, FileText, Folder, FolderPlus } from '../icons/shell-icons';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { PanelError } from './PanelError';
import { IconButton, PlainButton, revealOnHover } from '../ui';
import type { FileTreeActions } from '../app/useFileTreeActions';

type ContextTarget = { path: string; isDir: boolean };
type NodeContextMenuHandler = (event: ReactMouseEvent, target: ContextTarget) => void;
type NodeNewEntryHandler = (kind: 'file' | 'folder', dir: string) => void;

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
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
    origin: HTMLElement;
  } | null>(null);
  // 读盘失败后的本地重试计数：与外部 refreshVersion 并列驱动同一个装载 effect。
  const [retryNonce, setRetryNonce] = useState(0);
  const loadedProjectRef = useRef<string | null>(null);

  useAsyncEffect(
    (isCurrent) => {
      if (!projectPath) {
        loadedProjectRef.current = null;
        // 无项目时同步清空资源树派生态
        setFiles([]);
        setError(null);
        return;
      }

      // 同一本书重读时不闪「加载中」：树不卸载，作者折起来的文件夹也就不会被重新展开。
      if (loadedProjectRef.current !== projectPath) setLoading(true);
      setError(null);

      void (async () => {
        try {
          const entries = await TauriFileSystem.listProjectDir(projectPath, projectPath, true);
          const filteredEntries = entries.filter(isVisibleProjectTreeEntry);

          if (isCurrent()) {
            loadedProjectRef.current = projectPath;
            setFiles(filteredEntries);
          }
        } catch (err) {
          if (isCurrent()) {
            loadedProjectRef.current = null;
            setError(err instanceof Error ? err.message : '加载文件失败');
          }
        } finally {
          if (isCurrent()) {
            setLoading(false);
          }
        }
      })();
    },
    [projectPath, refreshVersion, retryNonce],
  );

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
        const { onDuplicate, onMove } = fileActions;
        items.push(
          { type: 'separator' },
          { label: '重命名', onSelect: () => void fileActions.onRename(target.path, target.isDir) },
          ...(onDuplicate && !target.isDir
            ? [{ label: '复制一份', onSelect: () => void onDuplicate(target.path) }]
            : []),
          ...(onMove
            ? [{ label: '移动到…', onSelect: () => void onMove(target.path, target.isDir) }]
            : []),
        );
      }
      const { onReveal } = fileActions;
      if (onReveal) {
        const revealPath = target?.path ?? projectPath;
        items.push({ label: '在资源管理器中显示', onSelect: () => void onReveal(revealPath) });
      }
      if (target) {
        items.push(
          { type: 'separator' },
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
      // origin=右键起源行：菜单 Esc 关闭后焦点回得来、该元素上的按下不算 outside-dismiss。
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: buildMenuItems(target),
        origin: event.currentTarget as HTMLElement,
      });
    },
    [buildMenuItems, fileActions, projectPath],
  );

  // 文件夹行 hover 出的新建按钮：与右键菜单同一套动作，只是不必先记住有右键这回事。
  const newEntryInDir = useCallback<NodeNewEntryHandler>(
    (kind, dir) => {
      if (!fileActions) return;
      void (kind === 'file' ? fileActions.onNewFile(dir) : fileActions.onNewFolder(dir));
    },
    [fileActions],
  );

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* 文件树 */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain py-2"
        data-testid="file-list"
        data-project-path={projectPath ?? ''}
        onContextMenu={(event) => openMenu(event, null)}
      >
        {!projectPath ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-subtle">尚未打开作品</p>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-sm text-subtle">加载中…</div>
        ) : error ? (
          <PanelError
            compact
            title="读取作品文件失败"
            hint="作品文件夹可能已被移动、重命名或正被其他程序占用。"
            detail={error}
            onRetry={() => setRetryNonce((value) => value + 1)}
          />
        ) : tree.length === 0 ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-subtle">空空如也</p>
            <p className="mt-1 text-3xs text-subtle">右键可新建文件 / 文件夹</p>
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
                  onNodeNewEntry={fileActions ? newEntryInDir : undefined}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
          triggerRef={{ current: menu.origin }}
        />
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
  onNodeNewEntry,
}: {
  node: ProjectTreeNode;
  level: number;
  currentFile: string | null;
  previewFile: string | null;
  onFileSelect: (filePath: string) => void;
  onFilePreview?: (filePath: string) => void;
  onNodeContextMenu?: NodeContextMenuHandler;
  onNodeNewEntry?: NodeNewEntryHandler;
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
        {/* 行容器是 div 而非 button：右侧要挂新建按钮，button 不能嵌套 button。 */}
        <div
          onContextMenu={(event) => onNodeContextMenu?.(event, { path: node.path, isDir: true })}
          className="sf-tree-row text-muted transition-colors hover:bg-elevated group cursor-pointer"
          data-testid="tree-folder-row"
          data-folder-path={node.path}
        >
          <PlainButton
            onClick={handleToggle}
            className="flex h-full min-w-0 flex-1 items-center text-left"
            aria-expanded={isOpen}
          >
            <div className="flex items-center h-full pl-[4px]">{indentBlocks}</div>

            <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
              <ChevronRight
                size={14}
                strokeWidth={1.7}
                className={`transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`}
              />
            </div>
            <span
              className={`mr-1.5 flex h-4 w-4 flex-shrink-0 items-center justify-center ${isOpen ? 'text-foreground' : 'text-muted group-hover:text-foreground'}`}
            >
              <Folder size={13} strokeWidth={1.7} />
            </span>

            <span className="min-w-0 flex-1 truncate text-sm" title={node.path}>
              {node.name}
            </span>
          </PlainButton>

          {onNodeNewEntry && (
            <span className={`flex flex-shrink-0 items-center gap-px ${revealOnHover()}`}>
              <IconButton
                size="compact"
                label={`在 ${node.name} 下新建文件`}
                tooltip={`在「${node.name}」下新建文件`}
                icon={<FilePlus size={13} strokeWidth={1.6} />}
                data-testid="tree-folder-new-file"
                onClick={(event) => {
                  event.stopPropagation();
                  // 新建的东西要看得见：折叠着的文件夹先展开再建。
                  setIsOpen(true);
                  onNodeNewEntry('file', node.path);
                }}
              />
              <IconButton
                size="compact"
                label={`在 ${node.name} 下新建文件夹`}
                tooltip={`在「${node.name}」下新建文件夹`}
                icon={<FolderPlus size={13} strokeWidth={1.6} />}
                data-testid="tree-folder-new-folder"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsOpen(true);
                  onNodeNewEntry('folder', node.path);
                }}
              />
            </span>
          )}
        </div>
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
                onNodeNewEntry={onNodeNewEntry}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <PlainButton
      onClick={handleSelect}
      onDoubleClick={handlePin}
      onContextMenu={(event) => onNodeContextMenu?.(event, { path: node.path, isDir: false })}
      data-testid="file-item"
      data-file-name={node.name}
      data-file-path={node.path}
      data-preview={isPreview ? 'true' : undefined}
      className={`
        sf-tree-row select-none transition-colors group cursor-pointer
        ${
          isActive
            ? 'bg-elevated text-foreground'
            : isPreview
              ? 'bg-elevated/60 italic text-foreground'
              : 'text-muted hover:bg-elevated'
        }
      `}
    >
      <div className="flex items-center h-full pl-[4px]">{indentBlocks}</div>

      <div className="w-5 h-full flex items-center justify-center flex-shrink-0 ml-[2px]">
        <FileText
          size={13}
          strokeWidth={1.7}
          className={isActive ? 'text-accent' : 'text-muted opacity-70 group-hover:opacity-100'}
        />
      </div>

      <span className="min-w-0 flex-1 truncate text-sm" title={node.path}>
        {node.name}
      </span>
    </PlainButton>
  );
});
