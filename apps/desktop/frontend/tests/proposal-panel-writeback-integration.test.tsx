/**
 * 实际 Editor → 提案面板 → 守卫写回 / 撤销集成回归。
 * 仅替换 Monaco 装配、HTTP、磁盘适配边界与快照服务；不是 Windows/Tauri 原生验收。
 */
import type { RevisionLoopRecord } from '../src/lib/author-loop';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editor as monacoEditor, __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { ToastHost } from '../src/components/shell/ToastHost';
import { emitFileSuggestion } from '../src/lib/assistant-events';
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
      <>
        <Editor
          projectPath={PROJECT}
          filePath={FILE}
          retainedFilePaths={[FILE]}
          dialogs={dialogs}
        />
        <ToastHost />
      </>,
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
      createDiffEditor: () => {
        const diff = actual.editor.createDiffEditor();
        Object.assign(diff.getOriginalEditor(), {
          setScrollTop: () => {},
          revealLineNearTop: () => {},
        });
        return diff;
      },
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
const BEFORE =
  '门边的灯亮着。\n\n楼下有人走过。\n\n杯子还是冷的。\n\n窗外的雨停了。\n\n她把信放回桌上。';
const AFTER = BEFORE.replace('灯亮着', '灯熄了').replace('冷的', '温的').replace('桌上', '抽屉里');
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
async function navigate(file: string, content: string) {
  files.set(file, content);
  await act(async () =>
    root.render(
      <>
        <Editor
          projectPath={PROJECT}
          filePath={file}
          retainedFilePaths={[FILE, file]}
          dialogs={dialogs}
        />
        <ToastHost />
      </>,
    ),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe(content));
}

