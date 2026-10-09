import { TauriFileSystem } from '../src/lib/tauri-fs';
/**
 * 实际 Editor → Ctrl+K → 守卫写回集成回归。
 * 仅替换 Monaco 装配、HTTP、磁盘适配边界与快照服务；不是 Windows/Tauri 原生验收。
 */
import type { RevisionLoopRecord } from '../src/lib/author-loop';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editor as monacoEditor, __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { Editor } from '../src/components/Editor';

const effects = vi.hoisted(() => ({
  snapshot: vi.fn(async () => ({ timestamp: 1, created: false })),
  record: vi.fn(async (_record: RevisionLoopRecord) => ({
    recordPath: null,
    updatedBlueprintPath: null,
  })),
  mark: vi.fn(async () => {}),
  dirty: vi.fn(),
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
      <Editor
        projectPath={PROJECT}
        filePath={FILE}
        retainedFilePaths={[FILE]}
        dialogs={dialogs}
        onDirtyChange={effects.dirty}
      />,
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
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

it('cumulative: same-candidate retry after lost write and failed receipt read settles unchanged editor', async () => {
  const ordinarySave = vi.spyOn(TauriFileSystem, 'writeFileIfUnchanged');
  const realWrite = TauriFileSystem.writeFileWithReceipt.bind(TauriFileSystem);
  const realInspect = TauriFileSystem.inspectWritebackReceipt.bind(TauriFileSystem);
  let reads = 0;
  vi.spyOn(TauriFileSystem, 'inspectWritebackReceipt').mockImplementation(async (...args) => {
    reads += 1;
    if (reads === 2) throw new Error('receipt IPC temporarily unavailable');
    return realInspect(...args);
  });
  const nativeWrite = vi
    .spyOn(TauriFileSystem, 'writeFileWithReceipt')
    .mockImplementationOnce(async (...args) => {
      await realWrite(...args);
      throw new Error('native invoke response lost after commit');
    });
  const trace = async (stage: string) => {
    const request = nativeWrite.mock.calls[0]?.[1];
    console.info(
      'CUMULATIVE_TRACE ' +
        JSON.stringify({
          stage,
          disk: files.get(FILE),
          model: __getLastEditor()?.getValue(),
          dirty: effects.dirty.mock.lastCall?.[1],
          nativeWrites: nativeWrite.mock.calls.length,
          ordinaryWrites: ordinarySave.mock.calls.length,
          receipt: request ? await realInspect(PROJECT, request) : null,
        }),
    );
  };
  await open(BEFORE);
  await generate();
  await approve();
  await observe(() => expect(host.textContent).toContain('接受失败'));
  expect(files.get(FILE)).toBe(AFTER);
  expect(__getLastEditor()?.getValue()).toBe(BEFORE);
  await trace('after initial unknown delivery');
  expect(host.querySelector('.sf-inline-btn-accept')).not.toBeNull();
  await approve();
  await observe(() => expect(host.querySelector('.sf-inline-btn-accept')).toBeNull());
  expect(nativeWrite).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect.soft(__getLastEditor()?.getValue()).toBe(AFTER);
  await act(async () => bridge.commands.get(3)?.());
  await act(async () => {
    await Promise.all(ordinarySave.mock.results.map((r) => r.value?.catch(() => {})));
  });
  expect(files.get(FILE)).toBe(AFTER);
  expect(writes.filter((path) => path === FILE)).toHaveLength(1);
});

function lostResponse() {
  const realWrite = TauriFileSystem.writeFileWithReceipt.bind(TauriFileSystem);
  const realInspect = TauriFileSystem.inspectWritebackReceipt.bind(TauriFileSystem);
  let reads = 0;
  const inspect = vi
    .spyOn(TauriFileSystem, 'inspectWritebackReceipt')
    .mockImplementation(async (...args) => {
      if (++reads === 2) throw new Error('receipt IPC temporarily unavailable');
      return realInspect(...args);
    });
  const native = vi
    .spyOn(TauriFileSystem, 'writeFileWithReceipt')
    .mockImplementationOnce(async (...args) => {
      await realWrite(...args);
      throw new Error('native response lost');
    });
  return { inspect, native, realInspect };
}
async function failedAcceptance() {
  const spies = lostResponse();
  await open(BEFORE);
  await generate();
  await approve();
  await observe(() => expect(host.textContent).toContain('接受失败'));
  expect(files.get(FILE)).toBe(AFTER);
  return spies;
}
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it.each(['typing', 'typing-undo', 'model-replacement'] as const)(
  'failed live acceptance cannot replace a newer model intent: %s',
  async (mode) => {
    const { native } = await failedAcceptance();
    const oldButton = host.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!;
    const expected = mode === 'typing' ? BEFORE + '\n后来输入' : BEFORE;
    await act(async () => {
      if (mode === 'model-replacement')
        __getLastEditor()!.setModel(monacoEditor.createModel(BEFORE));
      else {
        __getLastEditor()!
          .getModel()!
          .setValue(BEFORE + '\n后来输入');
        if (mode === 'typing-undo') __getLastEditor()!.getModel()!.setValue(BEFORE);
      }
      oldButton.click();
    });
    await act(async () => {});
    expect(__getLastEditor()!.getValue()).toBe(expected);
    expect(files.get(FILE)).toBe(AFTER);
    expect(native).toHaveBeenCalledTimes(1);
    expect(writes.filter((p) => p === FILE)).toHaveLength(1);
  },
);

it('live receipt resolution after navigation settles only unchanged originating model', async () => {
  const { inspect, native, realInspect } = await failedAcceptance();
  const originalModel = __getLastEditor()!.getModel()!;
  const receiptGate = defer<void>();
  inspect.mockImplementationOnce(async (...args) => {
    await receiptGate.promise;
    return realInspect(...args);
  });
  await approve();
  await navigate(OTHER, 'B正文不变');
  await act(async () => receiptGate.resolve());
  await observe(() => expect(originalModel.getValue()).toBe(AFTER));
  expect(__getLastEditor()!.getValue()).toBe('B正文不变');
  expect(files.get(OTHER)).toBe('B正文不变');
  await act(async () =>
    root.render(
      <Editor
        projectPath={PROJECT}
        filePath={FILE}
        retainedFilePaths={[FILE, OTHER]}
        dialogs={dialogs}
      />,
    ),
  );
  await observe(() => expect(__getLastEditor()!.getValue()).toBe(AFTER));
  await act(async () => bridge.commands.get(3)?.());
  expect(files.get(FILE)).toBe(AFTER);
  expect(native).toHaveBeenCalledTimes(1);
  expect(writes.filter((p) => p === FILE)).toHaveLength(1);
});

it.each(['typing', 'typing-undo'] as const)(
  'newer intent while live receipt retry is pending survives: %s',
  async (mode) => {
    const { inspect, native, realInspect } = await failedAcceptance();
    const receiptGate = defer<void>();
    inspect.mockImplementationOnce(async (...args) => {
      await receiptGate.promise;
      return realInspect(...args);
    });
    await approve();
    await act(async () => {
      __getLastEditor()!
        .getModel()!
        .setValue(BEFORE + '\n查证时输入');
      if (mode === 'typing-undo') __getLastEditor()!.getModel()!.setValue(BEFORE);
    });
    await act(async () => receiptGate.resolve());
    await observe(() => expect(host.querySelector('.sf-inline-btn-accept')).toBeNull());
    expect(__getLastEditor()!.getValue()).toBe(
      mode === 'typing-undo' ? BEFORE : BEFORE + '\n查证时输入',
    );
    expect(files.get(FILE)).toBe(AFTER);
    expect(native).toHaveBeenCalledTimes(1);
    expect(writes.filter((p) => p === FILE)).toHaveLength(1);
  },
);
