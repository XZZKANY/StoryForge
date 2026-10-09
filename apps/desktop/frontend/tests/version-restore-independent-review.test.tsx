import { TauriFileSystem } from '../src/lib/tauri-fs';

import { REQUEST_EDITOR_COMMAND_EVENT } from '../src/lib/assistant-events';
/**
 * 实际 Editor → VersionHistory → 历史恢复归属的独立集成回归。
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
  list: vi.fn(async () => []),
  read: vi.fn(async () => ({ exists: true, content: 'A历史正文' })),
  drop: vi.fn(),
}));
vi.mock('../src/lib/versions', async (load) => ({
  ...(await load<typeof import('../src/lib/versions')>()),
  snapshotBeforeWrite: effects.snapshot,
  listVersions: effects.list,
  readVersionState: effects.read,
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
const dialogs = {
  alert: async () => {},
  confirm: vi.fn(async () => true),
  prompt: vi.fn(async (): Promise<string | null> => null),
};

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
  vi.restoreAllMocks();
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
        dropOpenFilePath={effects.drop}
        projectPath={PROJECT}
        filePath={FILE}
        retainedFilePaths={[FILE]}
        dialogs={dialogs}
      />,
    ),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe(content ?? ''));
}

const bridge = vi.hoisted(() => ({
  commands: new Map<number, () => void>(),
  selection: null as {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    isEmpty: () => boolean;
  } | null,
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
          getSelection: () =>
            bridge.selection ?? {
              startLineNumber: 2,
              startColumn: 1,
              endLineNumber: 2,
              endColumn: 1,
              isEmpty: () => true,
            },
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
          getValueInRange: () => model.getValue(),
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
async function navigate(file: string, content: string) {
  files.set(file, content);
  await act(async () =>
    root.render(
      <Editor
        dropOpenFilePath={effects.drop}
        projectPath={PROJECT}
        filePath={file}
        retainedFilePaths={[FILE, file]}
        dialogs={dialogs}
      />,
    ),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe(content));
}

const ENTRY = {
  path: PROJECT + '/.storyforge/versions/chapter.md/1.snapshot.md',
  timestamp: 1,
  file: 'chapter.md',
  contentRef: {
    kind: 'legacy-file' as const,
    path: PROJECT + '/.storyforge/versions/chapter.md/1.snapshot.md',
  },
};
beforeEach(() => {
  effects.list.mockReset().mockResolvedValue([ENTRY] as never);
  effects.read.mockReset().mockResolvedValue({ exists: true, content: 'A历史正文' });
  effects.snapshot.mockReset().mockResolvedValue({ timestamp: 1, created: false });
  dialogs.confirm.mockReset().mockResolvedValue(true);
  dialogs.prompt.mockReset().mockResolvedValue(null);
  vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async (_project, path) => {
    files.delete(path);
  });
});
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function startRestore() {
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent(REQUEST_EDITOR_COMMAND_EVENT, { detail: { command: 'toggle-history' } }),
    ),
  );
  await observe(() =>
    expect(
      [...host.querySelectorAll('button')].find((b) => b.textContent === '恢复'),
    ).toBeDefined(),
  );
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '恢复')!
      .click(),
  );
}
async function beginPendingSnapshot() {
  await open('A当前正文');
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockImplementationOnce(() => gate.promise);
  await startRestore();
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  return gate;
}

it('independent restore: navigating during snapshot never pollutes B buffer or later CtrlS', async () => {
  const gate = await beginPendingSnapshot();
  await navigate(OTHER, 'B必须保留');
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  expect.soft(__getLastEditor()?.getValue()).toBe('B必须保留');
  await act(async () => bridge.commands.get(3)?.());
  expect(files.get(OTHER)).toBe('B必须保留');
  expect(files.get(FILE)).toBe('A当前正文');
});
it('independent restore: delayed version read cannot adopt the next active target', async () => {
  await open('A当前正文');
  const gate = defer<{ exists: boolean; content: string }>();
  effects.read.mockImplementationOnce(() => gate.promise);
  await startRestore();
  await observe(() => expect(effects.read).toHaveBeenCalledOnce());
  await navigate(OTHER, 'B必须保留');
  await act(async () => gate.resolve({ exists: true, content: 'A历史正文' }));
  await act(async () => {});
  expect(__getLastEditor()?.getValue()).toBe('B必须保留');
  expect(effects.snapshot).not.toHaveBeenCalled();
});
it('independent restore: fresh typing during snapshot survives', async () => {
  const gate = await beginPendingSnapshot();
  await act(async () => __getLastEditor()?.setValue('作者刚写下的新稿'));
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  expect(__getLastEditor()?.getValue()).toBe('作者刚写下的新稿');
  expect(files.get(FILE)).toBe('A当前正文');
});
it('independent restore: same path replacement model is never overwritten', async () => {
  const gate = await beginPendingSnapshot();
  const replacement = monacoEditor.createModel('相同文件的新模型');
  await act(async () => __getLastEditor()?.setModel(replacement));
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  expect(replacement.getValue()).toBe('相同文件的新模型');
  expect(files.get(FILE)).toBe('A当前正文');
});
it('independent restore: explicit cancellation never snapshots or replaces', async () => {
  await open('A当前正文');
  dialogs.confirm.mockResolvedValueOnce(false);
  await startRestore();
  await act(async () => {});
  expect(effects.snapshot).not.toHaveBeenCalled();
  expect(__getLastEditor()?.getValue()).toBe('A当前正文');
});
it('independent restore: navigating away and back invalidates earlier snapshot intent', async () => {
  const gate = await beginPendingSnapshot();
  await navigate(OTHER, 'B必须保留');
  await navigate(FILE, 'A当前正文');
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  expect(__getLastEditor()?.getValue()).toBe('A当前正文');
  expect(files.get(FILE)).toBe('A当前正文');
});

it('independent restore: dirty confirmation cannot save newly active B before owner check', async () => {
  await open('A当前正文');
  await act(async () => __getLastEditor()?.setValue('A未保存正文'));
  const confirmation = defer<boolean>();
  dialogs.confirm.mockImplementationOnce(() => confirmation.promise);
  await startRestore();
  await observe(() => expect(dialogs.confirm).toHaveBeenCalledOnce());
  await navigate(OTHER, 'B原磁盘');
  await act(async () => __getLastEditor()?.setValue('B未保存正文'));
  await act(async () => confirmation.resolve(true));
  await act(async () => {});
  expect(files.get(OTHER)).toBe('B原磁盘');
  expect(writes).not.toContain(OTHER);
  expect(__getLastEditor()?.getValue()).toBe('B未保存正文');
});
it('independent restore: external disk changes during snapshot cannot be overwritten by ordinary save', async () => {
  const gate = await beginPendingSnapshot();
  files.set(FILE, '外部磁盘新稿');
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  await act(async () => bridge.commands.get(3)?.());
  await act(async () => {});
  expect(files.get(FILE)).toBe('外部磁盘新稿');
});
it('independent restore: unmount during snapshot cannot mutate captured model', async () => {
  const gate = await beginPendingSnapshot();
  const captured = __getLastEditor()?.getModel();
  await act(async () => root.unmount());
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  expect(captured?.getValue()).toBe('A当前正文');
  expect(files.get(FILE)).toBe('A当前正文');
});

it('independent restore: absent version read after navigation cannot delete B', async () => {
  await open('A当前正文');
  const gate = defer<{ exists: boolean; content: string }>();
  effects.read.mockImplementationOnce(() => gate.promise);
  await startRestore();
  await navigate(OTHER, 'B必须保留');
  await act(async () => gate.resolve({ exists: false, content: '' }));
  await act(async () => {});
  expect(files.get(OTHER)).toBe('B必须保留');
  expect(files.get(FILE)).toBe('A当前正文');
  expect(TauriFileSystem.deletePath).not.toHaveBeenCalled();
  expect(effects.drop).not.toHaveBeenCalled();
});
it('independent restore: legitimate absent version still deletes its confirmed target', async () => {
  await open('A当前正文');
  effects.read.mockResolvedValueOnce({ exists: false, content: '' });
  await startRestore();
  await observe(() => expect(files.has(FILE)).toBe(false));
  expect(TauriFileSystem.deletePath).toHaveBeenCalledWith(PROJECT, FILE);
  expect(effects.drop).toHaveBeenCalledWith(FILE);
});
it('independent restore: absent version snapshot navigation invalidates stale deletion', async () => {
  await open('A当前正文');
  effects.read.mockResolvedValueOnce({ exists: false, content: '' });
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockImplementationOnce(() => gate.promise);
  await startRestore();
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await navigate(OTHER, 'B必须保留');
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  expect(files.get(FILE)).toBe('A当前正文');
  expect(files.get(OTHER)).toBe('B必须保留');
  expect(TauriFileSystem.deletePath).not.toHaveBeenCalled();
  expect(effects.drop).not.toHaveBeenCalled();
});

it('independent restore: external disk edits during absent-state snapshot are not deleted', async () => {
  await open('A当前正文');
  effects.read.mockResolvedValueOnce({ exists: false, content: '' });
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockImplementationOnce(() => gate.promise);
  await startRestore();
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  files.set(FILE, '外部磁盘新稿');
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await act(async () => {});
  expect(files.get(FILE)).toBe('外部磁盘新稿');
  expect(TauriFileSystem.deletePath).not.toHaveBeenCalled();
});

it('independent restore: newer restore after reopening history supersedes delayed version read', async () => {
  await open('A当前正文');
  const older = defer<{ exists: boolean; content: string }>();
  effects.read.mockImplementationOnce(() => older.promise);
  await startRestore();
  await observe(() => expect(effects.read).toHaveBeenCalledOnce());
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent(REQUEST_EDITOR_COMMAND_EVENT, { detail: { command: 'toggle-history' } }),
    ),
  );
  effects.read.mockResolvedValueOnce({ exists: true, content: '较新选择的历史正文' });
  await startRestore();
  await observe(() => expect(__getLastEditor()?.getValue()).toBe('较新选择的历史正文'));
  await act(async () => older.resolve({ exists: true, content: '已过期的历史正文' }));
  await act(async () => {});
  expect(__getLastEditor()?.getValue()).toBe('较新选择的历史正文');
  expect(effects.snapshot).toHaveBeenCalledOnce();
});

it('independent restore: same-target dirty restore saves current draft before applying historical version', async () => {
  await open('A当前正文');
  await act(async () => __getLastEditor()?.setValue('A未保存正文'));
  await startRestore();
  await observe(() => expect(__getLastEditor()?.getValue()).toBe('A历史正文'));
  expect(files.get(FILE)).toBe('A未保存正文');
  expect(effects.snapshot).toHaveBeenCalledTimes(2);
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => expect(files.get(FILE)).toBe('A历史正文'));
});

async function showGraphNode() {
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent(REQUEST_EDITOR_COMMAND_EVENT, { detail: { command: 'toggle-history' } }),
    ),
  );
  await observe(() => expect(host.querySelector('[data-testid="version-history"]')).not.toBeNull());
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="version-view-graph"]')!.click(),
  );
  await observe(() =>
    expect(host.querySelector('[data-testid="branch-node"] button')).not.toBeNull(),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="branch-node"] button')!.click(),
  );
}

it('independent restore: graph checkout retains successful same-target workflow', async () => {
  await open('A当前正文');
  await showGraphNode();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="branch-node-checkout"]')!.click(),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe('A历史正文'));
  expect(files.get(FILE)).toBe('A当前正文');
  expect(effects.snapshot).toHaveBeenCalledOnce();
});

it('independent restore: cancelling branch name dialog creates no branch or restore', async () => {
  await open('A当前正文');
  await showGraphNode();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="branch-node-fork"]')!.click(),
  );
  expect(dialogs.prompt).toHaveBeenCalledOnce();
  expect(writes).toHaveLength(0);
  expect(effects.snapshot).not.toHaveBeenCalled();
  expect(__getLastEditor()?.getValue()).toBe('A当前正文');
});

it('independent restore: branch-name dialog navigation cannot mutate new-file branch metadata', async () => {
  await open('A当前正文');
  const prompt = defer<string | null>();
  dialogs.prompt.mockImplementationOnce(() => prompt.promise);
  await showGraphNode();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="branch-node-fork"]')!.click(),
  );
  await observe(() => expect(dialogs.prompt).toHaveBeenCalledOnce());
  await navigate(OTHER, 'B必须保留');
  await act(async () => prompt.resolve('迟到分支'));
  await act(async () => {});
  expect(writes).toHaveLength(0);
  expect(effects.snapshot).not.toHaveBeenCalled();
  expect(__getLastEditor()?.getValue()).toBe('B必须保留');
});

it('independent restore: snapshot failure permits an explicit fresh retry only', async () => {
  await open('A当前正文');
  effects.snapshot.mockRejectedValueOnce(new Error('独立测试快照失败'));
  await startRestore();
  await observe(() => expect(host.textContent).toContain('独立测试快照失败'));
  expect(__getLastEditor()?.getValue()).toBe('A当前正文');
  expect(files.get(FILE)).toBe('A当前正文');
  expect(effects.snapshot).toHaveBeenCalledOnce();
  const reload = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes('重试'),
  );
  await act(async () => reload!.click());
  await observe(() =>
    expect(
      [...host.querySelectorAll('button')].find((button) => button.textContent === '恢复'),
    ).toBeDefined(),
  );
  const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === '恢复',
  );
  await act(async () => retry!.click());
  await observe(() => expect(__getLastEditor()?.getValue()).toBe('A历史正文'));
  expect(effects.snapshot).toHaveBeenCalledTimes(2);
});
