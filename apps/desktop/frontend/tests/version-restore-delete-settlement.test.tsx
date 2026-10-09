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
async function navigate(file: string, content: string, drop = effects.drop, project = PROJECT) {
  files.set(file, content);
  await act(async () =>
    root.render(
      <Editor
        dropOpenFilePath={drop}
        projectPath={project}
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
it('cumulative: completed absent restore always retires its deleted origin tab after navigation', async () => {
  await open('A当前正文');
  effects.read.mockResolvedValueOnce({ exists: false, content: '' });
  const deletion = defer<void>();
  vi.mocked(TauriFileSystem.deletePath).mockImplementationOnce(async (_project, path) => {
    await deletion.promise;
    files.delete(path);
  });
  await startRestore();
  await observe(() => expect(TauriFileSystem.deletePath).toHaveBeenCalledWith(PROJECT, FILE));
  await navigate(OTHER, 'B必须保留');
  await act(async () => deletion.resolve());
  await observe(() => expect(files.has(FILE)).toBe(false));
  expect(__getLastEditor()?.getValue()).toBe('B必须保留');
  expect(effects.drop).toHaveBeenCalledWith(FILE);
});

async function beginDeleting() {
  await open('A当前正文');
  effects.read.mockResolvedValueOnce({ exists: false, content: '' });
  const deletion = defer<void>();
  vi.mocked(TauriFileSystem.deletePath).mockImplementationOnce(async (_project, path) => {
    files.delete(path);
    await deletion.promise;
  });
  await startRestore();
  await observe(() => expect(TauriFileSystem.deletePath).toHaveBeenCalledWith(PROJECT, FILE));
  return deletion;
}

it('completed delete uses the latest tab callback after navigation', async () => {
  const gate = await beginDeleting();
  const latest = vi.fn();
  await navigate(OTHER, 'B正文', latest);
  await act(async () => gate.resolve());
  await observe(() => expect(latest).toHaveBeenCalledWith(FILE));
  expect(effects.drop).not.toHaveBeenCalled();
  expect(__getLastEditor()!.getValue()).toBe('B正文');
});

it('completed delete does not close a newer unsaved original model', async () => {
  const gate = await beginDeleting();
  await act(async () => __getLastEditor()!.getModel()!.setValue('A后来输入'));
  await act(async () => gate.resolve());
  await observe(() => expect(host.textContent).not.toContain('恢复中'));
  expect(__getLastEditor()!.getValue()).toBe('A后来输入');
  expect(effects.drop).not.toHaveBeenCalled();
});

it('completed delete does not close a replacement model at the same path', async () => {
  const gate = await beginDeleting();
  await act(async () => __getLastEditor()!.setModel(monacoEditor.createModel('A重建缓冲')));
  await act(async () => gate.resolve());
  await observe(() => expect(host.textContent).not.toContain('恢复中'));
  expect(__getLastEditor()!.getValue()).toBe('A重建缓冲');
  expect(effects.drop).not.toHaveBeenCalled();
});

it('completed delete does not close a recreated file even with the original model', async () => {
  const gate = await beginDeleting();
  files.set(FILE, 'A外部重建');
  await act(async () => gate.resolve());
  await observe(() => expect(host.textContent).not.toContain('恢复中'));
  expect(files.get(FILE)).toBe('A外部重建');
  expect(effects.drop).not.toHaveBeenCalled();
});

it('completed delete from the old project cannot close a tab in the new project', async () => {
  const gate = await beginDeleting();
  const latest = vi.fn();
  await navigate('D:/next-project/chapter.md', '新项目正文', latest, 'D:/next-project');
  await act(async () => gate.resolve());
  await observe(() => expect(host.textContent).not.toContain('恢复中'));
  expect(__getLastEditor()!.getValue()).toBe('新项目正文');
  expect(latest).not.toHaveBeenCalled();
  expect(effects.drop).not.toHaveBeenCalled();
});

it('target version is rechecked after the asynchronous existence query', async () => {
  const gate = await beginDeleting();
  const exists = defer<boolean>();
  vi.spyOn(TauriFileSystem, 'pathExists').mockReturnValueOnce(exists.promise);
  await act(async () => gate.resolve());
  await observe(() => expect(TauriFileSystem.pathExists).toHaveBeenCalledWith(FILE));
  await act(async () => __getLastEditor()!.getModel()!.setValue('A核对期间新输入'));
  await act(async () => exists.resolve(false));
  await observe(() => expect(host.textContent).not.toContain('恢复中'));
  expect(__getLastEditor()!.getValue()).toBe('A核对期间新输入');
  expect(effects.drop).not.toHaveBeenCalled();
});

it('normal same-target absent restore still retires the deleted tab', async () => {
  const gate = await beginDeleting();
  await act(async () => gate.resolve());
  await observe(() => expect(effects.drop).toHaveBeenCalledWith(FILE));
  expect(files.has(FILE)).toBe(false);
});
