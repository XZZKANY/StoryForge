import type { Dispatch, SetStateAction } from 'react';

import { ChatWindow } from '../ChatWindow';
import { CommandPalette, type PaletteMode } from '../CommandPalette';
import { Editor } from '../Editor';
import { SettingsView } from '../SettingsView';
import { ActivityBar } from '../shell/ActivityBar';
import { AssistantPanelFrame } from '../shell/AssistantPanelFrame';
import { EditorTabs, type CenterTab } from '../shell/EditorTabs';
import { ObsPanel, obsCounts, type Observation } from '../shell/ObsPanel';
import { ObservatoryView } from '../shell/ObservatoryView';
import { SidePanel } from '../shell/SidePanel';
import { StatusBar } from '../shell/StatusBar';
import { Titlebar } from '../shell/Titlebar';
import { ToastHost } from '../shell/ToastHost';
import type { useShellState } from '../shell/useShellState';
import {
  emitEditorCommand,
  emitExportCurrentFile,
  flushActiveEditorToDisk,
} from '../../lib/assistant-events';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import type { ObservationAnchor } from '../../lib/observations';
import type { useAppDialog } from './AppDialog';
import { AppDialogHost } from './AppDialog';
import { WelcomeDismissed, WelcomeWorkspace } from './WelcomeWorkspace';
import type { AppPreferences } from './useAppPreferences';
import type { EditorWorkspaceTabs } from './useEditorWorkspaceTabs';
import type { useObservatory } from './useObservatory';
import type { ProjectCommands } from './useProjectCommands';

type WorkspaceProps = {
  projects: string[];
  activeProject: string | null;
  currentFile: string | null;
  projectAssistantSessions: Record<string, number>;
  setActiveProjectAssistantSession: (
    assistantSessionId: number | null,
    projectOverride?: string,
  ) => void;
};

type RuntimeProps = {
  isDesktopRuntime: boolean;
  tauriMenuReady: boolean;
  tauriMenuError: string;
  smokeApiReady: boolean;
};

/** 观测句柄：useObservatory 全量数据 + App 级定位回调（观测行 / 台账锚点两种入口）。 */
export type ObservatoryHandle = ReturnType<typeof useObservatory> & {
  locateObservation: (observation: Observation) => void;
  locateAnchor: (anchor: ObservationAnchor) => void;
};

type AppShellProps = {
  workspace: WorkspaceProps;
  tabs: EditorWorkspaceTabs;
  commands: ProjectCommands;
  preferences: AppPreferences;
  shell: ReturnType<typeof useShellState>;
  dialogs: ReturnType<typeof useAppDialog>;
  runtime: RuntimeProps;
  settingsVisible: boolean;
  setSettingsVisible: Dispatch<SetStateAction<boolean>>;
  palette: PaletteMode | null;
  setPalette: Dispatch<SetStateAction<PaletteMode | null>>;
  obsPanelOpen: boolean;
  setObsPanelOpen: Dispatch<SetStateAction<boolean>>;
  observatory: ObservatoryHandle;
  openSettings: () => Promise<void>;
  welcomeDismissed: boolean;
  onCloseWelcome: () => void;
  onReopenWelcome: () => void;
};

