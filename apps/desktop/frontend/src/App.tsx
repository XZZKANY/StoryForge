/**
 * StoryForge desktop shell.
 * 固定三栏「编辑器中枢」布局：顶栏 / 活动栏+侧面板 / 中栏正文 C 位 / 右栏 Agent 面板 / 状态栏。
 * 中栏 = Monaco 编辑器（正文 C 位）；右栏 = 对话式 agent 面板。无拖拽分割线。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CommandPalette, PaletteMode } from './components/CommandPalette';
import { SettingsView } from './components/SettingsView';
import { Editor } from './components/Editor';
import { ChatWindow } from './components/ChatWindow';
import { TauriFileSystem, FS_MUTATION_EVENT, invalidateFileSystemCache } from './lib/tauri-fs';
import {
  createSampleStoryProject,
  initializeStoryProject,
  relativePathInsideProject,
  resolveProjectRelativePath,
} from './lib/project-context';
import { registerSmokeFileLoader, registerSmokeProjectLoader } from './lib/smoke';
import { executeIdeCommand } from './lib/api-client';
import {
  APPLY_FILE_SUGGESTION_EVENT,
  emitExportCurrentFile,
  flushActiveEditorToDisk,
} from './lib/assistant-events';
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
  closeEditorFile,
  nextEditorFileAfterClose,
  openEditorFile,
  updateDirtyEditorFiles,
} from './components/app/editor-tabs-state';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import { AppDialogHost, useAppDialog } from './components/app/AppDialog';
import { Titlebar } from './components/shell/Titlebar';
import { ActivityBar } from './components/shell/ActivityBar';
import { AssistantPanelFrame } from './components/shell/AssistantPanelFrame';
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
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(() => new Set());
  // 观测面板：底部 Problems 式面板。observations 现为空（诚实空态，不伪造）——
  // 真实 advisory / 一致性信号产生在 agent run 内，待后续从 ChatWindow 上提到此 store。
  const [obsPanelOpen, setObsPanelOpen] = useState(false);
  const [observations, setObservations] = useState<Observation[]>([]);
  const quickModelRequestRef = useRef(0);
  const quickProviderRequestRef = useRef(0);
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

  const handleEditorDirtyChange = useCallback(
    (filePath: string | null, dirty: boolean) => {
      if (!filePath) return;
      setDirtyFiles((current) => updateDirtyEditorFiles(current, filePath, dirty));
      if (dirty && previewFile === filePath) {
        setOpenFiles((current) => openEditorFile(current, filePath));
        setPreviewFile(null);
        handleFileSelect(filePath);
      }
    },
    [handleFileSelect, previewFile],
  );

  const confirmDiscardFiles = useCallback(
    async (paths: string[], actionLabel: string) => {
      const dirtyPaths = paths.filter((path) => dirtyFiles.has(path));
      if (dirtyPaths.length === 0) return true;
      const confirmed = await appDialog.confirm({
        title: '放弃未保存修改？',
        message: `${dirtyPaths.length} 个文件有未保存修改，${actionLabel}会放弃这些修改。`,
        confirmLabel: '放弃修改',
        cancelLabel: '继续编辑',
        tone: 'danger',
      });
      return confirmed;
    },
    [appDialog, dirtyFiles],
  );

  // 固定打开文件（清预览、切出设置）；预览仅暂存路径，不落 currentFile。
  const openFile = useCallback(
    async (path: string, _actionLabel = '打开其他文件') => {
      setOpenFiles((current) => openEditorFile(current, path));
      setPreviewFile(null);
      setSettingsVisible(false);
      handleFileSelect(path);
    },
    [handleFileSelect],
  );
  const previewFileOpen = useCallback(
    async (path: string) => {
      setSettingsVisible(false);
      if (openFiles.includes(path)) {
        setPreviewFile(null);
        handleFileSelect(path);
      } else {
        setPreviewFile(path);
      }
    },
    [handleFileSelect, openFiles],
  );
  const retainedEditorFiles = useMemo(
    () => (previewFile ? [...openFiles, previewFile] : openFiles),
    [openFiles, previewFile],
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
      if (!(await confirmDiscardFiles(openFiles, '切换项目'))) return false;
      setOpenFiles([]);
      setDirtyFiles(new Set());
      setPreviewFile(null);
      selectProject(path);
      return true;
    },
    [confirmDiscardFiles, openFiles, selectProject],
  );

  const removeProjectSafely = useCallback(
    async (path: string) => {
      if (path === activeProject) {
        if (!(await confirmDiscardFiles(openFiles, '移除当前项目'))) return;
        setOpenFiles([]);
        setDirtyFiles(new Set());
      }
      removeProject(path);
    },
    [activeProject, confirmDiscardFiles, openFiles, removeProject],
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
      if (!(await confirmDiscardFiles(openFiles, '创建示例项目'))) return;
      const projectPath = await createSampleStoryProject(selected);
      setOpenFiles([]);
      setDirtyFiles(new Set());
      setPreviewFile(null);
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
  }, [appDialog, confirmDiscardFiles, openFiles, selectProject]);

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

  const handleFileClose = useCallback(
    async (path: string) => {
      if (!(await confirmDiscardFiles([path], '关闭文件'))) return;
      const nextFile = nextEditorFileAfterClose(openFiles, path);
      setOpenFiles((current) => closeEditorFile(current, path));
      setDirtyFiles((current) => updateDirtyEditorFiles(current, path, false));
      if (currentFile === path) {
        if (nextFile) handleFileSelect(nextFile);
        else closeFile();
      }
    },
    [closeFile, confirmDiscardFiles, currentFile, handleFileSelect, openFiles],
  );

  const handlePreviewClose = useCallback(async () => {
    setPreviewFile(null);
  }, []);

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
          await TauriFileSystem.writeFile(targetProject, filePath, '# 新建文件\n\n');
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

  // 确定性触发 canon 投影（非 LLM）：重建在场 + 闸门 + 写出 dossier.md，结果以「参考信号」明示。
  const handleRefreshCanon = useCallback(async () => {
    if (!activeProject) {
      await handleOpenProject();
      return;
    }
    try {
      if (currentFile && dirtyFiles.has(currentFile)) {
        await flushActiveEditorToDisk(currentFile);
      }
      const result = await executeIdeCommand('canon.refresh', { project_root: activeProject });
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const canon = (payload.canon ?? {}) as Record<string, unknown>;
      const dossier = (canon.dossier ?? {}) as Record<string, unknown>;
      const dossierPath =
        typeof dossier.path === 'string' ? dossier.path : '.storyforge/canon/derived/dossier.md';
      invalidateFileSystemCache(activeProject);
      setProjectRefreshVersion((version) => version + 1);
      const lines = [
        `实体声明：${canon.entity_count ?? 0} 个`,
        `硬矛盾（blocking）：${canon.conflict_count ?? 0}，advisory：${canon.advisory_count ?? 0}`,
        `已写出事实卡：${dossierPath}`,
        '',
        typeof canon.note === 'string'
          ? canon.note
          : '结果为派生参考信号，非质量判定；advisory 须抽读原文核实。',
      ];
      await appDialog.alert({ title: 'Canon 事实卡已刷新（参考信号）', message: lines.join('\n') });
    } catch (error) {
      await appDialog.alert({
        title: '刷新 Canon 事实卡失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [activeProject, appDialog, currentFile, dirtyFiles, handleOpenProject]);

  const openSettings = useCallback(async () => {
    setSettingsVisible(true);
  }, []);

  const handleStartNewBook = useCallback(() => {
    setSettingsVisible(false);
    void handleOpenProject();
  }, [handleOpenProject]);

  const handleQuickModelChange = useCallback(
    async (model: string) => {
      const trimmed = model.trim();
      const previousProvider = settings.provider;
      const requestId = ++quickModelRequestRef.current;
      setSettings((prev) => ({ ...prev, provider: { ...prev.provider, model: trimmed } }));
      try {
        // 后端实时读取 llm-provider.json，写入即生效，无需重启。
        await saveDesktopLlmConfig({
          provider: settings.provider.kind,
          baseUrl: settings.provider.baseUrl,
          model: trimmed,
        });
      } catch (error) {
        if (quickModelRequestRef.current !== requestId) return;
        setSettings((current) =>
          current.provider.kind === previousProvider.kind &&
          current.provider.baseUrl === previousProvider.baseUrl &&
          current.provider.model === trimmed
            ? { ...current, provider: previousProvider }
            : current,
        );
        await appDialog.alert({
          title: '模型切换失败',
          message: `设置未保存，已恢复原模型。\n${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [appDialog, settings.provider],
  );

  const handleQuickProviderChange = useCallback(
    async (kind: ProviderKind) => {
      const previousProvider = settings.provider;
      const nextProvider = applyProviderPreset(settings.provider, kind, { preserveModel: true });
      const requestId = ++quickProviderRequestRef.current;
      setSettings((prev) => ({ ...prev, provider: nextProvider }));
      try {
        await saveDesktopLlmConfig({
          provider: nextProvider.kind,
          baseUrl: nextProvider.baseUrl,
          model: nextProvider.model,
        });
      } catch (error) {
        if (quickProviderRequestRef.current !== requestId) return;
        setSettings((current) =>
          current.provider.kind === nextProvider.kind &&
          current.provider.baseUrl === nextProvider.baseUrl &&
          current.provider.model === nextProvider.model
            ? { ...current, provider: previousProvider }
            : current,
        );
        await appDialog.alert({
          title: '服务商切换失败',
          message: `设置未保存，已恢复原服务商。\n${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [appDialog, settings.provider],
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
                openFiles={openFiles}
                activeFile={currentFile}
                previewFile={previewFile}
                dirtyFiles={dirtyFiles}
                settingsOpen={settingsVisible}
                activeTab={activeCenterTab}
                onFocusFile={(path) => {
                  setSettingsVisible(false);
                  setPreviewFile(null);
                  handleFileSelect(path);
                }}
                onFocusPreview={() => {
                  setSettingsVisible(false);
                }}
                onPinPreview={() => {
                  if (previewFile) void openFile(previewFile);
                }}
                onFocusSettings={() => void openSettings()}
                onCloseFile={(path) => void handleFileClose(path)}
                onCloseSettings={() => setSettingsVisible(false)}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {settingsVisible && (
                  <SettingsView
                    settings={settings}
                    onChange={setSettings}
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
                    filePath={displayedFile}
                    editorFontSize={settings.editorFontSize}
                    autoSave={settings.autoSave}
                    retainedFilePaths={retainedEditorFiles}
                    onClose={
                      displayedFile && displayedFile === previewFile
                        ? () => void handlePreviewClose()
                        : displayedFile
                          ? () => void handleFileClose(displayedFile)
                          : () => undefined
                    }
                    onDirtyChange={handleEditorDirtyChange}
                    onToggleSidebar={shell.toggleSidebar}
                    sidebarVisible={!shell.sidebarHidden}
                    onExportCurrent={() => emitExportCurrentFile()}
                    dialogs={appDialog}
                  />
                </section>
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

        {projectOpen && (
          <AssistantPanelFrame visible={rightPanelVisible}>
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
          </AssistantPanelFrame>
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
          onRefreshCanon={handleRefreshCanon}
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
