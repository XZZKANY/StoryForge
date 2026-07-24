/**
 * 中栏编辑器页签行（h-shell-row，与左右两栏头部行同高对齐）：设置 / 文件 / 预览页签 + 右端「…」文件操作菜单（Q3a）。
 * 预览页签为斜体，单击别的文件会覆盖它；双击预览页签固定（对齐原型 pane-preview 语义）。
 * 激活页签向下压 1px，用 --background 底线冲掉容器底边，与编辑区无缝一体。
 * Q3a：导出/历史/保存/关闭其他/关闭全部收进「…」溢出菜单（删掉 Editor 自己的第二条工具行，
 * 文件名不再出现两次）；保存走 REQUEST_SAVE、导出走 EXPORT_CURRENT_FILE、历史/分支走编辑器命令事件。
 */
import { useRef, useState } from 'react';
import { basename } from '../app/helpers';
import { MoreHorizontal, Settings, X } from '../icons/shell-icons';
import { useDismissableMenu } from './useDismissableMenu';

export type CenterTab = 'settings' | 'file' | 'preview';

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
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={title}
      onClick={onActivate}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      className={`group flex flex-shrink-0 cursor-pointer select-none items-center gap-2 px-3.5 text-[12px] ${
        preview ? 'italic' : ''
      } ${
        active
          ? 'relative z-[2] -mb-px border-b border-background bg-background font-medium text-foreground shadow-[inset_0_2px_0_rgb(var(--agent))]'
          : preview
            ? 'text-subtle hover:text-muted'
            : 'text-subtle hover:text-muted'
      }`}
    >
      {icon}
      <span className="max-w-[180px] truncate">{label}</span>
      {onClose && (
        <button
          className="relative flex h-4 w-4 items-center justify-center text-subtle hover:text-foreground"
          title={dirty ? '关闭（有未保存修改）' : '关闭'}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          {dirty && (
            <span
              className="h-2 w-2 rounded-full bg-foreground group-hover:hidden"
              data-testid="editor-tab-dirty"
            />
          )}
          <X
            className={
              dirty ? 'hidden group-hover:block' : active ? '' : 'opacity-0 group-hover:opacity-100'
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
  settingsOpen,
  activeTab,
  activeReadOnly = false,
  onFocusFile,
  onFocusPreview,
  onPinPreview,
  onFocusSettings,
  onCloseFile,
  onClosePreview,
  onCloseSettings,
  onSaveActive,
  onToggleHistory,
  onExportActive,
  onToggleBranchView,
  onCloseOthers,
  onCloseAll,
}: {
  openFiles: string[];
  activeFile: string | null;
  previewFile: string | null;
  dirtyFiles: ReadonlySet<string>;
  settingsOpen: boolean;
  activeTab: CenterTab | null;
  activeReadOnly?: boolean;
  onFocusFile: (path: string) => void;
  onFocusPreview: () => void;
  onPinPreview: () => void;
  onFocusSettings: () => void;
  onCloseFile: (path: string) => void;
  onClosePreview?: () => void;
  onCloseSettings: () => void;
  // Q3a 文件操作（收进「…」菜单，作用于当前活动文件页签）。
  onSaveActive?: () => void;
  onToggleHistory?: () => void;
  onExportActive?: () => void;
  onToggleBranchView?: () => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}) {
  const showPreview = Boolean(previewFile) && !openFiles.includes(previewFile as string);
  const hasFileActions = activeTab === 'file' || activeTab === 'preview';

  return (
    <div
      className="relative flex h-shell-row flex-shrink-0 items-stretch border-b border-border bg-panel"
      data-testid="editor-tabs"
      role="tablist"
      aria-label="打开的文件页签"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const tabEls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
          );
          const idx = tabEls.indexOf(document.activeElement as HTMLElement);
          if (idx === -1) return;
          event.preventDefault();
          const next =
            event.key === 'ArrowRight'
              ? (idx + 1) % tabEls.length
              : (idx - 1 + tabEls.length) % tabEls.length;
          tabEls[next]?.focus();
          tabEls[next]?.click(); // roving：移动焦点同时激活该页签
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
          if (activeTab === 'file' && activeFile) {
            event.preventDefault();
            onCloseFile(activeFile);
          }
        }
      }}
    >
      {/* 页签列表单独包横向滚动容器：多开/长章节名不再把右端徽标 + …菜单挤出屏外。 */}
      <div
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
        data-testid="editor-tab-scroll"
      >
        {settingsOpen && (
          <Tab
            active={activeTab === 'settings'}
            label="设置"
            icon={<Settings size={13} strokeWidth={1.6} />}
            onActivate={onFocusSettings}
            onClose={onCloseSettings}
          />
        )}
        {openFiles.map((path) => (
          <Tab
            key={path}
            active={activeTab === 'file' && path === activeFile}
            label={basename(path)}
            title={path}
            dirty={dirtyFiles.has(path)}
            onActivate={() => onFocusFile(path)}
            onClose={() => onCloseFile(path)}
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
            onClose={onClosePreview}
          />
        )}
      </div>
      {hasFileActions && (
        <div className="flex flex-shrink-0 items-center gap-1.5 border-l border-border pl-1.5 pr-1.5">
          {activeReadOnly && (
            <span
              className="flex items-center whitespace-nowrap rounded-full border border-warning/50 px-2 text-[10.5px] text-warning"
              title="canon 派生缓存由 canon_rebuild 从正文重建，手改无效"
            >
              只读派生文件
            </span>
          )}
          <EditorActionsMenu
            onSaveActive={onSaveActive}
            onToggleHistory={onToggleHistory}
            onExportActive={onExportActive}
            onToggleBranchView={onToggleBranchView}
            onCloseOthers={onCloseOthers}
            onCloseAll={onCloseAll}
          />
        </div>
      )}
    </div>
  );
}

function MenuRow({ label, kbd, onClick }: { label: string; kbd?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-elevated hover:text-foreground"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {kbd && <span className="flex-shrink-0 font-mono text-[10px] text-subtle">{kbd}</span>}
    </button>
  );
}

function EditorActionsMenu({
  onSaveActive,
  onToggleHistory,
  onExportActive,
  onToggleBranchView,
  onCloseOthers,
  onCloseAll,
}: {
  onSaveActive?: () => void;
  onToggleHistory?: () => void;
  onExportActive?: () => void;
  onToggleBranchView?: () => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismissableMenu(open, () => setOpen(false), triggerRef);
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
        title="文件操作：保存 / 历史 / 导出 …"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} strokeWidth={1.7} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-9 z-40 w-56 rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-dropdown)]"
            data-testid="editor-more-menu"
          >
            <MenuRow label="保存" kbd="Ctrl S" onClick={run(onSaveActive)} />
            <MenuRow label="版本历史" onClick={run(onToggleHistory)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="导出当前稿" onClick={run(onExportActive)} />
            <MenuRow label="剧情分支画布" onClick={run(onToggleBranchView)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="关闭其他页签" onClick={run(onCloseOthers)} />
            <MenuRow label="关闭全部页签" onClick={run(onCloseAll)} />
          </div>
        </>
      )}
    </div>
  );
}
