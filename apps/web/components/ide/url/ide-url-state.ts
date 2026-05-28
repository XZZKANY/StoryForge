export type IdePanelId =
  | 'explorer'
  | 'search'
  | 'memory'
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
  readonly inspectorId?: string;
  readonly artifactId?: number;
  readonly sceneId?: number;
  readonly bookRunId?: number;
  readonly leftPanel: IdePanelId;
  readonly bottomPanel: IdePanelId;
};

export function parseIdeUrlState(input: string | URLSearchParams): IdeUrlState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const book = params.get('book');
  const artifact = params.get('artifact');
  const scene = params.get('scene');
  const bookRun = params.get('book_run');
  const firstSceneTab = params.getAll('tab').find((tab) => tab.startsWith('scene:'));
  const sceneId = scene ? Number(scene) : parseSceneTabId(firstSceneTab);
  return {
    workspace: params.get('workspace') ?? undefined,
    bookId: book ? Number(book) : undefined,
    tabs: params.getAll('tab'),
    activeTabId: params.get('active') ?? params.getAll('tab')[0] ?? undefined,
    inspectorId: params.get('inspector') ?? undefined,
    artifactId: artifact ? Number(artifact) : undefined,
    ...(bookRun ? { bookRunId: Number(bookRun) } : {}),
    ...(sceneId !== undefined ? { sceneId } : {}),
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
  if (state.inspectorId) params.set('inspector', state.inspectorId);
  if (state.artifactId !== undefined) params.set('artifact', String(state.artifactId));
  if (state.sceneId !== undefined) params.set('scene', String(state.sceneId));
  if (state.bookRunId !== undefined) params.set('book_run', String(state.bookRunId));
  params.set('panel.left', state.leftPanel);
  params.set('panel.bottom', state.bottomPanel);
  return params.toString();
}

export function createIdeUrlHref(state: IdeUrlState, patch: Partial<IdeUrlState> = {}): string {
  const nextState: IdeUrlState = { ...state, ...patch, tabs: patch.tabs ?? state.tabs };
  return `/ide?${serializeIdeUrlState(nextState)}`;
}


function parseSceneTabId(tabId: string | undefined): number | undefined {
  if (!tabId?.startsWith('scene:')) return undefined;
  const id = Number(tabId.slice('scene:'.length));
  return Number.isFinite(id) ? id : undefined;
}
