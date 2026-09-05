import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useProjectCommands, type ProjectCommands } from '../src/components/app/useProjectCommands';
import { executeIdeCommand } from '../src/lib/api-client';
import { flushActiveEditorToDisk } from '../src/lib/assistant-events';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/api-client', () => ({ executeIdeCommand: vi.fn() }));
vi.mock('../src/lib/assistant-events', () => ({
  APPLY_FILE_SUGGESTION_EVENT: 'apply-file-suggestion',
  flushActiveEditorToDisk: vi.fn(),
}));
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

type CommandResult = Awaited<ReturnType<typeof executeIdeCommand>>;
type Options = Parameters<typeof useProjectCommands>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function result(command: string, breakdown: Record<string, unknown>): CommandResult {
  return { command_id: command, status: 'accepted', payload: { breakdown } };
}

function generated(status = 'completed', chapterCount = 9) {
  return result('book.breakdown', { status, chapter_count: chapterCount });
}

let latest: ProjectCommands;
let root: Root | null;
let container: HTMLDivElement;
let options: Options;
let generations: ReturnType<typeof deferred<CommandResult>>[];
let cancellations: ReturnType<typeof deferred<CommandResult>>[];

function Harness({ project }: { project: string | null }) {
  latest = useProjectCommands({ ...options, activeProject: project });
  return <span>{latest.bookBreakdown?.chapter_count ?? 'empty'}</span>;
}

async function render(project: string | null) {
  await act(async () => root!.render(<Harness project={project} />));
}

async function start(action: () => Promise<void>) {
  let pending!: Promise<void>;
  await act(async () => {
    pending = action();
  });
  return { pending };
}

async function finish(index: number, pending: Promise<void>, status = 'completed') {
  await act(async () => {
    generations[index].resolve(generated(status));
    await pending;
  });
}

