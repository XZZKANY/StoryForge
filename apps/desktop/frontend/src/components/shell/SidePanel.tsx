/**
 * 侧面板：默认 236px。
 * - explorer：项目 + 文件树
 * - search：搜索占位
 */
import { useRef, useState } from 'react';
import { StoryNavigator } from '../StoryNavigator';
import { basename } from '../app/helpers';
import type { SidePanelView } from './useShellState';
import { useDismissableMenu } from './useDismissableMenu';
import { ChevronDown, FilePlus, FileText, FolderOpen, Sparkles, X } from '../icons/shell-icons';

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
  onStartNewBook: () => void;
};

export function SidePanel(props: SidePanelProps) {
  return (
    <div
      className="flex w-[236px] flex-shrink-0 flex-col border-r border-border bg-panel"
      data-testid="shell-side-panel"
      data-side-view={props.view}
    >
      {props.view === 'explorer' && <ExplorerView {...props} />}
      {props.view === 'search' && <SearchView />}
    </div>
  );
}

function ViewHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-[34px] flex-shrink-0 items-center gap-1.5 pl-3.5 pr-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-subtle">
      <span>{title}</span>
      <span className="flex-1" />
      {children}
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
  onStartNewBook,
}: SidePanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  useDismissableMenu(menuOpen, () => setMenuOpen(false), menuTriggerRef);

  if (!activeProject) {
    return (
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" data-testid="explorer-empty">
        <p className="mb-2 text-[11.5px] leading-relaxed text-subtle">
          还没有打开项目。打开一个本地文件夹，或直接说一句话开新书。
        </p>
        <button
          className="flex h-[34px] items-center gap-2.5 rounded-md bg-elevated px-3 text-[12.5px] font-medium text-foreground hover:bg-surface hover:shadow-[inset_0_0_0_1px_rgb(var(--border-strong))]"
          onClick={onOpenProject}
          data-testid="add-project-btn"
        >
          <FileText size={15} strokeWidth={1.6} className="text-subtle" />
          打开项目…
        </button>
        <button
          className="flex h-[34px] items-center gap-2.5 rounded-md px-3 text-[12.5px] text-muted hover:bg-elevated hover:text-foreground"
          onClick={onStartNewBook}
        >
          <Sparkles size={15} strokeWidth={1.6} className="text-agent" />
          新的开始
        </button>
        {projects.length > 0 && (
          <>
            <h4 className="mb-1 mt-3 px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-subtle">
              最近打开
            </h4>
            <div data-testid="project-library-list">
              {projects.slice(0, 5).map((project) => (
                <div
                  key={project}
                  className="group flex w-full items-center rounded-md hover:bg-elevated"
                >
                  <button
                    className="flex min-w-0 flex-1 items-center px-2 py-1.5 text-left"
                    onClick={() => onSelectProject(project)}
                    title={project}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                      {basename(project)}
                    </span>
                  </button>
                  <button
                    className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-subtle opacity-0 hover:bg-surface hover:text-foreground group-hover:opacity-100"
                    onClick={() => onRemoveProject(project)}
                    title="从最近打开移除"
                    aria-label={`从最近打开移除 ${basename(project)}`}
                  >
                    <X size={13} strokeWidth={1.6} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        className="relative flex h-shell-row flex-shrink-0 items-center gap-1 border-b border-border px-2 pr-1.5"
        data-testid="side-panel-header"
      >
        <button
          ref={menuTriggerRef}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-semibold hover:bg-elevated"
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
          title="新建文件"
          onClick={() => onNewFile(activeProject)}
          data-testid="side-new-file"
        >
          <FilePlus size={14} strokeWidth={1.6} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-2 right-2 top-shell-row z-40 rounded-lg border border-border bg-surface p-1 shadow-[0_8px_28px_rgba(0,0,0,0.35)]">
              {projects.slice(0, 8).map((project) => (
                <div
                  key={project}
                  className={`group flex h-[30px] w-full items-center rounded text-[12px] hover:bg-elevated ${
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
                      className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-subtle opacity-0 hover:bg-surface hover:text-foreground group-hover:opacity-100"
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
                className="flex h-[30px] w-full items-center gap-2 rounded px-2 text-[12px] text-muted hover:bg-elevated hover:text-foreground"
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
        />
      </div>
    </>
  );
}

function SearchView() {
  return (
    <>
      <ViewHead title="搜索" />
      <div className="mx-3 mb-2">
        <input
          className="h-[30px] w-full rounded-md border border-border bg-surface px-2.5 text-[12px] text-foreground outline-none focus:border-border-strong"
          placeholder="在项目中搜索…"
          data-testid="side-search-input"
        />
      </div>
      <p className="px-4 text-[11.5px] leading-relaxed text-subtle">搜索功能开发中，暂未开放。</p>
    </>
  );
}
