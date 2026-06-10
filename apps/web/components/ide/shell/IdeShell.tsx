'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { ActivityBar } from './ActivityBar';
import { BottomPanel } from './BottomPanel';
import { EditorArea } from './EditorArea';
import { RightDock } from './RightDock';
import { SidePanel } from './SidePanel';
import { PersonalizationPanel } from '../personalization/PersonalizationPanel';
import {
  createEditorPopoutUrl,
  defaultIdePreferences,
  type IdePersonalizationPreferences,
} from '../personalization/preferences';
import { createIdeUrlHref, parseIdeUrlState, type IdePanelId } from '../url/ide-url-state';
import { createInitialIdeState, type IdeStoreState } from './ide-store';

export type IdeShellProps = {
  readonly initialState?: Partial<IdeStoreState>;
  readonly initialPreferences?: IdePersonalizationPreferences;
};

export function IdeShell({
  initialState,
  initialPreferences = defaultIdePreferences,
}: IdeShellProps) {
  const initial = createInitialIdeState(initialState);
  const [leftPanel, setLeftPanel] = useState(initial.leftPanel);
  const [bottomPanel, setBottomPanel] = useState(initial.bottomPanel);
  const [tabs, setTabs] = useState<readonly string[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(initial.activeTabId);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  const layoutStyle = {
    '--ide-left-panel-width': isLeftPanelOpen ? `${initialPreferences.layout.leftPanelWidth}px` : '0px',
    '--ide-bottom-panel-height': `${initialPreferences.layout.bottomPanelHeight}px`,
    '--ide-right-dock-width': isRightPanelOpen ? `${initialPreferences.layout.rightDockWidth}px` : '0px',
  } as CSSProperties;

  const urlState = useMemo(
    () => ({
      workspace: initial.workspace,
      bookId: initial.bookId,
      tabs,
      activeTabId,
      inspectorId: initial.inspectorId,
      artifactId: initial.artifactId,
      bookRunId: initial.bookRunId,
      sceneId: initial.sceneId,
      leftPanel: leftPanel as IdePanelId,
      bottomPanel: bottomPanel as IdePanelId,
    }),
    [
      activeTabId,
      bottomPanel,
      initial.artifactId,
      initial.bookRunId,
      initial.bookId,
      initial.inspectorId,
      initial.sceneId,
      initial.workspace,
      leftPanel,
      tabs,
    ],
  );
  const popoutUrl = createEditorPopoutUrl(urlState);

  const openTab = (tabId: string) => {
    setTabs((current) => (current.includes(tabId) ? current : [...current, tabId]));
    setActiveTabId(tabId);
  };

  const leftPanelHrefs = Object.fromEntries(
    ['explorer', 'search', 'memory', 'runs', 'problems'].map((panel) => [
      panel,
      createIdeUrlHref(urlState, { leftPanel: panel as IdePanelId }),
    ]),
  );
  const bottomPanelHrefs = Object.fromEntries(
    ['problems', 'diff', 'runs', 'artifacts', 'evaluation'].map((panel) => [
      panel,
      createIdeUrlHref(urlState, { bottomPanel: panel as IdePanelId }),
    ]),
  );

  const commitUrlState = (nextState: Partial<typeof urlState>) => {
    if (typeof window === 'undefined') return;
    window.history.pushState(null, '', createIdeUrlHref(urlState, nextState));
  };

  const selectLeftPanel = (panel: string) => {
    setLeftPanel(panel);
    commitUrlState({ leftPanel: panel as IdePanelId });
  };

  const selectBottomPanel = (panel: string) => {
    setBottomPanel(panel);
    commitUrlState({ bottomPanel: panel as IdePanelId });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return () => undefined;
    const restoreFromUrl = () => {
      const restored = createInitialIdeState(parseIdeUrlState(window.location.search));
      setLeftPanel(restored.leftPanel);
      setBottomPanel(restored.bottomPanel);
      setTabs(restored.tabs);
      setActiveTabId(restored.activeTabId);
    };
    window.addEventListener('popstate', restoreFromUrl);
    return () => window.removeEventListener('popstate', restoreFromUrl);
  }, []);

  return (
    <div
      data-testid="ide-shell"
      data-ide-theme={initialPreferences.theme}
      className="min-h-screen bg-stone-950 text-stone-100 flex flex-col"
      style={layoutStyle}
      data-active-left-panel={leftPanel}
      data-active-bottom-panel={bottomPanel}
    >
      <header className="flex items-center justify-between gap-4 border-b border-stone-800 bg-stone-950 px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsLeftPanelOpen((v) => !v)}
            className="rounded px-2 py-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors"
            aria-label="Toggle Left Panel"
            title="Toggle Left Panel"
          >
            ☰
          </button>
          <h1 className="text-lg font-bold">StoryForge IDE</h1>
        </div>
        <div className="flex items-center gap-3">
          <PersonalizationPanel preferences={initialPreferences} />
          <button
            type="button"
            onClick={() => setIsRightPanelOpen((v) => !v)}
            className="rounded px-2 py-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors"
            aria-label="Toggle Right Panel"
            title="Toggle Right Panel"
          >
            ☰
          </button>
        </div>
      </header>
      <div className="grid flex-1 overflow-hidden grid-cols-[4.5rem_var(--ide-left-panel-width)_minmax(0,1fr)_var(--ide-right-dock-width)] transition-[grid-template-columns] duration-300">
        <ActivityBar
          activePanel={leftPanel}
          onSelectPanel={selectLeftPanel}
          panelHrefs={leftPanelHrefs}
        />
        <div className="overflow-hidden flex flex-col border-r border-stone-800">
          <SidePanel
            activePanel={leftPanel}
            onOpenTab={openTab}
            storyMemoryResult={initial.storyMemoryResult}
          />
        </div>
        <div className="overflow-hidden flex flex-col">
          <EditorArea
            tabs={tabs}
            activeTabId={activeTabId}
            popoutUrl={popoutUrl}
            inspectorId={initial.inspectorId}
            contextSnapshot={initial.contextSnapshot}
            contextSnapshotEvictedAt={initial.contextSnapshotEvictedAt}
            sceneId={initial.sceneId}
            sceneContent={initial.sceneContent}
            diagnostics={initial.diagnostics}
          />
        </div>
        <div className="overflow-hidden flex flex-col border-l border-stone-800 bg-stone-900">
          <div className="flex-1 overflow-auto">
            <RightDock />
          </div>
          <div className="shrink-0 border-t border-stone-800">
            <BottomPanel
              activePanel={bottomPanel}
              artifactPreview={initial.artifactPreview}
              bookRun={initial.bookRun}
              bookRunEvents={initial.bookRunEvents}
              diagnostics={initial.diagnostics}
              onSelectPanel={selectBottomPanel}
              panelHrefs={bottomPanelHrefs}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
