/**
 * StoryForge desktop shell.
 * Cursor/Codex-like layout: app menu + left navigation + centered agent workspace
 * with an optional right editor/file panel.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { StoryNavigator } from './components/StoryNavigator';
import { Editor } from './components/Editor';
import { CommandPalette, PaletteMode } from './components/CommandPalette';
import { DynamicIDELayout, type ComposerLayoutMode } from './components/DynamicIDELayout';
import { SettingsView } from './components/SettingsView';
import { HomeStoryIcon, ProjectIcon } from './components/StoryIcons';
import { isTauriRuntime } from './lib/tauri-env';
import { TauriFileSystem } from './lib/tauri-fs';
import { initializeStoryProject } from './lib/project-context';
import { registerSmokeFileLoader, registerSmokeProjectLoader } from './lib/smoke';
import { emitExportCurrentFile, emitReviewCurrentFile } from './lib/assistant-events';
import { loadAppSettings, saveAppSettings, type AppSettings } from './lib/user-settings';

type LayoutMode = 'normal' | 'custom' | 'assistant-only' | 'workspace-only';

const RECENT_PROJECTS_KEY = 'recent-projects';
const RECENT_FILES_KEY = 'recent-files';
const PROJECT_ASSISTANT_SESSIONS_KEY = 'project-assistant-sessions';

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function activeProjectLabel(path: string | null): string {
  return path ? basename(path) : 'storyforge';
}

function joinPath(root: string, child: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[/\\]+$/, '')}${separator}${child.replace(/^[/\\]+/, '')}`;
}

function normalizeMarkdownFileName(input: string): string {
  const trimmed = input.trim().replace(/^[/\\]+/, '');
  if (!trimmed) return '';
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

function loadProjectAssistantSessions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PROJECT_ASSISTANT_SESSIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'number' && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

function saveProjectAssistantSessions(sessions: Record<string, number>) {
  localStorage.setItem(PROJECT_ASSISTANT_SESSIONS_KEY, JSON.stringify(sessions));
}

export function App() {
  const [projects, setProjects] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [projectAssistantSessions, setProjectAssistantSessions] = useState<Record<string, number>>(
    () => loadProjectAssistantSessions(),
  );
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [workspaceVisible, setWorkspaceVisible] = useState(true);
  const [editorVisible, setEditorVisible] = useState(true);
  const [composerMode, setComposerMode] = useState<ComposerLayoutMode>('panel');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('normal');
  const [emptyWorkbenchVisible, setEmptyWorkbenchVisible] = useState(false);
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);

  const [isDesktopRuntime, setIsDesktopRuntime] = useState(false);
  const [tauriMenuReady, setTauriMenuReady] = useState(false);
  const [tauriMenuError, setTauriMenuError] = useState('');
  const [smokeApiReady, setSmokeApiReady] = useState(false);

  useEffect(() => {
    const savedProjects = localStorage.getItem(RECENT_PROJECTS_KEY);
    const savedFiles = localStorage.getItem(RECENT_FILES_KEY);

    if (savedProjects) {
      try {
        const list = JSON.parse(savedProjects) as string[];
        if (Array.isArray(list)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- 启动时从 localStorage 恢复项目列表，React18 合法模式
          setProjects(list);
          if (list.length > 0) setActiveProject(list[0]);
        }
      } catch {
        // Ignore corrupted cache.
      }
    }
    if (savedFiles) {
      try {
        const list = JSON.parse(savedFiles) as string[];
        if (Array.isArray(list)) setRecentFiles(list);
      } catch {
        // Ignore corrupted cache.
      }
    }
  }, []);

  useEffect(() => {
    saveAppSettings(settings);
  }, [settings]);

  const selectProject = useCallback((path: string) => {
    setActiveProject(path);
    setCurrentFile(null);
    setEmptyWorkbenchVisible(false);
    setSettingsVisible(false);
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode('panel');
    setLayoutMode('normal');
    setProjects((prev) => {
      const next = [path, ...prev.filter((item) => item !== path)].slice(0, 12);
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

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

  const handleFileSelect = useCallback((filePath: string) => {
    setCurrentFile(filePath);
    setEmptyWorkbenchVisible(false);
    setSettingsVisible(false);
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode((mode) => (mode === 'full' ? 'panel' : mode));
    setRecentFiles((prev) => {
      const next = [filePath, ...prev.filter((item) => item !== filePath)].slice(0, 20);
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    return registerSmokeFileLoader((path: string) => {
      handleFileSelect(path);
    });
  }, [handleFileSelect]);

  const handleFileClose = useCallback(() => {
    setCurrentFile(null);
    setEmptyWorkbenchVisible(false);
  }, []);

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
        setWorkspaceVisible(true);
        setEditorVisible(true);
        setComposerMode('panel');
        setLayoutMode('custom');
      } catch (error) {
        console.error('初始化项目结构失败', error);
        window.alert(
          `初始化项目结构失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeProject, handleOpenProject],
  );

  const restoreFullLayout = useCallback(() => {
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode('panel');
    setLayoutMode('normal');
  }, []);

  const focusAssistantOnly = useCallback(() => {
    setWorkspaceVisible(false);
    setEditorVisible(false);
    setComposerMode('full');
    setLayoutMode('assistant-only');
  }, []);

  const focusWorkspaceOnly = useCallback(() => {
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode('floating');
    setLayoutMode('workspace-only');
  }, []);

  const markCustomLayout = useCallback(() => {
    setLayoutMode('custom');
    setEditorVisible(true);
  }, []);

  const setActiveProjectAssistantSession = useCallback(
    (assistantSessionId: number | null) => {
      const project = activeProject;
      if (!project) return;
      setProjectAssistantSessions((prev) => {
        const next = { ...prev };
        if (assistantSessionId) {
          next[project] = assistantSessionId;
        } else {
          delete next[project];
        }
        saveProjectAssistantSessions(next);
        return next;
      });
    },
    [activeProject],
  );

  const handleComposerModeChange = useCallback((mode: ComposerLayoutMode) => {
    setSettingsVisible(false);
    setComposerMode(mode);
    setLayoutMode(
      mode === 'full' ? 'assistant-only' : mode === 'floating' ? 'workspace-only' : 'custom',
    );
    if (mode === 'full') {
      setWorkspaceVisible(false);
      setEditorVisible(false);
      return;
    }
    setWorkspaceVisible(true);
    setEditorVisible(true);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsVisible(true);
    setComposerMode((mode) => (mode === 'floating' ? 'panel' : mode));
    setLayoutMode('custom');
  }, []);

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

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let isCancelled = false;
    const unlistenFns: Array<() => void> = [];

    const setSmokeReadyAttribute = (ready: boolean) => {
      const shell = document.querySelector('[data-testid="desktop-shell"]');
      shell?.setAttribute('data-smoke-api-ready', ready ? 'true' : 'false');
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect -- API 就绪后同步标记 smoke 状态，React18 合法模式
    setSmokeApiReady(true);
    setSmokeReadyAttribute(true);

    const registerMenuListeners = async () => {
      let listen: typeof import('@tauri-apps/api/event').listen;
      try {
        ({ listen } = await import('@tauri-apps/api/event'));
      } catch (error) {
        setTauriMenuError(
          error instanceof Error ? error.message : 'Failed to import Tauri event API',
        );
        return;
      }
      if (isCancelled) return;

      setIsDesktopRuntime(true);

      try {
        unlistenFns.push(await listen('menu:open-project', () => void handleOpenProject()));
        unlistenFns.push(await listen('menu:new-file', () => void handleNewFile()));
        unlistenFns.push(
          await listen('menu:save', () => document.getElementById('editor-save-btn')?.click()),
        );
        unlistenFns.push(
          await listen('menu:close', () => document.getElementById('editor-close-btn')?.click()),
        );
        unlistenFns.push(
          await listen('menu:toggle-sidebar', () => {
            markCustomLayout();
            setWorkspaceVisible((visible) => !visible);
          }),
        );
        unlistenFns.push(await listen('smoke:reset-panels', () => restoreFullLayout()));

        setTauriMenuError('');
        setTauriMenuReady(true);
      } catch (error) {
        setTauriMenuError(
          error instanceof Error ? error.message : 'Failed to register Tauri menu listeners',
        );
      }
    };

    void registerMenuListeners();

    return () => {
      isCancelled = true;
      setIsDesktopRuntime(false);
      setTauriMenuReady(false);
      setSmokeApiReady(false);
      setTauriMenuError('');
      setSmokeReadyAttribute(false);
      unlistenFns.forEach((fn) => fn());
    };
  }, [handleNewFile, handleOpenProject, markCustomLayout, restoreFullLayout]);

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
                  setWorkspaceVisible(true);
                  setEditorVisible(true);
                  setComposerMode('panel');
                  setLayoutMode('custom');
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
              onToggleWorkspace={() => {
                markCustomLayout();
                setWorkspaceVisible((visible) => !visible);
              }}
              onRestoreWorkspace={() => {
                markCustomLayout();
                setWorkspaceVisible(true);
                setEditorVisible(true);
                setComposerMode((mode) => (mode === 'full' ? 'panel' : mode));
              }}
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
            markCustomLayout();
            setWorkspaceVisible((visible) => !visible);
            setEditorVisible(true);
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

function WindowMenu({
  activeProject: _activeProject,
  onOpenProject: _onOpenProject,
  onNewFile: _onNewFile,
}: {
  activeProject: string | null;
  onOpenProject: () => void;
  onNewFile: (projectPath?: string) => void;
}) {
  const runWindowAction = async (action: 'drag' | 'minimize' | 'maximize' | 'close') => {
    if (!isTauriRuntime()) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      if (action === 'drag') await appWindow.startDragging();
      if (action === 'minimize') await appWindow.minimize();
      if (action === 'maximize') await appWindow.toggleMaximize();
      if (action === 'close') await appWindow.close();
    } catch (error) {
      console.error('窗口操作失败', error);
    }
  };

  return (
    <header
      className="h-9 flex-shrink-0 border-b border-[#3A3A40] bg-[#202024] flex items-center px-2 text-[13px]"
      onDoubleClick={() => void runWindowAction('maximize')}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('button')) return;
        void runWindowAction('drag');
      }}
    >
      <img src="/favicon.png" alt="" className="mr-2 h-4 w-4 flex-shrink-0" draggable={false} />
      <span className="mr-6">文件</span>
      <span className="mr-6">编辑</span>
      <span className="mr-6">视图</span>
      <span className="mr-4">帮助</span>

      <div className="ml-auto flex h-full items-center text-[#D9D9D9]">
        <button
          className="flex h-full w-11 items-center justify-center hover:bg-[#242424] hover:text-white"
          onClick={() => void runWindowAction('minimize')}
          title="最小化"
        >
          −
        </button>
        <button
          className="flex h-full w-11 items-center justify-center hover:bg-[#242424] hover:text-white"
          onClick={() => void runWindowAction('maximize')}
          title="最大化"
        >
          □
        </button>
        <button
          className="flex h-full w-11 items-center justify-center text-lg leading-none hover:bg-[#C42B1C] hover:text-white"
          onClick={() => void runWindowAction('close')}
          title="关闭"
        >
          ×
        </button>
      </div>
    </header>
  );
}

function FolderPlusIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.32c.42 0 .82.17 1.12.47l1.09 1.1c.11.11.26.18.42.18h4.05a1.75 1.75 0 0 1 1.75 1.75v5A1.75 1.75 0 0 1 12.5 13h-9a1.75 1.75 0 0 1-1.75-1.75v-6.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M8 7.25v3.5M6.25 9h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MessagePlusIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M7.25 3.25H4.4c-.9 0-1.65.74-1.65 1.65v6.7c0 .9.74 1.65 1.65 1.65h6.7c.9 0 1.65-.74 1.65-1.65V8.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.6 2.45c.54-.54 1.41-.54 1.95 0s.54 1.41 0 1.95L7.3 10.65l-2.3.65.65-2.3 5.95-6.55Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StoryStructureIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.25h4.25v3.5H2.5v-3.5ZM9.25 3.25h4.25v3.5H9.25v-3.5ZM2.5 9.25h4.25v3.5H2.5v-3.5ZM9.25 9.25h4.25v3.5H9.25v-3.5Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <path
        d="M6.75 5h2.5M6.75 11h2.5M4.6 6.75v2.5M11.4 6.75v2.5"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6 3.5 4.25 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4h10M3 8h6M3 12h8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.75l1.1 3.15L12.25 6l-3.15 1.1L8 10.25 6.9 7.1 3.75 6l3.15-1.1L8 1.75Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.75 3.25h10.5v9.5H2.75z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.8 3.25v9.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function LayoutSplitIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.75 3.25h10.5v9.5H2.75z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 3.25v9.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CodexSidebar({
  projects,
  activeProject,
  projectAssistantSessions,
  onSelectProject,
  onOpenProject,
  onInitializeProject,
  onOpenSettings,
}: {
  projects: string[];
  activeProject: string | null;
  projectAssistantSessions: Record<string, number>;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onOpenSettings: () => void;
}) {
  const [projectLibraryExpanded, setProjectLibraryExpanded] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  const toggleProjectSessions = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col text-[13px]">
      <div className="h-9 px-3 flex items-center gap-4 text-[#999999]">
        <button className="hover:text-white" title="侧边栏">
          ▣
        </button>
        <button className="hover:text-white" title="搜索">
          ⌕
        </button>
        <span className="ml-auto text-[#666666]">‹</span>
        <span className="text-[#666666]">›</span>
      </div>

      <div className="space-y-1 px-2">
        <SidebarButton icon={<TaskIcon />} label="自动任务" />
        <SidebarButton icon={<SparkleIcon />} label="个性化" />
      </div>

      <div className="group mt-6 flex h-[var(--sf-row-height)] items-center px-3 text-xs text-[#777777]">
        <span className="min-w-0 flex-1 truncate">项目库</span>
        <button
          className="sf-icon-button text-[#777777] opacity-0 transition-opacity hover:bg-[#252525] hover:text-[#DCDCDC] group-hover:opacity-100"
          onClick={() => setProjectLibraryExpanded((expanded) => !expanded)}
          title={projectLibraryExpanded ? '收起项目库' : '展开项目库'}
          data-testid="toggle-project-library"
          aria-expanded={projectLibraryExpanded}
        >
          <span
            className={
              projectLibraryExpanded ? 'rotate-90 transition-transform' : 'transition-transform'
            }
          >
            <ChevronRightIcon />
          </span>
        </button>
        <button
          id="open-project-btn"
          className="sf-icon-button text-[#777777] opacity-0 transition-opacity hover:bg-[#252525] hover:text-[#DCDCDC] group-hover:opacity-100"
          onClick={onOpenProject}
          title="添加项目"
          data-testid="add-project-btn"
        >
          <FolderPlusIcon />
        </button>
      </div>
      <div
        className={projectLibraryExpanded ? 'mt-2 space-y-1 px-2' : 'hidden'}
        data-testid="project-library-list"
      >
        {projects.length > 0 ? (
          projects.slice(0, 5).map((project) => {
            const path = project;
            const label =
              project.includes('\\') || project.includes('/') ? basename(project) : project;
            const isActive = activeProject === path;
            const isExpanded = expandedProjects.has(path);
            const sessionId = projectAssistantSessions[path];
            const sessions: Array<{ id: number; title: string }> = sessionId
              ? [{ id: sessionId, title: '最近创作会话' }]
              : [];
            return (
              <div key={project}>
                <button
                  onClick={() => {
                    if (project.includes('\\') || project.includes('/')) onSelectProject(path);
                  }}
                  className={`sf-sidebar-row group ${
                    isActive ? 'text-white' : 'text-[#CFCFCF] hover:bg-[#222222]'
                  }`}
                  title={path}
                >
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[#A8A8A8] transition-colors group-hover:text-[#DCDCDC] ${
                      isActive ? 'bg-[#2A2A2A] text-[#DCDCDC]' : ''
                    }`}
                  >
                    <ProjectIcon />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <IconToolButton
                      title={isExpanded ? '收起会话' : '展开会话'}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleProjectSessions(path);
                      }}
                    >
                      <span
                        className={
                          isExpanded ? 'rotate-90 transition-transform' : 'transition-transform'
                        }
                      >
                        <ChevronRightIcon />
                      </span>
                    </IconToolButton>
                    <IconToolButton
                      title="新建会话"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectProject(path);
                      }}
                    >
                      <MessagePlusIcon />
                    </IconToolButton>
                    <IconToolButton
                      title="初始化小说项目结构"
                      onClick={(event) => {
                        event.stopPropagation();
                        onInitializeProject(path);
                      }}
                    >
                      <StoryStructureIcon />
                    </IconToolButton>
                  </span>
                </button>
                {isExpanded && (
                  <div
                    className="mb-1 ml-10 mr-2 py-1"
                    data-testid="project-session-list"
                    data-project-path={path}
                  >
                    {sessions.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-[#777777]">暂无会话</div>
                    ) : (
                      sessions.map((session) => (
                        <button
                          key={session.id}
                          className="flex h-7 w-full items-center rounded px-2 text-left text-xs text-[#BDBDBD] hover:bg-[#222222] hover:text-white"
                          onClick={() => onSelectProject(path)}
                          title={`Assistant 会话 #${session.id}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <button
            className="w-full rounded-md border border-dashed border-[#303030] px-3 py-2 text-left text-xs text-[#777777] hover:border-[#3A3A3A] hover:text-[#BDBDBD]"
            onClick={onOpenProject}
          >
            暂无项目
          </button>
        )}
        <SidebarButton icon={<HomeStoryIcon />} label="首页" />
      </div>

      <div className="mt-auto p-2">
        <ProviderSettingsCard onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}

function IconToolButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: (
    event: React.MouseEvent<HTMLSpanElement> | React.KeyboardEvent<HTMLSpanElement>,
  ) => void;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="sf-icon-button text-[#888888] hover:bg-[#303030] hover:text-white"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClick(event);
      }}
      title={title}
    >
      {children}
    </span>
  );
}

function ProviderSettingsCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <button
      className="group flex w-full items-center gap-2 rounded-xl border border-[#303030] bg-[#1B1B1B] px-2 py-2 text-left transition-colors hover:border-[#3E3E3E] hover:bg-[#222222]"
      onClick={onOpenSettings}
      data-testid="settings-entry-card"
      title="打开设置"
    >
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-[#E8E1D7] text-[12px] font-semibold text-[#111111]">
        SF
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[#EDEDED]">本地创作环境</div>
        <div className="truncate text-[12px] text-[#A8A8A8]">模型服务未检测</div>
      </div>
      <span className="flex h-7 w-5 flex-shrink-0 items-center justify-center text-[#777777] transition-colors group-hover:text-[#BDBDBD]">
        <SettingsIcon />
      </span>
    </button>
  );
}

function SettingsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.55 2.1h2.9l.35 1.55c.33.12.64.3.92.53l1.48-.48 1.45 2.5-1.15 1.08a4.4 4.4 0 0 1 0 1.44l1.15 1.08-1.45 2.5-1.48-.48c-.28.23-.59.41-.92.53l-.35 1.55h-2.9l-.35-1.55a4.1 4.1 0 0 1-.92-.53l-1.48.48-1.45-2.5 1.15-1.08a4.4 4.4 0 0 1 0-1.44L2.35 6.2 3.8 3.7l1.48.48c.28-.23.59-.41.92-.53l.35-1.55Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

function SidebarButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="sf-sidebar-row group text-[#E2E2E2] hover:bg-[#222222]">
      <span className="icon-badge text-[#9A9A9A] group-hover:text-white">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function AgentWorkspace({
  projectPath,
  currentFile,
  assistantSessionId,
  exposeWorkspaceToggle,
  layoutMode,
  onAssistantSessionChange,
  onFocusOnly,
  onRestoreLayout,
  onInitializeProject,
  onCollapse,
}: {
  projectPath: string | null;
  currentFile: string | null;
  assistantSessionId: number | null;
  exposeWorkspaceToggle: boolean;
  layoutMode: LayoutMode;
  onAssistantSessionChange: (assistantSessionId: number | null) => void;
  onFocusOnly: () => void;
  onRestoreLayout: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onCollapse: () => void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      {!currentFile && (
        <TopRightTools
          exposeExpandTestId={exposeWorkspaceToggle}
          onShowWorkspace={onRestoreLayout}
          onShowPanel={onRestoreLayout}
        />
      )}
      <div className="min-h-0 flex-1">
        {currentFile ? (
          <ChatWindow
            projectPath={projectPath}
            currentFile={currentFile}
            assistantSessionId={assistantSessionId}
            layoutMode={layoutMode}
            onAssistantSessionChange={onAssistantSessionChange}
            onFocusOnly={onFocusOnly}
            onRestoreLayout={onRestoreLayout}
            onCollapse={onCollapse}
          />
        ) : (
          <AgentComposerHome
            activeProject={projectPath}
            compact
            onBrowseFiles={onRestoreLayout}
            onOpenProject={onRestoreLayout}
            onInitializeProject={onInitializeProject}
          />
        )}
      </div>
    </div>
  );
}

function TopRightTools({
  exposeExpandTestId = false,
  onShowWorkspace,
  onShowPanel,
}: {
  exposeExpandTestId?: boolean;
  onShowWorkspace: () => void;
  onShowPanel: () => void;
}) {
  return (
    <div className="sf-panel-header bg-[#18181B]">
      <span className="sf-topbar-title">编辑窗口</span>
      <div className="sf-topbar-actions">
        <button className="sf-toolbar-button" onClick={onShowWorkspace} title="编辑窗口">
          编辑窗口 ↗
        </button>
        <button className="sf-icon-button icon-button" title="更多">
          <MoreIcon />
        </button>
        <button
          data-testid={exposeExpandTestId ? 'expand-file-tree' : undefined}
          className="sf-icon-button icon-button"
          onClick={onShowPanel}
          title="显示面板 (Ctrl Alt B)"
        >
          <PanelIcon />
        </button>
        <button className="sf-icon-button icon-button" onClick={onShowWorkspace} title="恢复分栏">
          <LayoutSplitIcon />
        </button>
      </div>
    </div>
  );
}

function WelcomeWorkspace({
  activeProject,
  onOpenProject,
  onInitializeProject,
  onBrowseFiles,
  onShowWorkbench,
}: {
  activeProject: string | null;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onBrowseFiles: () => void;
  onShowWorkbench: () => void;
}) {
  return (
    <section
      className="flex h-full min-w-0 flex-col overflow-hidden bg-[#18181B]"
      data-testid="welcome-workspace"
    >
      <div className="sf-panel-header bg-[#18181B]">
        <span className="sf-topbar-title">编辑窗口</span>
        <div className="sf-topbar-actions">
          <button className="sf-toolbar-button" onClick={onBrowseFiles} title="打开编辑窗口">
            编辑窗口 ↗
          </button>
          <button className="sf-icon-button" title="更多">
            <MoreIcon />
          </button>
          <button
            className="sf-icon-button"
            onClick={onShowWorkbench}
            title="显示文件树与编辑分栏"
            data-testid="welcome-show-workbench"
          >
            <LayoutSplitIcon />
          </button>
        </div>
      </div>

      <AgentComposerHome
        activeProject={activeProject}
        onBrowseFiles={onBrowseFiles}
        onOpenProject={onOpenProject}
        onInitializeProject={onInitializeProject}
      />
    </section>
  );
}

function AgentComposerHome({
  activeProject,
  compact = false,
  onBrowseFiles,
  onOpenProject,
  onInitializeProject,
}: {
  activeProject: string | null;
  compact?: boolean;
  onBrowseFiles: () => void;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-[#18181B] px-4 py-10">
      <div
        className={`flex w-full ${compact ? 'max-w-xl' : 'max-w-[760px]'} translate-y-[-4vh] flex-col items-stretch`}
      >
        <div className="mb-6 flex min-w-0 items-center gap-2 text-xs text-zinc-400">
          <button
            className="text-zinc-300 transition-colors hover:text-white"
            onClick={onBrowseFiles}
          >
            首页⌄
          </button>
          <span className="text-[#777777]">▱</span>
          <span className="min-w-0 truncate text-[#CFCFCF]">
            {activeProject ? basename(activeProject) : '本地'}
          </span>
        </div>

        <div
          className={`w-full ${compact ? 'min-h-[116px]' : 'min-h-[126px]'} rounded-2xl border border-[#45454C] bg-[#2A2A30] shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
        >
          <textarea
            className={`${compact ? 'h-[66px] text-[15px]' : 'h-[72px] text-[17px]'} w-full resize-none bg-transparent px-4 py-3 leading-6 text-[#EDEDED] outline-none placeholder:text-[#707070]`}
            placeholder="规划、构建，输入 / 调用技能，输入 @ 引用上下文"
            aria-label="Agent 输入"
          />
          <div className={`${compact ? 'h-[50px]' : 'h-[54px]'} flex items-center gap-3 px-3`}>
            <button
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#333333] text-xl leading-none text-[#BDBDBD] transition-colors hover:bg-[#3D3D3D] hover:text-white"
              onClick={onBrowseFiles}
              title="添加上下文"
            >
              +
            </button>
            <span className="min-w-0 flex-1" aria-label="模型由设置中的默认模型决定" />
            <button
              className="ml-auto grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-[#111111] transition-colors hover:bg-white"
              title="语音输入"
            >
              ◉
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            className="h-9 rounded-full border border-[#303030] bg-[#181818] px-3 text-xs text-[#EDEDED] transition-colors hover:border-[#464646] hover:bg-[#1B1B1B]"
            onClick={onBrowseFiles}
            data-testid="welcome-primary-action"
          >
            规划新想法 <span className="text-[#777777]">⇧Tab</span>
          </button>
          {!activeProject && (
            <button
              className="h-10 rounded-full border border-transparent px-3 text-sm text-[#A8A8A8] transition-colors hover:bg-[#1B1B1B] hover:text-[#EDEDED]"
              onClick={onOpenProject}
            >
              打开项目
            </button>
          )}
          {activeProject && (
            <button
              className="h-10 rounded-full border border-[#303030] px-3 text-sm text-[#A8A8A8] transition-colors hover:border-[#464646] hover:bg-[#1B1B1B] hover:text-[#EDEDED]"
              onClick={() => onInitializeProject(activeProject)}
              data-testid="welcome-initialize-project"
            >
              初始化项目结构
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RightWorkspace({
  activeProject,
  currentFile,
  recentFiles,
  workspaceVisible,
  projectRefreshVersion,
  editorFontSize,
  autoSave,
  onFileSelect,
  onFileClose,
  onCloseWorkspace,
  onFocusWorkspaceOnly,
  onToggleWorkspace,
  onRestoreWorkspace,
  onExportCurrent,
}: {
  activeProject: string | null;
  currentFile: string | null;
  recentFiles: string[];
  workspaceVisible: boolean;
  projectRefreshVersion: number;
  editorFontSize: number;
  autoSave: boolean;
  onFileSelect: (filePath: string) => void;
  onFileClose: () => void;
  onCloseWorkspace: () => void;
  onFocusWorkspaceOnly: () => void;
  onToggleWorkspace: () => void;
  onRestoreWorkspace: () => void;
  onExportCurrent: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileTreeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [fileTreeWidth, setFileTreeWidth] = useState(288);
  const [isFileTreeDragging, setIsFileTreeDragging] = useState(false);
  const fileTreeMinWidth = 184;
  const fileTreeMaxWidth = 440;
  const editorMinWidth = 360;
  const fileTreeResizerWidth = 4;

  const clampFileTreeWidth = useCallback((nextWidth: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
    const maxByContainer = containerWidth
      ? Math.max(fileTreeMinWidth, containerWidth - editorMinWidth - fileTreeResizerWidth)
      : fileTreeMaxWidth;
    const effectiveMax = Math.min(fileTreeMaxWidth, maxByContainer);
    return Math.min(Math.max(nextWidth, fileTreeMinWidth), effectiveMax);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 布局变化时按容器夹紧文件树宽度，React18 合法模式
    setFileTreeWidth((width) => clampFileTreeWidth(width));
  }, [clampFileTreeWidth, workspaceVisible]);

  useEffect(() => {
    if (!isFileTreeDragging) return;

    const resize = (event: PointerEvent) => {
      const dragState = fileTreeDragRef.current;
      if (!dragState) return;
      setFileTreeWidth(clampFileTreeWidth(dragState.startWidth + event.clientX - dragState.startX));
    };

    const stopResize = () => {
      fileTreeDragRef.current = null;
      setIsFileTreeDragging(false);
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [clampFileTreeWidth, isFileTreeDragging]);

  const beginFileTreeResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    fileTreeDragRef.current = { startX: event.clientX, startWidth: fileTreeWidth };
    setIsFileTreeDragging(true);
  };

  const endFileTreeResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (fileTreeDragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    fileTreeDragRef.current = null;
    setIsFileTreeDragging(false);
  };

  return (
    <div ref={containerRef} className="flex h-full min-w-0">
      {workspaceVisible ? (
        <section
          className="flex h-full flex-shrink-0 flex-col bg-[#1F1F23]"
          style={{ width: fileTreeWidth }}
          data-testid="file-tree-panel"
        >
          <div className="sf-panel-header bg-[#1F1F23]">
            <button
              data-testid="focus-workspace-only"
              onClick={onFocusWorkspaceOnly}
              className="sf-toolbar-button -ml-2"
              title="编辑器最大化"
            >
              编辑窗口 ↗
            </button>
            <button
              data-testid="collapse-file-tree"
              onClick={onToggleWorkspace}
              className="sf-icon-button ml-auto"
              title="隐藏文件树"
            >
              ‹
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <StoryNavigator
              projectPath={activeProject}
              currentFile={currentFile}
              refreshVersion={projectRefreshVersion}
              onFileSelect={onFileSelect}
            />
          </div>
          <div className="hidden" aria-hidden="true" data-recent-count={recentFiles.length} />
        </section>
      ) : (
        <CollapsedRail
          testId="expand-file-tree"
          label="文件"
          title="展开文件树"
          onClick={onRestoreWorkspace}
        />
      )}

      {workspaceVisible && (
        <div
          role="separator"
          aria-orientation="vertical"
          data-testid="file-tree-resizer"
          className={`group relative w-1 flex-shrink-0 cursor-col-resize bg-[#242428] ${
            isFileTreeDragging ? 'bg-[#3E6FA3]' : 'hover:bg-[#34343A]'
          }`}
          style={{ touchAction: 'none' }}
          onPointerDown={beginFileTreeResize}
          onPointerUp={endFileTreeResize}
          onPointerCancel={endFileTreeResize}
          onDoubleClick={() => setFileTreeWidth(288)}
          title="拖拽调整文件树宽度，双击恢复默认宽度"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#3A3A40] group-hover:bg-[#5AA0E6]" />
        </div>
      )}

      <section className="flex-1 min-w-0 bg-[#18181B]" data-testid="editor-panel">
        <Editor
          projectPath={activeProject}
          filePath={currentFile}
          editorFontSize={editorFontSize}
          autoSave={autoSave}
          onClose={currentFile ? onFileClose : onCloseWorkspace}
          onToggleSidebar={onToggleWorkspace}
          sidebarVisible={workspaceVisible}
          onExportCurrent={onExportCurrent}
        />
      </section>
    </div>
  );
}

function FloatingComposer({
  projectName,
  onRestore,
  onRestoreLayout,
  onFullConversation,
}: {
  projectName: string;
  onRestore: () => void;
  onRestoreLayout: () => void;
  onFullConversation: () => void;
}) {
  return (
    <div
      className="rounded-[22px] border border-[#3A3A3A] bg-[#202020]/95 px-2 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur"
      data-testid="floating-composer"
    >
      <div className="mb-2 flex items-center gap-2 px-2 text-xs text-[#CFCFCF]">
        <button
          data-testid="expand-assistant"
          className="rounded-full border border-[#333333] px-3 py-1 hover:bg-[#292929]"
          onClick={onRestore}
          title="恢复左右分栏"
        >
          {projectName}⌄
        </button>
        <span className="rounded-full border border-[#333333] px-3 py-1">▱ 本地⌄</span>
        <button
          data-testid="restore-layout"
          className="ml-auto text-[#8A8A8A] hover:text-white"
          onClick={onRestoreLayout}
          title="恢复完整布局"
        >
          恢复布局
        </button>
        <button
          className="text-[#8A8A8A] hover:text-white"
          onClick={onFullConversation}
          title="回到完整对话"
        >
          还原对话
        </button>
      </div>
      <div className="flex h-10 items-center gap-3 rounded-[18px] border border-[#333333] bg-[#252525] px-3">
        <span className="sf-icon-button rounded-full bg-[#353535] text-lg text-[#BDBDBD]">+</span>
        <span className="min-w-0 flex-1 truncate text-sm text-[#8F8F8F]">
          输入内容，或 @ 引用文件上下文
        </span>
        <span className="text-sm text-[#EDEDED]">StoryForge 助手 · 快速</span>
        <button className="sf-icon-button rounded-full bg-[#EEEEEE] text-[#111111]" title="发送">
          ◖
        </button>
      </div>
    </div>
  );
}

function CollapsedRail({
  testId,
  title,
  label,
  onClick,
}: {
  testId: string;
  title: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      title={title}
      className="group w-9 h-full flex-shrink-0 border-r border-[#3A3A40] bg-[#202024] text-[#B0B0B8] hover:text-white hover:bg-[#2A2A30] transition-colors flex flex-col items-center justify-start py-3 gap-2"
    >
      <span className="text-lg leading-none opacity-80 transition-opacity group-hover:opacity-100">
        ›
      </span>
      <span className="vertical-rl text-[12px] tracking-wide">{label}</span>
    </button>
  );
}
