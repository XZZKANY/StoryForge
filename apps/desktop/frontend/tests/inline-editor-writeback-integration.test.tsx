/**
 * 实际 Editor → Ctrl+K → 守卫写回集成回归。
 * 仅替换 Monaco 装配、HTTP、磁盘适配边界与快照服务；不是 Windows/Tauri 原生验收。
 */
import type { RevisionLoopRecord } from '../src/lib/author-loop';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { Editor } from '../src/components/Editor';

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

const bridge = vi.hoisted(() => ({
  commands: new Map<number, () => void>(),
  emitContent: null as (() => void) | null,
  current: null as { getModel: () => unknown } | null,
}));
vi.mock('monaco-editor', async (load) => {
  const actual = await load<typeof import('monaco-editor')>();
  return {
    ...actual,
    KeyMod: { CtrlCmd: 1, Shift: 2 },
    KeyCode: { KeyS: 2, KeyK: 4 },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: {
      ...actual.editor,
      EditorOption: { fontInfo: 1, lineHeight: 2 },
      create: (container: HTMLElement) => {
        const instance = actual.editor.create();
        const listeners = new Set<() => void>();
        const models = new Set<() => void>();
        const zones = document.createElement('div');
        zones.className = 'view-zones';
        container.append(zones);
        const setModel = instance.setModel.bind(instance);
        let seq = 0;
        const zoneMap = new Map<string, HTMLElement>();
        Object.assign(instance, {
          setModel: (model: Parameters<typeof setModel>[0]) => {
            setModel(model);
            models.forEach((fn) => fn());
          },
          getSelection: () => ({
            startLineNumber: 2,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 1,
            isEmpty: () => true,
          }),
          getOption: (option: number) => (option === 1 ? { fontFamily: 'fixture' } : 22),
          getContainerDomNode: () => container,
          addCommand: (key: number, run: () => void) => bridge.commands.set(key, run),
          onDidChangeModel: (fn: () => void) => {
            models.add(fn);
            return { dispose: () => models.delete(fn) };
          },
          onDidChangeModelContent: (fn: () => void) => {
            listeners.add(fn);
            return { dispose: () => listeners.delete(fn) };
          },
          onDidChangeCursorPosition: () => ({ dispose: () => {} }),
          changeViewZones: (run: (accessor: unknown) => void) =>
            run({
              addZone: (zone: { domNode: HTMLElement }) => {
                const id = String(++seq);
                zoneMap.set(id, zone.domNode);
                zones.append(zone.domNode);
                return id;
              },
              removeZone: (id: string) => {
                zoneMap.get(id)?.remove();
                zoneMap.delete(id);
              },
              layoutZone: () => {},
            }),
          createDecorationsCollection: () => ({ clear: () => {}, set: () => {} }),
          focus: () => {},
          setPosition: vi.fn(),
          revealLineInCenterIfOutsideViewport: () => {},
        });
        bridge.current = instance;
        bridge.emitContent = () => listeners.forEach((fn) => fn());
        return instance;
      },
      createModel: (value: string) => {
        const model = actual.editor.createModel(value);
        const set = model.setValue.bind(model);
        Object.assign(model, {
          getVersionId: () => model.getAlternativeVersionId(),
          getLineContent: (line: number) => model.getValue().split('\n')[line - 1] ?? '',
          getValueInRange: () => model.getValue().split('\n')[1],
          setValue: (next: string) => {
            set(next);
            if (bridge.current?.getModel() === model) bridge.emitContent?.();
          },
        });
        return model;
      },
    },
  };
});
vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({ baseUrl: 'http://inline-integration.test', apiKey: 'fixture' }),
  trimApiBaseUrl: (url: string) => url,
}));
const fetchMock = vi.fn<typeof fetch>();
const BEFORE = '首段。\n中段。\n尾段。';
const AFTER = '首段。\n新中段。\n尾段。';
const OTHER = PROJECT + '/other.md';
beforeEach(() => {
  bridge.commands.clear();
  fetchMock
    .mockReset()
    .mockResolvedValue(Response.json({ after: AFTER, model: 'fixture', assistant_session_id: 71 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
async function generate() {
  await act(async () => bridge.commands.get(5)?.());
  const input = host.querySelector<HTMLTextAreaElement>('.sf-inline-chat__textarea');
  expect(input).not.toBeNull();
  await act(async () => {
    input!.value = '只改中段';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}
async function approve() {
  const button = host.querySelector<HTMLButtonElement>('.sf-inline-btn-accept');
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}
async function navigate(file: string, content: string) {
  files.set(file, content);
  await act(async () =>
    root.render(
      <Editor
        projectPath={PROJECT}
        filePath={file}
        retainedFilePaths={[FILE, file]}
        dialogs={dialogs}
      />,
    ),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe(content));
}

it('real inline owner and guarded writer accept only into its originating file', async () => {
  await open(BEFORE);
  await generate();
  await approve();
  await observe(() => expect(files.get(FILE)).toBe(AFTER));
  expect(__getLastEditor()?.getValue()).toBe(AFTER);
});

it.each(['deleted', 'renamed'] as const)(
  'disk target %s after generation cannot be recreated by inline accept',
  async (kind) => {
    await open(BEFORE);
    await generate();
    files.delete(FILE);
    if (kind === 'renamed') files.set(OTHER, BEFORE);
    await approve();
    await observe(() => expect(host.textContent).toContain('接受失败'));
    expect(files.has(FILE)).toBe(false);
    if (kind === 'renamed') expect(files.get(OTHER)).toBe(BEFORE);
    expect(writes).not.toContain(FILE);
    expect(writes).not.toContain(OTHER);
  },
);

it('file switch before generation completes aborts and cannot propose into new active file', async () => {
  await open(BEFORE);
  let reply!: (r: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  await generate();
  const signal = fetchMock.mock.calls[0]?.[1]?.signal;
  await navigate(OTHER, 'B新稿');
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    reply(Response.json({ after: AFTER, model: 'fixture', assistant_session_id: 71 })),
  );
  expect(host.querySelector('.sf-inline-btn-accept')).toBeNull();
  expect(files.get(FILE)).toBe(BEFORE);
  expect(files.get(OTHER)).toBe('B新稿');
});

it('accepted write awaiting snapshot settles only origin after navigation', async () => {
  await open(BEFORE);
  await generate();
  let release!: (v: { timestamp: number; created: boolean }) => void;
  effects.snapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await approve();
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await navigate(OTHER, 'B新稿');
  await act(async () => release({ timestamp: 1, created: false }));
  await observe(() => expect(files.get(FILE)).toBe(AFTER));
  expect(files.get(OTHER)).toBe('B新稿');
  expect(__getLastEditor()?.getValue()).toBe('B新稿');
  expect(writes.filter((path) => path === FILE)).toHaveLength(1);
  expect(host.textContent).not.toContain('行间修订已写回当前文件');
});

it.each(['deleted', 'renamed'] as const)(
  'target %s while snapshot pending is not recreated on late accept',
  async (kind) => {
    await open(BEFORE);
    await generate();
    let release!: (v: { timestamp: number; created: boolean }) => void;
    effects.snapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await approve();
    await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
    files.delete(FILE);
    if (kind === 'renamed') files.set(OTHER, BEFORE);
    await act(async () => release({ timestamp: 1, created: false }));
    await observe(() => expect(host.textContent).toContain('接受失败'));
    expect(files.has(FILE)).toBe(false);
    if (kind === 'renamed') expect(files.get(OTHER)).toBe(BEFORE);
    expect(writes).not.toContain(FILE);
    expect(writes).not.toContain(OTHER);
  },
);

it('real inline snapshot failure retains candidate; retry writes once with no new generation', async () => {
  await open(BEFORE);
  await generate();
  effects.snapshot.mockRejectedValueOnce(new Error('快照不可用'));
  await approve();
  await observe(() => expect(host.textContent).toContain('候选已保留'));
  expect(files.get(FILE)).toBe(BEFORE);
  expect(writes).not.toContain(FILE);
  await approve();
  await observe(() => expect(files.get(FILE)).toBe(AFTER));
  expect(writes.filter((path) => path === FILE)).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.sf-inline-btn-accept')).toBeNull();
});

it('navigating before accepting cannot apply an old detached button to the active file', async () => {
  await open(BEFORE);
  await generate();
  const oldButton = host.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!;
  await navigate(OTHER, 'B新稿');
  await act(async () => {
    oldButton.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(files.get(FILE)).toBe(BEFORE);
  expect(files.get(OTHER)).toBe('B新稿');
  expect(writes).not.toContain(FILE);
  expect(writes).not.toContain(OTHER);
  expect(__getLastEditor()?.getValue()).toBe('B新稿');
});

it('author edits during accepted write remain in the editor after original candidate settles to disk', async () => {
  await open(BEFORE);
  await generate();
  let release!: (v: { timestamp: number; created: boolean }) => void;
  effects.snapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await approve();
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await act(async () => __getLastEditor()?.setValue('作者等待时继续写的新稿'));
  await act(async () => release({ timestamp: 1, created: false }));
  await observe(() => expect(files.get(FILE)).toBe(AFTER));
  // 落盘早于回执/审计结算；必须等完整接受完成，不能把处理中按钮当成残留。
  await observe(() => expect(host.querySelector('.sf-inline-btn-accept')).toBeNull());
  expect(__getLastEditor()?.getValue()).toBe('作者等待时继续写的新稿');
  // 继续保存作者的新输入，应使用已推进的磁盘基线，不能回滚成 AI 候选。
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => expect(files.get(FILE)).toBe('作者等待时继续写的新稿'));
  expect(writes.filter((path) => path === FILE)).toHaveLength(2);
});

it('failed accepted write after author edits neither writes old proposal nor offers stale retry', async () => {
  await open(BEFORE);
  await generate();
  let fail!: (reason: Error) => void;
  effects.snapshot.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await approve();
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await act(async () => {
    __getLastEditor()?.setValue('作者保留的新稿');
    fail(new Error('快照不可用'));
  });
  await observe(() => expect(host.querySelector('.sf-inline-btn-accept')).toBeNull());
  expect(__getLastEditor()?.getValue()).toBe('作者保留的新稿');
  expect(files.get(FILE)).toBe(BEFORE);
  expect(writes).not.toContain(FILE);
});