function expectNoEffects() {
  expect(options.dialogs.alert).not.toHaveBeenCalled();
  expect(options.openFile).not.toHaveBeenCalled();
  expect(invalidateFileSystemCache).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  options = {
    activeProject: null,
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
  generations = [];
  cancellations = [];
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('{"chapter_count":3}');
  vi.mocked(executeIdeCommand).mockImplementation((command) => {
    if (command === 'book.breakdown.status') {
      return Promise.resolve(result(command, { stale: false }));
    }
    if (command === 'book.breakdown' || command === 'book.breakdown.cancel') {
      const response = deferred<CommandResult>();
      (command === 'book.breakdown' ? generations : cancellations).push(response);
      return response.promise;
    }
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

test.each([
  ['close', 'success'],
  ['close', 'failure'],
  ['unmount', 'success'],
  ['unmount', 'failure'],
])('%s ignores late generation %s', async (boundary, outcome) => {
  await render('D:/A');
  const { pending } = await start(latest.handleBookBreakdown);
  if (boundary === 'close') await render(null);
  else {
    await act(async () => root!.unmount());
    root = null;
  }
  const refreshVersion = latest.projectRefreshVersion;
  await act(async () => {
    if (outcome === 'success') generations[0].resolve(generated());
    else generations[0].reject(new Error('late generation failed'));
    await pending;
  });
  expectNoEffects();
  expect(latest.projectRefreshVersion).toBe(refreshVersion);
  if (boundary === 'close') {
    expect(latest.bookBreakdown).toBeNull();
    expect(latest.bookBreakdownRunning).toBe(false);
  }
});

test('A to B to A does not revive a generation from the first project lifetime', async () => {
  await render('D:/A');
  const { pending } = await start(latest.handleBookBreakdown);
  await render('D:/B');
  await render('D:/A');
  const refreshVersion = latest.projectRefreshVersion;
  await finish(0, pending);
  expect(container.textContent).toBe('3');
  expectNoEffects();
  expect(latest.projectRefreshVersion).toBe(refreshVersion);
  expect(latest.bookBreakdownRunning).toBe(false);
});

test('switching projects while the completion alert is open prevents opening the old file', async () => {
  const alert = deferred<void>();
  vi.mocked(options.dialogs.alert).mockReturnValueOnce(alert.promise);
  await render('D:/A');
  const { pending } = await start(latest.handleBookBreakdown);
  await act(async () => generations[0].resolve(generated()));
  expect(options.dialogs.alert).toHaveBeenCalledTimes(1);
  expect(options.openFile).not.toHaveBeenCalled();
  await render('D:/B');
  const refreshVersion = latest.projectRefreshVersion;
  await act(async () => {
    alert.resolve();
    await pending;
  });
  expect(options.openFile).not.toHaveBeenCalled();
  expect(options.dialogs.alert).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe('3');
  expect(latest.projectRefreshVersion).toBe(refreshVersion);
  expect(latest.bookBreakdownRunning).toBe(false);
});

test.each(['success', 'failure'])(
  'switching during an editor save ignores its late %s',
  async (outcome) => {
    const save = deferred<void>();
    options.currentFile = 'D:/A/chapter.md';
    options.dirtyFiles.add(options.currentFile);
    vi.mocked(flushActiveEditorToDisk).mockReturnValueOnce(save.promise);
    await render('D:/A');
    const { pending } = await start(latest.handleBookBreakdown);
    expect(flushActiveEditorToDisk).toHaveBeenCalledWith('D:/A/chapter.md');
    expect(generations).toHaveLength(0);
    await render('D:/B');
    await act(async () => {
      if (outcome === 'success') save.resolve();
      else save.reject(new Error('old save failed'));
    });
    // Settle any incorrectly dispatched command too, so a regression fails instead of timing out.
    const generationCount = generations.length;
    await act(async () => {
      generations.forEach((generation) => generation.resolve(generated()));
      await pending;
    });
    expect(generationCount).toBe(0);
    expectNoEffects();
    expect(latest.bookBreakdownRunning).toBe(false);
  },
);

test.each(['denial', 'failure'])(
  'old cancellation %s cannot clear a subsequent cancellation or display an alert',
  async (outcome) => {
    await render('D:/A');
    const first = await start(latest.handleBookBreakdown);
    const oldCancel = await start(latest.handleCancelBookBreakdown);
    await finish(0, first.pending);
    const next = await start(latest.handleBookBreakdown);
    const newCancel = await start(latest.handleCancelBookBreakdown);
    expect(latest.bookBreakdownRunning).toBe(true);
    expect(latest.bookBreakdownCancelling).toBe(true);
    const alerts = vi.mocked(options.dialogs.alert).mock.calls.length;
    await act(async () => {
      if (outcome === 'denial') {
        cancellations[0].resolve(
          result('book.breakdown.cancel', { cancellation_requested: false }),
        );
      } else cancellations[0].reject(new Error('old cancellation failed'));
      await oldCancel.pending;
    });
    expect(latest.bookBreakdownRunning).toBe(true);
    expect(latest.bookBreakdownCancelling).toBe(true);
    expect(options.dialogs.alert).toHaveBeenCalledTimes(alerts);
    await act(async () => {
      cancellations[1].resolve(result('book.breakdown.cancel', { cancellation_requested: true }));
      await newCancel.pending;
    });
    await finish(1, next.pending, 'cancelled');
    expect(latest.bookBreakdownRunning).toBe(false);
    expect(latest.bookBreakdownCancelling).toBe(false);
  },
);

test.each(['denial', 'failure'])(
  'switching projects suppresses late cancellation %s',
  async (outcome) => {
    await render('D:/A');
    const generation = await start(latest.handleBookBreakdown);
    const cancel = await start(latest.handleCancelBookBreakdown);
    await render('D:/B');
    await act(async () => {
      if (outcome === 'denial') {
        cancellations[0].resolve(
          result('book.breakdown.cancel', { cancellation_requested: false }),
        );
      } else cancellations[0].reject(new Error('old cancellation failed'));
      await cancel.pending;
    });
    expectNoEffects();
    await finish(0, generation.pending, 'cancelled');
    expectNoEffects();
    expect(latest.bookBreakdownRunning).toBe(false);
    expect(latest.bookBreakdownCancelling).toBe(false);
  },
);

test('normal completion refreshes and opens the report, and a later failure allows retry', async () => {
  await render('D:/A');
  const first = await start(latest.handleBookBreakdown);
  expect(latest.bookBreakdownRunning).toBe(true);
  expect(executeIdeCommand).toHaveBeenCalledWith('book.breakdown', {
    project_root: 'D:/A',
    target_count: 8,
    analysis_id: expect.any(String),
  });
  await finish(0, first.pending);
  expect(container.textContent).toBe('9');
  expect(invalidateFileSystemCache).toHaveBeenCalledWith('D:/A');
  expect(latest.projectRefreshVersion).toBe(1);
  expect(options.dialogs.alert).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: '结构化拆书报告已生成' }),
  );
  expect(options.openFile).toHaveBeenCalledWith(
    'D:/A/.storyforge/analysis/book-breakdown.md',
    '打开拆书报告',
  );
  expect(latest.bookBreakdownRunning).toBe(false);
  const failure = await start(latest.handleBookBreakdown);
  await act(async () => {
    generations[1].reject(new Error('generation failed'));
    await failure.pending;
  });
  expect(options.dialogs.alert).toHaveBeenLastCalledWith({
    title: '生成拆书报告失败',
    message: 'generation failed',
  });
  expect(latest.bookBreakdownRunning).toBe(false);
  const retry = await start(latest.handleBookBreakdown);
  await finish(2, retry.pending);
  expect(generations).toHaveLength(3);
  expect(latest.bookBreakdownRunning).toBe(false);
});

test.each(['denial', 'failure'])(
  'current cancellation %s remains visible and allows cancellation retry',
  async (outcome) => {
    await render('D:/A');
    const generation = await start(latest.handleBookBreakdown);
    const cancel = await start(latest.handleCancelBookBreakdown);
    const generationCall = vi
      .mocked(executeIdeCommand)
      .mock.calls.find(([command]) => command === 'book.breakdown');
    expect(executeIdeCommand).toHaveBeenCalledWith('book.breakdown.cancel', {
      analysis_id: generationCall![1].analysis_id,
    });
    await act(async () => {
      if (outcome === 'denial') {
        cancellations[0].resolve(
          result('book.breakdown.cancel', { cancellation_requested: false }),
        );
      } else cancellations[0].reject(new Error('cancellation failed'));
      await cancel.pending;
    });
    expect(options.dialogs.alert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: outcome === 'denial' ? '拆书无法取消' : '取消拆书失败',
      }),
    );
    expect(latest.bookBreakdownRunning).toBe(true);
    expect(latest.bookBreakdownCancelling).toBe(false);
    const retry = await start(latest.handleCancelBookBreakdown);
    await act(async () => {
      cancellations[1].resolve(result('book.breakdown.cancel', { cancellation_requested: true }));
      await retry.pending;
    });
    expect(latest.bookBreakdownCancelling).toBe(true);
    await finish(0, generation.pending, 'cancelled');
    expect(latest.bookBreakdown?.status).toBe('cancelled');
    expect(options.dialogs.alert).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '拆书已取消' }),
    );
    expect(latest.bookBreakdownRunning).toBe(false);
    expect(latest.bookBreakdownCancelling).toBe(false);
    const rerun = await start(latest.handleBookBreakdown);
    await finish(1, rerun.pending);
  },
);

