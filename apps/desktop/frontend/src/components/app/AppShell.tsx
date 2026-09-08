import { useRef } from 'react';

import { ChatWindow } from '../ChatWindow';
import { CommandPalette } from '../CommandPalette';
import { PROSE_MEASURE_LABELS } from '../editor/options';
import { Editor } from '../Editor';
import { SettingsView } from '../SettingsView';
import { ActivityBar } from '../shell/ActivityBar';
import type { ContextMenuItem } from '../shell/ContextMenu';
import { AssistantPanelFrame } from '../shell/AssistantPanelFrame';
import { EditorTabs, editorTabId, type CenterTab } from '../shell/EditorTabs';
import { ObsPanel, obsCounts } from '../shell/ObsPanel';
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
import {
  useWorkspacePrimaryMinWidth,
  useWorkspaceSidePanelLimit,
} from '../shell/useWorkspaceSidePanelLimit';
import {
  emitEditorCommand,
  emitChapterPolishRequest,
  emitExportCurrentFile,
  flushActiveEditorToDisk,
} from '../../lib/assistant-events';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import { AppDialogHost } from './AppDialog';
import { resolveActiveCenterTab } from './editor-tabs-state';
import { formatShortcutSheet } from './shortcuts';
import { useAgentPermission } from './useAgentPermission';
import { useFileTreeActions } from './useFileTreeActions';
import { WelcomeDismissed, WelcomeWorkspace } from './WelcomeWorkspace';
import { useKnowledgeInbox } from './useKnowledgeInbox';
import type { AppShellProps } from './app-shell-types';
import { useWorkspaceLayoutEffects } from './useWorkspaceLayoutEffects';

export type { ObservatoryHandle } from './app-shell-types';

export function AppShell({
  onUnsentInputChange,
  confirmDiscardInput,
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
}: AppShellProps) {
  const { projects, activeProject, currentFile, projectAssistantSessions } = workspace;
  const projectOpen = Boolean(activeProject);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const obsTriggerRef = useRef<HTMLButtonElement>(null);
  const compactWorkspace = useWorkspaceLayoutEffects(projectOpen, shell);

  const sidebarVisible = !shell.sidebarHidden && (projectOpen || shell.view !== 'explorer');
  const sidePanelMaxWidth = useWorkspaceSidePanelLimit(projectOpen, shell.layoutMode);
  const primaryMinWidth = useWorkspacePrimaryMinWidth(projectOpen);
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
        'StoryForge — 面向小说作者的本地 AI 写作工作台。',
        '',
        '打开你的小说项目，专注写作，与 Agent 一起审稿、构思和修订。',
        '',
        '修改会先生成可查看的差异，默认由你确认后写回。',
        '项目权限可调整，但安全检查、写前快照与版本记录始终保留。',
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
            sidebarHidden={!sidebarVisible}
            onSwitchView={shell.switchView}
            onOpenSettings={() => void openSettings()}
            settingsMenu={settingsMenu}
            settingsButtonRef={settingsButtonRef}
            observatoryAttention={observatory.litEntityIds.length > 0}
            knowledgePendingCount={knowledgeInbox.inbox.pending_count}
          />
          {sidebarVisible && (
            <SidePanel
              view={shell.view}
              widths={preferences.settings.sidePanelWidths}
              maxWidth={sidePanelMaxWidth}
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
                    breakdown={commands.bookBreakdown}
                    breakdownRunning={commands.bookBreakdownRunning}
                    breakdownCancelling={commands.bookBreakdownCancelling}
                    onCancelBreakdown={() => void commands.handleCancelBookBreakdown()}
                    onOpenBreakdown={(format) => void commands.handleOpenBookBreakdown(format)}
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
          style={projectOpen ? { minWidth: primaryMinWidth } : undefined}
        >
          {centerHasTabs ? (
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
                onCloseFile={tabs.handleFileClose}
                onClosePreview={tabs.closePreview}
                onSaveActive={() => {
                  if (tabs.displayedFile) {
                    void flushActiveEditorToDisk(tabs.displayedFile).catch(() => undefined);
                  }
                }}
                onToggleHistory={() => emitEditorCommand('toggle-history')}
                historyTriggerRef={historyTriggerRef}
                onExportActive={() => emitExportCurrentFile()}
                onPolishActive={(useMainModel) => emitChapterPolishRequest({ useMainModel })}
                onCloseOthers={tabs.handleCloseOthers}
                onCloseAll={tabs.handleCloseAll}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                <section
                  className="h-full min-h-0 overflow-hidden bg-background"
                  id="editor-panel"
                  role="tabpanel"
                  aria-labelledby={tabs.displayedFile ? editorTabId(tabs.displayedFile) : undefined}
                  aria-label={tabs.displayedFile ? undefined : '编辑器'}
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
                    historyTriggerRef={historyTriggerRef}
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
                  onClose={() => {
                    setObsPanelOpen(false);
                    requestAnimationFrame(() =>
                      obsTriggerRef.current?.focus({ preventScroll: true }),
                    );
                  }}
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
              onOpenPalette={() => setPalette('commands')}
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
              projectCreationBusy={commands.projectCreationBusy}
              composerValue={commands.welcomeDraft}
              onComposerChange={commands.setWelcomeDraft}
              onComposerSend={commands.handleWelcomeSend}
            />
          )}
        </main>

        {projectOpen && (
          <AssistantPanelFrame
            visible={rightPanelVisible}
            wide={shell.layoutMode === 'chat'}
            compact={compactWorkspace}
          >
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-testid="right-chat-pane"
            >
              <ChatWindow
                onUnsentInputChange={onUnsentInputChange}
                confirmDiscardInput={confirmDiscardInput}
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
        obsTriggerRef={obsTriggerRef}
        observationOpen={obsPanelOpen}
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
          fallbackFocusRef={settingsButtonRef}
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
