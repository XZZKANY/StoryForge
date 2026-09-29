import { FloatingSurface } from '../ui';
/**
 * 侧面板：宽度可拖（右缘把手，双击复位），全左栏共享一份并持久化到设置
 * （约束见 lib/side-panel-width.ts；旧按视图设置加载时迁移）。
 * 切换视图只换内容 pane，右边界不动，编辑区不跳。
 *
 * 视觉分层：本面板是覆盖在 rail（一级导航，画布色、贯穿全高）上方的内容层——
 * 左缘上下两角 rounded-l-xl 向内收，切口透出底层 rail 同色背景；overflow-hidden
 * 把内部 hover 行裁进圆角；shadow-panel-lift 给一点浮起纵深，z-10 保证软影盖过 rail。
 *
 * 视图顺序即写作顺序（见 useShellState 的 SIDE_PANEL_VIEWS）：
 * - book：封面 / 书名 / 简介 / 题材 + 全书与今日进度 + 大纲跳转 + 灵感速记（Ctrl Shift B）
 * - manuscript：按阅读序的章节列表 + 模型这轮拿到的作品底座（Ctrl Shift M）
 * - explorer：项目 + 文件树（文件搜索走顶栏命令面板 Ctrl P）
 * - search：正文全文搜索（Ctrl Shift F）
 * - observatory：世界线观测镜（Ctrl Shift O / 活动栏雷达图标）
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  clampSidePanelWidth,
  draggedSidePanelWidth,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
} from '../../lib/side-panel-width';
import { StoryNavigator } from '../StoryNavigator';
import { basename } from '../app/helpers';
import type { FileTreeActions } from '../app/useFileTreeActions';
import type { SidePanelView } from './useShellState';
import { ChevronDown, FilePlus, FolderOpen, FolderPlus, X } from '../icons/shell-icons';

type SidePanelProps = {
  view: SidePanelView;
  projects: string[];
  activeProject: string | null;
  currentFile: string | null;
  previewFile: string | null;
  projectRefreshVersion: number;
  onSelectProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
  onOpenProject: () => void;
  onNewFile: (projectPath?: string) => void;
  onFileSelect: (filePath: string) => void;
  onFilePreview: (filePath: string) => void;
  fileActions?: FileTreeActions;
  // 作品 / 观测镜 / 搜索 / 手稿视图内容由 AppShell 注入（数据在各自 hook，面板只管容器）。
  book?: ReactNode;
  observatory?: ReactNode;
  search?: ReactNode;
  manuscript?: ReactNode;
  knowledge?: ReactNode;
  /** 全左栏共享的已保存宽度；防御性夹限防手改设置。 */
  width: number;
  /** 仅限制当前显示；窗口恢复后继续使用作者保存的宽度。 */
  maxWidth?: number;
  onWidthChange: (width: number) => void;
};

