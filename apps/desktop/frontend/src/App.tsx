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
import { createSampleStoryProject, initializeStoryProject } from './lib/project-context';
import { registerSmokeFileLoader, registerSmokeProjectLoader } from './lib/smoke';
import { emitExportCurrentFile } from './lib/assistant-events';
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
  type ProviderKind,
} from './lib/user-settings';
import { saveDesktopLlmConfig } from './lib/desktop-llm-config';
import { applyProviderPreset } from './lib/provider-config';
import { applyTheme } from './lib/theme';
import { WindowMenu } from './components/app/WindowMenu';
import { CodexSidebar } from './components/app/CodexSidebar';
import { AgentWorkspace, WelcomeWorkspace } from './components/app/WelcomeWorkspace';
import { RightWorkspace, FloatingComposer } from './components/app/RightWorkspace';
import { activeProjectLabel, joinPath, normalizeMarkdownFileName } from './components/app/helpers';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useShellLayout } from './components/app/useShellLayout';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import { AppDialogHost, useAppDialog } from './components/app/AppDialog';

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const appDialog = useAppDialog();
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
    setSettingsVisible(false);
    restoreFullLayout();
  }, [restoreFullLayout]);
  const handleWorkspaceFileSelected = useCallback(() => {
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

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

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

  const handleCreateSampleProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择示例项目保存位置',
      });
      if (!selected || typeof selected !== 'string') return;
      const projectPath = await createSampleStoryProject(selected);
      selectProject(projectPath);
      setProjectRefreshVersion((version) => version + 1);
      setSettingsVisible(false);
      showWorkbenchPanel();
    } catch (error) {
      console.error('创建示例项目失败', error);
      await appDialog.alert({
        title: '创建示例项目失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [appDialog, selectProject, showWorkbenchPanel]);

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
  }, [closeFile]);

  const handleNewFile = useCallback(
    async (projectOverride?: string) => {
      const targetProject = projectOverride ?? activeProject;
      if (!targetProject) {
        await handleOpenProject();
        return;
      }

      const input = await appDialog.prompt({
        title: '新建文件',
        message: '输入文件名（带 .md 扩展名）：',
        defaultValue: 'untitled.md',
        confirmLabel: '创建',
      });
      if (input === null) return;

      const relativePath = normalizeMarkdownFileName(input);
      if (!relativePath) return;

      const filePath = joinPath(targetProject, relativePath);
      try {
        const exists = await TauriFileSystem.pathExists(filePath);
        if (exists) {
          const shouldOpen = await appDialog.confirm({
            title: '文件已存在',
            message: '是否直接打开这个文件？',
            confirmLabel: '打开',
          });
          if (!shouldOpen) return;
        } else {
          await TauriFileSystem.writeFile(filePath, '# 新建文件\n\n');
        }
        handleFileSelect(filePath);
      } catch (error) {
        console.error('新建文件失败', error);
        await appDialog.alert({
          title: '新建文件失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeProject, appDialog, handleFileSelect, handleOpenProject],
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
        setSettingsVisible(false);
        showWorkbenchPanel();
      } catch (error) {
        console.error('初始化项目结构失败', error);
        await appDialog.alert({
          title: '初始化项目结构失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeProject, appDialog, handleOpenProject, showWorkbenchPanel],
  );

  const handleComposerModeChange = useCallback(
    (mode: ComposerLayoutMode) => {
      setSettingsVisible(false);
      applyComposerMode(mode);
    },
    [applyComposerMode],
  );

  const openSettings = useCallback(() => {
    setSettingsVisible(true);
    prepareSettingsLayout();
  }, [prepareSettingsLayout]);

  const handleQuickModelChange = useCallback(
    async (model: string) => {
      const trimmed = model.trim();
      setSettings((prev) => ({ ...prev, provider: { ...prev.provider, model: trimmed } }));
      try {
        // 后端实时读取 llm-provider.json，写入即生效，无需重启。
        await saveDesktopLlmConfig({
          provider: settings.provider.kind,
          baseUrl: settings.provider.baseUrl,
          model: trimmed,
        });
      } catch {
        // 桌面外/后端未接入时静默：仅更新本地设置。
      }
    },
    [settings.provider.kind, settings.provider.baseUrl],
  );

  const handleQuickProviderChange = useCallback(
    async (kind: ProviderKind) => {
      const nextProvider = applyProviderPreset(settings.provider, kind, { preserveModel: true });
      setSettings((prev) => ({ ...prev, provider: nextProvider }));
      try {
        await saveDesktopLlmConfig({
          provider: nextProvider.kind,
          baseUrl: nextProvider.baseUrl,
          model: nextProvider.model,
        });
      } catch {
        // 桌面外/后端未接入时静默：仅更新本地设置。
      }
    },
    [settings.provider],
  );

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

  const { isDesktopRuntime, tauriMenuReady, tauriMenuError, smokeApiReady } = useTauriMenuBridge({
    onOpenProject: handleOpenProject,
    onNewFile: handleNewFile,
    onToggleSidebar: toggleWorkspace,
    onRestoreFullLayout: restoreFullLayout,
  });

  const projectName = activeProjectLabel(activeProject);
  const workbenchPanelVisible = workspaceVisible || editorVisible;
  const welcomeVisible = !activeProject;
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
      className="h-screen bg-background text-foreground overflow-hidden flex flex-col"
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
                onCreateSampleProject={handleCreateSampleProject}
                onOpenSettings={openSettings}
                onBrowseFiles={() => setPalette('files')}
                onShowWorkbench={() => {
                  showWorkbenchPanel();
                }}
                providerModel={settings.provider.model}
                onApplyModel={handleQuickModelChange}
                providerKind={settings.provider.kind}
                onApplyProvider={handleQuickProviderChange}
              />
            ) : (
              <section className="h-full min-w-0 bg-background" data-testid="assistant-panel">
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
                  onOpenProject={handleOpenProject}
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
              onToggleWorkspace={toggleWorkspace}
              onRestoreWorkspace={restoreWorkspacePanel}
              onExportCurrent={() => emitExportCurrentFile()}
              dialogs={appDialog}
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
      <AppDialogHost
        dialog={appDialog.dialog}
        onClose={appDialog.closeDialog}
        onPromptValueChange={appDialog.updatePromptValue}
      />
    </div>
  );
}
