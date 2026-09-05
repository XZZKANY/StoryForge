import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useProjectCommands, type ProjectCommands } from '../src/components/app/useProjectCommands';
import { executeIdeCommand } from '../src/lib/api-client';
import { TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/api-client', () => ({ executeIdeCommand: vi.fn() }));
vi.mock('../src/lib/smoke', () => ({
  registerSmokeFileLoader: () => () => {},
  registerSmokeProjectLoader: () => () => {},
}));
vi.mock('../src/lib/tauri-fs', () => ({
  FS_MUTATION_EVENT: 'fs-mutation',
  invalidateFileSystemCache: vi.fn(),
  TauriFileSystem: { readProjectFile: vi.fn() },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ProjectCommands;
let root: Root;
let container: HTMLDivElement;

const options = {
  currentFile: null,
  dirtyFiles: new Set<string>(),
  openFiles: [],
  dialogs: {
    alert: async () => {},
    confirm: async () => true,
    prompt: async () => null,
    choose: async () => null,
  },
  selectProject: () => {},
  selectProjectSafely: async () => true,
  openFile: async () => {},
  confirmDiscardFiles: async () => true,
  resetEditorFiles: () => {},
  onShowEditor: () => {},
};

function Harness({ project }: { project: string | null }) {
  latest = useProjectCommands({ ...options, activeProject: project });
  return <span>{latest.bookBreakdown?.chapter_count ?? 'empty'}</span>;
}

async function render(project: string | null) {
  await act(async () => root.render(<Harness project={project} />));
}

beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement('div');
  root = createRoot(container);
  vi.mocked(executeIdeCommand).mockResolvedValue({
    command_id: 'book.breakdown.status',
    status: 'accepted',
    payload: { breakdown: { stale: false } },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('switching projects hides the previous report while the new read is pending', async () => {
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValueOnce('{"chapter_count":3}');
  await render('D:/A');
  expect(container.textContent).toBe('3');
  vi.mocked(TauriFileSystem.readProjectFile).mockImplementationOnce(() => new Promise(() => {}));
  await render('D:/B');
  expect(latest.bookBreakdown).toBeNull();
});

test('late responses from a previous project cannot replace the current report', async () => {
  let finishOld!: (value: string) => void;
  vi.mocked(TauriFileSystem.readProjectFile).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  await render('D:/A');
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValueOnce('{"chapter_count":7}');
  await render('D:/B');
  expect(container.textContent).toBe('7');
  await act(async () => finishOld('{"chapter_count":3}'));
  expect(container.textContent).toBe('7');
});

test('closing a project keeps a late report invisible', async () => {
  let finish!: (value: string) => void;
  vi.mocked(TauriFileSystem.readProjectFile).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render('D:/A');
  await render(null);
  await act(async () => finish('{"chapter_count":3}'));
  expect(latest.bookBreakdown).toBeNull();
});
