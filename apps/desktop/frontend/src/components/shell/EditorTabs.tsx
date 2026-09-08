/**
 * 中栏编辑器页签行（h-shell-row，与左右两栏头部行同高对齐）：文件 / 预览页签 + 右端「…」文件操作菜单（Q3a）。
 * 预览页签为斜体，单击别的文件会覆盖它；双击预览页签固定（对齐原型 pane-preview 语义）。
 * 激活页签向下压 1px，用 --background 底线冲掉容器底边，与编辑区无缝一体。
 * Q3a：导出/历史/保存/关闭其他/关闭全部收进「…」溢出菜单（删掉 Editor 自己的第二条工具行，
 * 文件名不再出现两次）；保存走 REQUEST_SAVE、导出走 EXPORT_CURRENT_FILE、历史走编辑器命令事件。
 */
import { useId, useRef, useState, type RefObject } from 'react';
import { basename } from '../app/helpers';
import { MoreHorizontal, Sparkles, X } from '../icons/shell-icons';
import { ContextMenu } from './ContextMenu';
import { useMenuKeyboard } from './useMenuKeyboard';

export type CenterTab = 'file' | 'preview';

export function editorTabId(path: string): string {
  return `editor-tab-${encodeURIComponent(path)}`;
}

function Tab({
  active,
  preview,
  dirty,
  label,
  title,
  icon,
  onActivate,
  onDoubleClick,
  onClose,
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
  onClose?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  // 文件页签可拖拽重排：dragId=该文件路径，onReorder(from,to) 搬动 openFiles 次序。
  dragId?: string;
  onReorder?: (from: string, to: string) => void;
}) {
  const draggable = Boolean(dragId && onReorder);
  const tabClass = `flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 px-3.5 text-xs ${
    preview ? 'italic' : ''
  }`;
  const wrapperClass = `group flex h-full flex-shrink-0 items-stretch ${
    active
      ? 'relative z-[2] -mb-px border-b border-background bg-background font-medium text-foreground shadow-[inset_0_2px_0_rgb(var(--agent))]'
      : 'text-subtle hover:text-muted'
  }`;
  return (
    <div className={wrapperClass}>
      <div
        role="tab"
        id={title ? editorTabId(title) : undefined}
        aria-selected={active}
        aria-controls="editor-panel"
        tabIndex={active ? 0 : -1}
        title={title}
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
        onClick={onActivate}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
          }
        }}
        className={tabClass}
      >
        {icon}
        <span className="max-w-[180px] truncate">{label}</span>
      </div>
      {onClose && (
        <button
          type="button"
          tabIndex={active ? 0 : -1}
          className="relative flex h-4 w-4 self-center items-center justify-center text-subtle hover:text-foreground"
          title={dirty ? '关闭（有未保存修改）' : '关闭'}
          aria-label={`关闭 ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          {dirty && (
            <span
              className="h-2 w-2 rounded-full bg-foreground group-hover:hidden group-focus-within:hidden"
              data-testid="editor-tab-dirty"
            />
          )}
          <X
            className={
              dirty
                ? 'hidden group-hover:block group-focus-within:block'
                : active
                  ? ''
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
            }
            size={11}
            strokeWidth={1.7}
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
  onFocusFile,
  onReorderFiles,
  onFocusPreview,
  onPinPreview,
  onCloseFile,
  onClosePreview,
  onSaveActive,
  onToggleHistory,
  historyTriggerRef,
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
  onFocusFile: (path: string) => void;
  onReorderFiles?: (from: string, to: string) => void;
  onFocusPreview: () => void;
  onPinPreview: () => void;
  onCloseFile: (path: string) => void | Promise<void>;
  onClosePreview?: () => void;
  // Q3a 文件操作（收进「…」菜单，作用于当前活动文件页签）。
  onSaveActive?: () => void;
  onToggleHistory?: () => void;
  historyTriggerRef?: RefObject<HTMLButtonElement>;
  onExportActive?: () => void;
  onPolishActive?: (useMainModel: boolean) => void;
  onCloseOthers?: (keepPath?: string) => void | Promise<void>;
  onCloseAll?: () => void | Promise<void>;
}) {
  const showPreview = Boolean(previewFile) && !openFiles.includes(previewFile as string);
  const hasFileActions = activeTab === 'file' || activeTab === 'preview';
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    path: string;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const closeWithFocus = (action: () => void | Promise<void>) => {
    const origin = document.activeElement;
    const list = tabListRef.current;
    const restore = origin instanceof HTMLElement && list?.contains(origin);
    void (async () => {
      try {
        await action();
      } catch (error) {
        console.error('关闭页签失败', error);
      }
      if (restore) {
        // Closing may wait for a dirty-file dialog; focus follows the resulting render.
        requestAnimationFrame(() => {
          if (!list || tabListRef.current !== list) return;
          if (document.activeElement !== document.body && document.activeElement !== origin) return;
          const target = origin.isConnected
            ? origin
            : (list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? list);
          target.focus({ preventScroll: true });
        });
      }
    })();
  };
  const openTabMenu = (event: React.MouseEvent, path: string) => {
    event.preventDefault();
    setTabMenu({
      x: event.clientX,
      y: event.clientY,
      path,
      // 页签本身是 roving-tabindex 的 focusable role=tab；显式记录它，
      // 因为鼠标右键不会在所有平台上自动聚焦事件目标。
      returnFocus: event.currentTarget instanceof HTMLElement ? event.currentTarget : null,
    });
  };

  return (
    <div
      className="relative flex h-shell-row flex-shrink-0 items-stretch border-b border-border bg-panel"
      data-testid="editor-tabs"
    >
      {/* 工具菜单不属于 tablist；把语义和 roving 键盘范围限制在实际页签滚动区。 */}
      <div
        ref={tabListRef}
        tabIndex={-1}
        role="tablist"
        aria-label="打开的文件页签"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            const tabEls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
            );
            const idx = tabEls.indexOf(document.activeElement as HTMLElement);
            if (idx === -1 || tabEls.length === 0) return;
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
              closeWithFocus(() => onCloseFile(activeFile));
            } else if (activeTab === 'preview' && onClosePreview) {
              event.preventDefault();
              closeWithFocus(onClosePreview);
            }
          }
        }}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
        data-testid="editor-tab-scroll"
      >
        {openFiles.map((path) => (
          <Tab
            key={path}
            active={activeTab === 'file' && path === activeFile}
            label={basename(path)}
            title={path}
            dirty={dirtyFiles.has(path)}
            onActivate={() => onFocusFile(path)}
            onClose={() => closeWithFocus(() => onCloseFile(path))}
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
            onClose={onClosePreview ? () => closeWithFocus(onClosePreview) : undefined}
          />
        )}
      </div>
      {hasFileActions && (
        <div className="flex flex-shrink-0 items-center gap-1.5 border-l border-border pl-1.5 pr-1.5">
          {activeReadOnly && (
            <span
              className="flex items-center whitespace-nowrap rounded-full border border-warning/50 px-2 text-3xs text-warning"
              title="canon 派生缓存由 canon_rebuild 从正文重建，手改无效"
            >
              只读派生文件
            </span>
          )}
          {!activeReadOnly && onPolishActive && (
            <PolishActionsMenu onPolishActive={onPolishActive} />
          )}
          <EditorActionsMenu
            historyTriggerRef={historyTriggerRef}
            onSaveActive={onSaveActive}
            onToggleHistory={onToggleHistory}
            onExportActive={onExportActive}
            onCloseOthers={onCloseOthers ? () => closeWithFocus(onCloseOthers) : undefined}
            onCloseAll={onCloseAll ? () => closeWithFocus(onCloseAll) : undefined}
          />
        </div>
      )}
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          returnFocus={tabMenu.returnFocus}
          items={[
            { label: '关闭', onSelect: () => closeWithFocus(() => onCloseFile(tabMenu.path)) },
            {
              label: '关闭其他',
              onSelect: () => closeWithFocus(() => onCloseOthers?.(tabMenu.path)),
              disabled: !onCloseOthers,
            },
            {
              label: '关闭全部',
              onSelect: () => closeWithFocus(() => onCloseAll?.()),
              disabled: !onCloseAll,
            },
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
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dismiss = useMenuKeyboard(open, menuRef, () => setOpen(false), triggerRef);
  const run = (useMainModel: boolean) => {
    dismiss();
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
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles size={15} strokeWidth={1.7} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="润色当前章"
            tabIndex={-1}
            className="absolute right-0 top-9 z-40 w-52 rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-dropdown)]"
            data-testid="editor-polish-menu"
          >
            <MenuRow label="使用专用润色模型" onClick={() => run(false)} />
            <MenuRow label="本次使用主模型" onClick={() => run(true)} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuRow({ label, kbd, onClick }: { label: string; kbd?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={!onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs text-muted hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {kbd && <span className="flex-shrink-0 font-mono text-3xs text-subtle">{kbd}</span>}
    </button>
  );
}

function EditorActionsMenu({
  historyTriggerRef: externalTriggerRef,
  onSaveActive,
  onToggleHistory,
  onExportActive,
  onCloseOthers,
  onCloseAll,
}: {
  historyTriggerRef?: RefObject<HTMLButtonElement>;
  onSaveActive?: () => void;
  onToggleHistory?: () => void;
  onExportActive?: () => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef ?? ownTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const dismiss = useMenuKeyboard(open, menuRef, () => setOpen(false), triggerRef);
  const run = (handler?: () => void) =>
    handler
      ? () => {
          dismiss();
          handler?.();
        }
      : undefined;
  return (
    <div className="relative flex items-center">
      <button
        ref={triggerRef}
        type="button"
        data-testid="editor-more-btn"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-foreground"
        title="文件操作：保存 / 历史 / 导出 …"
        aria-label="文件操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} strokeWidth={1.7} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="文件操作"
            tabIndex={-1}
            className="absolute right-0 top-9 z-40 w-56 rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-dropdown)]"
            data-testid="editor-more-menu"
          >
            <MenuRow label="保存" kbd="Ctrl S" onClick={run(onSaveActive)} />
            <MenuRow label="版本历史" onClick={run(onToggleHistory)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="导出当前稿" onClick={run(onExportActive)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="关闭其他页签" onClick={run(onCloseOthers)} />
            <MenuRow label="关闭全部页签" onClick={run(onCloseAll)} />
          </div>
        </>
      )}
    </div>
  );
}
