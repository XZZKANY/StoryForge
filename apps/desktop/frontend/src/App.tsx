/**
 * StoryForge desktop shell.
 * 固定三栏「编辑器中枢」布局：顶栏 / 活动栏+侧面板 / 中栏正文 C 位 / 右栏 Agent 面板 / 状态栏。
 * 中栏 = Monaco 编辑器（正文 C 位）；右栏 = 对话式 agent 面板。无拖拽分割线。
 */

import { useState, useEffect, useCallback } from 'react';
import { CommandPalette, PaletteMode } from './components/CommandPalette';
import { SettingsView } from './components/SettingsView';
import { Editor } from './components/Editor';
import { ChatWindow } from './components/ChatWindow';
import { TauriFileSystem } from './lib/tauri-fs';
import { createSampleStoryProject, initializeStoryProject } from './lib/project-context';
import { registerSmokeFileLoader, registerSmokeProjectLoader } from './lib/smoke';
import { APPLY_FILE_SUGGESTION_EVENT, emitExportCurrentFile } from './lib/assistant-events';
import type { AssistantFileSuggestion } from './lib/assistant-suggestions';
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
  type ProviderKind,
} from './lib/user-settings';
import { saveDesktopLlmConfig } from './lib/desktop-llm-config';
import { applyProviderPreset, getProviderPreset } from './lib/provider-config';
import { applyTheme } from './lib/theme';
import { WelcomeWorkspace } from './components/app/WelcomeWorkspace';
import { joinPath, normalizeMarkdownFileName } from './components/app/helpers';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import { AppDialogHost, useAppDialog } from './components/app/AppDialog';
import { Titlebar } from './components/shell/Titlebar';
import { ActivityBar } from './components/shell/ActivityBar';
import { SidePanel } from './components/shell/SidePanel';
import { StatusBar } from './components/shell/StatusBar';
import { useShellState, type SidePanelView } from './components/shell/useShellState';

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const [welcomeDraft, setWelcomeDraft] = useState('');
  const [pendingWelcomePrompt, setPendingWelcomePrompt] = useState<string | null>(null);
  const appDialog = useAppDialog();
  const shell = useShellState();

  const handleProjectSelected = useCallback(() => {
    setSettingsVisible(false);
  }, []);
  const handleWorkspaceFileSelected = useCallback(() => {
    setSettingsVisible(false);
  }, []);
  const {
    projects,
    activeProject,
    currentFile,
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

  const handleSelectProjectSession = useCallback(
    (path: string, assistantSessionId: number) => {
      selectProject(path);
      setActiveProjectAssistantSession(assistantSessionId, path);
    },
    [selectProject, setActiveProjectAssistantSession],
  );

  const handleNewProjectSession = useCallback(
    (path: string) => {
      selectProject(path);
      setActiveProjectAssistantSession(null, path);
    },
    [selectProject, setActiveProjectAssistantSession],
  );

  // 欢迎页首条输入：先记住 prompt，打开项目后由 ChatWindow 自动发出。
  const handleWelcomeSend = useCallback(() => {
    const prompt = welcomeDraft.trim();
    if (!prompt) return;
    setPendingWelcomePrompt(prompt);
    void handleOpenProject();
  }, [welcomeDraft, handleOpenProject]);

  const handlePendingWelcomePromptConsumed = useCallback(() => {
    setPendingWelcomePrompt(null);
    setWelcomeDraft('');
  }, []);

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
    } catch (error) {
      console.error('创建示例项目失败', error);
      await appDialog.alert({
        title: '创建示例项目失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [appDialog, selectProject]);

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

  // Agent 补丁可能指向未打开（甚至尚不存在）的文件：自动打开目标文件，
  // 编辑器加载完成后经 takePendingFileSuggestion 领取补丁进入确认面板。
  useEffect(() => {
    const normalize = (path: string) => path.replace(/\\/g, '/');
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion?.filePath || !activeProject) return;
      const target = normalize(suggestion.filePath);
      const projectPrefix = normalize(activeProject).replace(/\/+$/, '') + '/';
      if (!target.startsWith(projectPrefix)) return;
      if (currentFile && normalize(currentFile) === target) return;
      handleFileSelect(suggestion.filePath);
    };
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    return () => {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    };
  }, [activeProject, currentFile, handleFileSelect]);

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
      } catch (error) {
        console.error('初始化项目结构失败', error);
        await appDialog.alert({
          title: '初始化项目结构失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeProject, appDialog, handleOpenProject],
  );

  const openSettings = useCallback(() => {
    setSettingsVisible(true);
  }, []);

  const handleStartNewBook = useCallback(() => {
    setSettingsVisible(false);
    void handleOpenProject();
  }, [handleOpenProject]);

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

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (e.shiftKey) {
        const viewMap: Record<string, SidePanelView> = {
          e: 'explorer',
          f: 'search',
          c: 'sessions',
          m: 'qa',
        };
        const view = viewMap[key];
        if (view) {
          e.preventDefault();
          shell.switchView(view);
          return;
        }
        if (key === 'p') {
          e.preventDefault();
          setPalette('commands');
        }
        return;
      }
      if (key === 'p') {
        e.preventDefault();
        setPalette('files');
      } else if (key === 'b') {
        e.preventDefault();
        shell.toggleSidebar();
      } else if (key === ',') {
        e.preventDefault();
        setSettingsVisible(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shell]);

  const { isDesktopRuntime, tauriMenuReady, tauriMenuError, smokeApiReady } = useTauriMenuBridge({
    onOpenProject: handleOpenProject,
    onNewFile: handleNewFile,
    onToggleSidebar: shell.toggleSidebar,
    onRestoreFullLayout: () => {
      shell.showSidebar();
      shell.showRight();
    },
  });

  const projectOpen = Boolean(activeProject);
  const modelLabel =
    settings.provider.model.trim() || getProviderPreset(settings.provider.kind).label;
  const rightPanelVisible = projectOpen && !shell.rightCollapsed;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-testid="desktop-shell"
      data-layout-mode={shell.view}
      data-tauri-runtime={isDesktopRuntime ? 'true' : 'false'}
      data-tauri-menu-ready={tauriMenuReady ? 'true' : 'false'}
      data-smoke-api-ready={smokeApiReady ? 'true' : 'false'}
      data-tauri-menu-error={tauriMenuError}
    >
      <Titlebar projectName={activeProject} onOpenPalette={() => setPalette('files')} />

      <div className="relative flex min-h-0 flex-1">
        <div className="flex flex-shrink-0">
          <ActivityBar
            view={shell.view}
            sidebarHidden={shell.sidebarHidden}
            noProject={!projectOpen}
            qaBadge={0}
            onSwitchView={shell.switchView}
            onOpenPalette={() => setPalette('files')}
            onOpenSettings={openSettings}
          />
          {!shell.sidebarHidden && (
            <SidePanel
              view={shell.view}
              projects={projects}
              activeProject={activeProject}
              currentFile={currentFile}
              projectRefreshVersion={projectRefreshVersion}
              activeAssistantSessionId={
                activeProject ? (projectAssistantSessions[activeProject] ?? null) : null
              }
              onSelectProject={selectProject}
              onSelectProjectSession={handleSelectProjectSession}
              onNewProjectSession={handleNewProjectSession}
              onOpenProject={handleOpenProject}
              onNewFile={handleNewFile}
              onFileSelect={handleFileSelect}
              onStartNewBook={handleStartNewBook}
            />
          )}
        </div>

        <main className="flex min-w-0 flex-1 flex-col bg-background" data-testid="shell-center">
          {settingsVisible ? (
            <div className="min-h-0 flex-1">
              <SettingsView
                settings={settings}
                onChange={setSettings}
                onClose={() => setSettingsVisible(false)}
              />
            </div>
          ) : projectOpen ? (
            <section className="min-h-0 flex-1 bg-background" data-testid="editor-panel">
              <Editor
                projectPath={activeProject}
                filePath={currentFile}
                editorFontSize={settings.editorFontSize}
                autoSave={settings.autoSave}
                onClose={currentFile ? handleFileClose : () => shell.toggleSidebar()}
                onToggleSidebar={shell.toggleSidebar}
                sidebarVisible={!shell.sidebarHidden}
                onExportCurrent={() => emitExportCurrentFile()}
                dialogs={appDialog}
              />
            </section>
          ) : (
            <WelcomeWorkspace
              activeProject={activeProject}
              onOpenProject={handleOpenProject}
              onInitializeProject={handleInitializeStoryProject}
              onCreateSampleProject={handleCreateSampleProject}
              onOpenSettings={openSettings}
              onBrowseFiles={() => setPalette('files')}
              onShowWorkbench={shell.showSidebar}
              providerModel={settings.provider.model}
              onApplyModel={handleQuickModelChange}
              providerKind={settings.provider.kind}
              onApplyProvider={handleQuickProviderChange}
              composerValue={welcomeDraft}
              onComposerChange={setWelcomeDraft}
              onComposerSend={handleWelcomeSend}
            />
          )}
        </main>

        {rightPanelVisible && (
          <section
            className="flex w-[384px] flex-shrink-0 flex-col border-l border-border bg-panel"
            data-testid="assistant-panel"
          >
            <ChatWindow
              projectPath={activeProject}
              currentFile={currentFile}
              assistantSessionId={
                activeProject ? (projectAssistantSessions[activeProject] ?? null) : null
              }
              pendingInitialPrompt={pendingWelcomePrompt}
              onPendingInitialPromptConsumed={handlePendingWelcomePromptConsumed}
              onAssistantSessionChange={setActiveProjectAssistantSession}
            />
          </section>
        )}
      </div>

      <StatusBar
        modelLabel={modelLabel}
        theme={settings.theme}
        projectOpen={projectOpen}
        onToggleTheme={toggleTheme}
        onToggleRight={shell.toggleRight}
      />

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
        dialog={appDialog.dialog}
        onClose={appDialog.closeDialog}
        onPromptValueChange={appDialog.updatePromptValue}
      />
    </div>
  );
}
