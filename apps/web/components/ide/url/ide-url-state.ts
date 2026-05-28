export type IdePanelId =
  | 'explorer'
  | 'search'
  | 'runs'
  | 'artifacts'
  | 'evaluation'
  | 'problems'
  | 'diff';

export type IdeUrlState = {
  readonly workspace?: string;
  readonly bookId?: number;
  readonly tabs: readonly string[];
  readonly activeTabId?: string;
  readonly leftPanel: IdePanelId;
  readonly bottomPanel: IdePanelId;
};

export function parseIdeUrlState(input: string | URLSearchParams): IdeUrlState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const book = params.get('book');
  return {
    workspace: params.get('workspace') ?? undefined,
    bookId: book ? Number(book) : undefined,
    tabs: params.getAll('tab'),
    activeTabId: params.get('active') ?? params.getAll('tab')[0] ?? undefined,
    leftPanel: (params.get('panel.left') as IdePanelId | null) ?? 'explorer',
    bottomPanel: (params.get('panel.bottom') as IdePanelId | null) ?? 'problems',
  };
}

export function serializeIdeUrlState(state: IdeUrlState): string {
  const params = new URLSearchParams();
  if (state.workspace) params.set('workspace', state.workspace);
  if (state.bookId !== undefined) params.set('book', String(state.bookId));
  for (const tab of state.tabs) params.append('tab', tab);
  if (state.activeTabId) params.set('active', state.activeTabId);
  params.set('panel.left', state.leftPanel);
  params.set('panel.bottom', state.bottomPanel);
  return params.toString();
}
