import type { Dispatch, SetStateAction } from 'react';

import { ChatWindow } from '../ChatWindow';
import { CommandPalette, type PaletteMode } from '../CommandPalette';
import { Editor } from '../Editor';
import { SettingsView } from '../SettingsView';
import { ActivityBar } from '../shell/ActivityBar';
import { AssistantPanelFrame } from '../shell/AssistantPanelFrame';
import { EditorTabs, type CenterTab } from '../shell/EditorTabs';
import {
  ObsPanel,
  obsCounts,
  type Observation,
  type ObservationAvailability,
} from '../shell/ObsPanel';
import { SidePanel } from '../shell/SidePanel';
import { StatusBar } from '../shell/StatusBar';
import { Titlebar } from '../shell/Titlebar';
import type { useShellState } from '../shell/useShellState';
import {
  emitEditorCommand,
  emitExportCurrentFile,
  flushActiveEditorToDisk,
} from '../../lib/assistant-events';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import type { useAppDialog } from './AppDialog';
import { AppDialogHost } from './AppDialog';
import { WelcomeWorkspace } from './WelcomeWorkspace';
import type { AppPreferences } from './useAppPreferences';
import type { EditorWorkspaceTabs } from './useEditorWorkspaceTabs';
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
  observations: Observation[];
  observationAvailability: ObservationAvailability;
  resolveObservation: (id: string) => void;
  locateObservation: (observation: Observation) => void;
  openSettings: () => Promise<void>;
  openPublishSide: () => void;
  handlePublishCommand: (type: string) => void;
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
  observations,
  observationAvailability,
  resolveObservation,
  locateObservation,
  openSettings,
  openPublishSide,
  handlePublishCommand,
}: AppShellProps) {
  const { projects, activeProject, currentFile, projectAssistantSessions } = workspace;
  const projectOpen = Boolean(activeProject);
  const rightPanelVisible = projectOpen && !shell.rightCollapsed;
  const obs = obsCounts(observations);
  const centerHasTabs = settingsVisible || projectOpen;
  const activeCenterTab: CenterTab | null = settingsVisible
    ? 'settings'
    : tabs.previewFile && tabs.previewFile !== currentFile
      ? 'preview'
      : currentFile
        ? 'file'
        : null;

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
              onStartNewBook={commands.handleStartNewBook}
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
                onFocusPreview={tabs.focusPreview}
                onPinPreview={tabs.pinPreview}
                onFocusSettings={() => void openSettings()}
                onCloseFile={(path) => void tabs.handleFileClose(path)}
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
                  observations={observations}
                  availability={observationAvailability}
                  onClose={() => setObsPanelOpen(false)}
                  onResolve={resolveObservation}
                  onLocate={locateObservation}
                />
              )}
            </>
          ) : (
            <WelcomeWorkspace
              activeProject={activeProject}
              onOpenProject={commands.handleOpenProject}
              onInitializeProject={commands.handleInitializeStoryProject}
              onCreateSampleProject={commands.handleCreateSampleProject}
              onOpenSettings={openSettings}
              onBrowseFiles={() => setPalette('files')}
              onShowWorkbench={shell.showSidebar}
              providerModel={preferences.settings.provider.model}
              onApplyModel={preferences.handleQuickModelChange}
              providerKind={preferences.settings.provider.kind}
              onApplyProvider={preferences.handleQuickProviderChange}
              composerValue={commands.welcomeDraft}
              onComposerChange={commands.setWelcomeDraft}
              onComposerSend={commands.handleWelcomeSend}
            />
          )}
        </main>

        {projectOpen && (
          <AssistantPanelFrame visible={rightPanelVisible} wide={shell.layoutMode === 'chat'}>
            <ChatWindow
              projectPath={activeProject}
              currentFile={currentFile}
              assistantSessionId={
                activeProject ? (projectAssistantSessions[activeProject] ?? null) : null
              }
              pendingInitialPrompt={commands.pendingWelcomePrompt}
              onPendingInitialPromptConsumed={commands.handlePendingWelcomePromptConsumed}
              onAssistantSessionChange={workspace.setActiveProjectAssistantSession}
              layoutMode={shell.layoutMode}
              onSetLayoutMode={shell.setLayoutMode}
            />
          </AssistantPanelFrame>
        )}
      </div>

      <StatusBar
        modelLabel={preferences.modelLabel}
        theme={preferences.settings.theme}
        projectOpen={projectOpen}
        fontMode={preferences.settings.editorFontMode}
        obs={obs}
        observationAvailability={observationAvailability}
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
          onExportCurrent={() => emitExportCurrentFile()}
          onToggleAssistant={shell.toggleRight}
          onToggleWorkspace={shell.toggleSidebar}
          onOpenSettings={openSettings}
          onOpenPublish={openPublishSide}
          onPublishCommand={handlePublishCommand}
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
    </div>
  );
}
