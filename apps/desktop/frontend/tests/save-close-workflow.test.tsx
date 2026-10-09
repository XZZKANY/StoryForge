/**
 * 实际 Editor + 页签 / 项目关闭 → 保存与缓冲保留集成回归。
 * 仅替换 Monaco 装配、HTTP、磁盘适配边界与快照服务；不是 Windows/Tauri 原生验收。
 */
import type { RevisionLoopRecord } from '../src/lib/author-loop';
import { act, useState } from 'react';
import { useEditorWorkspaceTabs } from '../src/components/app/useEditorWorkspaceTabs';
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
const dialogs = {
  alert: vi.fn(async () => {}),
  confirm: vi.fn(async () => false),
  prompt: vi.fn(async () => null),
  choose: vi.fn(async (): Promise<string | null> => 'save'),
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
});
async function observe(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
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

let tabs!: ReturnType<typeof useEditorWorkspaceTabs>;
let activeProject: string | null;
function Workspace() {
  const [project, setProject] = useState<string | null>(PROJECT);
  const [current, setCurrent] = useState<string | null>(null);
  activeProject = project;
  tabs = useEditorWorkspaceTabs({
    activeProject: project,
    currentFile: current,
    selectProject: (path) => {
      setProject(path);
      setCurrent(null);
    },
    selectFile: setCurrent,
    closeFile: () => setCurrent(null),
    removeProject: () => {
      setProject(null);
      setCurrent(null);
    },
    dialogs,
    onShowEditor: () => {},
  });
  return (
    <Editor
      projectPath={project}
      filePath={tabs.displayedFile}
      retainedFilePaths={tabs.retainedEditorFiles}
      onDirtyChange={tabs.handleEditorDirtyChange}
      dropOpenFilePath={tabs.dropOpenFilePath}
      dialogs={dialogs}
    />
  );
}
async function openWorkspace() {
  files.set(FILE, BEFORE);
  files.set(OTHER, 'B原稿');
  await act(async () => root.render(<Workspace />));
  await act(async () => tabs.openFile(FILE));
  await observe(() => expect(__getLastEditor()?.getValue()).toBe(BEFORE));
}
async function type(value: string) {
  await act(async () => __getLastEditor()!.getModel()!.setValue(value));
  await observe(() => expect(tabs.dirtyFiles.has(FILE)).toBe(true));
}
function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  dialogs.choose.mockReset().mockResolvedValue('save');
  dialogs.confirm.mockReset().mockResolvedValue(false);
  effects.snapshot.mockReset().mockResolvedValue({ timestamp: 1, created: false });
});
it('control: save and close completes when no input arrives during save', async () => {
  await openWorkspace();
  await type(BEFORE + '\nSaved input');
  await act(async () => tabs.handleFileClose(FILE));
  expect(tabs.openFiles).not.toContain(FILE);
  expect(files.get(FILE)).toBe(BEFORE + '\nSaved input');
  expect(dialogs.alert).not.toHaveBeenCalled();
});

it.each(['file', 'all', 'project', 'remove'] as const)(
  'pending input survives save-and-%s, or operation leaves the dirty source open',
  async (kind) => {
    await openWorkspace();
    const first = BEFORE + '\nSaved input';
    const latest = first + '\nInput during pending snapshot';
    await type(first);
    const originalModel = __getLastEditor()!.getModel()!;
    const gate = defer<{ timestamp: number; created: boolean }>();
    effects.snapshot.mockReturnValueOnce(gate.promise);
    let operation!: Promise<unknown>;
    await act(async () => {
      operation =
        kind === 'file'
          ? tabs.handleFileClose(FILE)
          : kind === 'all'
            ? tabs.handleCloseAll()
            : kind === 'project'
              ? tabs.selectProjectSafely('D:/other-project')
              : tabs.removeProjectSafely(PROJECT);
    });
    await observe(() => expect(effects.snapshot).toHaveBeenCalledTimes(1));
    await type(latest);
    expect(originalModel.getValue()).toBe(latest);
    await act(async () => {
      gate.resolve({ timestamp: 1, created: false });
      await operation;
    });
    // If saving did not include the latest text, the original tab/model must survive.
    // This is compatible with either saving again or cancelling close/switch.
    const retained =
      tabs.openFiles.includes(FILE) &&
      !originalModel.isDisposed() &&
      originalModel.getValue() === latest;
    expect.soft(files.get(FILE) === latest || retained).toBe(true);
    if (kind !== 'project') {
      await act(async () => tabs.openFile(FILE));
      await observe(() => expect(__getLastEditor()?.getValue()).toBe(latest));
    } else {
      expect.soft(activeProject === PROJECT || files.get(FILE) === latest).toBe(true);
    }
  },
);

