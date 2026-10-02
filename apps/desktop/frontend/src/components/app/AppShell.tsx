import { useCallback, useRef } from 'react';

import { ChatWindow } from '../ChatWindow';
import { CommandPalette } from '../CommandPalette';
import { PROSE_MEASURE_LABELS } from '../editor/options';
import { SettingsView } from '../SettingsView';
import { ActivityBar } from '../shell/ActivityBar';
import { AssistantPanelFrame } from '../shell/AssistantPanelFrame';
import type { CenterTab } from '../shell/EditorTabs';
import { BookProfileView } from '../shell/BookProfileView';
import { ManuscriptView } from '../shell/ManuscriptView';
import { KnowledgeInboxView } from '../shell/KnowledgeInboxView';
import { ObservatoryView } from '../shell/ObservatoryView';
import { SearchView } from '../shell/SearchView';
import { SidePanel } from '../shell/SidePanel';
import { Titlebar } from '../shell/Titlebar';
import { ToastHost } from '../shell/ToastHost';
import { useDeference } from '../shell/useDeference';
import { useWorkspaceSidePanelLimit } from '../shell/useWorkspaceSidePanelLimit';
import { WORKSPACE_PRIMARY_MIN_WIDTH } from '../../lib/workspace-layout';
import { emitExportCurrentFile } from '../../lib/assistant-events';
import { AppDialogHost } from './AppDialog';
import { resolveActiveCenterTab } from './editor-tabs-state';
import { createShellHelp } from './shell-help';
import { useAgentPermission } from './useAgentPermission';
import { useFileTreeActions } from './useFileTreeActions';
import { ProjectLibrary } from './ProjectLibrary';
import { NewProjectDialog } from './NewProjectDialog';
import { useKnowledgeInbox } from './useKnowledgeInbox';
import type { MainSurface, AppShellProps } from './app-shell-types';
export type { ObservatoryHandle } from './app-shell-types';
import { WritingWorkspace } from './WritingWorkspace';

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
  bookContext,
  onOpenManuscriptChapter,
  onDraftNextChapter,
  bookProfile,
  onOpenOutlineHeading,
  openSettings,
  onOpenLibrary,
  onResumeProject,
  openingProject,
  initialCursors,
  onCursorPersist,
  onPendingSuggestionChange,
  onAgentRunSummaryChange,
  search,
  onOpenSearchHit,
  overview,
  mainSurface = 'workspace',
  onMainSurfaceChange,
  onSwitchView = shell.switchView,
}: AppShellProps) {
  const { projects, activeProject, currentFile, projectAssistantSessions } = workspace;
  const projectOpen = Boolean(activeProject);
  const libraryVisible = !projectOpen || mainSurface === 'library';
  const overviewVisible = projectOpen && mainSurface === 'overview' && Boolean(overview);
  const workspaceVisible = projectOpen && !libraryVisible && !overviewVisible;
  const libraryButtonRef = useRef<HTMLButtonElement>(null);
  const setMainSurface = useCallback(
    (next: MainSurface) => {
      onMainSurfaceChange?.(next);
    },
    [onMainSurfaceChange],
  );

  const openWorkspace = useCallback(() => {
    setMainSurface('workspace');
    setSettingsVisible(false);
    shell.showCenter();
  }, [setMainSurface, setSettingsVisible, shell]);
  const toggleAssistantFromCommand = useCallback(() => {
    if (!workspaceVisible) {
      openWorkspace();
      shell.showRight();
    } else {
      shell.toggleRight();
    }
  }, [openWorkspace, workspaceVisible, shell]);
  const toggleWorkspaceFromCommand = useCallback(() => {
    if (!workspaceVisible) {
      openWorkspace();
      shell.showSidebar();
    } else {
      shell.toggleSidebar();
    }
  }, [openWorkspace, workspaceVisible, shell]);
  // P2-C：作品资料编辑器藏在「book」视图里，普通作者很难找到；overview 顶栏已有按钮，
  // 封面空态的「点击添加」也复用同一路径。
  const openBookProfileEditor = useCallback(() => {
    openWorkspace();
    shell.showExplorerView();
    shell.switchView('book');
    shell.showSidebar();
    shell.showCenter();
  }, [openWorkspace, shell]);
  const handleOpenOutlineHeading = useCallback(
    (path: string, line: number) => {
      openWorkspace();
      onOpenOutlineHeading(path, line);
    },
    [onOpenOutlineHeading, openWorkspace],
  );
  const handleOpenManuscriptChapter = useCallback(
    (relativePath: string) => {
      openWorkspace();
      onOpenManuscriptChapter(relativePath);
    },
    [onOpenManuscriptChapter, openWorkspace],
  );
  const handleOpenSearchHit = useCallback(
    (path: string, line: number) => {
      openWorkspace();
      onOpenSearchHit(path, line);
    },
    [onOpenSearchHit, openWorkspace],
  );
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarVisible = !shell.sidebarHidden && (projectOpen || shell.view !== 'explorer');
  const sidePanelMaxWidth = useWorkspaceSidePanelLimit(projectOpen, shell.layoutMode);
  const agentPermission = useAgentPermission(activeProject);
  const knowledgeInbox = useKnowledgeInbox(activeProject);
  const rightPanelVisible = workspaceVisible && !shell.rightCollapsed;
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

  const { showShortcuts, settingsMenu } = createShellHelp({
    dialogs,
    theme: preferences.settings.theme,
    toggleTheme: preferences.toggleTheme,
    openSettings,
    openCommands: () => setPalette('commands'),
  });

  const deferred = useDeference();

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-testid="desktop-shell"
      data-main-surface={mainSurface}
      data-layout-mode={shell.view}
      data-layout-focus={shell.layoutMode}
      data-compact-workspace={shell.compact}
      data-shell-deferred={deferred ? 'true' : 'false'}
      data-tauri-runtime={runtime.isDesktopRuntime ? 'true' : 'false'}
      data-tauri-menu-ready={runtime.tauriMenuReady ? 'true' : 'false'}
      data-smoke-api-ready={runtime.smokeApiReady ? 'true' : 'false'}
      data-tauri-menu-error={runtime.tauriMenuError}
    >
      <Titlebar
        onOpenPalette={() => setPalette(projectOpen ? 'files' : 'commands')}
        onOpenLibrary={onOpenLibrary}
        libraryVisible={libraryVisible}
        libraryButtonRef={libraryButtonRef}
        projectOpen={projectOpen}
        rightCollapsed={!workspaceVisible || shell.rightCollapsed}
        onToggleRight={() => {
          openWorkspace();
          if (!workspaceVisible) shell.showRight();
          else shell.toggleRight();
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* wrapper 保持透明：露出 root 的画布底色，二级面板左缘圆角的切口
            才能透出与 rail 相同的底色，读作「面板覆盖在 rail 之上」。 */}
        <div className={libraryVisible ? 'hidden' : 'flex flex-shrink-0'} hidden={libraryVisible}>
          <ActivityBar
            view={overviewVisible ? 'book' : shell.view}
            sidebarHidden={overviewVisible ? false : !sidebarVisible}
            onSwitchView={onSwitchView}
            onOpenSettings={() => void openSettings()}
            settingsMenu={settingsMenu}
            settingsButtonRef={settingsButtonRef}
            observatoryAttention={observatory.litEntityIds.length > 0}
            knowledgePendingCount={knowledgeInbox.inbox.pending_count}
          />
          {(projectOpen || shell.view !== 'explorer') && (
            <div
              hidden={!sidebarVisible || !workspaceVisible}
              className={!sidebarVisible || !workspaceVisible ? 'hidden' : 'flex'}
              data-testid="workspace-sidebar-surface"
            >
              <SidePanel
                view={shell.view}
                width={preferences.settings.sidePanelWidth}
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
                      onOpenOutline={handleOpenOutlineHeading}
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
                    onOpenHit={handleOpenSearchHit}
                  />
                }
                manuscript={
                  projectOpen ? (
                    <ManuscriptView
                      snapshot={bookContext.snapshot}
                      availability={bookContext.availability}
                      refreshing={bookContext.refreshing}
                      onRefresh={bookContext.refresh}
                      onOpenChapter={handleOpenManuscriptChapter}
                      onBackToExplorer={shell.showExplorerView}
                      onDraftNextChapter={onDraftNextChapter}
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
            </div>
          )}
        </div>

        <main
          className={`${workspaceVisible && shell.layoutMode === 'chat' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col bg-background`}
          data-testid="shell-center"
          style={
            workspaceVisible
              ? { minWidth: shell.compact ? 0 : WORKSPACE_PRIMARY_MIN_WIDTH }
              : undefined
          }
        >
          {centerHasTabs ? (
            <>
              <WritingWorkspace
                hidden={!workspaceVisible}
                workspace={workspace}
                tabs={tabs}
                preferences={preferences}
                dialogs={dialogs}
                shell={shell}
                initialCursors={initialCursors}
                onCursorPersist={onCursorPersist}
                onPendingSuggestionChange={onPendingSuggestionChange}
                obsPanelOpen={obsPanelOpen}
                setObsPanelOpen={setObsPanelOpen}
                observatory={observatory}
                onOverview={overview ? () => setMainSurface('overview') : undefined}
                activeCenterTab={activeCenterTab}
                permissionProfile={agentPermission.profile}
              />
              {overview && (
                <div
                  className={`${overviewVisible ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-y-auto bg-background`}
                  hidden={!overviewVisible}
                  data-testid="book-overview-surface"
                >
                  <div className="flex flex-shrink-0 flex-wrap justify-end gap-2 px-5 py-2">
                    <button
                      type="button"
                      className="rounded-sm px-3 py-1 text-xs text-muted hover:bg-elevated"
                      data-testid="edit-book-profile"
                      onClick={openBookProfileEditor}
                    >
                      编辑作品资料
                    </button>
                    <button
                      type="button"
                      className="rounded-sm px-3 py-1 text-xs text-muted hover:bg-elevated"
                      data-testid="open-writing-workspace"
                      onClick={openWorkspace}
                    >
                      写作工作台 →
                    </button>
                  </div>
                  {overview}
                </div>
              )}
            </>
          ) : null}
          <div
            hidden={!libraryVisible}
            className={`${libraryVisible ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
            data-testid="project-library-surface"
          >
            <ProjectLibrary
              projects={projects}
              activeProject={activeProject}
              openingProject={openingProject}
              onNewProject={commands.newProject.open}
              onOpenProject={commands.handleOpenProject}
              onSelectProject={(path) => {
                if (path === activeProject) onResumeProject();
                else void tabs.selectProjectSafely(path);
              }}
              onResumeProject={onResumeProject}
              onOpenSettings={openSettings}
            />
          </div>
        </main>

        {projectOpen && (
          <AssistantPanelFrame
            visible={rightPanelVisible}
            wide={shell.layoutMode === 'chat'}
            compact={shell.compact}
          >
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-testid="right-chat-pane"
            >
              <ChatWindow
                decisionDialogsActive={
                  rightPanelVisible && !settingsVisible && !palette && !dialogs.dialog
                }
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
                onAgentRunSummaryChange={onAgentRunSummaryChange}
              />
            </div>
          </AssistantPanelFrame>
        )}
      </div>

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
          onReopenWelcome={onOpenLibrary}
          onExportCurrent={() => emitExportCurrentFile()}
          onToggleAssistant={toggleAssistantFromCommand}
          onToggleWorkspace={toggleWorkspaceFromCommand}
          onOpenSettings={openSettings}
          onShowShortcuts={showShortcuts}
          onFocusAssistantOnly={() => {
            openWorkspace();
            shell.showRight();
            shell.setLayoutMode('chat');
          }}
          onFocusWorkspaceOnly={() => {
            openWorkspace();
            shell.showSidebar();
            shell.setLayoutMode('editor');
          }}
          onRestoreLayout={() => {
            openWorkspace();
            shell.showSidebar();
            shell.setLayoutMode('balanced');
          }}
          onShowKnowledge={
            activeProject
              ? () => {
                  openWorkspace();
                  shell.switchView('knowledge');
                  shell.showSidebar();
                }
              : undefined
          }
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
      <NewProjectDialog controller={commands.newProject} fallbackFocusRef={libraryButtonRef} />
      <ToastHost />
    </div>
  );
}
