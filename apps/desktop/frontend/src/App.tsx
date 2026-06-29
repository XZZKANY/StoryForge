/**
 * StoryForge desktop shell.
 * Cursor/Codex-like layout: app menu + left navigation + centered agent workspace
 * with an optional right editor/file panel.
 */

import { useState, useEffect, useCallback } from 'react';
import { CommandPalette, PaletteMode } from './components/CommandPalette';
import { DynamicIDELayout, type ComposerLayoutMode } from './components/DynamicIDELayout';
import { SettingsView } from './components/SettingsView';
import { TauriFileSystem } from './lib/tauri-fs';
import { initializeStoryProject } from './lib/project-context';
import { registerSmokeFileLoader, registerSmokeProjectLoader } from './lib/smoke';
import { emitExportCurrentFile, emitReviewCurrentFile } from './lib/assistant-events';
import { loadAppSettings, saveAppSettings, type AppSettings } from './lib/user-settings';
import { WindowMenu } from './components/app/WindowMenu';
import { CodexSidebar } from './components/app/CodexSidebar';
import { AgentWorkspace, WelcomeWorkspace } from './components/app/WelcomeWorkspace';
import { RightWorkspace, FloatingComposer } from './components/app/RightWorkspace';
import {
  activeProjectLabel,
  joinPath,
  normalizeMarkdownFileName,
} from './components/app/helpers';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useShellLayout } from './components/app/useShellLayout';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [emptyWorkbenchVisible, setEmptyWorkbenchVisible] = useState(false);
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const {
    workspaceVisible,
    editorVisible,
    composerMode,
    layoutMode,
    restoreFullLayout,
    focusAssistantOnly,
    focusWorkspaceOnly,
    markCustomLayout,
    showWorkbenchPanel,
    showEditorForFile,
    restoreWorkspacePanel,
    toggleWorkspace,
    toggleWorkspaceWithEditor,
    applyComposerMode,
    prepareSettingsLayout,
  } = useShellLayout();
  const handleProjectSelected = useCallback(() => {
    setEmptyWorkbenchVisible(false);
    setSettingsVisible(false);
    restoreFullLayout();
  }, [restoreFullLayout]);
  const handleWorkspaceFileSelected = useCallback(() => {
    setEmptyWorkbenchVisible(false);
    setSettingsVisible(false);
    showEditorForFile();
  }, [showEditorForFile]);
  const {
    projects,
    activeProject,
    currentFile,
    recentFiles,
    projectAssistantSessions,
    selectProject,
    selectFile: handleFileSelect,
    closeFile,
    setActiveProjectAssistantSession,
  } = useProjectWorkspace({
    onProjectSelected: handleProjectSelected,
    onFileSelected: handleWorkspaceFileSelected,
  });

  useEffect(() => {
    saveAppSettings(settings);
  }, [settings]);

  const handleOpenProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: '选择项目目录' });
      if (!selected || typeof selected !== 'string') return;
      selectProject(selected);
    } catch (error) {
      console.error('打开项目失败', error);
    }
  }, [selectProject]);

  useEffect(() => {
    return registerSmokeProjectLoader((path: string) => {
      selectProject(path);
    });
  }, [selectProject]);

  useEffect(() => {
    return registerSmokeFileLoader((path: string) => {
      handleFileSelect(path);
    });
  }, [handleFileSelect]);

  const handleFileClose = useCallback(() => {
    closeFile();
    setEmptyWorkbenchVisible(false);
  }, [closeFile]);

  const handleNewFile = useCallback(
    async (projectOverride?: string) => {
      const targetProject = projectOverride ?? activeProject;
      if (!targetProject) {
        await handleOpenProject();
        return;
      }

      const input = window.prompt('新建文件名', 'untitled.md');
      if (input === null) return;

      const relativePath = normalizeMarkdownFileName(input);
      if (!relativePath) return;

      const filePath = joinPath(targetProject, relativePath);
      try {
        const exists = await TauriFileSystem.pathExists(filePath);
        if (exists) {
          const shouldOpen = window.confirm('文件已存在，是否直接打开？');
          if (!shouldOpen) return;
        } else {
          await TauriFileSystem.writeFile(filePath, '# 新建文件\n\n');
        }
        handleFileSelect(filePath);
      } catch (error) {
        console.error('新建文件失败', error);
        window.alert(`新建文件失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [activeProject, handleFileSelect, handleOpenProject],
  );

  const handleInitializeStoryProject = useCallback(
    async (projectOverride?: string) => {
      const targetProject = projectOverride ?? activeProject;
      if (!targetProject) {
        await handleOpenProject();
        return;
      }

      try {
        await initializeStoryProject(targetProject);
        setProjectRefreshVersion((version) => version + 1);
        setEmptyWorkbenchVisible(true);
        setSettingsVisible(false);
        showWorkbenchPanel();
      } catch (error) {
        console.error('初始化项目结构失败', error);
        window.alert(
          `初始化项目结构失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeProject, handleOpenProject, showWorkbenchPanel],
  );

  const handleComposerModeChange = useCallback((mode: ComposerLayoutMode) => {
    setSettingsVisible(false);
    applyComposerMode(mode);
  }, [applyComposerMode]);

  const openSettings = useCallback(() => {
    setSettingsVisible(true);
    prepareSettingsLayout();
  }, [prepareSettingsLayout]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setPalette(e.shiftKey ? 'commands' : 'files');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { isDesktopRuntime, tauriMenuReady, tauriMenuError, smokeApiReady } =
    useTauriMenuBridge({
      onOpenProject: handleOpenProject,
      onNewFile: handleNewFile,
      onToggleSidebar: toggleWorkspace,
      onRestoreFullLayout: restoreFullLayout,
    });

  const projectName = activeProjectLabel(activeProject);
  const workbenchPanelVisible = workspaceVisible || editorVisible;
  const welcomeVisible = !currentFile && !emptyWorkbenchVisible;
  const rightPanelVisible = !welcomeVisible && workbenchPanelVisible;
  const effectiveComposerMode: ComposerLayoutMode = welcomeVisible
    ? 'full'
    : rightPanelVisible
      ? composerMode === 'full'
        ? 'panel'
        : composerMode
      : 'full';

  return (
    <div
      className="h-screen bg-[#18181B] text-[#EDEDED] overflow-hidden flex flex-col"
      data-testid="desktop-shell"
      data-layout-mode={layoutMode}
      data-tauri-runtime={isDesktopRuntime ? 'true' : 'false'}
      data-tauri-menu-ready={tauriMenuReady ? 'true' : 'false'}
      data-smoke-api-ready={smokeApiReady ? 'true' : 'false'}
      data-tauri-menu-error={tauriMenuError}
    >
      <WindowMenu
        activeProject={activeProject}
        onOpenProject={handleOpenProject}
        onNewFile={handleNewFile}
      />

      {settingsVisible ? (
        <div className="min-h-0 flex-1">
          <SettingsView
            settings={settings}
            onChange={setSettings}
            onClose={() => setSettingsVisible(false)}
          />
        </div>
      ) : (
        <DynamicIDELayout
          sidebar={
            <CodexSidebar
              projects={projects}
              activeProject={activeProject}
              settings={settings}
              projectAssistantSessions={projectAssistantSessions}
              onSelectProject={selectProject}
              onOpenProject={handleOpenProject}
              onInitializeProject={handleInitializeStoryProject}
              onOpenSettings={openSettings}
            />
          }
          composerPanel={
            welcomeVisible ? (
              <WelcomeWorkspace
                activeProject={activeProject}
                onOpenProject={handleOpenProject}
                onInitializeProject={handleInitializeStoryProject}
                onBrowseFiles={() => setPalette('files')}
                onShowWorkbench={() => {
                  setEmptyWorkbenchVisible(true);
                  showWorkbenchPanel();
                }}
              />
            ) : (
              <section className="h-full min-w-0 bg-[#18181B]" data-testid="assistant-panel">
                <AgentWorkspace
                  projectPath={activeProject}
                  currentFile={currentFile}
                  assistantSessionId={
                    activeProject ? (projectAssistantSessions[activeProject] ?? null) : null
                  }
                  exposeWorkspaceToggle={!workbenchPanelVisible}
                  layoutMode={layoutMode}
                  onAssistantSessionChange={setActiveProjectAssistantSession}
                  onFocusOnly={focusAssistantOnly}
                  onRestoreLayout={restoreFullLayout}
                  onInitializeProject={handleInitializeStoryProject}
                  onCollapse={() => handleComposerModeChange('floating')}
                />
              </section>
            )
          }
          floatingComposer={
            <FloatingComposer
              projectName={projectName}
              onRestore={() => handleComposerModeChange('panel')}
              onRestoreLayout={restoreFullLayout}
              onFullConversation={() => handleComposerModeChange('full')}
            />
          }
          rightPanel={
            <RightWorkspace
              activeProject={activeProject}
              currentFile={currentFile}
              recentFiles={recentFiles}
              workspaceVisible={workspaceVisible}
              projectRefreshVersion={projectRefreshVersion}
              editorFontSize={settings.editorFontSize}
              autoSave={settings.autoSave}
              onFileSelect={handleFileSelect}
              onFileClose={handleFileClose}
              onCloseWorkspace={() => handleComposerModeChange('full')}
              onFocusWorkspaceOnly={() => handleComposerModeChange('floating')}
              onToggleWorkspace={toggleWorkspace}
              onRestoreWorkspace={restoreWorkspacePanel}
              onExportCurrent={() => emitExportCurrentFile()}
            />
          }
          rightPanelVisible={rightPanelVisible}
          composerMode={effectiveComposerMode}
          onComposerModeChange={handleComposerModeChange}
        />
      )}

      {palette && (
        <CommandPalette
          mode={palette}
          projectPath={activeProject}
          currentFile={currentFile}
          onClose={() => setPalette(null)}
          onOpenFile={handleFileSelect}
          onOpenProject={handleOpenProject}
          onInitializeProject={handleInitializeStoryProject}
          onReviewCurrent={() => emitReviewCurrentFile()}
          onExportCurrent={() => emitExportCurrentFile()}
          onToggleAssistant={() => {
            markCustomLayout();
            handleComposerModeChange(composerMode === 'full' ? 'panel' : 'full');
          }}
          onToggleWorkspace={() => {
            toggleWorkspaceWithEditor();
          }}
          onOpenSettings={openSettings}
          onFocusAssistantOnly={focusAssistantOnly}
          onFocusWorkspaceOnly={focusWorkspaceOnly}
          onRestoreLayout={restoreFullLayout}
        />
      )}
    </div>
  );
}
