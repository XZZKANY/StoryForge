/**
 * 欢迎区与 Agent 工作台占位组件。
 * 从 App.tsx 抽出。
 */
import { ChatWindow } from '../ChatWindow';
import { basename, type LayoutMode } from './helpers';
import { PanelIcon } from './icons';

export function AgentWorkspace({
  projectPath,
  currentFile,
  assistantSessionId,
  exposeWorkspaceToggle,
  layoutMode,
  onAssistantSessionChange,
  onFocusOnly,
  onRestoreLayout,
  onInitializeProject,
  onCollapse,
}: {
  projectPath: string | null;
  currentFile: string | null;
  assistantSessionId: number | null;
  exposeWorkspaceToggle: boolean;
  layoutMode: LayoutMode;
  onAssistantSessionChange: (assistantSessionId: number | null) => void;
  onFocusOnly: () => void;
  onRestoreLayout: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onCollapse: () => void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      {!currentFile && (
        <TopRightTools exposeExpandTestId={exposeWorkspaceToggle} onToggle={onRestoreLayout} />
      )}
      <div className="min-h-0 flex-1">
        {currentFile ? (
          <ChatWindow
            projectPath={projectPath}
            currentFile={currentFile}
            assistantSessionId={assistantSessionId}
            layoutMode={layoutMode}
            onAssistantSessionChange={onAssistantSessionChange}
            onFocusOnly={onFocusOnly}
            onRestoreLayout={onRestoreLayout}
            onCollapse={onCollapse}
          />
        ) : (
          <AgentComposerHome
            activeProject={projectPath}
            compact
            onBrowseFiles={onRestoreLayout}
            onOpenProject={onRestoreLayout}
            onInitializeProject={onInitializeProject}
          />
        )}
      </div>
    </div>
  );
}

function TopRightTools({
  exposeExpandTestId = false,
  onToggle,
}: {
  exposeExpandTestId?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex h-9 flex-shrink-0 items-center justify-end px-3">
      <button
        data-testid={exposeExpandTestId ? 'expand-file-tree' : undefined}
        className="sf-icon-button icon-button"
        onClick={onToggle}
        title="显示/隐藏侧边栏"
      >
        <PanelIcon />
      </button>
    </div>
  );
}

export function WelcomeWorkspace({
  activeProject,
  onOpenProject,
  onInitializeProject,
  onBrowseFiles,
  onShowWorkbench,
}: {
  activeProject: string | null;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onBrowseFiles: () => void;
  onShowWorkbench: () => void;
}) {
  return (
    <section
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="welcome-workspace"
    >
      <div className="flex h-9 flex-shrink-0 items-center justify-end px-3">
        <button
          className="sf-icon-button icon-button"
          onClick={onShowWorkbench}
          title="显示/隐藏侧边栏"
          data-testid="welcome-show-workbench"
        >
          <PanelIcon />
        </button>
      </div>

      <AgentComposerHome
        activeProject={activeProject}
        onBrowseFiles={onBrowseFiles}
        onOpenProject={onOpenProject}
        onInitializeProject={onInitializeProject}
      />
    </section>
  );
}

function AgentComposerHome({
  activeProject,
  compact = false,
  onBrowseFiles,
  onOpenProject,
  onInitializeProject,
}: {
  activeProject: string | null;
  compact?: boolean;
  onBrowseFiles: () => void;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background px-4 py-10">
      <div
        className={`flex w-full ${compact ? 'max-w-xl' : 'max-w-[760px]'} translate-y-[-4vh] flex-col items-stretch`}
      >
        <div className="mb-6 flex min-w-0 items-center gap-2 text-xs text-muted">
          <button
            className="text-muted transition-colors hover:text-foreground"
            onClick={onBrowseFiles}
          >
            首页⌄
          </button>
          <span className="text-subtle">▱</span>
          <span className="min-w-0 truncate text-foreground/80">
            {activeProject ? basename(activeProject) : '本地'}
          </span>
        </div>

        <div
          className={`w-full ${compact ? 'min-h-[116px]' : 'min-h-[126px]'} rounded-2xl border border-border bg-surface`}
        >
          <textarea
            className={`${compact ? 'h-[66px] text-[15px]' : 'h-[72px] text-[17px]'} w-full resize-none bg-transparent px-4 py-3 leading-6 text-foreground outline-none placeholder:text-subtle`}
            placeholder="规划、构建，输入 / 调用技能，输入 @ 引用上下文"
            aria-label="Agent 输入"
          />
          <div className={`${compact ? 'h-[50px]' : 'h-[54px]'} flex items-center gap-3 px-3`}>
            <button
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-elevated text-xl leading-none text-muted transition-colors hover:bg-border-strong hover:text-foreground"
              onClick={onBrowseFiles}
              title="添加上下文"
            >
              +
            </button>
            <span className="min-w-0 flex-1" aria-label="模型由设置中的默认模型决定" />
            <button
              className="ml-auto grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-colors hover:opacity-90"
              title="语音输入"
            >
              ◉
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            className="h-9 rounded-full border border-border bg-panel px-3 text-xs text-foreground transition-colors hover:border-border-strong hover:bg-surface"
            onClick={onBrowseFiles}
            data-testid="welcome-primary-action"
          >
            规划新想法 <span className="text-subtle">⇧Tab</span>
          </button>
          {!activeProject && (
            <button
              className="h-10 rounded-full border border-transparent px-3 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"
              onClick={onOpenProject}
            >
              打开项目
            </button>
          )}
          {activeProject && (
            <button
              className="h-10 rounded-full border border-border px-3 text-sm text-muted transition-colors hover:border-border-strong hover:bg-surface hover:text-foreground"
              onClick={() => onInitializeProject(activeProject)}
              data-testid="welcome-initialize-project"
            >
              初始化项目结构
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
