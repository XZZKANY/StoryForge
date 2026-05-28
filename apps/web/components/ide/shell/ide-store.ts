'use client';

export type IdeStoreState = {
  readonly tabs: readonly string[];
  readonly activeTabId?: string;
  readonly leftPanel: string;
  readonly bottomPanel: string;
  readonly workspace?: string;
  readonly bookId?: number;
};

export function createInitialIdeState(overrides: Partial<IdeStoreState> = {}): IdeStoreState {
  const tabs = overrides.tabs && overrides.tabs.length > 0 ? overrides.tabs : ['legacy:studio'];
  return {
    tabs,
    activeTabId: overrides.activeTabId ?? tabs[0],
    leftPanel: overrides.leftPanel ?? 'explorer',
    bottomPanel: overrides.bottomPanel ?? 'problems',
    workspace: overrides.workspace,
    bookId: overrides.bookId,
  };
}
