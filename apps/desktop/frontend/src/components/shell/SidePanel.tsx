import { FloatingSurface } from '../ui';
/**
 * 侧面板：宽度可拖（右缘把手，双击复位），全左栏共享一份，存成占窗口宽的比例
 * （换算见 lib/workspace-layout.ts；旧像素 / 按视图设置加载时迁移）。
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
import { useId, useRef, useState, type ReactNode } from 'react';
import {
  clampSidePanelWidth,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
} from '../../lib/side-panel-width';
import { usePanelResize } from './usePanelResize';
import { StoryNavigator } from '../StoryNavigator';
import { basename } from '../app/helpers';
import { isSameOrInsidePath } from '../app/editor-tabs-state';
import { entryName, parentDir } from '../../lib/fs-path-ops';
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
  /** 书名（作品资料里起过名就用书名，否则文件夹名）。 */
  titleOf?: (path: string) => string;
  onFileSelect: (filePath: string) => void;
  onFilePreview: (filePath: string) => void;
  fileActions?: FileTreeActions;
  // 作品 / 观测镜 / 搜索 / 手稿视图内容由 AppShell 注入（数据在各自 hook，面板只管容器）。
  book?: ReactNode;
  observatory?: ReactNode;
  search?: ReactNode;
  manuscript?: ReactNode;
  knowledge?: ReactNode;
  /** 显示宽度：作者存的比例按当前窗口换算后的像素（见 resolveWorkspaceColumns）。 */
  width: number;
  /** 此刻最多拖到多宽；只约束显示，不回写作者的比例。 */
  maxWidth?: number;
  /** 拖完 / 方向键调完的像素宽度，由调用方换成比例落设置。 */
  onWidthChange: (width: number) => void;
  /** Enter / 双击复位：回到默认比例。 */
  onWidthReset: () => void;
};

export function SidePanel(props: SidePanelProps) {
  const panelId = useId();
  const { displayWidth, handle } = usePanelResize({
    width: clampSidePanelWidth(props.width),
    min: SIDE_PANEL_WIDTH_MIN,
    max: clampSidePanelWidth(props.maxWidth ?? SIDE_PANEL_WIDTH_MAX),
    edge: 'right',
    controlsId: panelId,
    label: '调整侧栏宽度',
    testId: 'side-panel-resize',
    onCommit: props.onWidthChange,
    onReset: props.onWidthReset,
  });

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
          hover/焦点/拖拽时才显强调色。双击复位到默认比例。 */}
      {handle}
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
  titleOf = basename,
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
  // 新文件落在正在写的那章旁边：建在作品根目录的 .md 会被手稿当成第 1 章，章序整体顺延。
  const openPath = currentFile ?? previewFile;
  const newFileDir =
    openPath && isSameOrInsidePath(openPath, activeProject) ? parentDir(openPath) : activeProject;
  const newFileLabel =
    newFileDir === activeProject
      ? '在作品根目录新建文件'
      : `在「${entryName(newFileDir)}」里新建文件`;

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
          title={`${titleOf(activeProject)}（切换作品）`}
          data-testid="toggle-project-library"
        >
          <span className="min-w-0 flex-1 truncate text-left">{titleOf(activeProject)}</span>
          <ChevronDown size={13} strokeWidth={1.6} className="text-subtle" />
        </button>
        {fileActions && (
          <button
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
            aria-label={newFileLabel}
            title={newFileLabel}
            onClick={() => void fileActions.onNewFile(newFileDir)}
            data-testid="side-new-file"
          >
            <FilePlus size={14} strokeWidth={1.6} />
          </button>
        )}
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
                      {titleOf(project)}
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
                      aria-label={`从最近打开移除 ${titleOf(project)}`}
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
                打开本地作品…
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
