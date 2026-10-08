/**
 * 实际 Editor → 提案面板 → 守卫写回 / 撤销集成回归。
 * 仅替换 Monaco 装配、HTTP、磁盘适配边界与快照服务；不是 Windows/Tauri 原生验收。
 */
import type { RevisionLoopRecord } from '../src/lib/author-loop';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { buildPatchHunks } from '../src/lib/patch-hunks';
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
it('接受第二块删除重复尾段确实应用指定变化而非误判已应用', async () => {
  const before = '甲。\n乙。\n甲。';
  const after = '\n甲。\n乙。';
  await open(before);
  await propose(before, after);
  expect(host.querySelectorAll('[data-testid="suggestion-accept-hunk"]')).toHaveLength(2);
  await click('suggestion-accept-hunk', 1);
  await settled('甲。\n乙。');
  expect(__getLastEditor()!.getValue()).toBe('甲。\n乙。');
});
it('接受首块删除换行确实应用指定变化而非误判已应用', async () => {
  const before = '甲。\n乙。\n甲。';
  const after = '甲。乙。\n甲。\n甲。';
  await open(before);
  await propose(before, after);
  expect(host.querySelectorAll('[data-testid="suggestion-accept-hunk"]').length).toBeGreaterThan(1);
  await click('suggestion-accept-hunk');
  await settled('甲。乙。\n甲。');
});

it('先接受开头插入后，剩余结尾插入仍可完整接受', async () => {
  const before = '甲。';
  const after = '甲。\n甲。\n甲。乙。';
  await open(before);
  await propose(before, after);
  expect(host.querySelectorAll('[data-testid="suggestion-accept-hunk"]')).toHaveLength(2);
  await click('suggestion-accept-hunk');
  await settled('甲。\n甲。\n甲。');
  expect(button('suggestion-accept').disabled).toBe(false);
  await click('suggestion-accept');
  await settled(after);
});

const representatives = [
  ['重复段落', '灯还亮着。\n\n灯还亮着。\n\n灯还亮着。', '灯灭了。\n\n灯还亮着。\n\n她关上门。'],
  ['中文引号', '她说：“别走。” 他没回答。灯还亮着。', '她说：“别等。” 他没回答。灯已经灭了。'],
  ['空行和尾行', '甲。\n\n乙。\n\n丙。\n', '新甲。\n\n乙。\n\n新丙。\n\n'],
  ['CRLF', '甲。\r\n\r\n乙。\r\n\r\n丙。\r\n', '新甲。\r\n\r\n乙。\r\n\r\n新丙。\r\n'],
] as const;
it.each(representatives)('%s：接受末处只改该处，撤销后完整接受', async (_name, before, after) => {
  const ops = buildPatchHunks(before, after);
  expect(ops.length).toBeGreaterThan(1);
  const selected = ops[ops.length - 1];
  const partial =
    before.slice(0, selected.originalStartOffset) +
    selected.afterText +
    before.slice(selected.originalEndOffset);
  await open(before);
  await propose(before, after);
  await click('suggestion-accept-hunk', ops.length - 1);
  await settled(partial);
  await click('toast-action');
  await observe(() => expect(files.get(FILE)).toBe(before));
  await observe(() =>
    expect(host.querySelectorAll('[data-testid="suggestion-accept-hunk"]')).toHaveLength(
      ops.length,
    ),
  );
  await click('suggestion-accept');
  await settled(after);
  expect(__getLastEditor()!.getValue()).toBe(after);
});
it.each([...representatives, ['空稿', '', '甲。\n'], ['删除全部', '甲。\n', '']] as const)(
  '%s：拒绝全部不改正文',
  async (_name, before, after) => {
    await open(before);
    await propose(before, after);
    await click('suggestion-reject');
    await click('patch-reject-confirm');
    await observe(() => expect(host.querySelector('[data-testid="patch-review"]')).toBeNull());
    expect(files.get(FILE)).toBe(before);
    expect(__getLastEditor()!.getValue()).toBe(before);
    expect(writes.filter((p) => p === FILE)).toHaveLength(0);
  },
);
