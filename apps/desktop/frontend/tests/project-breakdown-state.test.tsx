import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useProjectCommands, type ProjectCommands } from '../src/components/app/useProjectCommands';
import { executeIdeCommand } from '../src/lib/api-client';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/tauri-fs';

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
    alert: vi.fn(async () => {}),
    confirm: async () => true,
    prompt: async () => null,
    choose: async () => null,
  },
  selectProject: () => {},
  selectProjectSafely: async () => true,
  openFile: vi.fn(async () => {}),
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

test('a late generation cannot replace another project report or open its file', async () => {
  let finish!: (value: Awaited<ReturnType<typeof executeIdeCommand>>) => void;
  vi.mocked(executeIdeCommand).mockImplementation(async (command) => {
    if (command === 'book.breakdown')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { command_id: command, status: 'accepted', payload: { breakdown: { stale: false } } };
  });
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('{"chapter_count":3}');
  await render('D:/A');
  let pending!: Promise<void>;
  await act(async () => {
    pending = latest.handleBookBreakdown();
  });
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('{"chapter_count":7}');
  await render('D:/B');
  const refreshVersion = latest.projectRefreshVersion;
  await act(async () => {
    finish({
      command_id: 'book.breakdown',
      status: 'accepted',
      payload: { breakdown: { chapter_count: 9 } },
    });
    await pending;
  });
  expect(latest.bookBreakdown?.chapter_count).toBe(7);
  expect(options.dialogs.alert).not.toHaveBeenCalled();
  expect(options.openFile).not.toHaveBeenCalled();
  expect(invalidateFileSystemCache).not.toHaveBeenCalled();
  expect(latest.projectRefreshVersion).toBe(refreshVersion);
  expect(latest.bookBreakdownRunning).toBe(false);
});

test.each(['success', 'failure'])(
  'an old report read %s cannot overwrite a generated report',
  async (outcome) => {
    let finish!: (value: string) => void;
    let fail!: (error: Error) => void;
    vi.mocked(TauriFileSystem.readProjectFile).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    vi.mocked(executeIdeCommand).mockImplementation(async (command) => ({
      command_id: command,
      status: 'accepted',
      payload: {
        breakdown: command === 'book.breakdown' ? { chapter_count: 9 } : { stale: false },
      },
    }));
    await render('D:/A');
    await act(async () => {
      await latest.handleBookBreakdown();
    });
    expect(latest.bookBreakdown?.chapter_count).toBe(9);
    await act(async () => {
      if (outcome === 'success') finish('{"chapter_count":3}');
      else fail(new Error('old read failed'));
    });
    expect(latest.bookBreakdown?.chapter_count).toBe(9);
  },
);

test('StrictMode replay invalidates the first report load', async () => {
  let finish!: (value: string) => void;
  vi.mocked(TauriFileSystem.readProjectFile)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce('{"chapter_count":7}');
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness project="D:/A" />
      </StrictMode>,
    ),
  );
  expect(latest.bookBreakdown?.chapter_count).toBe(7);
  await act(async () => finish('{"chapter_count":3}'));
  expect(latest.bookBreakdown?.chapter_count).toBe(7);
});

test.each(['success', 'failure'])(
  'a late status query %s cannot overwrite a generated report',
  async (outcome) => {
    let finish!: (value: Awaited<ReturnType<typeof executeIdeCommand>>) => void;
    let fail!: (error: Error) => void;
    vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('{"chapter_count":3}');
    vi.mocked(executeIdeCommand).mockImplementation(async (command) => {
      if (command === 'book.breakdown.status')
        return new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
      return {
        command_id: command,
        status: 'accepted',
        payload: { breakdown: { chapter_count: 9 } },
      };
    });
    await render('D:/A');
    await act(async () => {
      await latest.handleBookBreakdown();
    });
    expect(latest.bookBreakdown?.chapter_count).toBe(9);
    await act(async () => {
      if (outcome === 'success')
        finish({
          command_id: 'book.breakdown.status',
          status: 'accepted',
          payload: { breakdown: { stale: true } },
        });
      else fail(new Error('old status query failed'));
    });
    expect(latest.bookBreakdown?.chapter_count).toBe(9);
    expect(latest.bookBreakdown?.stale).not.toBe(true);
  },
);
