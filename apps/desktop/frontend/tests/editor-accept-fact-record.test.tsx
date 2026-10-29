/** 接受整份补丁之后才记账（和连载计划标「已写」挂在同一层），并把发起这次写回的运行交过去。 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { Editor } from '../src/components/Editor';
import {
  emitFileSuggestion,
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
} from '../src/lib/assistant-events';

const effects = vi.hoisted(() => ({
  snapshot: vi.fn(async () => ({ timestamp: 1, created: false })),
  record: vi.fn(async () => ({ recordPath: null, updatedBlueprintPath: null })),
  mark: vi.fn(async () => null),
  facts: vi.fn(async () => {}),
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
vi.mock('../src/lib/fact-write', () => ({ recordAcceptedChapterFacts: effects.facts }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PROJECT = 'D:/fact-record';
const FILE = PROJECT + '/正文/第002章.md';
let files: Map<string, string>;
let root: Root;
let host: HTMLDivElement;
const dialogs = { alert: async () => {}, confirm: async () => false, prompt: async () => null };

beforeEach(() => {
  vi.clearAllMocks();
  files = new Map();
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => files.has(path),
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('file missing');
      return value;
    },
    writeFile: (path, content) => {
      files.set(path, content);
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

async function openAndPropose(runId: string | undefined, auto: boolean) {
  await act(async () =>
    root.render(
      <Editor projectPath={PROJECT} filePath={FILE} retainedFilePaths={[FILE]} dialogs={dialogs} />,
    ),
  );
  await observe(() => expect(__getLastEditor()?.getValue()).toBe(''));
  await act(async () =>
    emitFileSuggestion({
      id: 'chapter-writing-1',
      filePath: FILE,
      before: '',
      after: '第二章\n\n陈默进了城。\n',
      title: '写章',
      summary: '写章',
      note: '',
      createdAt: 1,
      requiresConfirmation: !auto,
      runId,
    }),
  );
}

it.each([false, true])('整份接受后记账，带上运行 id（auto=%s）', async (auto) => {
  await openAndPropose('run-7', auto);
  if (!auto) {
    expect(effects.facts).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT));
    });
  }
  await observe(() => expect(effects.facts).toHaveBeenCalledOnce());
  expect(files.get(FILE)).toBe('第二章\n\n陈默进了城。\n');
  expect(effects.mark).toHaveBeenCalledOnce();
  expect(effects.facts).toHaveBeenCalledWith(PROJECT, FILE, 'run-7', expect.any(Function));
});

it('写回被拦下就不记账', async () => {
  await openAndPropose('run-7', false);
  files.set(FILE, '作者在别处写了');
  await act(async () => {
    window.dispatchEvent(new CustomEvent(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT));
  });
  await observe(() => expect(host.textContent).toContain('磁盘内容已变化'));
  expect(effects.facts).not.toHaveBeenCalled();
});