export function AppShell({
  workspace,
  tabs,
  commands,
  preferences,
  shell,
  dialogs,
  runtime,
  settingsVisible,
  setSettingsVisible,
  palette,
  setPalette,
  obsPanelOpen,
  setObsPanelOpen,
  observatory,
  openSettings,
  welcomeDismissed,
  onCloseWelcome,
  onReopenWelcome,
}: AppShellProps) {
  const { projects, activeProject, currentFile, projectAssistantSessions } = workspace;
  const projectOpen = Boolean(activeProject);
  const rightPanelVisible = projectOpen && !shell.rightCollapsed;
  const obs = obsCounts(observatory.observations);
  const centerHasTabs = settingsVisible || projectOpen;
  const activeCenterTab: CenterTab | null = settingsVisible
    ? 'settings'
    : tabs.previewFile && tabs.previewFile !== currentFile
      ? 'preview'
      : currentFile
        ? 'file'
        : null;

  const showShortcuts = () => {
    // 键名列走等宽对齐（mono:true）：比例字体下空格填充会参差；补活动栏承诺的 Ctrl Shift E，
    // 面板名统一「资源管理器」（与命令面板/活动栏一致）。
    const rows: [string, string][] = [
      ['Ctrl P', '打开文件（命令面板 · 文件）'],
      ['Ctrl Shift P', '命令面板（全部命令）'],
      ['Ctrl Shift E', '资源管理器'],
      ['Ctrl O', '打开项目'],
      ['Ctrl B', '显示 / 隐藏资源管理器'],
      ['Ctrl ,', '打开设置'],
      ['Ctrl 1 / 2 / 3', '编辑 / 平衡 / 对话 布局'],
      ['Ctrl 4', '观测镜'],
    ];
    void dialogs.alert({
      title: '快捷键速查',
      mono: true,
      message: [
        ...rows.map(([key, label]) => `${key.padEnd(16)}${label}`),
        '',
        '编辑 · 全选 · 复制 · 粘贴（Ctrl C / A / V）全部沿袭系统，不拦截。',
      ].join('\n'),
    });
  };

  const showAbout = () =>
    void dialogs.alert({
      title: '了解 StoryForge',
      message: [
        'StoryForge — 可验证的长篇创作流水线。',
        '',
        '设计立场：先做诊断控制台，再做生成器。任何生成路径都先有',
        '读证据 → 评审 → 修复 → 批准的闭环，再考虑接真实模型。',
        '',
        '桌面 IDE 是主体验：本地项目、Monaco 编辑、对话式 Agent、',
        'canon 事实卡与观测镜，BYO-key 接真实 LLM。',
      ].join('\n'),
    });

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-testid="desktop-shell"
      data-layout-mode={shell.view}
      data-layout-focus={shell.layoutMode}
      data-tauri-runtime={runtime.isDesktopRuntime ? 'true' : 'false'}
      data-tauri-menu-ready={runtime.tauriMenuReady ? 'true' : 'false'}
      data-smoke-api-ready={runtime.smokeApiReady ? 'true' : 'false'}
      data-tauri-menu-error={runtime.tauriMenuError}
    >
      <Titlebar
        onOpenPalette={() => setPalette('files')}
        projectOpen={projectOpen}
        rightCollapsed={shell.rightCollapsed}
        onToggleRight={shell.toggleRight}
      />

      <div className="relative flex min-h-0 flex-1">
        <div className="flex flex-shrink-0">
          <ActivityBar
            view={shell.view}
            sidebarHidden={shell.sidebarHidden}
            noProject={!projectOpen}
            onSwitchView={shell.switchView}
            onOpenSettings={() => void openSettings()}
          />
          {!shell.sidebarHidden && (
            <SidePanel
              view={shell.view}
              projects={projects}
              activeProject={activeProject}
              currentFile={currentFile}
              previewFile={tabs.previewFile}
              projectRefreshVersion={commands.projectRefreshVersion}
              onSelectProject={(path) => void tabs.selectProjectSafely(path)}
              onRemoveProject={(path) => void tabs.removeProjectSafely(path)}
              onOpenProject={commands.handleOpenProject}
              onNewFile={commands.handleNewFile}
              onFileSelect={tabs.openFile}
              onFilePreview={tabs.previewFileOpen}
            />
          )}
        </div>

        <main
          className={`${shell.layoutMode === 'chat' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col bg-background`}
          data-testid="shell-center"
        >
          {centerHasTabs ? (
            <>
              <EditorTabs
                openFiles={tabs.openFiles}
                activeFile={currentFile}
                previewFile={tabs.previewFile}
                dirtyFiles={tabs.dirtyFiles}
                settingsOpen={settingsVisible}
                activeTab={activeCenterTab}
                activeReadOnly={
                  tabs.displayedFile ? isReadOnlyDerivedProjectPath(tabs.displayedFile) : false
                }
                onFocusFile={tabs.focusFile}
                onReorderFiles={tabs.reorderOpenFiles}
                onFocusPreview={tabs.focusPreview}
                onPinPreview={tabs.pinPreview}
                onFocusSettings={() => void openSettings()}
                onCloseFile={(path) => void tabs.handleFileClose(path)}
                onClosePreview={tabs.closePreview}
                onCloseSettings={() => setSettingsVisible(false)}
                onSaveActive={() => {
                  if (tabs.displayedFile) {
                    void flushActiveEditorToDisk(tabs.displayedFile).catch(() => undefined);
                  }
                }}
                onToggleHistory={() => emitEditorCommand('toggle-history')}
                onExportActive={() => emitExportCurrentFile()}
                onToggleBranchView={() => emitEditorCommand('toggle-branch-view')}
                onCloseOthers={() => void tabs.handleCloseOthers()}
                onCloseAll={() => void tabs.handleCloseAll()}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {settingsVisible && (
                  <SettingsView
                    settings={preferences.settings}
                    onChange={preferences.setSettings}
                    onClose={() => setSettingsVisible(false)}
                  />
                )}
                <section
                  className={`${settingsVisible ? 'hidden' : 'h-full'} min-h-0 overflow-hidden bg-background`}
                  data-testid="editor-panel"
                  hidden={settingsVisible}
                >
                  <Editor
                    projectPath={activeProject}
                    filePath={tabs.displayedFile}
                    editorFontSize={preferences.settings.editorFontSize}
                    editorFontMode={preferences.settings.editorFontMode}
                    editorLineNumbers={preferences.settings.editorLineNumbers}
                    autoSave={preferences.settings.autoSave}
                    retainedFilePaths={tabs.retainedEditorFiles}
                    onDirtyChange={tabs.handleEditorDirtyChange}
                    sidebarVisible={!shell.sidebarHidden}
                    dialogs={dialogs}
                  />
                </section>
              </div>
              {obsPanelOpen && projectOpen && (
                <ObsPanel
                  observations={observatory.observations}
                  availability={observatory.availability}
                  onClose={() => setObsPanelOpen(false)}
                  onResolve={observatory.resolveObservation}
                  onLocate={observatory.locateObservation}
                />
              )}
            </>
          ) : welcomeDismissed ? (
            <WelcomeDismissed
              onReopenWelcome={onReopenWelcome}
              onOpenProject={commands.handleOpenProject}
            />
          ) : (
            <WelcomeWorkspace
              onOpenProject={commands.handleOpenProject}
              onNewFile={() => void commands.handleNewFile()}
              onOpenPalette={() => setPalette('files')}
              onCreateSampleProject={commands.handleCreateSampleProject}
              onOpenSettings={openSettings}
              onShowShortcuts={showShortcuts}
              onShowAbout={showAbout}
              onClose={onCloseWelcome}
              recentProjects={projects}
              onSelectRecent={(path) => void tabs.selectProjectSafely(path)}
              showOnStartup={preferences.settings.showWelcomeOnStartup}
              onToggleShowOnStartup={(value) =>
                preferences.setSettings((prev) => ({ ...prev, showWelcomeOnStartup: value }))
              }
              composerValue={commands.welcomeDraft}
              onComposerChange={commands.setWelcomeDraft}
              onComposerSend={commands.handleWelcomeSend}
            />
          )}
        </main>

        {projectOpen && (
          <AssistantPanelFrame visible={rightPanelVisible} wide={shell.layoutMode === 'chat'}>
            {/* 两视图 CSS 互斥不卸载：对话在途 run 状态不能因切观测镜丢失（S14 纪律）。 */}
            <div
              className={`${shell.rightView === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}
              data-testid="right-chat-pane"
              hidden={shell.rightView !== 'chat'}
            >
              <ChatWindow
                projectPath={activeProject}
                currentFile={tabs.displayedFile ?? currentFile}
                assistantSessionId={
                  activeProject ? (projectAssistantSessions[activeProject] ?? null) : null
                }
                pendingInitialPrompt={commands.pendingWelcomePrompt}
                onPendingInitialPromptConsumed={commands.handlePendingWelcomePromptConsumed}
                onAssistantSessionChange={workspace.setActiveProjectAssistantSession}
                layoutMode={shell.layoutMode}
                onSetLayoutMode={shell.setLayoutMode}
                onOpenObservatory={shell.toggleObservatory}
                observatoryAttention={observatory.litEntityIds.length > 0}
              />
            </div>
            <div
              className={`${shell.rightView === 'observatory' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}
              data-testid="right-observatory-pane"
              hidden={shell.rightView !== 'observatory'}
            >
              <ObservatoryView
                availability={observatory.availability}
                scanning={observatory.scanning}
                observations={observatory.observations}
                checkers={observatory.checkers}
                entities={observatory.entities}
                promises={observatory.promises}
                proposals={observatory.proposals}
                generatedAt={observatory.generatedAt}
                litEntityIds={observatory.litEntityIds}
                onRescan={() => void observatory.runScan()}
                onBackToChat={shell.showChatView}
                onLocateObservation={observatory.locateObservation}
                onLocateAnchor={observatory.locateAnchor}
              />
            </div>
          </AssistantPanelFrame>
        )}
      </div>

      <StatusBar
        modelLabel={preferences.modelLabel}
        theme={preferences.settings.theme}
        projectOpen={projectOpen}
        fontMode={preferences.settings.editorFontMode}
        obs={obs}
        observationAvailability={observatory.availability}
        onToggleObs={() => setObsPanelOpen((open) => !open)}
        onToggleFont={preferences.toggleFontMode}
        onToggleTheme={preferences.toggleTheme}
      />

      {palette && (
        <CommandPalette
          mode={palette}
          projectPath={activeProject}
          currentFile={currentFile}
          onClose={() => setPalette(null)}
          onOpenFile={tabs.openFile}
          onOpenProject={commands.handleOpenProject}
          onInitializeProject={commands.handleInitializeStoryProject}
          onRefreshCanon={commands.handleRefreshCanon}
          onReopenWelcome={onReopenWelcome}
          onExportCurrent={() => emitExportCurrentFile()}
          onToggleAssistant={shell.toggleRight}
          onToggleWorkspace={shell.toggleSidebar}
          onOpenSettings={openSettings}
          onFocusAssistantOnly={() => shell.showRight()}
          onFocusWorkspaceOnly={() => shell.showSidebar()}
          onRestoreLayout={() => {
            shell.showSidebar();
            shell.showRight();
          }}
        />
      )}
      <AppDialogHost
        dialog={dialogs.dialog}
        onClose={dialogs.closeDialog}
        onPromptValueChange={dialogs.updatePromptValue}
      />
      <ToastHost />
    </div>
  );
}