let sequence = 0;
async function propose(before = BEFORE, after = AFTER) {
  await act(async () =>
    emitFileSuggestion({
      id: `panel-trial-${++sequence}`,
      filePath: FILE,
      before,
      after,
      title: '逐处审阅',
      summary: '三处改稿',
      note: '',
      createdAt: 1,
      requiresConfirmation: true,
    }),
  );
  await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).not.toBeNull());
}
function button(id: string, index = 0) {
  const result = host.querySelectorAll<HTMLButtonElement>(`[data-testid="${id}"]`)[index];
  expect(result).toBeDefined();
  return result;
}
async function click(id: string, index = 0) {
  await act(async () => button(id, index).click());
}
async function settled(content: string) {
  await observe(() => {
    expect(files.get(FILE)).toBe(content);
    expect(host.querySelector('[data-testid="patch-action-status"]')).toBeNull();
    expect(host.querySelector('[data-testid="toast-action"]')).not.toBeNull();
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

it('真实面板接受首块后其余原文不变，撤销后仍能整份接受', async () => {
  await open(BEFORE);
  await propose();
  expect(host.querySelectorAll('[data-testid="suggestion-accept-hunk"]').length).toBe(3);
  await click('suggestion-accept-hunk');
  await settled(BEFORE.replace('灯亮着', '灯熄了'));
  expect(host.querySelectorAll('[data-testid="suggestion-accept-hunk"]').length).toBe(2);
  await click('toast-action');
  await observe(() => expect(files.get(FILE)).toBe(BEFORE));
  await observe(() =>
    expect(host.querySelectorAll('[data-testid="suggestion-accept-hunk"]').length).toBe(3),
  );
  await click('suggestion-accept');
  await settled(AFTER);
  expect(host.querySelector('[data-testid="patch-review"]')).toBeNull();
});

it('接受第二块后拒绝剩余，不写入未接受的两处', async () => {
  await open(BEFORE);
  await propose();
  await click('suggestion-accept-hunk', 1);
  const middle = BEFORE.replace('冷的', '温的');
  await settled(middle);
  await click('suggestion-reject');
  await click('patch-reject-confirm');
  await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).toBeNull());
  expect(files.get(FILE)).toBe(middle);
  expect(writes.filter((p) => p === FILE)).toHaveLength(1);
});

it('重复点击同一接受按钮只写入一次', async () => {
  await open(BEFORE);
  await propose();
  const gate = deferred<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  const accept = button('suggestion-accept-hunk');
  await act(async () => {
    accept.click();
    accept.click();
    accept.click();
  });
  await observe(() => expect(effects.snapshot).toHaveBeenCalledTimes(1));
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await settled(BEFORE.replace('灯亮着', '灯熄了'));
  expect(writes.filter((p) => p === FILE)).toHaveLength(1);
});

it('接受后有新输入时撤销保留新内容和已落盘正文', async () => {
  await open(BEFORE);
  await propose();
  await click('suggestion-accept');
  await settled(AFTER);
  await act(async () =>
    __getLastEditor()!
      .getModel()!
      .setValue(AFTER + '\n作者的新句。'),
  );
  await click('toast-action');
  expect(__getLastEditor()!.getValue()).toBe(AFTER + '\n作者的新句。');
  expect(files.get(FILE)).toBe(AFTER);
  expect(writes.filter((p) => p === FILE)).toHaveLength(1);
});

it('快照失败保留原稿与面板，显式重试成功且只写一次', async () => {
  await open(BEFORE);
  await propose();
  effects.snapshot.mockRejectedValueOnce(new Error('fixture snapshot failure'));
  await click('suggestion-accept-hunk');
  await observe(() => expect(host.textContent).toContain('fixture snapshot failure'));
  expect(files.get(FILE)).toBe(BEFORE);
  expect(writes.filter((p) => p === FILE)).toHaveLength(0);
  await click('suggestion-accept-hunk');
  await settled(BEFORE.replace('灯亮着', '灯熄了'));
  expect(writes.filter((p) => p === FILE)).toHaveLength(1);
});

it('接受等待快照时切到 B，不污染 B 缓冲区或磁盘', async () => {
  await open(BEFORE);
  await propose();
  const gate = deferred<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  await click('suggestion-accept-hunk');
  await observe(() => expect(effects.snapshot).toHaveBeenCalledTimes(1));
  await navigate(OTHER, 'B 的正文。');
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await observe(() => expect(files.get(FILE)).toBe(BEFORE.replace('灯亮着', '灯熄了')));
  expect(files.get(OTHER)).toBe('B 的正文。');
  expect(__getLastEditor()!.getValue()).toBe('B 的正文。');
  expect(host.querySelector('[data-testid="patch-review"]')).toBeNull();
});

it('快照等待期间作者输入保留，接受只写入已经确认的版本', async () => {
  await open(BEFORE);
  await propose();
  const gate = deferred<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  await click('suggestion-accept-hunk');
  await observe(() => expect(effects.snapshot).toHaveBeenCalledTimes(1));
  await act(async () =>
    __getLastEditor()!
      .getModel()!
      .setValue(BEFORE + '\n作者的新句。'),
  );
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await observe(() => expect(files.get(FILE)).toBe(BEFORE.replace('灯亮着', '灯熄了')));
  expect(__getLastEditor()!.getValue()).toBe(BEFORE + '\n作者的新句。');
});

it('落盘后审计失败只补记录，不重写正文', async () => {
  await open(BEFORE);
  await propose();
  effects.record.mockRejectedValueOnce(new Error('fixture audit failure'));
  await click('suggestion-accept');
  await observe(() => expect(host.textContent).toContain('重试记录（不重写正文）'));
  expect(files.get(FILE)).toBe(AFTER);
  expect(writes.filter((p) => p === FILE)).toHaveLength(1);
  await click('toast-action');
  await observe(() => expect(effects.record).toHaveBeenCalledTimes(2));
  expect(files.get(FILE)).toBe(AFTER);
  expect(writes.filter((p) => p === FILE)).toHaveLength(1);
});

it('接受前磁盘正文改变时拒绝写入，不把提案覆盖外部新内容', async () => {
  await open(BEFORE);
  await propose();
  files.set(FILE, BEFORE + '\n外部新句。');
  await click('suggestion-accept-hunk');
  await observe(() => expect(host.textContent).toContain('接受分块失败'));
  expect(files.get(FILE)).toBe(BEFORE + '\n外部新句。');
  expect(writes.filter((p) => p === FILE)).toHaveLength(0);
});

it('撤销等待快照时切到 B，不污染 B 缓冲区或磁盘', async () => {
  await open(BEFORE);
  await propose();
  await click('suggestion-accept');
  await settled(AFTER);
  const gate = deferred<{ timestamp: number; created: boolean }>();
  effects.snapshot.mockReturnValueOnce(gate.promise);
  await click('toast-action');
  await observe(() => expect(effects.snapshot).toHaveBeenCalledTimes(2));
  await navigate(OTHER, 'B 的正文。');
  await act(async () => gate.resolve({ timestamp: 1, created: false }));
  await observe(() => expect(files.get(FILE)).toBe(BEFORE));
  expect(files.get(OTHER)).toBe('B 的正文。');
  expect(__getLastEditor()!.getValue()).toBe('B 的正文。');
});

it('撤销快照失败时保留可重试的撤销动作', async () => {
  await open(BEFORE);
  await propose();
  await click('suggestion-accept');
  await settled(AFTER);
  effects.snapshot.mockRejectedValueOnce(new Error('undo snapshot unavailable'));
  await click('toast-action');
  await observe(() => expect(host.textContent).toContain('undo snapshot unavailable'));
  expect(files.get(FILE)).toBe(AFTER);
  expect(host.querySelector('[data-testid="toast-action"]')).not.toBeNull();
  await click('toast-action');
  await observe(() => expect(files.get(FILE)).toBe(BEFORE));
});

it('撤销回执已落盘但返回丢失时查证成功，不重复写入', async () => {
  await open(BEFORE);
  await propose();
  await click('suggestion-accept');
  await settled(AFTER);
  const original = TauriFileSystem.writeFileWithReceipt.bind(TauriFileSystem);
  const commit = vi
    .spyOn(TauriFileSystem, 'writeFileWithReceipt')
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('fixture lost undo response');
    });
  await click('toast-action');
  await observe(() => expect(host.textContent).toContain('已撤销，文件回到写回前'));
  expect(files.get(FILE)).toBe(BEFORE);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(writes.filter((p) => p === FILE)).toHaveLength(2);
  expect(host.querySelector('[data-testid="toast-action"]')).toBeNull();
});

