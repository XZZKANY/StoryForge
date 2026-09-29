import { FloatingSurface } from '../ui';
/**
 * 中栏编辑器页签行（h-shell-row，与左右两栏头部行同高对齐）：文件 / 预览页签 + 右端「…」文件操作菜单（Q3a）。
 * 预览页签为斜体，单击别的文件会覆盖它；双击预览页签固定（对齐原型 pane-preview 语义）。
 * 页签用内收圆角与选中填充标识，不再以横竖边线切割正文。
 * Q3a：导出/历史/保存/关闭其他/关闭全部收进「…」溢出菜单（删掉 Editor 自己的第二条工具行，
 * 文件名不再出现两次）；保存走 REQUEST_SAVE、导出走 EXPORT_CURRENT_FILE、历史走编辑器命令事件。
 */
import { useEffect, useRef, useState } from 'react';
import { basename } from '../app/helpers';
import { MoreHorizontal, Sparkles, X } from '../icons/shell-icons';
import { ContextMenu } from './ContextMenu';

export type CenterTab = 'file' | 'preview';

function Tab({
  active,
  preview,
  dirty,
  label,
  title,
  icon,
  onActivate,
  onDoubleClick,
  onRequestClose,
  onContextMenu,
  dragId,
  onReorder,
}: {
  active: boolean;
  preview?: boolean;
  dirty?: boolean;
  label: string;
  title?: string;
  icon?: React.ReactNode;
  onActivate: () => void;
  onDoubleClick?: () => void;
  onRequestClose?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  // 文件页签可拖拽重排：dragId=该文件路径，onReorder(from,to) 搬动 openFiles 次序。
  dragId?: string;
  onReorder?: (from: string, to: string) => void;
}) {
  const draggable = Boolean(dragId && onReorder);
  return (
    <div
      data-tab-shell={dragId ?? label}
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) => {
              event.dataTransfer.setData('text/plain', dragId as string);
              event.dataTransfer.effectAllowed = 'move';
            }
          : undefined
      }
      onDragOver={
        draggable
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          : undefined
      }
      onDrop={
        draggable
          ? (event) => {
              event.preventDefault();
              const from = event.dataTransfer.getData('text/plain');
              if (from && from !== dragId) onReorder?.(from, dragId as string);
            }
          : undefined
      }
      className={`group relative my-1 flex flex-shrink-0 items-stretch rounded-md select-none ${
        draggable ? 'active:cursor-grabbing' : ''
      } ${
        active
          ? 'bg-elevated font-medium text-foreground'
          : 'text-subtle hover:bg-elevated/60 hover:text-muted'
      }`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        title={title}
        data-tab-path={dragId ?? label}
        onClick={onActivate}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
          }
        }}
        className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent pl-3 pr-2 text-xs transition-colors ${preview ? 'italic' : ''}`}
      >
        {icon}
        <span className="max-w-[180px] truncate">{label}</span>
      </button>
      {onRequestClose && (
        <button
          type="button"
          data-testid="editor-tab-close"
          aria-label={dirty ? `关闭 ${label}（有未保存修改）` : `关闭 ${label}`}
          // hover 底色要与页签底色拉开：激活页签本身是 bg-elevated，这里用
          // bg-border-strong/40 才能在激活页签上看出「悬停在关闭钮上」。
          className="relative mr-2 flex h-6 w-6 flex-shrink-0 self-center items-center justify-center rounded-sm text-subtle transition-colors hover:bg-border-strong/40 hover:text-foreground"
          title={dirty ? '关闭（有未保存修改）· Ctrl W' : '关闭 · Ctrl W'}
          onClick={onRequestClose}
        >
          {dirty && (
            <span
              className="absolute h-2 w-2 rounded-full bg-agent transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
              data-testid="editor-tab-dirty"
            />
          )}
          <X
            className={`transition-opacity ${
              dirty || !active
                ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                : ''
            }`}
            size={11}
            strokeWidth={2}
          />
        </button>
      )}
    </div>
  );
}

export function EditorTabs({
  openFiles,
  activeFile,
  previewFile,
  dirtyFiles,
  activeTab,
  activeReadOnly = false,
  permissionProfile,
  onOverview,
  onFocusFile,
  onReorderFiles,
  onFocusPreview,
  onPinPreview,
  onCloseFile,
  onClosePreview,
  onSaveActive,
  onToggleHistory,
  onExportActive,
  onPolishActive,
  onCloseOthers,
  onCloseAll,
}: {
  openFiles: string[];
  activeFile: string | null;
  previewFile: string | null;
  dirtyFiles: ReadonlySet<string>;
  activeTab: CenterTab | null;
  activeReadOnly?: boolean;
  /** P2-D：项目级权限档位（read/ask/auto/full），仅用于编辑器区被动指示。业务判定走后端。 */
  permissionProfile?: 'read' | 'ask' | 'auto' | 'full';
  onOverview?: () => void;
  onFocusFile: (path: string) => void;
  onReorderFiles?: (from: string, to: string) => void;
  onFocusPreview: () => void;
  onPinPreview: () => void;
  onCloseFile: (path: string) => void;
  onClosePreview?: () => void;
  // Q3a 文件操作（收进「…」菜单，作用于当前活动文件页签）。
  onSaveActive?: () => void;
  onToggleHistory?: () => void;
  onExportActive?: () => void;
  onPolishActive?: (useMainModel: boolean) => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}) {
  const showPreview = Boolean(previewFile) && !openFiles.includes(previewFile as string);
  const hasFileActions = activeTab === 'file' || activeTab === 'preview';
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    path: string;
    origin: HTMLElement;
  } | null>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const pendingCloseFocusRef = useRef<{
    closedPath: string;
    fallbackPath: string | null;
    focusOwner: Element | null;
  } | null>(null);
  const visibleTabCount = openFiles.length + (showPreview ? 1 : 0);
  const tabElements = () =>
    Array.from(tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
  const requestClose = (path: string, close: () => void) => {
    const tabs = tabElements();
    const currentIndex = tabs.findIndex((tab) => tab.dataset.tabPath === path);
    const previous = currentIndex > 0 ? tabs[currentIndex - 1]?.dataset.tabPath : undefined;
    const next = currentIndex >= 0 ? tabs[currentIndex + 1]?.dataset.tabPath : undefined;
    pendingCloseFocusRef.current = {
      closedPath: path,
      fallbackPath: previous ?? next ?? null,
      focusOwner: document.activeElement,
    };
    close();
  };
  useEffect(() => {
    const pending = pendingCloseFocusRef.current;
    if (!pending) return;
    // 脏文件确认可能被取消；目标仍在列表时保留焦点和 pending，不抢走后续输入。
    if (tabElements().some((tab) => tab.dataset.tabPath === pending.closedPath)) return;
    const target = pending.fallbackPath
      ? tabElements().find((tab) => tab.dataset.tabPath === pending.fallbackPath)
      : undefined;
    pendingCloseFocusRef.current = null;
    // A dirty-file confirmation/save can finish after the author has moved to
    // another input or tab. Restore only the original focus, or the body fallback
    // produced when that focused close control/dialog was removed.
    if (document.activeElement !== document.body && document.activeElement !== pending.focusOwner)
      return;
    if (target) {
      target.focus();
      return;
    }
    // 最后一个页签关闭时，回到页签行本身而不是把焦点丢到文档。
    tablistRef.current?.focus();
  }, [openFiles, previewFile, showPreview]);
  const openTabMenu = (event: React.MouseEvent, path: string) => {
    event.preventDefault();
    // 记下右键起源页签：菜单 Esc 关闭后焦点回得来、触发元素上的按下不算 outside-dismiss。
    setTabMenu({
      x: event.clientX,
      y: event.clientY,
      path,
      origin: event.currentTarget as HTMLElement,
    });
  };

  return (
    <div
      className="relative flex h-shell-row flex-shrink-0 items-stretch gap-1 bg-background px-1"
      data-testid="editor-tabs"
    >
      {onOverview && (
        <button
          type="button"
          onClick={onOverview}
          className="my-1 flex flex-shrink-0 items-center gap-1 rounded-md px-3 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
          data-testid="back-to-book-overview"
          aria-label="返回作品总览"
          title="返回作品总览"
        >
          <span aria-hidden="true">←</span>
          <span>作品总览</span>
        </button>
      )}
      {/* 页签列表单独包横向滚动容器：多开/长章节名不再把右端徽标 + …菜单挤出屏外。 */}
      <div
        ref={tablistRef}
        className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto"
        data-testid="editor-tab-scroll"
        role="tablist"
        aria-label="打开的文件页签"
        tabIndex={visibleTabCount === 0 ? 0 : -1}
        onKeyDown={(event) => {
          if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'Home' ||
            event.key === 'End'
          ) {
            const tabEls = tabElements();
            const idx = tabEls.indexOf(document.activeElement as HTMLElement);
            if (idx === -1) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabEls.length - 1
                  : event.key === 'ArrowRight'
                    ? (idx + 1) % tabEls.length
                    : (idx - 1 + tabEls.length) % tabEls.length;
            tabEls[next]?.focus();
            tabEls[next]?.click(); // roving：移动焦点同时激活该页签
          } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
            if (activeTab === 'file' && activeFile) {
              event.preventDefault();
              requestClose(activeFile, () => onCloseFile(activeFile));
            }
          }
        }}
      >
        {openFiles.map((path) => (
          <Tab
            key={path}
            active={activeTab === 'file' && path === activeFile}
            label={basename(path)}
            title={path}
            dirty={dirtyFiles.has(path)}
            onActivate={() => onFocusFile(path)}
            onRequestClose={() => requestClose(path, () => onCloseFile(path))}
            onContextMenu={(event) => openTabMenu(event, path)}
            dragId={path}
            onReorder={onReorderFiles}
          />
        ))}
        {showPreview && previewFile && (
          <Tab
            active={activeTab === 'preview'}
            preview
            label={basename(previewFile)}
            title={`预览：单击别的文件会覆盖它；双击固定 · ${previewFile}`}
            onActivate={onFocusPreview}
            onDoubleClick={onPinPreview}
            onRequestClose={
              onClosePreview ? () => requestClose(previewFile, onClosePreview) : undefined
            }
            dragId={previewFile}
          />
        )}
      </div>
      {hasFileActions && (
        <div className="flex flex-shrink-0 items-center gap-1.5 pl-1.5 pr-1.5">
          {activeReadOnly && (
            <span
              className="flex items-center whitespace-nowrap rounded-full border border-warning/50 px-2 text-3xs text-warning"
              title="canon 派生缓存由 canon_rebuild 从正文重建，手改无效"
            >
              只读派生文件
            </span>
          )}
          {permissionProfile === 'read' && (
            <span
              className="flex items-center whitespace-nowrap rounded-full border border-border px-2 text-3xs text-muted"
              title="当前项目权限档位为「只读」：Agent 不会发起修订。可在对话栏档位切换处调整。"
              data-testid="editor-permission-read"
            >
              只读档
            </span>
          )}
          {(permissionProfile === 'auto' || permissionProfile === 'full') && (
            <span
              className="flex items-center whitespace-nowrap rounded-full border border-agent/40 px-2 text-3xs text-agent"
              title={
                permissionProfile === 'auto'
                  ? '当前项目权限档位为「自动」：补丁不经确认直接落盘（写前留快照，可撤销）。'
                  : '当前项目权限档位为「完全放行」：补丁与长任务均不再二次确认。'
              }
              data-testid="editor-permission-auto"
            >
              {permissionProfile === 'auto' ? '自动档' : '完全放行'}
            </span>
          )}
          {!activeReadOnly && permissionProfile !== 'read' && onPolishActive && (
            <PolishActionsMenu onPolishActive={onPolishActive} />
          )}
          <EditorActionsMenu
            onSaveActive={onSaveActive}
            onToggleHistory={onToggleHistory}
            onExportActive={onExportActive}
            onCloseActive={
              activeTab === 'file' && activeFile
                ? () => requestClose(activeFile, () => onCloseFile(activeFile))
                : undefined
            }
            onCloseOthers={onCloseOthers}
            onCloseAll={onCloseAll}
          />
        </div>
      )}
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={[
            {
              label: '关闭',
              onSelect: () => requestClose(tabMenu.path, () => onCloseFile(tabMenu.path)),
            },
            { label: '关闭其他', onSelect: () => onCloseOthers?.(), disabled: !onCloseOthers },
            { label: '关闭全部', onSelect: () => onCloseAll?.(), disabled: !onCloseAll },
          ]}
          onClose={() => setTabMenu(null)}
        />
      )}
    </div>
  );
}

function PolishActionsMenu({
  onPolishActive,
}: {
  onPolishActive: (useMainModel: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const run = (useMainModel: boolean) => {
    setOpen(false);
    onPolishActive(useMainModel);
  };
  return (
    <div className="relative flex items-center">
      <button
        ref={triggerRef}
        type="button"
        data-testid="editor-polish-btn"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-foreground"
        title="润色当前章"
        aria-label="润色当前章"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles size={15} strokeWidth={1.7} />
      </button>
      {open && (
        <>
          <FloatingSurface
            role="menu"
            aria-label="操作"
            triggerRef={triggerRef}
            onDismiss={() => setOpen(false)}
            className="w-52 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"
            data-testid="editor-polish-menu"
          >
            <MenuRow label="使用专用润色模型" onClick={() => run(false)} />
            <MenuRow label="本次使用主模型" onClick={() => run(true)} />
          </FloatingSurface>
        </>
      )}
    </div>
  );
}

function MenuRow({ label, kbd, onClick }: { label: string; kbd?: string; onClick?: () => void }) {
  return (
    <button
      role="menuitem"
      type="button"
      className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs text-muted hover:bg-elevated hover:text-foreground"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {kbd && <span className="flex-shrink-0 font-mono text-3xs text-subtle">{kbd}</span>}
    </button>
  );
}

function EditorActionsMenu({
  onSaveActive,
  onToggleHistory,
  onExportActive,
  onCloseActive,
  onCloseOthers,
  onCloseAll,
}: {
  onSaveActive?: () => void;
  onToggleHistory?: () => void;
  onExportActive?: () => void;
  /** P2-C：暴露 Ctrl+W 的菜单入口（此前仅页签行内 keydown 接管，无可发现 UI）。 */
  onCloseActive?: () => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const run = (handler?: () => void) => () => {
    setOpen(false);
    handler?.();
  };
  return (
    <div className="relative flex items-center">
      <button
        ref={triggerRef}
        type="button"
        data-testid="editor-more-btn"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-foreground"
        title="文件操作：保存/历史/导出…"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} strokeWidth={1.7} />
      </button>
      {open && (
        <>
          <FloatingSurface
            role="menu"
            aria-label="操作"
            triggerRef={triggerRef}
            onDismiss={() => setOpen(false)}
            className="w-56 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"
            data-testid="editor-more-menu"
          >
            <MenuRow label="保存" kbd="Ctrl S" onClick={run(onSaveActive)} />
            <MenuRow label="版本历史" kbd="Ctrl Shift H" onClick={run(onToggleHistory)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="导出当前稿" onClick={run(onExportActive)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="关闭当前页签" kbd="Ctrl W" onClick={run(onCloseActive)} />
            <MenuRow label="关闭其他页签" onClick={run(onCloseOthers)} />
            <MenuRow label="关闭全部页签" onClick={run(onCloseAll)} />
          </FloatingSurface>
        </>
      )}
    </div>
  );
}
