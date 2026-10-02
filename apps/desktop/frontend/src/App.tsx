/** StoryForge desktop shell wiring. */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PaletteMode } from './components/CommandPalette';
import { AppShell } from './components/app/AppShell';
import { BookOverview } from './components/app/BookOverview';
import { useMainSurface } from './components/app/useMainSurface';
import { useOverviewActivity } from './components/app/useOverviewActivity';
import { useAppDialog } from './components/app/AppDialog';
import { useAppPreferences } from './components/app/useAppPreferences';
import { useBookContext } from './components/app/useBookContext';
import { useBookOverviewChapters } from './components/app/useBookOverviewChapters';
import { useBookProfile } from './components/app/useBookProfile';
import { nextCyclicEditorFile } from './components/app/editor-tabs-state';
import { useEditorNavigation } from './components/app/useEditorNavigation';
import { useEditorWorkspaceTabs } from './components/app/useEditorWorkspaceTabs';
import { useObservatory } from './components/app/useObservatory';
import { useProjectCommands } from './components/app/useProjectCommands';
import { useProjectSearch } from './components/app/useProjectSearch';
import { useProjectWorkspace } from './components/app/useProjectWorkspace';
import { useSessionRestore } from './components/app/useSessionRestore';
import { useTauriMenuBridge } from './components/app/useTauriMenuBridge';
import { useShellState, type SidePanelView } from './components/shell/useShellState';
import {
  emitChapterWriteRequest,
  emitEditorCommand,
  flushActiveEditorToDisk,
  nextChapterWriteRequest,
} from './lib/assistant-events';
import { emitToast } from './lib/toast';
import { checkForUpdate, currentAppVersion } from './lib/update-check';
import { isEditableTarget } from './lib/browser-guards';
import { ExternalWritebackCoordinator } from './lib/external-writeback/coordinator';
import { ExternalWritebackProvider } from './components/app/ExternalWritebackProvider';
export function App() {
  const [externalWriteback] = useState(() => new ExternalWritebackCoordinator());
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [obsPanelOpen, setObsPanelOpen] = useState(false);
  const appDialog = useAppDialog();
  const shell = useShellState();
  const { showRight } = shell;
  const surface = useMainSurface(shell, setSettingsVisible);
  const { mainSurface, setMainSurface, showEditor, showOverview } = surface;
  const { showLibrary, resumeProject, navigateView, openAllChapters } = surface;
  const preferences = useAppPreferences();
  const workspace = useProjectWorkspace({
    onProjectSelected: showOverview,
    onFileSelected: showEditor,
  });
  const session = useSessionRestore({
    enabled: preferences.settings.restoreLastSession,
    deferUntilProjectSelected: true,
    selectProject: workspace.selectProject,
  });
  const tabs = useEditorWorkspaceTabs({
    activeProject: workspace.activeProject,
    currentFile: workspace.currentFile,
    selectProject: session.selectProjectManually,
    selectFile: workspace.selectFile,
    closeFile: workspace.closeFile,
    removeProject: workspace.removeProject,
    dialogs: appDialog,
    onShowEditor: showEditor,
    pendingRestore: session.pendingRestore,
    onRestoreApplied: session.handleRestoreApplied,
  });
  const { cancelPendingNavigation } = session;
  const openLibrary = useCallback(() => {
    cancelPendingNavigation();
    showLibrary();
  }, [cancelPendingNavigation, showLibrary]);
  const resumeSelectedProject = useCallback(() => {
    if (mainSurface === 'library') resumeProject();
  }, [mainSurface, resumeProject]);
  const commands = useProjectCommands({
    activeProject: workspace.activeProject,
    currentFile: workspace.currentFile,
    dirtyFiles: tabs.dirtyFiles,
    openFiles: tabs.openFiles,
    dialogs: appDialog,
    selectProject: session.selectProjectManually,
    selectProjectSafely: tabs.selectProjectSafely,
    openFile: tabs.openFile,
    confirmDiscardFiles: tabs.confirmDiscardFiles,
    resetEditorFiles: tabs.resetEditorFiles,
    onShowEditor: showEditor,
    cancelPendingNavigation,
    onResumeProject: resumeSelectedProject,
  });
  const switchView = useCallback(
    (view: SidePanelView) => navigateView(view, Boolean(workspace.activeProject)),
    [navigateView, workspace.activeProject],
  );
  const openSettings = useCallback(async () => {
    setSettingsVisible(true);
  }, []);
  const { persistSession } = session;
  useEffect(() => {
    persistSession(workspace.activeProject, tabs.openFiles, workspace.currentFile);
  }, [persistSession, tabs.openFiles, workspace.activeProject, workspace.currentFile]);
  const restoreIssueKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const issue = session.restoreIssue;
    const key = issue ? `${issue.kind}:${issue.project}` : null;
    if (issue && key && key !== restoreIssueKeyRef.current) emitToast(issue.message);
    restoreIssueKeyRef.current = key;
  }, [session.restoreIssue]);
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
      // IME 组合态不触发全局命令。文本焦点只屏蔽会抢走编辑位置的布局导航；
      // Ctrl/Cmd+S/P/O 保持全局保存、文件搜索、打开项目的既有契约。
      const shellNavigationKey =
        key === 'b' || (event.shiftKey && key === 'o') || key === '1' || key === '2' || key === '3';
      if (event.isComposing || (shellNavigationKey && isEditableTarget(event.target))) return;
      // Ctrl Tab / Ctrl Shift Tab / Ctrl PageDown·PageUp：在已固定页签间循环（shift = 反向）。
      // 必须排在 shift 早退之前，否则 Ctrl+Shift+Tab 会被上面那组视图快捷键吞掉。
      // 与 Ctrl W 关键区别：只换焦点不关页签，不触发脏文件确认，按一圈不会丢稿。
      if (key === 'tab' || key === 'pagedown' || key === 'pageup') {
        if (!workspace.activeProject) return;
        event.preventDefault();
        const direction = key === 'pageup' || (key === 'tab' && event.shiftKey) ? -1 : 1;
        const next = nextCyclicEditorFile(tabs.openFiles, tabs.displayedFile, direction);
        if (next) tabs.focusFile(next);
        return;
      }
      if (event.shiftKey) {
        // Ctrl+Shift+B 作品 / E 资源管理器 / F 正文全文搜索 / M 手稿 / O 观测镜 / K 知识收件箱。
        // P2-A：library 态下这些键不该拽出主表面——作者在作品库里按 Ctrl+Shift+F 找文段是
        // 误触，应先回到 overview/workspace 才有「在哪个作品里搜」的语境。无项目时也无目标。
        const viewMap: Record<string, SidePanelView> = {
          b: 'book',
          e: 'explorer',
          f: 'search',
          m: 'manuscript',
          o: 'observatory',
          i: 'knowledge',
        };
        const view = viewMap[key];
        if (view) {
          if (mainSurface === 'library' || !workspace.activeProject) return;
          event.preventDefault();
          switchView(view);
          return;
        }
        if (key === 'h') {
          // 版本历史与 Ctrl+S 同档：无活动文件时按下去是死键。
          if (!tabs.displayedFile) return;
          event.preventDefault();
          emitEditorCommand('toggle-history');
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
        if (mainSurface === 'overview') {
          showEditor();
          shell.showSidebar();
        } else {
          shell.toggleSidebar();
        }
      } else if (key === ',') {
        event.preventDefault();
        void openSettings();
      } else if (key === '1' || key === '2' || key === '3') {
        // P2-A：compact 下 balanced 会被立即派生回 editor，写 preference 不生效反而误导。
        // 与 toggleRight/showRight 的 compact 分支对齐：compact 时只有 editor(chat 走 Ctrl+3)。
        if (mainSurface === 'library') return; // 作品库里没有编辑器，布局键无意义。
        event.preventDefault();
        setMainSurface('workspace');
        const requested =
          key === '1' ? 'editor' : key === '2' || !workspace.activeProject ? 'balanced' : 'chat';
        shell.setLayoutMode(shell.compact && requested === 'balanced' ? 'editor' : requested);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // exhaustive-deps：依赖里列出 tabs 的叶片（displayedFile/openFiles/focusFile）而非整个 tabs 对象——
    // tabs 是 useEditorWorkspaceTabs 每次渲染新建的对象，整体列入会让监听器每帧脱落重挂。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commands,
    mainSurface,
    openSettings,
    shell,
    showEditor,
    switchView,
    tabs.displayedFile,
    tabs.focusFile,
    tabs.openFiles,
    workspace.activeProject,
  ]);
  const runtime = useTauriMenuBridge({
    onRestoreFullLayout: () => {
      shell.showSidebar();
      shell.setLayoutMode('balanced');
    },
  });

  // 观测接线：打开项目即首扫，写盘后防抖重扫（确定性无 LLM）。
  const observatory = useObservatory({ activeProject: workspace.activeProject });

  // 手稿视图：阅读序章节 + 模型这轮拿到的作品底座。跟着当前文件走，章号才不会长期显示错的。
  const bookContext = useBookContext({
    activeProject: workspace.activeProject,
    currentFile: workspace.currentFile,
  });

  // 作品视图：档案（book.json）+ 现算的进度 / 大纲 / 速记。只在视图激活时读盘——
  // 全书字数是几百次读盘，不能每开一个项目就白扫一遍。
  const bookProfile = useBookProfile({
    activeProject: workspace.activeProject,
    active: mainSurface === 'overview' || (shell.view === 'book' && !shell.sidebarHidden),
  });
  const bookChapters = useBookOverviewChapters({
    projectPath: workspace.activeProject,
    currentFile: workspace.currentFile,
    active: mainSurface === 'overview',
  });

  const search = useProjectSearch(workspace.activeProject);
  const {
    openOutlineHeading,
    openSearchHit,
    locateAnchor,
    locateObservation,
    openManuscriptChapter,
  } = useEditorNavigation({
    activeProject: workspace.activeProject,
    displayedFile: tabs.displayedFile,
    openFile: tabs.openFile,
    showEditor,
  });

  const continueWriting = useCallback(
    (relativePath?: string) => {
      setMainSurface('workspace');
      if (relativePath) {
        openManuscriptChapter(relativePath);
      } else {
        showEditor();
      }
    },
    [openManuscriptChapter, setMainSurface, showEditor],
  );
  const showAgent = useCallback(() => {
    showEditor();
    showRight();
  }, [showEditor, showRight]);
  // 「AI 起草下一章」：先展开右栏（brief 在右栏确认），事件由常驻 ChatWindow 消费；
  // 章节源优先总览索引，总览未激活时（手稿视图）回落到底座快照。
  const draftNextChapter = useCallback(() => {
    showAgent();
    const chapters = bookChapters.chapters.length
      ? bookChapters.chapters
      : (bookContext.snapshot?.chapters ?? []);
    emitChapterWriteRequest(nextChapterWriteRequest(chapters));
  }, [bookChapters.chapters, bookContext.snapshot, showAgent]);
  const activity = useOverviewActivity({
    projectPath: workspace.activeProject,
    displayedFile: tabs.displayedFile,
    openFile: tabs.openFile,
    showEditor,
  });

  // P2-C：与 AppShell.openBookProfileEditor 同一路径，从作品总览封面空态直通作品资料编辑视图。
  const openBookProfileEditor = useCallback(() => {
    showEditor();
    shell.showExplorerView();
    shell.switchView('book');
    shell.showSidebar();
  }, [showEditor, shell]);

  return (
    <ExternalWritebackProvider project={workspace.activeProject} coordinator={externalWriteback}>
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
        bookContext={bookContext}
        onOpenManuscriptChapter={openManuscriptChapter}
        onDraftNextChapter={draftNextChapter}
        bookProfile={bookProfile}
        onOpenOutlineHeading={openOutlineHeading}
        openSettings={openSettings}
        search={search}
        onOpenSearchHit={openSearchHit}
        mainSurface={mainSurface}
        onMainSurfaceChange={setMainSurface}
        onSwitchView={switchView}
        onPendingSuggestionChange={activity.onPendingChange}
        onAgentRunSummaryChange={activity.onRunChange}
        overview={
          workspace.activeProject ? (
            <BookOverview
              projectPath={workspace.activeProject}
              profile={bookProfile}
              context={bookContext}
              chapters={bookChapters}
              onContinueWriting={continueWriting}
              onOpenAllChapters={openAllChapters}
              onOpenChapter={continueWriting}
              onOpenOutline={openOutlineHeading}
              onRefresh={bookProfile.refresh}
              pendingPatchCount={activity.pendingSuggestion ? 1 : 0}
              onOpenPendingPatches={activity.openPendingSuggestion}
              agentRun={activity.agentRun}
              onOpenAgentRun={showAgent}
              onEditProfile={openBookProfileEditor}
              onDraftNextChapter={draftNextChapter}
            />
          ) : null
        }
        initialCursors={session.initialCursors}
        onCursorPersist={session.recordCursor}
        onOpenLibrary={openLibrary}
        onResumeProject={resumeProject}
        openingProject={session.openingProject}
      />
    </ExternalWritebackProvider>
  );
}
