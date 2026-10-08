import type { RevisionLoopRecord } from '../src/lib/author-loop';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editor as monacoEditor, __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { Editor } from '../src/components/Editor';
import {
  emitFileSuggestion,
  EDITOR_AUTHOR_VIEW_EVENT,
  AUTHOR_VIEW_SELECTION_MAX_CHARS,
  type EditorAuthorViewDetail,
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
} from '../src/lib/assistant-events';

const effects = vi.hoisted(() => ({
  snapshot: vi.fn(async () => ({ timestamp: 1, created: false })),
  record: vi.fn(async (_record: RevisionLoopRecord) => ({
    recordPath: null,
    updatedBlueprintPath: null,
  })),
  mark: vi.fn(async () => {}),
}));
vi.mock('../src/lib/versions', async (load) => ({
  ...(await load<typeof import('../src/lib/versions')>()),
  snapshotBeforeWrite: effects.snapshot,
}));
vi.mock('../src/lib/author-loop', async (load) => ({
  ...(await load<typeof import('../src/lib/author-loop')>()),
  recordRevisionLoop: effects.record,
}));
vi.mock('../src/lib/serial-plan', async (load) => ({
  ...(await load<typeof import('../src/lib/serial-plan')>()),
  markChapterWrittenInPlan: effects.mark,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const PROJECT = 'D:/disk-contract';
const FILE = PROJECT + '/chapter.md';
let files: Map<string, string>;
let writes: string[];
let proposalSequence = 0;
let root: Root;
let host: HTMLDivElement;
const dialogs = { alert: async () => {}, confirm: async () => false, prompt: async () => null };

beforeEach(async () => {
  vi.clearAllMocks();
  const original =
    await vi.importActual<typeof import('../src/lib/author-loop')>('../src/lib/author-loop');
  effects.record.mockImplementation(async (record) => {
    await original.recordRevisionLoop(record);
    return { recordPath: null, updatedBlueprintPath: null };
  });
  files = new Map();
  writes = [];
  proposalSequence = 0;
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => files.has(path),
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('file missing');
      return value;
    },
    writeFile: (path, content) => {
      files.set(path, content);
      writes.push(path);
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.__STORYFORGE_MOCK_FS__;
  __resetMonacoStub();
});
async function observe(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
}
async function open(content: string | null) {
  if (content !== null) files.set(FILE, content);
  await act(async () =>
    root.render(
      <Editor projectPath={PROJECT} filePath={FILE} retainedFilePaths={[FILE]} dialogs={dialogs} />,
    ),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe(content ?? ''));
}
async function propose(before: string, after: string, auto = false) {
  await act(async () =>
    emitFileSuggestion({
      id: `disk-patch-${proposalSequence++}`,
      filePath: FILE,
      before,
      after,
      title: '改稿',
      summary: '改稿',
      note: '',
      createdAt: 1,
      requiresConfirmation: !auto,
    }),
  );
}
async function accept() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT));
  });
}

it.each([false, true])(
  'disk-only drift blocks patch without changing Monaco (auto=%s)',
  async (auto) => {
    await open('original');
    files.set(FILE, 'external edit');
    await propose('original', 'proposed', auto);
    if (!auto) await accept();
    await observe(() => expect(host.textContent).toContain('磁盘内容已变化'));
    expect(files.get(FILE)).toBe('external edit');
    expect(__getLastEditor()?.getValue()).toBe('original');
    expect(writes).not.toContain(FILE);
    expect(effects.record).not.toHaveBeenCalled();
    expect(effects.mark).not.toHaveBeenCalled();
    expect(host.textContent).toContain('磁盘内容已变化');
  },
);

it('rechecks disk after a pending snapshot, not just before it', async () => {
  await open('original');
  let release!: (value: { timestamp: number; created: boolean }) => void;
  effects.snapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await propose('original', 'proposed');
  await accept();
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  files.set(FILE, 'changed during snapshot');
  await act(async () => release({ timestamp: 1, created: false }));
  await observe(() => expect(host.textContent).toContain('磁盘内容已变化'));
  expect(files.get(FILE)).toBe('changed during snapshot');
  expect(effects.record).not.toHaveBeenCalled();
  expect(host.textContent).toContain('磁盘内容已变化');
});

it.each(['', 'external creation'])(
  'missing file cannot replace externally created %j',
  async (external) => {
    await open(null);
    files.set(FILE, external);
    await propose('', 'new chapter');
    await accept();
    await observe(() => expect(host.textContent).toContain('磁盘内容已变化'));
    expect(files.get(FILE)).toBe(external);
    expect(effects.record).not.toHaveBeenCalled();
  },
);