it('撤销结果未知时原地重试沿用同一操作身份，查明前不重复写入', async () => {
  await open(BEFORE);
  await propose();
  await click('suggestion-accept');
  await settled(AFTER);
  const originalCommit = TauriFileSystem.writeFileWithReceipt.bind(TauriFileSystem);
  const originalInspect = TauriFileSystem.inspectWritebackReceipt.bind(TauriFileSystem);
  let unknown = true;
  const keys: string[] = [];
  const requests: string[] = [];
  const inspect = vi
    .spyOn(TauriFileSystem, 'inspectWritebackReceipt')
    .mockImplementation(async (...args) => {
      keys.push(args[1].operationKey);
      requests.push(JSON.stringify(args[1]));
      const receipt = await originalInspect(...args);
      return receipt && unknown
        ? { ...receipt, state: 'outcome_unknown', receiptPersisted: false }
        : receipt;
    });
  const commit = vi
    .spyOn(TauriFileSystem, 'writeFileWithReceipt')
    .mockImplementationOnce(async (...args) => {
      await originalCommit(...args);
      throw new Error('fixture unknown undo response');
    });
  await click('toast-action');
  await observe(() => {
    expect(host.querySelector('[data-testid="toast-action-error"]')).not.toBeNull();
    expect(button('toast-action').disabled).toBe(false);
  });
  await click('toast-action');
  await observe(() => expect(inspect.mock.calls.length).toBeGreaterThanOrEqual(3));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(writes.filter((p) => p === FILE)).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
  expect(new Set(requests).size).toBe(1);
  await observe(() => expect(button('toast-action').disabled).toBe(false));
  unknown = false;
  await click('toast-action');
  await observe(() => expect(host.textContent).toContain('已撤销，文件回到写回前'));
  expect(files.get(FILE)).toBe(BEFORE);
  expect(__getLastEditor()!.getValue()).toBe(BEFORE);
  await act(async () => bridge.commands.get(3)?.());
  await observe(() => expect(files.get(FILE)).toBe(BEFORE));
  expect(commit).toHaveBeenCalledTimes(1);
});

it('撤销已写入但审计失败时只补记录，不再提供重复撤销', async () => {
  await open(BEFORE);
  await propose();
  await click('suggestion-accept');
  await settled(AFTER);
  effects.record.mockRejectedValueOnce(new Error('undo audit unavailable'));
  await click('toast-action');
  await observe(() => expect(host.textContent).toContain('重试记录（不重写正文）'));
  expect(files.get(FILE)).toBe(BEFORE);
  expect(writes.filter((p) => p === FILE)).toHaveLength(2);
  expect(host.querySelectorAll('[data-testid="toast-action"]')).toHaveLength(1);
  await click('toast-action');
  await observe(() => expect(effects.record).toHaveBeenCalledTimes(3));
  expect(writes.filter((p) => p === FILE)).toHaveLength(2);
});