test('same-tick double click starts only one generation', async () => {
  await render('D:/A');
  let pending!: Promise<void>[];
  await act(async () => {
    const generate = latest.handleBookBreakdown;
    pending = [generate(), generate()];
  });
  const count = generations.length;
  await act(async () => {
    generations.forEach((generation) => generation.resolve(generated()));
    await Promise.all(pending);
  });
  expect(count).toBe(1);
  expect(latest.bookBreakdownRunning).toBe(false);
});

test('an old in-flight generation blocks duplicates but releases the next project after settling', async () => {
  await render('D:/A');
  const old = await start(latest.handleBookBreakdown);
  await render('D:/B');
  const blocked = await start(latest.handleBookBreakdown);
  expect(generations).toHaveLength(1);
  await finish(0, old.pending);
  await blocked.pending;
  expectNoEffects();
  const next = await start(latest.handleBookBreakdown);
  expect(generations).toHaveLength(2);
  expect(executeIdeCommand).toHaveBeenLastCalledWith('book.breakdown', {
    project_root: 'D:/B',
    target_count: 8,
    analysis_id: expect.any(String),
  });
  await finish(1, next.pending);
  expect(latest.bookBreakdownRunning).toBe(false);
});

test('same-tick double cancellation sends one request and can finish normally', async () => {
  await render('D:/A');
  const generation = await start(latest.handleBookBreakdown);
  let pending!: Promise<void>[];
  await act(async () => {
    const cancel = latest.handleCancelBookBreakdown;
    pending = [cancel(), cancel()];
  });
  const count = cancellations.length;
  await act(async () => {
    cancellations.forEach((cancel) =>
      cancel.resolve(result('book.breakdown.cancel', { cancellation_requested: true })),
    );
    await Promise.all(pending);
  });
  expect(count).toBe(1);
  expect(latest.bookBreakdownCancelling).toBe(true);
  await finish(0, generation.pending, 'cancelled');
  expect(latest.bookBreakdownCancelling).toBe(false);
});