export function SidePanel(props: SidePanelProps) {
  const panelId = useId();
  const savedWidth = clampSidePanelWidth(props.width);
  const widthLimit = clampSidePanelWidth(props.maxWidth ?? SIDE_PANEL_WIDTH_MAX);
  // 拖拽中的宽度只放本地：每帧写进设置会把 localStorage 刷爆，松手才落。
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const displayWidth = Math.min(dragWidth ?? savedWidth, widthLimit);
  const stopResizeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopResizeRef.current?.(), []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopResizeRef.current?.();
    const startX = event.clientX;
    const startWidth = displayWidth;
    setDragWidth(startWidth);
    const widthAt = (clientX: number) =>
      Math.min(widthLimit, draggedSidePanelWidth(startWidth, clientX - startX));
    const onMove = (move: PointerEvent) => {
      setDragWidth(widthAt(move.clientX));
    };
    const onUp = (up: PointerEvent) => {
      stopResizeRef.current?.();
      setDragWidth(null);
      props.onWidthChange(widthAt(up.clientX));
    };
    const onCancel = () => {
      stopResizeRef.current?.();
      setDragWidth(null);
    };
    stopResizeRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stopResizeRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  return (
    <div
      id={panelId}
      className="relative z-10 flex flex-shrink-0 flex-col overflow-hidden rounded-l-xl bg-panel shadow-panel-lift"
      style={{
        width: `${displayWidth}px`,
      }}
      data-testid="shell-side-panel"
      data-side-view={props.view}
    >
      {/* 右缘拖拽把手：命中区 7px（内收于面板内，overflow-hidden 会裁掉外凸部分），
          hover/焦点/拖拽时才显强调色。双击复位到共享默认宽度。 */}
      <div
        className="sf-panel-resize absolute inset-y-0 right-0 z-20 w-[7px] cursor-col-resize"
        data-testid="side-panel-resize"
        data-resizing={dragWidth !== null}
        role="separator"
        tabIndex={0}
        aria-label="调整侧栏宽度"
        aria-orientation="vertical"
        aria-controls={panelId}
        aria-valuemin={SIDE_PANEL_WIDTH_MIN}
        aria-valuemax={widthLimit}
        aria-valuenow={displayWidth}
        aria-valuetext={`${displayWidth} 像素`}
        title="拖动或左右方向键调整宽度 · Shift 加速 · Enter / 双击复位"
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const step = event.shiftKey ? 50 : 10;
          let next: number;
          switch (event.key) {
            case 'ArrowLeft':
              next = Math.min(widthLimit, draggedSidePanelWidth(displayWidth, -step));
              break;
            case 'ArrowRight':
              next = Math.min(widthLimit, draggedSidePanelWidth(displayWidth, step));
              break;
            case 'Home':
              next = SIDE_PANEL_WIDTH_MIN;
              break;
            case 'End':
              next = widthLimit;
              break;
            case 'Enter':
              next = SIDE_PANEL_WIDTH_DEFAULT;
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
          props.onWidthChange(next);
        }}
        onPointerDown={startResize}
        onDoubleClick={() => props.onWidthChange(SIDE_PANEL_WIDTH_DEFAULT)}
      />
      {/* 五视图 CSS 互斥不卸载：观测镜折叠态、搜索结果、章节滚动位置、简介里没提交的
          编辑，都不因切视图丢失。 */}
      <div
        className={`${props.view === 'book' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        data-testid="side-book-pane"
        hidden={props.view !== 'book'}
      >
        {props.book}
      </div>
      <div
        className={`${props.view === 'explorer' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        hidden={props.view !== 'explorer'}
      >
        <ExplorerView {...props} />
      </div>
      <div
        className={`${props.view === 'search' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        data-testid="side-search-pane"
        hidden={props.view !== 'search'}
      >
        {props.search}
      </div>
      <div
        className={`${props.view === 'manuscript' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        data-testid="side-manuscript-pane"
        hidden={props.view !== 'manuscript'}
      >
        {props.manuscript}
      </div>
      <div
        className={`${props.view === 'knowledge' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        data-testid="side-knowledge-pane"
        hidden={props.view !== 'knowledge'}
      >
        {props.knowledge}
      </div>
      <div
        className={`${props.view === 'observatory' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        data-testid="side-observatory-pane"
        hidden={props.view !== 'observatory'}
      >
        {props.observatory}
      </div>
    </div>
  );
}

function ExplorerView({
  projects,
  activeProject,
  currentFile,
  previewFile,
  projectRefreshVersion,
  onSelectProject,
  onRemoveProject,
  onOpenProject,
  onNewFile,
  onFileSelect,
  onFilePreview,
  fileActions,
}: SidePanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  if (!activeProject) {
    // #4：左栏空态删除——打开项目 / 最近打开只留在中栏欢迎页，避免两个欢迎面重复。
    return <div className="flex-1" data-testid="explorer-empty" />;
  }

  return (
    <>
      <div
        className="relative flex h-shell-row flex-shrink-0 items-center gap-1 px-2 pr-1.5"
        data-testid="side-panel-header"
      >
        <button
          ref={menuTriggerRef}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-xs font-semibold hover:bg-elevated"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="toggle-project-library"
        >
          <span className="min-w-0 flex-1 truncate text-left">{basename(activeProject)}</span>
          <ChevronDown size={13} strokeWidth={1.6} className="text-subtle" />
        </button>
        <button
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          aria-label="在项目根目录新建文件"
          title="在项目根目录新建文件"
          onClick={() => onNewFile(activeProject)}
          data-testid="side-new-file"
        >
          <FilePlus size={14} strokeWidth={1.6} />
        </button>
        {fileActions && (
          <button
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
            aria-label="在项目根目录新建文件夹"
            title="在项目根目录新建文件夹"
            onClick={() => void fileActions.onNewFolder(activeProject)}
            data-testid="side-new-folder"
          >
            <FolderPlus size={14} strokeWidth={1.6} />
          </button>
        )}
        {menuOpen && (
          <>
            <FloatingSurface
              role="menu"
              aria-label="操作"
              triggerRef={menuTriggerRef}
              onDismiss={() => setMenuOpen(false)}
              className="w-64 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"
            >
              {projects.slice(0, 8).map((project) => (
                <div
                  key={project}
                  className={`group flex h-[var(--sf-row-height)] w-full items-center rounded-sm text-xs hover:bg-elevated ${
                    project === activeProject
                      ? 'text-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  <button
                    role="menuitem"
                    className="flex min-w-0 flex-1 items-center px-2 text-left"
                    onClick={() => {
                      setMenuOpen(false);
                      if (project !== activeProject) onSelectProject(project);
                    }}
                    title={project}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {project === activeProject ? '✓ ' : ''}
                      {basename(project)}
                    </span>
                  </button>
                  {project !== activeProject && (
                    <button
                      role="menuitem"
                      className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm text-subtle opacity-40 hover:bg-surface hover:text-foreground hover:opacity-100 focus-visible:bg-surface focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveProject(project);
                      }}
                      title="从最近打开移除"
                      aria-label={`从最近打开移除 ${basename(project)}`}
                    >
                      <X size={13} strokeWidth={1.6} />
                    </button>
                  )}
                </div>
              ))}
              <div className="my-1 mx-1.5 h-px bg-border" />
              <button
                role="menuitem"
                className="flex h-[var(--sf-row-height)] w-full items-center gap-2 rounded-sm px-2 text-xs text-muted hover:bg-elevated hover:text-foreground"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenProject();
                }}
              >
                <FolderOpen size={14} strokeWidth={1.6} />
                打开项目…
              </button>
            </FloatingSurface>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="file-tree-panel">
        <StoryNavigator
          projectPath={activeProject}
          currentFile={currentFile}
          previewFile={previewFile}
          refreshVersion={projectRefreshVersion}
          onFileSelect={onFileSelect}
          onFilePreview={onFilePreview}
          fileActions={fileActions}
        />
      </div>
    </>
  );
}