it('independent proposal: created-file undo preserves newer disk edits with unchanged buffer', async () => {
  await open(null);
  await propose('', AFTER);
  await click('suggestion-accept');
  await settled(AFTER);
  const external = AFTER + '\n外部作者新增';
  files.set(FILE, external);
  const remove = vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async (_root, path) => {
    files.delete(path);
  });
  await click('toast-action');
  await act(async () => {});
  expect(files.get(FILE)).toBe(external);
  expect(remove).not.toHaveBeenCalled();
});
it('independent proposal: untouched created file can still be undone by deletion', async () => {
  await open(null);
  await propose('', AFTER);
  await click('suggestion-accept');
  await settled(AFTER);
  const remove = vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async (_root, path) => {
    files.delete(path);
  });
  await click('toast-action');
  await observe(() => expect(files.has(FILE)).toBe(false));
  expect(remove).toHaveBeenCalledOnce();
});
it('independent proposal: created-file unsaved typing blocks deletion', async () => {
  await open(null);
  await propose('', AFTER);
  await click('suggestion-accept');
  await settled(AFTER);
  await act(async () =>
    __getLastEditor()!
      .getModel()!
      .setValue(AFTER + '\n新输入'),
  );
  const remove = vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async (_root, path) => {
    files.delete(path);
  });
  await click('toast-action');
  expect(remove).not.toHaveBeenCalled();
  expect(files.get(FILE)).toBe(AFTER);
});
it.each(['navigate', 'typing', 'away-back'] as const)(
  'independent proposal: created undo read wait rejects %s invalidation',
  async (mode) => {
    await open(null);
    await propose('', AFTER);
    await click('suggestion-accept');
    await settled(AFTER);
    const gate = deferred<string>();
    const read = vi
      .spyOn(TauriFileSystem, 'readProjectFile')
      .mockImplementationOnce(() => gate.promise);
    const remove = vi
      .spyOn(TauriFileSystem, 'deletePath')
      .mockImplementation(async (_root, path) => {
        files.delete(path);
      });
    await click('toast-action');
    await observe(() => expect(read).toHaveBeenCalledOnce());
    if (mode === 'typing')
      await act(async () =>
        __getLastEditor()!
          .getModel()!
          .setValue(AFTER + '\n等待期间作者的新句'),
      );
    else {
      await navigate(OTHER, 'B必须保留');
      if (mode === 'away-back') await navigate(FILE, AFTER);
    }
    await act(async () => gate.resolve(AFTER));
    await observe(() =>
      expect(host.querySelector('[data-testid="toast-action-error"]')).not.toBeNull(),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(files.get(FILE)).toBe(AFTER);
    if (mode === 'navigate') expect(__getLastEditor()!.getValue()).toBe('B必须保留');
    if (mode === 'typing')
      expect(__getLastEditor()!.getValue()).toBe(AFTER + '\n等待期间作者的新句');
  },
);

it.each(['typing', 'typing-undo', 'model-replacement'] as const)(
  'independent proposal: uncertain undo retry preserves %s newer editor ownership',
  async (mode) => {
    await open(BEFORE);
    await propose();
    await click('suggestion-accept');
    await settled(AFTER);
    const originalWrite = TauriFileSystem.writeFileWithReceipt;
    const originalInspect = TauriFileSystem.inspectWritebackReceipt;
    const native = vi
      .spyOn(TauriFileSystem, 'writeFileWithReceipt')
      .mockImplementationOnce(async (...args) => {
        await originalWrite.apply(TauriFileSystem, args);
        throw new Error('lost acknowledgement');
      });
    let inspections = 0;
    vi.spyOn(TauriFileSystem, 'inspectWritebackReceipt').mockImplementation(async (...args) => {
      if (++inspections === 2) throw new Error('temporary receipt unavailable');
      return originalInspect.apply(TauriFileSystem, args);
    });
    await click('toast-action');
    await observe(() => expect(host.textContent).toContain('无法核对'));
    const expected =
      mode === 'typing-undo'
        ? AFTER
        : mode === 'typing'
          ? AFTER + '\n作者的新稿'
          : '替换模型的新稿';
    await act(async () => {
      if (mode === 'model-replacement')
        __getLastEditor()!.setModel(monacoEditor.createModel(expected));
      else {
        __getLastEditor()!
          .getModel()!
          .setValue(AFTER + '\n作者的新稿');
        if (mode === 'typing-undo') __getLastEditor()!.getModel()!.setValue(AFTER);
      }
    });
    await click('toast-action');
    if (mode === 'model-replacement')
      await observe(() =>
        expect(host.querySelector('[data-testid="toast-action-error"]')).not.toBeNull(),
      );
    else if (mode === 'typing-undo')
      await observe(() => expect(host.querySelector('[data-testid="toast-action"]')).toBeNull());
    else await observe(() => expect(host.textContent).toContain('一键撤销会吃掉新内容'));
    expect(__getLastEditor()!.getValue()).toBe(expected);
    expect(files.get(FILE)).toBe(BEFORE);
    expect(native).toHaveBeenCalledOnce();
    expect(writes.filter((path) => path === FILE)).toHaveLength(2);
  },
);