it('普通保存保留等待期间的新输入；再次保存精确落下最新全文', async () => {
  await openWorkspace();
  const first = BEFORE + '\n先输入';
  const latest = first + '\n后输入';
  await type(first);
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await type(latest);
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await observe(() => expect(files.get(FILE)).toBe(first));
  expect(__getLastEditor()!.getValue()).toBe(latest);
  expect(tabs.dirtyFiles.has(FILE)).toBe(true);
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => {
    expect(files.get(FILE)).toBe(latest);
    expect(tabs.dirtyFiles.has(FILE)).toBe(false);
  });
  expect(writes.filter((p) => p === FILE)).toHaveLength(2);
});

it('普通保存拒绝覆盖外部改稿，保留当前未保存输入并提示失败', async () => {
  await openWorkspace();
  const latest = BEFORE + '\n本地输入';
  await type(latest);
  files.set(FILE, '外部最新稿');
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => expect(dialogs.alert).toHaveBeenCalled());
  expect(files.get(FILE)).toBe('外部最新稿');
  expect(__getLastEditor()!.getValue()).toBe(latest);
  expect(tabs.dirtyFiles.has(FILE)).toBe(true);
  expect(writes.filter((p) => p === FILE)).toHaveLength(0);
});

it('普通保存A期间切到B不误写B，返回B仍保留未保存缓冲', async () => {
  await openWorkspace();
  const saved = BEFORE + '\nA输入';
  await type(saved);
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await act(async () => tabs.openFile(OTHER));
  await observe(() => expect(__getLastEditor()!.getValue()).toBe('B原稿'));
  await act(async () => __getLastEditor()!.getModel()!.setValue('B未保存输入'));
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await observe(() => expect(files.get(FILE)).toBe(saved));
  expect(__getLastEditor()!.getValue()).toBe('B未保存输入');
  expect(files.get(OTHER)).toBe('B原稿');
  await act(async () => tabs.openFile(FILE));
  await observe(() => expect(__getLastEditor()!.getValue()).toBe(saved));
  await act(async () => tabs.openFile(OTHER));
  await observe(() => expect(__getLastEditor()!.getValue()).toBe('B未保存输入'));
  expect(tabs.dirtyFiles.has(OTHER)).toBe(true);
});

it('普通保存快照失败不改变磁盘，明确重试后保存最新输入', async () => {
  await openWorkspace();
  await type(BEFORE + '\n输入');
  effects.snapshot.mockRejectedValueOnce(new Error('snapshot failed'));
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => expect(dialogs.alert).toHaveBeenCalled());
  expect(files.get(FILE)).toBe(BEFORE);
  expect(tabs.dirtyFiles.has(FILE)).toBe(true);
  const latest = BEFORE + '\n输入\n继续写';
  await type(latest);
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => {
    expect(files.get(FILE)).toBe(latest);
    expect(tabs.dirtyFiles.has(FILE)).toBe(false);
  });
});

