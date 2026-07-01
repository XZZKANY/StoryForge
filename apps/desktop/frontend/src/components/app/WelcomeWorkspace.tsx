/**
 * 欢迎区与 Agent 工作台占位组件。
 * 从 App.tsx 抽出。
 */
import { useState } from 'react';
import { ChatWindow } from '../ChatWindow';
import { basename, type LayoutMode } from './helpers';
import { PanelIcon } from './icons';
import { PROVIDER_OPTIONS, PROVIDER_PRESETS } from '../../lib/provider-config';
import type { ProviderKind } from '../../lib/user-settings';

export function AgentWorkspace({
  projectPath,
  currentFile,
  assistantSessionId,
  exposeWorkspaceToggle,
  layoutMode,
  onAssistantSessionChange,
  onFocusOnly,
  onRestoreLayout,
  onOpenProject,
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
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onCollapse: () => void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      {!projectPath && (
        <TopRightTools exposeExpandTestId={exposeWorkspaceToggle} onToggle={onRestoreLayout} />
      )}
      <div className="min-h-0 flex-1">
        {projectPath ? (
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
            onOpenProject={onOpenProject}
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
  onCreateSampleProject,
  onOpenSettings,
  onBrowseFiles,
  onShowWorkbench,
  providerModel,
  onApplyModel,
  providerKind,
  onApplyProvider,
}: {
  activeProject: string | null;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onCreateSampleProject: () => void;
  onOpenSettings: () => void;
  onBrowseFiles: () => void;
  onShowWorkbench: () => void;
  providerModel: string;
  onApplyModel: (model: string) => void;
  providerKind: ProviderKind;
  onApplyProvider: (kind: ProviderKind) => void;
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
        onCreateSampleProject={onCreateSampleProject}
        onOpenSettings={onOpenSettings}
        providerModel={providerModel}
        onApplyModel={onApplyModel}
        providerKind={providerKind}
        onApplyProvider={onApplyProvider}
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
  onOpenSettings,
  providerModel,
  onApplyModel,
  providerKind,
  onApplyProvider,
}: {
  activeProject: string | null;
  compact?: boolean;
  onBrowseFiles: () => void;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onCreateSampleProject?: () => void;
  onOpenSettings?: () => void;
  providerModel?: string;
  onApplyModel?: (model: string) => void;
  providerKind?: ProviderKind;
  onApplyProvider?: (kind: ProviderKind) => void;
}) {
  const primaryAction = activeProject ? onBrowseFiles : onOpenProject;
  const projectLabel = activeProject ? basename(activeProject) : 'StoryForge';
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState(providerModel ?? '');
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const currentModel = providerModel?.trim() ? providerModel : '选择模型';
  const providerLabel = providerKind ? PROVIDER_PRESETS[providerKind].label : '本地模式';
  const applyModel = () => {
    onApplyModel?.(modelDraft.trim());
    setModelPickerOpen(false);
  };

  return (
    <div className="flex h-full items-center justify-center bg-background px-4 py-10">
      <div
        className={`flex w-full ${compact ? 'max-w-xl' : 'max-w-[760px]'} translate-y-[-4vh] flex-col items-stretch`}
      >
        {!compact && activeProject && (
          <h1 className="mb-8 text-center text-[27px] font-semibold leading-snug text-foreground">
            我们应该在 {projectLabel} 中构建什么？
          </h1>
        )}

        <div
          className={`w-full ${compact ? 'min-h-[116px]' : 'min-h-[126px]'} rounded-2xl border border-border bg-surface`}
        >
          <textarea
            className={`${compact ? 'h-[66px] text-[15px]' : 'h-[72px] text-[17px]'} w-full resize-none bg-transparent px-4 py-3 leading-6 text-foreground outline-none placeholder:text-subtle`}
            placeholder="随心输入"
            aria-label="Agent 输入"
          />
          <div className={`${compact ? 'h-[50px]' : 'h-[54px]'} flex items-center gap-2 px-3`}>
            <button
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-elevated text-xl leading-none text-muted transition-colors hover:bg-border-strong hover:text-foreground"
              onClick={onBrowseFiles}
              title="添加上下文"
            >
              +
            </button>
            {onApplyProvider && (
              <div className="relative flex-shrink-0">
                <button
                  className="flex h-8 max-w-[160px] items-center gap-1 rounded-full px-2 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
                  onClick={() => setProviderPickerOpen((open) => !open)}
                  title="切换模型服务商"
                  aria-expanded={providerPickerOpen}
                >
                  <span className="text-subtle">◍</span>
                  <span className="min-w-0 truncate">{providerLabel}</span>
                  <span className="text-subtle">⌄</span>
                </button>
                {providerPickerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setProviderPickerOpen(false)}
                    />
                    <div className="absolute bottom-10 left-0 z-20 w-52 overflow-hidden rounded-md border border-border bg-panel py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                      {PROVIDER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            onApplyProvider(option.value);
                            setProviderPickerOpen(false);
                          }}
                          className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-elevated hover:text-foreground ${
                            option.value === providerKind ? 'text-foreground' : 'text-muted'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <span className="min-w-0 flex-1" />
            {onApplyModel && (
              <div className="relative flex-shrink-0">
                <button
                  className="flex h-8 max-w-[180px] items-center gap-1 rounded-full px-2 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
                  onClick={() => {
                    setModelDraft(providerModel ?? '');
                    setModelPickerOpen((open) => !open);
                  }}
                  title="切换默认模型"
                  aria-expanded={modelPickerOpen}
                >
                  <span className="min-w-0 truncate">{currentModel}</span>
                  <span className="text-subtle">⌄</span>
                </button>
                {modelPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setModelPickerOpen(false)} />
                    <div className="absolute bottom-10 right-0 z-20 w-64 rounded-md border border-border bg-panel p-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                      <div className="mb-1 px-1 text-xs text-subtle">
                        切换默认模型（写盘即生效，无需重启）
                      </div>
                      <input
                        autoFocus
                        value={modelDraft}
                        onChange={(event) => setModelDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') applyModel();
                          if (event.key === 'Escape') setModelPickerOpen(false);
                        }}
                        placeholder="例如 gpt-4.1、deepseek-chat"
                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-accent"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        {onOpenSettings && (
                          <button
                            className="text-xs text-subtle transition-colors hover:text-foreground"
                            onClick={onOpenSettings}
                          >
                            更多设置
                          </button>
                        )}
                        <button
                          className="ml-auto h-7 rounded-md bg-accent px-3 text-xs text-accent-foreground transition-colors hover:opacity-90"
                          onClick={applyModel}
                        >
                          应用
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-accent text-lg leading-none text-accent-foreground transition-colors hover:opacity-90"
              title="发送"
            >
              ↑
            </button>
          </div>
        </div>

        {!compact && (
          <div className="mt-2 flex items-center gap-3 px-1 text-xs text-muted">
            <span className="flex min-w-0 items-center gap-1">
              <span className="text-subtle">▤</span>
              <span className="min-w-0 truncate text-foreground/80">{projectLabel}</span>
            </span>
            <button
              className="flex items-center gap-1 transition-colors hover:text-foreground"
              onClick={onBrowseFiles}
              title="浏览项目文件"
            >
              <span className="text-subtle">▱</span>
              本地
              <span className="text-subtle">⌄</span>
            </button>
          </div>
        )}

        {!compact && (
          <div className="mt-4 flex flex-col">
            <button
              className="flex items-center gap-2 border-t border-border py-3 text-left text-sm text-muted transition-colors hover:text-foreground"
              onClick={primaryAction}
              data-testid="welcome-primary-action"
            >
              <span className="text-subtle">⌾</span>
              {activeProject ? '浏览项目文件' : '打开项目开始写作'}
            </button>
            {activeProject ? (
              <button
                className="flex items-center gap-2 border-t border-border py-3 text-left text-sm text-muted transition-colors hover:text-foreground"
                onClick={() => onInitializeProject(activeProject)}
                data-testid="welcome-initialize-project"
              >
                <span className="text-subtle">⌾</span>
                初始化项目结构
              </button>
            ) : (
              onOpenSettings && (
                <button
                  className="flex items-center gap-2 border-t border-border py-3 text-left text-sm text-muted transition-colors hover:text-foreground"
                  onClick={onOpenSettings}
                >
                  <span className="text-subtle">⌾</span>
                  配置模型服务，连接真实 LLM
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
