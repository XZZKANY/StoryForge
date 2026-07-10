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
import { TauriFileSystem, FS_MUTATION_EVENT } from './lib/tauri-fs';
import {
  createSampleStoryProject,
  initializeStoryProject,
  relativePathInsideProject,
  resolveProjectRelativePath,
} from './lib/project-context';
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
import { normalizeMarkdownFileName } from './components/app/helpers';
import {
  nextDirtyEditorFile,
  shouldConfirmBeforeReplacingDirtyEditor,
} from './components/app/dirty-editor';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import { AppDialogHost, useAppDialog } from './components/app/AppDialog';
import { Titlebar } from './components/shell/Titlebar';
import { ActivityBar } from './components/shell/ActivityBar';
import { SidePanel } from './components/shell/SidePanel';
import { StatusBar } from './components/shell/StatusBar';
import { EditorTabs, type CenterTab } from './components/shell/EditorTabs';
import { ObsPanel, obsCounts, type Observation } from './components/shell/ObsPanel';
import { useShellState, type SidePanelView } from './components/shell/useShellState';

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const [welcomeDraft, setWelcomeDraft] = useState('');
  const [pendingWelcomePrompt, setPendingWelcomePrompt] = useState<string | null>(null);
  // 预览页签：单击树里的文件先进预览（斜体、可被覆盖），双击/编辑固定为 currentFile。
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [dirtyEditorFile, setDirtyEditorFile] = useState<string | null>(null);
  // 观测面板：底部 Problems 式面板。observations 现为空（诚实空态，不伪造）——
  // 真实 advisory / 一致性信号产生在 agent run 内，待后续从 ChatWindow 上提到此 store。
  const [obsPanelOpen, setObsPanelOpen] = useState(false);
  const [observations, setObservations] = useState<Observation[]>([]);
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
    removeProject,
    setActiveProjectAssistantSession,
  } = useProjectWorkspace({
    onProjectSelected: handleProjectSelected,
    onFileSelected: handleWorkspaceFileSelected,
  });
  const displayedFile = previewFile ?? currentFile;

  const handleEditorDirtyChange = useCallback((filePath: string | null, dirty: boolean) => {
    setDirtyEditorFile((current) => nextDirtyEditorFile(current, filePath, dirty));
  }, []);

  const commitDirtyEditorReplacement = useCallback((targetFile: string | null) => {
    setDirtyEditorFile((current) =>
      shouldConfirmBeforeReplacingDirtyEditor(current, targetFile) ? null : current,
    );
  }, []);

  const confirmDiscardDirtyEditor = useCallback(
    async (targetFile: string | null, actionLabel: string) => {
      if (!shouldConfirmBeforeReplacingDirtyEditor(dirtyEditorFile, targetFile)) return true;
      const confirmed = await appDialog.confirm({
        title: '放弃未保存修改？',
        message: `当前文件有未保存的修改，${actionLabel}会放弃这些修改。`,
        confirmLabel: '放弃修改',
        cancelLabel: '继续编辑',
        tone: 'danger',
      });
      return confirmed;
    },
    [appDialog, dirtyEditorFile],
  );

  // 固定打开文件（清预览、切出设置）；预览仅暂存路径，不落 currentFile。
  const openFile = useCallback(
    async (path: string, actionLabel = '打开其他文件') => {
      if (!(await confirmDiscardDirtyEditor(path, actionLabel))) return;
      commitDirtyEditorReplacement(path);
      setPreviewFile(null);
      setSettingsVisible(false);
      handleFileSelect(path);
    },
    [commitDirtyEditorReplacement, confirmDiscardDirtyEditor, handleFileSelect],
  );
  const previewFileOpen = useCallback(
    async (path: string) => {
      if (!(await confirmDiscardDirtyEditor(path, '预览其他文件'))) return;
      commitDirtyEditorReplacement(path);
      setSettingsVisible(false);
      setPreviewFile(path);
    },
    [commitDirtyEditorReplacement, confirmDiscardDirtyEditor],
  );

  // 切换项目必须清预览页签：previewFile 是当前项目内的路径，跨项目后仍非空会让
  // displayedFile 落回上一个项目的文件（编辑器展示、Ctrl+S 也写回旧项目），造成跨项目串写。
  // selectProject 只清 currentFile，previewFile 提在 App 层，故在此按 activeProject 收口。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 项目切换时重置预览态，React18 合法模式
    setPreviewFile(null);
  }, [activeProject]);

  // 本进程改动本地文件（补丁写回、Agent 起草新文件、新建/删除/改名）后刷新资源树。
  // 一次「接受补丁」会触发快照写 + 正文写两次 mutation，debounce 合并为一次重拉。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFsMutation = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setProjectRefreshVersion((version) => version + 1), 120);
    };
    window.addEventListener(FS_MUTATION_EVENT, onFsMutation);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(FS_MUTATION_EVENT, onFsMutation);
    };
  }, []);

  useEffect(() => {
    saveAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  const selectProjectSafely = useCallback(
    async (path: string) => {
      if (!(await confirmDiscardDirtyEditor(null, '切换项目'))) return false;
      commitDirtyEditorReplacement(null);
      selectProject(path);
      return true;
    },
    [commitDirtyEditorReplacement, confirmDiscardDirtyEditor, selectProject],
  );

  const removeProjectSafely = useCallback(
    async (path: string) => {
      if (path === activeProject) {
        if (!(await confirmDiscardDirtyEditor(null, '移除当前项目'))) return;
        commitDirtyEditorReplacement(null);
      }
      removeProject(path);
    },
    [activeProject, commitDirtyEditorReplacement, confirmDiscardDirtyEditor, removeProject],
  );

  const handleOpenProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: '选择项目目录' });
      if (!selected || typeof selected !== 'string') return;
      await selectProjectSafely(selected);
    } catch (error) {
      console.error('打开项目失败', error);
    }
  }, [selectProjectSafely]);

  const handleSelectProjectSession = useCallback(
    async (path: string, assistantSessionId: number) => {
      if (path !== activeProject && !(await selectProjectSafely(path))) return;
      setActiveProjectAssistantSession(assistantSessionId, path);
    },
    [activeProject, selectProjectSafely, setActiveProjectAssistantSession],
  );

  const handleNewProjectSession = useCallback(
    async (path: string) => {
      if (path !== activeProject && !(await selectProjectSafely(path))) return;
      setActiveProjectAssistantSession(null, path);
    },
    [activeProject, selectProjectSafely, setActiveProjectAssistantSession],
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
      if (!(await confirmDiscardDirtyEditor(null, '创建示例项目'))) return;
      const projectPath = await createSampleStoryProject(selected);
      commitDirtyEditorReplacement(null);
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
  }, [appDialog, commitDirtyEditorReplacement, confirmDiscardDirtyEditor, selectProject]);

  useEffect(() => {
    return registerSmokeProjectLoader((path: string) => {
      void selectProjectSafely(path);
    });
  }, [selectProjectSafely]);

  useEffect(() => {
    return registerSmokeFileLoader((path: string) => {
      void openFile(path);
    });
  }, [openFile]);

  // Agent 补丁可能指向未打开（甚至尚不存在）的文件：自动打开目标文件，
  // 编辑器加载完成后经 takePendingFileSuggestion 领取补丁进入确认面板。
  useEffect(() => {
    const normalize = (path: string) => path.replace(/\\/g, '/');
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion?.filePath || !activeProject) return;
      if (relativePathInsideProject(activeProject, suggestion.filePath) === null) return;
      if (currentFile && normalize(currentFile) === normalize(suggestion.filePath)) return;
      void openFile(suggestion.filePath);
    };
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    return () => {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    };
  }, [activeProject, currentFile, openFile]);

  const handleFileClose = useCallback(async () => {
    if (
      displayedFile &&
      displayedFile === currentFile &&
      !(await confirmDiscardDirtyEditor(null, '关闭文件'))
    ) {
      return;
    }
    commitDirtyEditorReplacement(null);
    closeFile();
  }, [
    closeFile,
    commitDirtyEditorReplacement,
    confirmDiscardDirtyEditor,
    currentFile,
    displayedFile,
  ]);

  const handlePreviewClose = useCallback(async () => {
    if (
      displayedFile &&
      displayedFile === previewFile &&
      !(await confirmDiscardDirtyEditor(null, '关闭预览文件'))
    ) {
      return;
    }
    commitDirtyEditorReplacement(null);
    setPreviewFile(null);
  }, [commitDirtyEditorReplacement, confirmDiscardDirtyEditor, displayedFile, previewFile]);

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

      const filePath = resolveProjectRelativePath(targetProject, relativePath);
      if (!filePath) {
        await appDialog.alert({
          title: '新建文件失败',
          message: '文件名必须位于当前项目内，不能使用绝对路径或 .. 跳出项目。',
        });
        return;
      }
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
        await openFile(filePath, '打开新文件');
      } catch (error) {
        console.error('新建文件失败', error);
        await appDialog.alert({
          title: '新建文件失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeProject, appDialog, openFile, handleOpenProject],
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

  const openSettings = useCallback(async () => {
    if (!(await confirmDiscardDirtyEditor(null, '打开设置'))) return;
    commitDirtyEditorReplacement(null);
    setSettingsVisible(true);
  }, [commitDirtyEditorReplacement, confirmDiscardDirtyEditor]);

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
        void openSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSettings, shell]);

  const { isDesktopRuntime, tauriMenuReady, tauriMenuError, smokeApiReady } = useTauriMenuBridge({
    onOpenProject: handleOpenProject,
    onNewFile: handleNewFile,
    onToggleSidebar: shell.toggleSidebar,
    onRestoreFullLayout: () => {
      shell.showSidebar();
      shell.showRight();
    },
  });

  const resolveObservation = useCallback((id: string) => {
    setObservations((prev) => prev.map((o) => (o.id === id ? { ...o, resolved: true } : o)));
  }, []);

  const projectOpen = Boolean(activeProject);
  const modelLabel =
    settings.provider.model.trim() || getProviderPreset(settings.provider.kind).label;
  const rightPanelVisible = projectOpen && !shell.rightCollapsed;
  const obs = obsCounts(observations);
  const centerHasTabs = settingsVisible || projectOpen;
  const activeCenterTab: CenterTab | null = settingsVisible
    ? 'settings'
    : previewFile && previewFile !== currentFile
      ? 'preview'
      : currentFile
        ? 'file'
        : null;

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
      <Titlebar
        projectName={activeProject}
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
            qaBadge={0}
            onSwitchView={shell.switchView}
            onOpenPalette={() => setPalette('files')}
            onOpenSettings={() => void openSettings()}
          />
          {!shell.sidebarHidden && (
            <SidePanel
              view={shell.view}
              projects={projects}
              activeProject={activeProject}
              currentFile={currentFile}
              previewFile={previewFile}
              projectRefreshVersion={projectRefreshVersion}
              activeAssistantSessionId={
                activeProject ? (projectAssistantSessions[activeProject] ?? null) : null
              }
              onSelectProject={(path) => void selectProjectSafely(path)}
              onRemoveProject={(path) => void removeProjectSafely(path)}
              onSelectProjectSession={handleSelectProjectSession}
              onNewProjectSession={handleNewProjectSession}
              onOpenProject={handleOpenProject}
              onNewFile={handleNewFile}
              onFileSelect={openFile}
              onFilePreview={previewFileOpen}
              onStartNewBook={handleStartNewBook}
              onOpenObsPanel={() => setObsPanelOpen(true)}
            />
          )}
        </div>

        <main className="flex min-w-0 flex-1 flex-col bg-background" data-testid="shell-center">
          {centerHasTabs ? (
            <>
              <EditorTabs
                currentFile={currentFile}
                previewFile={previewFile}
                settingsOpen={settingsVisible}
                activeTab={activeCenterTab}
                onFocusFile={() => {
                  void (async () => {
                    if (!(await confirmDiscardDirtyEditor(currentFile, '切换到已固定文件'))) return;
                    commitDirtyEditorReplacement(currentFile);
                    setSettingsVisible(false);
                    setPreviewFile(null);
                  })();
                }}
                onFocusPreview={() => {
                  void (async () => {
                    if (!(await confirmDiscardDirtyEditor(previewFile, '切换到预览文件'))) return;
                    commitDirtyEditorReplacement(previewFile);
                    setSettingsVisible(false);
                  })();
                }}
                onPinPreview={() => {
                  if (previewFile) void openFile(previewFile);
                }}
                onFocusSettings={() => void openSettings()}
                onCloseFile={() => void handleFileClose()}
                onCloseSettings={() => setSettingsVisible(false)}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {settingsVisible ? (
                  <SettingsView
                    settings={settings}
                    onChange={setSettings}
                    onClose={() => setSettingsVisible(false)}
                  />
                ) : (
                  <section
                    className="h-full min-h-0 overflow-hidden bg-background"
                    data-testid="editor-panel"
                  >
                    <Editor
                      projectPath={activeProject}
                      filePath={displayedFile}
                      editorFontSize={settings.editorFontSize}
                      autoSave={settings.autoSave}
                      onClose={
                        displayedFile && displayedFile === previewFile
                          ? () => void handlePreviewClose()
                          : () => void handleFileClose()
                      }
                      onDirtyChange={handleEditorDirtyChange}
                      onToggleSidebar={shell.toggleSidebar}
                      sidebarVisible={!shell.sidebarHidden}
                      onExportCurrent={() => emitExportCurrentFile()}
                      dialogs={appDialog}
                    />
                  </section>
                )}
              </div>
              {obsPanelOpen && projectOpen && (
                <ObsPanel
                  observations={observations}
                  onClose={() => setObsPanelOpen(false)}
                  onResolve={resolveObservation}
                />
              )}
            </>
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
            className="flex min-h-0 w-[384px] flex-shrink-0 flex-col overflow-hidden border-l border-border bg-panel"
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
        obs={obs}
        onToggleObs={() => setObsPanelOpen((open) => !open)}
        onToggleTheme={toggleTheme}
      />

      {palette && (
        <CommandPalette
          mode={palette}
          projectPath={activeProject}
          currentFile={currentFile}
          onClose={() => setPalette(null)}
          onOpenFile={openFile}
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
