/** StoryForge desktop shell wiring. */

import { useCallback, useEffect, useState } from 'react';

import type { PaletteMode } from './components/CommandPalette';
import { AppShell } from './components/app/AppShell';
import { useAppDialog } from './components/app/AppDialog';
import { useAppPreferences } from './components/app/useAppPreferences';
import { useEditorWorkspaceTabs } from './components/app/useEditorWorkspaceTabs';
import { useObservatory } from './components/app/useObservatory';
import { useProjectCommands } from './components/app/useProjectCommands';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import type { Observation } from './components/shell/ObsPanel';
import { useShellState, type SidePanelView } from './components/shell/useShellState';
import { emitLocateInEditor } from './lib/assistant-events';
import type { ObservationAnchor } from './lib/observations';
import { emitToast } from './lib/toast';
import { checkForUpdate, currentAppVersion } from './lib/update-check';

export function App() {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [obsPanelOpen, setObsPanelOpen] = useState(false);
  const appDialog = useAppDialog();
  const shell = useShellState();
  const preferences = useAppPreferences();
  // 欢迎页可关（会话级）：起始态由「启动时显示欢迎页」偏好决定；关了露出空 workbench，
  // 命令面板「显示欢迎页」可重开。
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => !preferences.settings.showWelcomeOnStartup,
  );

  // 关设置页 + 确保中栏可见（对话聚焦 Ctrl+3 态会隐藏中栏，补丁 / 正文才不至于落在看不见的中栏）。
  const showEditor = useCallback(() => {
    setSettingsVisible(false);
    shell.showCenter();
  }, [shell.showCenter]);
  const workspace = useProjectWorkspace({
    onProjectSelected: showEditor,
    onFileSelected: showEditor,
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
        const viewMap: Record<string, SidePanelView> = {
          e: 'explorer',
          f: 'search',
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
      if (key === 'p') {
        event.preventDefault();
        setPalette('files');
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
  }, [openSettings, shell, workspace.activeProject]);

  const runtime = useTauriMenuBridge({
    onOpenProject: commands.handleOpenProject,
    onNewFile: commands.handleNewFile,
    onToggleSidebar: shell.toggleSidebar,
    onRestoreFullLayout: () => {
      shell.showSidebar();
      shell.showRight();
    },
  });

  // 观测接线：打开项目即首扫，写盘后防抖重扫（确定性无 LLM）。
  const observatory = useObservatory({ activeProject: workspace.activeProject });

  // 点观测行 / 台账锚点定位原文：拼项目内绝对路径（沿用项目串的分隔符风格，保证与
  // 页签路径可比），非当前文件先打开，再广播定位事件由 Editor 在模型就绪后消费。
  const locateAnchor = useCallback(
    (anchor: ObservationAnchor) => {
      const project = workspace.activeProject;
      if (!project) return;
      // 定位原文要落在中栏编辑器；对话聚焦态隐藏中栏时先落回 balanced，否则定位落空。
      shell.showCenter();
      const separator = project.includes('\\') ? '\\' : '/';
      const relativePath = anchor.path.split('/').join(separator);
      const absolutePath = `${project.replace(/[\\/]+$/, '')}${separator}${relativePath}`;
      if (tabs.displayedFile !== absolutePath) void tabs.openFile(absolutePath, '定位观测');
      emitLocateInEditor({ filePath: absolutePath, line: anchor.line, snippet: anchor.snippet });
    },
    [shell.showCenter, tabs, workspace.activeProject],
  );

  const locateObservation = useCallback(
    (observation: Observation) => {
      if (observation.anchor) locateAnchor(observation.anchor);
    },
    [locateAnchor],
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
      observatory={{ ...observatory, locateObservation, locateAnchor }}
      openSettings={openSettings}
      welcomeDismissed={welcomeDismissed}
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
