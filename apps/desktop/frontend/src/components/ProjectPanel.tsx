/**
 * 左侧"项目"面板
 * 只负责项目级选择与打开，不展开章节/人物/设定文件树（那是右侧文件工作区的职责）。
 * 项目列表是用户真实打开过的本地目录，不伪造状态标签。
 */

type ProjectPanelProps = {
  projects: string[];
  activeProject: string | null;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
  onToggleCollapse?: () => void;
};

function projectName(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] || path;
}

export function ProjectPanel({
  projects,
  activeProject,
  onSelectProject,
  onOpenProject,
  onToggleCollapse,
}: ProjectPanelProps) {
  return (
    <div className="h-full flex flex-col bg-panel" data-testid="project-panel">
      {/* 顶部：项目入口 */}
      <div className="h-10 px-3 border-b border-border flex items-center gap-2 flex-shrink-0">
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            data-testid="collapse-project"
            className="w-7 h-7 rounded-md hover:bg-foreground/10 flex items-center justify-center text-muted hover:text-foreground transition-colors"
            title="折叠项目栏"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeWidth="1.5" d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>
        )}

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground">项目</h2>
        </div>

        {/* 打开/新建项目（菜单 menu:open-project 与冒烟依赖此 id） */}
        <button
          id="open-project-btn"
          data-testid="open-project"
          onClick={onOpenProject}
          title="打开项目目录"
          className="w-7 h-7 rounded-md hover:bg-foreground/10 flex items-center justify-center text-muted hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2v3h3v9h6V5h3V2H2zm8 3H6v8h4V5z" />
          </svg>
        </button>
      </div>

      {/* 项目列表 */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-1"
        data-testid="project-list"
        data-project-count={projects.length}
        data-active-project={activeProject ?? ''}
      >
        {projects.length === 0 ? (
          <div className="mt-8 mx-2 p-6 rounded-lg border border-border bg-surface text-center">
            <p className="text-sm text-muted mb-3">还没有打开过项目</p>
            <button
              onClick={onOpenProject}
              className="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground hover:opacity-90 active:opacity-100 transition-opacity font-medium"
            >
              打开项目
            </button>
          </div>
        ) : (
          projects.map((path) => {
            const isActive = path === activeProject;
            return (
              <button
                key={path}
                onClick={() => onSelectProject(path)}
                data-testid="project-item"
                data-project-path={path}
                data-active={isActive ? 'true' : 'false'}
                title={path}
                className={`
                  w-full text-left px-2.5 py-2 rounded-md flex items-center gap-2.5
                  transition-colors group
                  ${isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-foreground/10 active:bg-foreground/[0.06]'}
                `}
              >
                <svg
                  className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-accent-foreground' : 'text-muted group-hover:text-foreground'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{projectName(path)}</span>
                  <span className={`block truncate text-[11px] ${isActive ? 'text-accent-foreground/70' : 'text-muted'}`}>
                    {path}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