it('独立保存关闭：等待期间打开并编辑B不得清除B活动状态', async () => {
  await openWorkspace();
  await type(BEFORE + '\nA先输入');
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  let closing!: Promise<void>;
  await act(async () => {
    closing = tabs.handleFileClose(FILE);
  });
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await act(async () => tabs.openFile(OTHER));
  await observe(() => expect(__getLastEditor()?.getValue()).toBe('B原稿'));
  await act(async () => __getLastEditor()!.getModel()!.setValue('B新输入'));
  await observe(() => expect(tabs.dirtyFiles.has(OTHER)).toBe(true));
  await act(async () => {
    gate.resolve({ timestamp: 1, created: false });
    await closing;
  });
  expect(tabs.openFiles).toContain(OTHER);
  expect(tabs.displayedFile).toBe(OTHER);
  expect(__getLastEditor()?.getValue()).toBe('B新输入');
  expect(files.get(OTHER)).toBe('B原稿');
});
it('独立保存关闭：关闭全部不能丢弃等待期间新打开的B脏稿', async () => {
  await openWorkspace();
  await type(BEFORE + '\nA先输入');
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  let closing!: Promise<void>;
  await act(async () => {
    closing = tabs.handleCloseAll();
  });
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  await act(async () => tabs.openFile(OTHER));
  await observe(() => expect(__getLastEditor()?.getValue()).toBe('B原稿'));
  await act(async () => __getLastEditor()!.getModel()!.setValue('B新输入'));
  await observe(() => expect(tabs.dirtyFiles.has(OTHER)).toBe(true));
  await act(async () => {
    gate.resolve({ timestamp: 1, created: false });
    await closing;
  });
  expect(tabs.openFiles).toContain(OTHER);
  expect(__getLastEditor()?.getValue()).toBe('B新输入');
  expect(files.get(OTHER)).toBe('B原稿');
});
it('独立保存关闭：同路径替换模型不能被旧保存确认关闭', async () => {
  await openWorkspace();
  await type(BEFORE + '\nA先输入');
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  let closing!: Promise<void>;
  await act(async () => {
    closing = tabs.handleFileClose(FILE);
  });
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  const replacement = monacoEditor.createModel('替换后的新稿');
  await act(async () => __getLastEditor()!.setModel(replacement));
  await act(async () => {
    gate.resolve({ timestamp: 1, created: false });
    await closing;
  });
  expect(tabs.openFiles).toContain(FILE);
  expect(replacement.getValue()).toBe('替换后的新稿');
});
it('独立保存关闭：显式取消不保存也不关闭', async () => {
  await openWorkspace();
  await type(BEFORE + '\nA先输入');
  dialogs.choose.mockResolvedValueOnce(null);
  await act(async () => tabs.handleFileClose(FILE));
  expect(tabs.openFiles).toContain(FILE);
  expect(effects.snapshot).not.toHaveBeenCalled();
  expect(files.get(FILE)).toBe(BEFORE);
});
it('独立保存关闭：保存失败保留脏模型和原磁盘', async () => {
  await openWorkspace();
  await type(BEFORE + '\nA先输入');
  effects.snapshot.mockRejectedValueOnce(new Error('独立快照失败'));
  await act(async () => tabs.handleFileClose(FILE));
  expect(tabs.openFiles).toContain(FILE);
  expect(__getLastEditor()?.getValue()).toBe(BEFORE + '\nA先输入');
  expect(files.get(FILE)).toBe(BEFORE);
  expect(dialogs.alert).toHaveBeenCalled();
});

it('独立保存关闭：较新关闭请求的取消使旧保存完成不能再关页签', async () => {
  await openWorkspace();
  await type(BEFORE + '\nA先输入');
  const gate = defer<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  let older!: Promise<void>;
  await act(async () => {
    older = tabs.handleFileClose(FILE);
  });
  await observe(() => expect(effects.snapshot).toHaveBeenCalledOnce());
  dialogs.choose.mockResolvedValueOnce(null);
  await act(async () => tabs.handleFileClose(FILE));
  await act(async () => {
    gate.resolve({ timestamp: 1, created: false });
    await older;
  });
  expect(tabs.openFiles).toContain(FILE);
  expect(__getLastEditor()?.getValue()).toBe(BEFORE + '\nA先输入');
  expect(files.get(FILE)).toBe(BEFORE + '\nA先输入');
});
