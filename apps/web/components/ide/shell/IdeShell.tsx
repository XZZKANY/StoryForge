'use client';

import { useState } from 'react';

import { ActivityBar } from './ActivityBar';
import { BottomPanel } from './BottomPanel';
import { EditorArea } from './EditorArea';
import { RightDock } from './RightDock';
import { SidePanel } from './SidePanel';
import { PersonalizationPanel } from '../personalization/PersonalizationPanel';
import { createEditorPopoutUrl, defaultIdePreferences } from '../personalization/preferences';
import { createInitialIdeState, type IdeStoreState } from './ide-store';

export type IdeShellProps = {
  readonly initialState?: Partial<IdeStoreState>;
};

export function IdeShell({ initialState }: IdeShellProps) {
  const initial = createInitialIdeState(initialState);
  const [leftPanel, setLeftPanel] = useState(initial.leftPanel);
  const [bottomPanel] = useState(initial.bottomPanel);
  const [tabs, setTabs] = useState<readonly string[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(initial.activeTabId);
  const popoutUrl = createEditorPopoutUrl({
    workspace: initial.workspace,
    bookId: initial.bookId,
    tabs,
    activeTabId,
    leftPanel: leftPanel as never,
    bottomPanel: bottomPanel as never,
  });

  const openTab = (tabId: string) => {
    setTabs((current) => (current.includes(tabId) ? current : [...current, tabId]));
    setActiveTabId(tabId);
  };

  return (
    <div data-testid="ide-shell" className="min-h-screen bg-stone-950 text-stone-100">
      <header className="flex items-start justify-between gap-4 border-b border-stone-800 bg-stone-950 px-4 py-2">
        <h1 className="text-lg font-bold">StoryForge IDE</h1>
        <PersonalizationPanel preferences={defaultIdePreferences} />
      </header>
      <div className="grid min-h-[calc(100vh-3rem)] grid-cols-[4.5rem_16rem_minmax(0,1fr)_14rem] grid-rows-[1fr_auto]">
        <ActivityBar activePanel={leftPanel} onSelectPanel={setLeftPanel} />
        <SidePanel activePanel={leftPanel} onOpenTab={openTab} />
        <EditorArea tabs={tabs} activeTabId={activeTabId} popoutUrl={popoutUrl} />
        <RightDock />
        <div className="col-span-4">
          <BottomPanel activePanel={bottomPanel} />
        </div>
      </div>
    </div>
  );
}