it('deleted file cannot be silently recreated by an old patch', async () => {
  await open('original');
  files.delete(FILE);
  await propose('original', 'proposed');
  await accept();
  await observe(() => expect(host.textContent).toContain('磁盘内容已变化'));
  expect(files.has(FILE)).toBe(false);
  expect(effects.record).not.toHaveBeenCalled();
});

it.each([null, ''])(
  'missing and empty baselines can each be written when unchanged (%j)',
  async (initial) => {
    await open(initial);
    await propose('', 'new chapter');
    await accept();
    await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).toBeNull());
    expect(files.get(FILE)).toBe('new chapter');
    expect(effects.record).toHaveBeenCalledOnce();
  },
);

it('an unsaved editor proposal uses the loaded disk baseline, then advances it for another patch', async () => {
  await open('disk original');
  await act(async () => __getLastEditor()!.setValue('unsaved author draft'));
  await propose('unsaved author draft', 'accepted first');
  await accept();
  await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).toBeNull());
  expect(files.get(FILE)).toBe('accepted first');
  await propose('accepted first', 'accepted second');
  await accept();
  await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).toBeNull());
  expect(files.get(FILE)).toBe('accepted second');
  expect(effects.record).toHaveBeenCalledTimes(2);
});

it('ordinary save cannot bypass the same disk drift guard', async () => {
  await open('original');
  await act(async () => __getLastEditor()!.setValue('unsaved author draft'));
  files.set(FILE, 'external edit');
  const replies: unknown[] = [];
  const listener = (event: Event) => replies.push((event as CustomEvent).detail);
  window.addEventListener(SAVE_ACTIVE_FILE_DONE_EVENT, listener);
  try {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(REQUEST_SAVE_ACTIVE_FILE_EVENT, { detail: { filePath: FILE } }),
      );
    });
    expect(files.get(FILE)).toBe('external edit');
    expect(__getLastEditor()?.getValue()).toBe('unsaved author draft');
    await observe(() =>
      expect(replies).toContainEqual(expect.objectContaining({ status: 'error' })),
    );
  } finally {
    window.removeEventListener(SAVE_ACTIVE_FILE_DONE_EVENT, listener);
  }
});

it('an unchanged editor proposal still snapshots unsaved disk changes', async () => {
  await open('disk original');
  await act(async () => __getLastEditor()!.setValue('unsaved draft'));
  await propose('unsaved draft', 'unsaved draft');
  await accept();
  await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).toBeNull());
  expect(files.get(FILE)).toBe('unsaved draft');
  expect(effects.snapshot).toHaveBeenCalledOnce();
});

it('creating an empty file still snapshots its missing state', async () => {
  await open(null);
  await propose('', '');
  await accept();
  await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).toBeNull());
  expect(files.get(FILE)).toBe('');
  expect(effects.snapshot).toHaveBeenCalledOnce();
});

it('disk acknowledgement settles the buffer before slow evidence; later save cannot roll it back', async () => {
  await open('disk original');
  await act(async () => __getLastEditor()!.setValue('unsaved draft'));
  let release!: (value: { recordPath: null; updatedBlueprintPath: null }) => void;
  effects.record.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await propose('unsaved draft', 'accepted');
  await accept();
  await observe(() => expect(effects.record).toHaveBeenCalledOnce());
  expect(files.get(FILE)).toBe('accepted');
  expect(__getLastEditor()?.getValue()).toBe('accepted');
  await act(async () => __getLastEditor()!.setValue('author next draft'));
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(REQUEST_SAVE_ACTIVE_FILE_EVENT, { detail: { filePath: FILE } }),
    );
  });
  expect(files.get(FILE)).toBe('accepted');
  await act(async () => release({ recordPath: null, updatedBlueprintPath: null }));
  await observe(() => expect(files.get(FILE)).toBe('author next draft'));
  expect(__getLastEditor()?.getValue()).toBe('author next draft');
});

it('a save queued behind AI evidence stays on the originating file after navigation', async () => {
  await open('original');
  let release!: (value: { recordPath: null; updatedBlueprintPath: null }) => void;
  effects.record.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await propose('original', 'accepted');
  await accept();
  await observe(() => expect(effects.record).toHaveBeenCalledOnce());
  await act(async () => __getLastEditor()!.setValue('next draft in first file'));
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(REQUEST_SAVE_ACTIVE_FILE_EVENT, { detail: { filePath: FILE } }),
    );
  });
  const other = PROJECT + '/other.md';
  files.set(other, 'other original');
  await act(async () =>
    root.render(
      <Editor
        projectPath={PROJECT}
        filePath={other}
        retainedFilePaths={[FILE, other]}
        dialogs={dialogs}
      />,
    ),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe('other original'));
  await act(async () => release({ recordPath: null, updatedBlueprintPath: null }));
  await observe(() => expect(files.get(FILE)).toBe('next draft in first file'));
  expect(files.get(other)).toBe('other original');
  expect(__getLastEditor()?.getValue()).toBe('other original');
});

