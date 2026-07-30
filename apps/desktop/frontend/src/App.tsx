/** StoryForge desktop shell wiring. */

import { useCallback, useEffect, useState } from 'react';

import type { PaletteMode } from './components/CommandPalette';
import { AppShell } from './components/app/AppShell';
import { useAppDialog } from './components/app/AppDialog';
import { useAppPreferences } from './components/app/useAppPreferences';
import { useBookContext } from './components/app/useBookContext';
import { useEditorWorkspaceTabs } from './components/app/useEditorWorkspaceTabs';
import { useObservatory } from './components/app/useObservatory';
import { useProjectCommands } from './components/app/useProjectCommands';
import { useProjectSearch } from './components/app/useProjectSearch';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useSessionRestore } from './components/app/useSessionRestore';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import type { Observation } from './components/shell/ObsPanel';
import { useShellState, type SidePanelView } from './components/shell/useShellState';
import { emitLocateInEditor, flushActiveEditorToDisk } from './lib/assistant-events';
import type { ObservationAnchor } from './lib/observations';
import { emitToast } from './lib/toast';
import { checkForUpdate, currentAppVersion } from './lib/update-check';

export function App() {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [obsPanelOpen, setObsPanelOpen] = useState(false);
  const appDialog = useAppDialog();
  const shell = useShellState();
  // showCenter 单独取出：稳定 useCallback，供 showEditor / locateAnchor 依赖，避免整个 shell 进 deps。
  const { showCenter } = shell;
  const preferences = useAppPreferences();
  // 欢迎页可关（会话级）：起始态由「启动时显示欢迎页」偏好决定；关了露出空 workbench，
  // 命令面板「显示欢迎页」可重开。
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => !preferences.settings.showWelcomeOnStartup,
  );

  // 关设置页 + 确保中栏可见（对话聚焦 Ctrl+3 态会隐藏中栏，补丁 / 正文才不至于落在看不见的中栏）。
  const showEditor = useCallback(() => {
    setSettingsVisible(false);
    showCenter();
  }, [showCenter]);
  const workspace = useProjectWorkspace({
    onProjectSelected: showEditor,
    onFileSelected: showEditor,
  });
  const session = useSessionRestore({
    enabled: preferences.settings.restoreLastSession,
    selectProject: workspace.selectProject,
  });
  const tabs = useEditorWorkspaceTabs({
    activeProject: workspace.activeProject,
    currentFile: workspace.currentFile,
    selectProject: workspace.selectProject,
    selectFile: workspace.selectFile,
    closeFile: workspace.closeFile,
    removeProject: workspace.removeProject,
    dialogs: appDialog,
    onShowEditor: showEditor,
    pendingRestore: session.pendingRestore,
    onRestoreApplied: session.handleRestoreApplied,
  });
  const commands = useProjectCommands({
    activeProject: workspace.activeProject,
    currentFile: workspace.currentFile,
    dirtyFiles: tabs.dirtyFiles,
    openFiles: tabs.openFiles,
    dialogs: appDialog,
    selectProject: workspace.selectProject,
    selectProjectSafely: tabs.selectProjectSafely,
    openFile: tabs.openFile,
    confirmDiscardFiles: tabs.confirmDiscardFiles,
    resetEditorFiles: tabs.resetEditorFiles,
    onShowEditor: showEditor,
  });

  const openSettings = useCallback(async () => {
    setSettingsVisible(true);
  }, []);

  // 现场随页签 / 活动文件变化回写；光标位置由 Editor 去抖后经 recordCursor 记进同一份会话。
  const { persistSession } = session;
  useEffect(() => {
    persistSession(workspace.activeProject, tabs.openFiles, workspace.currentFile);
  }, [persistSession, tabs.openFiles, workspace.activeProject, workspace.currentFile]);

  // 启动更新自检：仅装机构建，延迟起跑不抢启动带宽；网络失败静默降级
  // （GitHub 在本机依赖代理，不可用是常态，只有查到新版才打扰）。
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const version = await currentAppVersion();
        if (!version) return;
        const result = await checkForUpdate(version);
        if (result.kind === 'update-available') {
          emitToast(`检查到新版本 ${result.latest}（当前 ${result.current}）`, {
            durationMs: 10000,
          });
        }
      })();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  // 滚动容器短暂显示 scrollbar thumb，便于长稿定位。
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      el.classList.add('scrolling');
      const previous = timers.get(el);
      if (previous) window.clearTimeout(previous);
      timers.set(
        el,
        window.setTimeout(() => el.classList.remove('scrolling'), 700),
      );
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey) {
        // Ctrl+Shift+E 资源管理器 / F 正文全文搜索 / M 手稿 / O 观测镜。
        const viewMap: Record<string, SidePanelView> = {
          e: 'explorer',
          f: 'search',
          m: 'manuscript',
          o: 'observatory',
        };
        const view = viewMap[key];
        if (view) {
          event.preventDefault();
          shell.switchView(view);
          return;
        }
        if (key === 'p') {
          event.preventDefault();
          setPalette('commands');
        }
        return;
      }
      if (key === 's') {
        // Ctrl+S 此前只是 Monaco 内部命令：焦点在文件树 / 对话栏时是死键，作者以为存了其实没存。
        // 编辑器聚焦时 Monaco 先吃掉这个键并阻断冒泡，这里不会重复触发。
        if (!tabs.displayedFile) return;
        event.preventDefault();
        void flushActiveEditorToDisk(tabs.displayedFile).catch(() => {
          // 保存失败由 Editor 自己弹窗告知，这里只防未处理 rejection。
        });
      } else if (key === 'p') {
        event.preventDefault();
        setPalette('files');
      } else if (key === 'o') {
        // 速查表与欢迎页都印着 Ctrl O；原生菜单从未安装（decorations:false + create_menu never called），
        // 这个键此前一直是死的。承诺写在界面上就得由前端自己兑现。
        event.preventDefault();
        void commands.handleOpenProject();
      } else if (key === 'b') {
        event.preventDefault();
        shell.toggleSidebar();
      } else if (key === ',') {
        event.preventDefault();
        void openSettings();
      } else if (key === '1' || key === '2' || key === '3') {
        if (!workspace.activeProject) return;
        event.preventDefault();
        shell.setLayoutMode(key === '1' ? 'editor' : key === '2' ? 'balanced' : 'chat');
      } else if (key === '4') {
        if (!workspace.activeProject) return;
        event.preventDefault();
        shell.toggleObservatory();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commands, openSettings, shell, tabs.displayedFile, workspace.activeProject]);

  // 观测面板挂在中栏底部，而对话聚焦态（Ctrl+3）整条隐藏中栏：直接翻 open 会「点了没反应」。
  // 开面板前先落回可见布局，关面板则不动布局。
  const toggleObsPanel = useCallback(() => {
    if (!obsPanelOpen) showCenter();
    setObsPanelOpen((open) => !open);
  }, [obsPanelOpen, showCenter]);

  const runtime = useTauriMenuBridge({
    onRestoreFullLayout: () => {
      shell.showSidebar();
      shell.showRight();
    },
  });

  // 观测接线：打开项目即首扫，写盘后防抖重扫（确定性无 LLM）。
  const observatory = useObservatory({ activeProject: workspace.activeProject });

  // 手稿视图：阅读序章节 + 模型这轮拿到的作品底座。跟着当前文件走，章号才不会长期显示错的。
  const bookContext = useBookContext({
    activeProject: workspace.activeProject,
    currentFile: workspace.currentFile,
  });

  // 全文搜索（Ctrl+Shift+F）：点结果 → 打开该文件并跳到那一行，复用观测定位的同一条事件通道。
  const search = useProjectSearch(workspace.activeProject);
  const openSearchHit = useCallback(
    (path: string, line: number) => {
      showCenter();
      if (tabs.displayedFile !== path) void tabs.openFile(path, '打开搜索结果');
      emitLocateInEditor({ filePath: path, line });
    },
    [showCenter, tabs],
  );

  // 点观测行 / 台账锚点定位原文：拼项目内绝对路径（沿用项目串的分隔符风格，保证与
  // 页签路径可比），非当前文件先打开，再广播定位事件由 Editor 在模型就绪后消费。
  const locateAnchor = useCallback(
    (anchor: ObservationAnchor) => {
      const project = workspace.activeProject;
      if (!project) return;
      // 定位原文要落在中栏编辑器；对话聚焦态隐藏中栏时先落回 balanced，否则定位落空。
      showCenter();
      const separator = project.includes('\\') ? '\\' : '/';
      const relativePath = anchor.path.split('/').join(separator);
      const absolutePath = `${project.replace(/[\\/]+$/, '')}${separator}${relativePath}`;
      if (tabs.displayedFile !== absolutePath) void tabs.openFile(absolutePath, '定位观测');
      emitLocateInEditor({ filePath: absolutePath, line: anchor.line, snippet: anchor.snippet });
    },
    [showCenter, tabs, workspace.activeProject],
  );

  const locateObservation = useCallback(
    (observation: Observation) => {
      if (observation.anchor) locateAnchor(observation.anchor);
    },
    [locateAnchor],
  );

  // 点手稿章节行打开该章：底座给的是 posix 相对路径，拼绝对路径沿用项目串的分隔符风格
  // （与 locateAnchor 同一判据），否则 Windows 下拼出的路径与页签路径不可比、会重复开页签。
  const openManuscriptChapter = useCallback(
    (relativePath: string) => {
      const project = workspace.activeProject;
      if (!project) return;
      showCenter();
      const separator = project.includes('\\') ? '\\' : '/';
      const absolutePath = `${project.replace(/[\\/]+$/, '')}${separator}${relativePath
        .split('/')
        .join(separator)}`;
      if (tabs.displayedFile !== absolutePath) void tabs.openFile(absolutePath, '打开章节');
    },
    [showCenter, tabs, workspace.activeProject],
  );

  return (
    <AppShell
      workspace={workspace}
      tabs={tabs}
      commands={commands}
      preferences={preferences}
      shell={shell}
      dialogs={appDialog}
      runtime={runtime}
      settingsVisible={settingsVisible}
      setSettingsVisible={setSettingsVisible}
      palette={palette}
      setPalette={setPalette}
      obsPanelOpen={obsPanelOpen}
      setObsPanelOpen={setObsPanelOpen}
      toggleObsPanel={toggleObsPanel}
      observatory={{ ...observatory, locateObservation, locateAnchor }}
      bookContext={bookContext}
      onOpenManuscriptChapter={openManuscriptChapter}
      openSettings={openSettings}
      search={search}
      onOpenSearchHit={openSearchHit}
      initialCursors={session.initialCursors}
      onCursorPersist={session.recordCursor}
      welcomeDismissed={welcomeDismissed || session.restoredWorkspace}
      onCloseWelcome={() => setWelcomeDismissed(true)}
      onReopenWelcome={() => {
        // 无项目时设置页占据中栏（centerHasTabs），只翻 welcomeDismissed 不清设置页 =
        // 「显示欢迎页」命令静默无效；一并收起设置页才能从任意无项目态稳定露出欢迎页。
        setSettingsVisible(false);
        setWelcomeDismissed(false);
      }}
    />
  );
}
