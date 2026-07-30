/**
 * 侧面板：explorer / search 默认 236px；book（作品）、manuscript（手稿）与 observatory
 * （世界线观测镜，#13 从右栏迁来）用 300px——封面行、章节行、台账行信息密度高，236px 太挤。
 *
 * 视图顺序即写作顺序（见 useShellState 的 SIDE_PANEL_VIEWS）：
 * - book：封面 / 书名 / 简介 / 题材 + 全书与今日进度 + 大纲跳转 + 灵感速记（Ctrl+Shift+B）
 * - manuscript：按阅读序的章节列表 + 模型这轮拿到的作品底座（Ctrl+Shift+M）
 * - explorer：项目 + 文件树（文件搜索走顶栏命令面板 Ctrl+P）
 * - search：正文全文搜索（Ctrl+Shift+F）
 * - observatory：世界线观测镜（Ctrl+4 / 活动栏雷达图标）
 */
import { useRef, useState, type ReactNode } from 'react';
import { StoryNavigator } from '../StoryNavigator';
import { basename } from '../app/helpers';
import type { FileTreeActions } from '../app/useFileTreeActions';
import type { SidePanelView } from './useShellState';
import { useDismissableMenu } from './useDismissableMenu';
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
};

const WIDE_VIEWS: ReadonlySet<SidePanelView> = new Set(['book', 'manuscript', 'observatory']);

export function SidePanel(props: SidePanelProps) {
  const wide = WIDE_VIEWS.has(props.view);
  return (
    <div
      className={`flex ${wide ? 'w-[300px]' : 'w-[236px]'} flex-shrink-0 flex-col border-r border-border bg-panel`}
      data-testid="shell-side-panel"
      data-side-view={props.view}
    >
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
  useDismissableMenu(menuOpen, () => setMenuOpen(false), menuTriggerRef);

  if (!activeProject) {
    // #4：左栏空态删除——打开项目 / 最近打开只留在中栏欢迎页，避免两个欢迎面重复。
    return <div className="flex-1" data-testid="explorer-empty" />;
  }

  return (
    <>
      <div
        className="relative flex h-shell-row flex-shrink-0 items-center gap-1 border-b border-border px-2 pr-1.5"
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
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground"
          title="在项目根目录新建文件"
          onClick={() => onNewFile(activeProject)}
          data-testid="side-new-file"
        >
          <FilePlus size={14} strokeWidth={1.6} />
        </button>
        {fileActions && (
          <button
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground"
            title="在项目根目录新建文件夹"
            onClick={() => void fileActions.onNewFolder(activeProject)}
            data-testid="side-new-folder"
          >
            <FolderPlus size={14} strokeWidth={1.6} />
          </button>
        )}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-2 right-2 top-shell-row z-40 rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-dropdown)]">
              {projects.slice(0, 8).map((project) => (
                <div
                  key={project}
                  className={`group flex h-[30px] w-full items-center rounded-sm text-xs hover:bg-elevated ${
                    project === activeProject
                      ? 'text-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  <button
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
                      className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm text-subtle opacity-0 hover:bg-surface hover:text-foreground group-hover:opacity-100"
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
                className="flex h-[30px] w-full items-center gap-2 rounded-sm px-2 text-xs text-muted hover:bg-elevated hover:text-foreground"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenProject();
                }}
              >
                <FolderOpen size={14} strokeWidth={1.6} />
                打开项目…
              </button>
            </div>
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