it('keeps author-view selection, debounced model/content updates and cleanup after metrics retirement', async () => {
  const selectionListeners = new Set<() => void>();
  const modelListeners = new Set<() => void>();
  const subscribe = (listeners: Set<() => void>, listener: () => void) => {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  };
  let selections = ['甲', '乙'.repeat(AUTHOR_VIEW_SELECTION_MAX_CHARS)];
  let position = { lineNumber: 3, column: 7 };
  const originalCreate = monacoEditor.create;
  const originalCreateModel = monacoEditor.createModel;
  const createSpy = vi.spyOn(monacoEditor, 'create').mockImplementation((...args) => {
    const instance = originalCreate(...args);
    const setModel = instance.setModel.bind(instance);
    return Object.assign(instance, {
      getSelections: () => selections.map((_, index) => ({ startColumn: index + 1 })),
      getPosition: () => position,
      onDidChangeCursorSelection: (listener: () => void) => subscribe(selectionListeners, listener),
      onDidChangeModel: (listener: () => void) => subscribe(modelListeners, listener),
      setModel(model: Parameters<typeof instance.setModel>[0]) {
        const previous = instance.getModel();
        setModel(model);
        if (model !== previous) modelListeners.forEach((listener) => listener());
      },
    });
  });
  const modelSpy = vi.spyOn(monacoEditor, 'createModel').mockImplementation((...args) =>
    Object.assign(originalCreateModel(...args), {
      getValueInRange: (range: { startColumn: number }) => selections[range.startColumn - 1],
    }),
  );
  const events: EditorAuthorViewDetail[] = [];
  const listener = (event: Event) =>
    events.push((event as CustomEvent<EditorAuthorViewDetail>).detail);
  window.addEventListener(EDITOR_AUTHOR_VIEW_EVENT, listener);
  try {
    await open('author draft');
    vi.useFakeTimers();
    // Initial model attachment can occur after the immediate broadcast.
    act(() => vi.advanceTimersByTime(200));
    expect(events.at(-1)).toEqual({
      filePath: FILE,
      cursorLine: 3,
      cursorColumn: 7,
      selectionText: '甲' + '乙'.repeat(AUTHOR_VIEW_SELECTION_MAX_CHARS - 1),
    });
    expect(selectionListeners.size).toBe(1);
    // AuthorView still owns its debounced publication; inline operations also
    // subscribe to abort stale generation. Both must dispose on unmount below.
    expect(modelListeners.size).toBe(3);
    // Each input independently reaches the live event bus; coalescing alone could
    // conceal a missing content or selection subscription.
    for (const trigger of [
      () => __getLastEditor()!.setValue('first unsaved edit'),
      () => selectionListeners.forEach((notify) => notify()),
      () => modelListeners.forEach((notify) => notify()),
    ]) {
      events.length = 0;
      act(trigger);
      act(() => vi.advanceTimersByTime(199));
      expect(events).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      expect(events).toHaveLength(1);
      expect(events[0].filePath).toBe(FILE);
    }
    events.length = 0;
    act(() => __getLastEditor()!.setValue('unsaved edit'));
    act(() => vi.advanceTimersByTime(100));
    selections = ['新', '选区'];
    act(() => selectionListeners.forEach((notify) => notify()));
    act(() => vi.advanceTimersByTime(100));
    position = { lineNumber: 5, column: 2 };
    act(() => modelListeners.forEach((notify) => notify()));
    act(() => vi.advanceTimersByTime(199));
    expect(events).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(events).toEqual([
      {
        filePath: FILE,
        cursorLine: 5,
        cursorColumn: 2,
        selectionText: '新选区',
      },
    ]);
    events.length = 0;
    act(() => selectionListeners.forEach((notify) => notify()));
    act(() => root.render(null));
    expect(selectionListeners.size).toBe(0);
    expect(modelListeners.size).toBe(0);
    act(() => vi.advanceTimersByTime(300));
    expect(events).toEqual([]);
    expect(writes).toEqual([]);
  } finally {
    window.removeEventListener(EDITOR_AUTHOR_VIEW_EVENT, listener);
    vi.useRealTimers();
    createSpy.mockRestore();
    modelSpy.mockRestore();
  }
});
