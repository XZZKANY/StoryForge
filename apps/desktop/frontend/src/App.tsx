/** StoryForge desktop shell wiring. */

import { useCallback, useEffect, useState } from 'react';

import type { PaletteMode } from './components/CommandPalette';
import { AppShell } from './components/app/AppShell';
import { useAppDialog } from './components/app/AppDialog';
import { useAppPreferences } from './components/app/useAppPreferences';
import { useEditorWorkspaceTabs } from './components/app/useEditorWorkspaceTabs';
import { useProjectCommands } from './components/app/useProjectCommands';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import type { Observation } from './components/shell/ObsPanel';
import { useShellState, type SidePanelView } from './components/shell/useShellState';
import { emitPublishCommand, type PublishCommandType } from './features/publish';

export function App() {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [obsPanelOpen, setObsPanelOpen] = useState(false);
  // 真实 advisory / 一致性信号仍在 Agent run 内；未接线前保持诚实空态。
  const [observations, setObservations] = useState<Observation[]>([]);
  const appDialog = useAppDialog();
  const shell = useShellState();
  const preferences = useAppPreferences(appDialog);

  const showEditor = useCallback(() => setSettingsVisible(false), []);
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

  /** 发行 = 左栏功能块，不再占中栏整页。 */
  const openPublishSide = useCallback(() => {
    setSettingsVisible(false);
    shell.switchView('publish');
    shell.showSidebar();
  }, [shell]);

  const handlePublishCommand = useCallback(
    (type: string) => {
      openPublishSide();
      window.setTimeout(() => {
        emitPublishCommand(type as PublishCommandType);
      }, 0);
    },
    [openPublishSide],
  );

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

  const resolveObservation = useCallback((id: string) => {
    setObservations((current) =>
      current.map((observation) =>
        observation.id === id ? { ...observation, resolved: true } : observation,
      ),
    );
  }, []);

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
      observations={observations}
      resolveObservation={resolveObservation}
      openSettings={openSettings}
      openPublishSide={openPublishSide}
      handlePublishCommand={handlePublishCommand}
    />
  );
}
