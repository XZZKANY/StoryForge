import type { Dispatch, SetStateAction } from 'react';

import { ChatWindow } from '../ChatWindow';
import { CommandPalette, type PaletteMode } from '../CommandPalette';
import { PROSE_MEASURE_LABELS } from '../editor/options';
import { Editor } from '../Editor';
import { SettingsView } from '../SettingsView';
import { ActivityBar } from '../shell/ActivityBar';
import type { ContextMenuItem } from '../shell/ContextMenu';
import { AssistantPanelFrame } from '../shell/AssistantPanelFrame';
import { EditorTabs, type CenterTab } from '../shell/EditorTabs';
import { ObsPanel, obsCounts, type Observation } from '../shell/ObsPanel';
import { BookProfileView } from '../shell/BookProfileView';
import { ManuscriptView } from '../shell/ManuscriptView';
import { KnowledgeInboxView } from '../shell/KnowledgeInboxView';
import { ObservatoryView } from '../shell/ObservatoryView';
import { SearchView } from '../shell/SearchView';
import { SidePanel } from '../shell/SidePanel';
import { StatusBar } from '../shell/StatusBar';
import { Titlebar } from '../shell/Titlebar';
import { ToastHost } from '../shell/ToastHost';
import { useDeference } from '../shell/useDeference';
import type { useShellState } from '../shell/useShellState';
import {
  emitEditorCommand,
  emitExportCurrentFile,
  flushActiveEditorToDisk,
} from '../../lib/assistant-events';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import type { ObservationAnchor } from '../../lib/observations';
import type { FileCursor } from '../../lib/workspace-session';
import type { useAppDialog } from './AppDialog';
import { AppDialogHost } from './AppDialog';
import { ProjectDashboard } from './ProjectDashboard';
import { resolveActiveCenterTab } from './editor-tabs-state';
import { formatShortcutSheet } from './shortcuts';
import { useAgentPermission } from './useAgentPermission';
import { useFileTreeActions } from './useFileTreeActions';
import { WelcomeDismissed, WelcomeWorkspace } from './WelcomeWorkspace';
import type { AppPreferences } from './useAppPreferences';
import type { BookContextHandle } from './useBookContext';
import type { BookProfileHandle } from './useBookProfile';
import type { EditorWorkspaceTabs } from './useEditorWorkspaceTabs';
import type { useObservatory } from './useObservatory';
import type { ProjectCommands } from './useProjectCommands';
import type { useProjectSearch } from './useProjectSearch';
import { useKnowledgeInbox } from './useKnowledgeInbox';

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
  toggleObsPanel: () => void;
  observatory: ObservatoryHandle;
  /** 手稿视图：作品底座只读投影 + 点章节行打开该章。 */
  bookContext: BookContextHandle;
  onOpenManuscriptChapter: (relativePath: string) => void;
  /** 作品视图：档案（book.json）+ 现算的进度 / 大纲 / 速记。 */
  bookProfile: BookProfileHandle;
  onOpenOutlineHeading: (path: string, line: number) => void;
  openSettings: () => Promise<void>;
  welcomeDismissed: boolean;
  onCloseWelcome: () => void;
  onReopenWelcome: () => void;
  /** 恢复现场：上次的光标位置 + 光标回写口子（写作时刻 01）。 */
  initialCursors: Record<string, FileCursor> | null;
  onCursorPersist: (filePath: string, cursor: FileCursor) => void;
  search: ReturnType<typeof useProjectSearch>;
  onOpenSearchHit: (path: string, line: number) => void;
  /** 仪表盘"开始写作"回调：隐藏仪表盘进入编辑器。 */
  onStartWriting: () => void;
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
  toggleObsPanel,
  observatory,
  bookContext,
  onOpenManuscriptChapter,
  bookProfile,
  onOpenOutlineHeading,
  openSettings,
  welcomeDismissed,
  onCloseWelcome,
  onReopenWelcome,
  initialCursors,
  onCursorPersist,
  search,
  onOpenSearchHit,
  onStartWriting,
}: AppShellProps) {
  const { projects, activeProject, currentFile, projectAssistantSessions } = workspace;
  const projectOpen = Boolean(activeProject);
  const agentPermission = useAgentPermission(activeProject);
  const knowledgeInbox = useKnowledgeInbox(activeProject);
  const rightPanelVisible = projectOpen && !shell.rightCollapsed;
  const obs = obsCounts(observatory.observations);
  const fileActions = useFileTreeActions({
    activeProject,
    dialogs,
    openFile: tabs.openFile,
    dropOpenFilePath: tabs.dropOpenFilePath,
  });
  // 设置改为弹出式（#15），不再占中栏页签：centerHasTabs 只看是否开了项目。
  const centerHasTabs = projectOpen;
  const activeCenterTab: CenterTab | null = resolveActiveCenterTab(
    tabs.displayedFile,
    tabs.previewFile,
  );

  const showShortcuts = () => {
    void dialogs.alert({
      title: '快捷键速查',
      mono: true,
      message: formatShortcutSheet(),
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

  // 齿轮小菜单（#15）：命令面板 / 设置 / 快捷键 / 主题 / 关于。
  const settingsMenu: ContextMenuItem[] = [
    { label: '命令面板', onSelect: () => setPalette('commands') },
    { label: '设置', onSelect: () => void openSettings() },
    { type: 'separator' },
    { label: '快捷键速查', onSelect: showShortcuts },
    {
      label: preferences.settings.theme === 'dark' ? '切换到浅色' : '切换到深色',
      onSelect: preferences.toggleTheme,
    },
    { type: 'separator' },
    { label: '了解 StoryForge', onSelect: showAbout },
  ];

  const deferred = useDeference();

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-testid="desktop-shell"
      data-layout-mode={shell.view}
      data-layout-focus={shell.layoutMode}
      data-shell-deferred={deferred ? 'true' : 'false'}
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
            onSwitchView={shell.switchView}
            onOpenSettings={() => void openSettings()}
            settingsMenu={settingsMenu}
            observatoryAttention={observatory.litEntityIds.length > 0}
            knowledgePendingCount={knowledgeInbox.inbox.pending_count}
          />
          {!shell.sidebarHidden && (
            <SidePanel
              view={shell.view}
              widths={preferences.settings.sidePanelWidths}
              onWidthChange={preferences.setSidePanelWidth}
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
              fileActions={fileActions}
              book={
                activeProject ? (
                  <BookProfileView
                    projectPath={activeProject}
                    handle={bookProfile}
                    dailyWordGoal={preferences.settings.dailyWordGoal}
                    onOpenOutline={onOpenOutlineHeading}
                    onBackToExplorer={shell.showExplorerView}
                    onRunBreakdown={() => void commands.handleBookBreakdown()}
                  />
                ) : (
                  <p className="px-3 py-4 text-2xs leading-relaxed text-subtle">
                    打开项目后可填写封面、简介与字数目标。
                  </p>
                )
              }
              search={
                <SearchView
                  search={search}
                  projectOpen={projectOpen}
                  active={shell.view === 'search'}
                  onOpenHit={onOpenSearchHit}
                />
              }
              manuscript={
                projectOpen ? (
                  <ManuscriptView
                    snapshot={bookContext.snapshot}
                    availability={bookContext.availability}
                    refreshing={bookContext.refreshing}
                    onRefresh={bookContext.refresh}
                    onOpenChapter={onOpenManuscriptChapter}
                    onBackToExplorer={shell.showExplorerView}
                  />
                ) : (
                  <p className="px-3 py-4 text-2xs leading-relaxed text-subtle">
                    打开项目后可查看按阅读序排列的章节。
                  </p>
                )
              }
              knowledge={<KnowledgeInboxView handle={knowledgeInbox} />}
              observatory={
                projectOpen ? (
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
                    merging={observatory.merging}
                    onRescan={() => void observatory.runScan()}
                    onBackToChat={shell.showExplorerView}
                    onLocateObservation={observatory.locateObservation}
                    onLocateAnchor={observatory.locateAnchor}
                    onMergeProposal={(target) => void observatory.mergeProposal(target)}
                  />
                ) : (
                  <p className="px-3 py-4 text-2xs leading-relaxed text-subtle">
                    打开项目后可查看世界线观测镜。
                  </p>
                )
              }
            />
          )}
        </div>

        <main
          className={`${shell.layoutMode === 'chat' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col bg-background`}
          data-testid="shell-center"
        >
          {/* 项目已打开 */}
          {centerHasTabs ? (
            shell.dashboardVisible ? (
              // 显示项目仪表盘（落地页）
              <ProjectDashboard
                projectPath={activeProject!}
                bookProfile={bookProfile}
                bookContext={bookContext}
                onStartWriting={onStartWriting}
                onViewSettings={() => {
                  shell.switchView('observatory');
                }}
              />
            ) : (
              // 显示编辑器
              <>
                <EditorTabs
                  openFiles={tabs.openFiles}
                  activeFile={currentFile}
                  previewFile={tabs.previewFile}
                  dirtyFiles={tabs.dirtyFiles}
                  activeTab={activeCenterTab}
                  activeReadOnly={
                    tabs.displayedFile ? isReadOnlyDerivedProjectPath(tabs.displayedFile) : false
                  }
                  onFocusFile={tabs.focusFile}
                  onReorderFiles={tabs.reorderOpenFiles}
                  onFocusPreview={tabs.focusPreview}
                  onPinPreview={tabs.pinPreview}
                  onCloseFile={(path) => void tabs.handleFileClose(path)}
                  onClosePreview={tabs.closePreview}
                  onSaveActive={() => {
                    if (tabs.displayedFile) {
                      void flushActiveEditorToDisk(tabs.displayedFile).catch(() => undefined);
                    }
                  }}
                  onToggleHistory={() => emitEditorCommand('toggle-history')}
                  onExportActive={() => emitExportCurrentFile()}
                  onCloseOthers={() => void tabs.handleCloseOthers()}
                  onCloseAll={() => void tabs.handleCloseAll()}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <section
                    className="h-full min-h-0 overflow-hidden bg-background"
                    data-testid="editor-panel"
                  >
                    <Editor
                      projectPath={activeProject}
                      filePath={tabs.displayedFile}
                      editorFontSize={preferences.settings.editorFontSize}
                      editorFontMode={preferences.settings.editorFontMode}
                      editorProseMeasure={preferences.settings.editorProseMeasure}
                      editorLineNumbers={preferences.settings.editorLineNumbers}
                      autoSave={preferences.settings.autoSave}
                      retainedFilePaths={tabs.retainedEditorFiles}
                      onDirtyChange={tabs.handleEditorDirtyChange}
                      initialCursors={initialCursors}
                      onCursorPersist={onCursorPersist}
                      dropOpenFilePath={tabs.dropOpenFilePath}
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
            )
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
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-testid="right-chat-pane"
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
                agentPermissionProfile={agentPermission.profile}
                onAgentPermissionProfileChange={agentPermission.changeProfile}
              />
            </div>
          </AssistantPanelFrame>
        )}
      </div>

      <StatusBar
        modelLabel={preferences.modelLabel}
        projectOpen={projectOpen}
        projectPath={activeProject}
        dailyWordGoal={preferences.settings.dailyWordGoal}
        obs={obs}
        observationAvailability={observatory.availability}
        onToggleObs={toggleObsPanel}
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
          onToggleFontMode={preferences.toggleFontMode}
          onCycleProseMeasure={preferences.cycleProseMeasure}
          fontModeLabel={
            preferences.settings.editorFontMode === 'prose' ? '当前：书稿' : '当前：格子'
          }
          proseMeasureLabel={`当前：${PROSE_MEASURE_LABELS[preferences.settings.editorProseMeasure]}`}
        />
      )}
      {settingsVisible && (
        <SettingsView
          settings={preferences.settings}
          onChange={preferences.setSettings}
          onClose={() => setSettingsVisible(false)}
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
