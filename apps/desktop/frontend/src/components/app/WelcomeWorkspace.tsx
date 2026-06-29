/**
 * 欢迎区与 Agent 工作台占位组件。
 * 从 App.tsx 抽出。
 */
import { ChatWindow } from '../ChatWindow';
import { basename, type LayoutMode } from './helpers';
import { LayoutSplitIcon, MoreIcon, PanelIcon } from './icons';

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
        <TopRightTools
          exposeExpandTestId={exposeWorkspaceToggle}
          onShowWorkspace={onRestoreLayout}
          onShowPanel={onRestoreLayout}
        />
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
  onShowWorkspace,
  onShowPanel,
}: {
  exposeExpandTestId?: boolean;
  onShowWorkspace: () => void;
  onShowPanel: () => void;
}) {
  return (
    <div className="sf-panel-header bg-[#18181B]">
      <span className="sf-topbar-title">编辑窗口</span>
      <div className="sf-topbar-actions">
        <button className="sf-toolbar-button" onClick={onShowWorkspace} title="编辑窗口">
          编辑窗口 ↗
        </button>
        <button className="sf-icon-button icon-button" title="更多">
          <MoreIcon />
        </button>
        <button
          data-testid={exposeExpandTestId ? 'expand-file-tree' : undefined}
          className="sf-icon-button icon-button"
          onClick={onShowPanel}
          title="显示面板 (Ctrl Alt B)"
        >
          <PanelIcon />
        </button>
        <button className="sf-icon-button icon-button" onClick={onShowWorkspace} title="恢复分栏">
          <LayoutSplitIcon />
        </button>
      </div>
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
      className="flex h-full min-w-0 flex-col overflow-hidden bg-[#18181B]"
      data-testid="welcome-workspace"
    >
      <div className="sf-panel-header bg-[#18181B]">
        <span className="sf-topbar-title">编辑窗口</span>
        <div className="sf-topbar-actions">
          <button className="sf-toolbar-button" onClick={onBrowseFiles} title="打开编辑窗口">
            编辑窗口 ↗
          </button>
          <button className="sf-icon-button" title="更多">
            <MoreIcon />
          </button>
          <button
            className="sf-icon-button"
            onClick={onShowWorkbench}
            title="显示文件树与编辑分栏"
            data-testid="welcome-show-workbench"
          >
            <LayoutSplitIcon />
          </button>
        </div>
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
    <div className="flex h-full items-center justify-center bg-[#18181B] px-4 py-10">
      <div
        className={`flex w-full ${compact ? 'max-w-xl' : 'max-w-[760px]'} translate-y-[-4vh] flex-col items-stretch`}
      >
        <div className="mb-6 flex min-w-0 items-center gap-2 text-xs text-zinc-400">
          <button
            className="text-zinc-300 transition-colors hover:text-white"
            onClick={onBrowseFiles}
          >
            首页⌄
          </button>
          <span className="text-[#777777]">▱</span>
          <span className="min-w-0 truncate text-[#CFCFCF]">
            {activeProject ? basename(activeProject) : '本地'}
          </span>
        </div>

        <div
          className={`w-full ${compact ? 'min-h-[116px]' : 'min-h-[126px]'} rounded-2xl border border-[#45454C] bg-[#2A2A30] shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
        >
          <textarea
            className={`${compact ? 'h-[66px] text-[15px]' : 'h-[72px] text-[17px]'} w-full resize-none bg-transparent px-4 py-3 leading-6 text-[#EDEDED] outline-none placeholder:text-[#707070]`}
            placeholder="规划、构建，输入 / 调用技能，输入 @ 引用上下文"
            aria-label="Agent 输入"
          />
          <div className={`${compact ? 'h-[50px]' : 'h-[54px]'} flex items-center gap-3 px-3`}>
            <button
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#333333] text-xl leading-none text-[#BDBDBD] transition-colors hover:bg-[#3D3D3D] hover:text-white"
              onClick={onBrowseFiles}
              title="添加上下文"
            >
              +
            </button>
            <span className="min-w-0 flex-1" aria-label="模型由设置中的默认模型决定" />
            <button
              className="ml-auto grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-[#111111] transition-colors hover:bg-white"
              title="语音输入"
            >
              ◉
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            className="h-9 rounded-full border border-[#303030] bg-[#181818] px-3 text-xs text-[#EDEDED] transition-colors hover:border-[#464646] hover:bg-[#1B1B1B]"
            onClick={onBrowseFiles}
            data-testid="welcome-primary-action"
          >
            规划新想法 <span className="text-[#777777]">⇧Tab</span>
          </button>
          {!activeProject && (
            <button
              className="h-10 rounded-full border border-transparent px-3 text-sm text-[#A8A8A8] transition-colors hover:bg-[#1B1B1B] hover:text-[#EDEDED]"
              onClick={onOpenProject}
            >
              打开项目
            </button>
          )}
          {activeProject && (
            <button
              className="h-10 rounded-full border border-[#303030] px-3 text-sm text-[#A8A8A8] transition-colors hover:border-[#464646] hover:bg-[#1B1B1B] hover:text-[#EDEDED]"
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
