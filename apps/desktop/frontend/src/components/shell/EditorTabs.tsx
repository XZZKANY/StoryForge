/**
 * 中栏编辑器页签行（36px）：设置 / 文件 / 预览页签 + 右侧面板切换 etool。
 * 预览页签为斜体，单击别的文件会覆盖它；双击预览页签固定（对齐原型 pane-preview 语义）。
 * 激活页签向下压 1px，用 --background 底线冲掉容器底边，与编辑区无缝一体。
 */
import { basename } from '../app/helpers';
import { PanelRight, Settings, X } from '../icons/shell-icons';

export type CenterTab = 'settings' | 'file' | 'preview';

function Tab({
  active,
  preview,
  label,
  title,
  icon,
  onActivate,
  onDoubleClick,
  onClose,
}: {
  active: boolean;
  preview?: boolean;
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
      title={title}
      onClick={onActivate}
      onDoubleClick={onDoubleClick}
      className={`group flex cursor-pointer select-none items-center gap-2 px-3.5 text-[12px] ${
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
          className="text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          title="关闭"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X size={11} strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
}

export function EditorTabs({
  currentFile,
  previewFile,
  settingsOpen,
  activeTab,
  rightCollapsed,
  onFocusFile,
  onFocusPreview,
  onPinPreview,
  onFocusSettings,
  onCloseFile,
  onCloseSettings,
  onToggleRight,
}: {
  currentFile: string | null;
  previewFile: string | null;
  settingsOpen: boolean;
  activeTab: CenterTab | null;
  rightCollapsed: boolean;
  onFocusFile: () => void;
  onFocusPreview: () => void;
  onPinPreview: () => void;
  onFocusSettings: () => void;
  onCloseFile: () => void;
  onCloseSettings: () => void;
  onToggleRight: () => void;
}) {
  const showPreview = Boolean(previewFile) && previewFile !== currentFile;

  return (
    <div
      className="relative flex h-9 flex-shrink-0 items-stretch border-b border-border bg-panel"
      data-testid="editor-tabs"
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
      {currentFile && (
        <Tab
          active={activeTab === 'file'}
          label={basename(currentFile)}
          title={currentFile}
          onActivate={onFocusFile}
          onClose={onCloseFile}
        />
      )}
      {showPreview && previewFile && (
        <Tab
          active={activeTab === 'preview'}
          preview
          label={basename(previewFile)}
          title={`预览：单击别的文件会覆盖它；双击固定 · ${previewFile}`}
          onActivate={onFocusPreview}
          onDoubleClick={onPinPreview}
        />
      )}
      <div className="flex-1" />
      <button
        className="my-auto mr-2 flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-[11.5px] text-muted hover:bg-elevated"
        title={rightCollapsed ? '展开 Agent 面板' : '收起 Agent 面板'}
        onClick={onToggleRight}
      >
        <PanelRight size={13} strokeWidth={1.6} />
        面板
      </button>
    </div>
  );
}
