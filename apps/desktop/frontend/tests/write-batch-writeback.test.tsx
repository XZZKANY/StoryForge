/**
 * 批量写章的交接口：编辑器接受整份写章修订、事实记账落定后交结果，调度器按运行 id 等。
 * 钉住：记账没落定前调度器等不到；写前快照、记账前的台账版本、对不上的条数原样交出去；被拦下交原因。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { Editor } from '../src/components/editor/Editor';
import { emitFileSuggestion } from '../src/lib/assistant-events';
import {
  awaitChapterWriteback,
  ChapterWritebackAbortedError,
  reportChapterWriteback,
  type ChapterWriteback,
} from '../src/lib/write-batch-writeback';
import type { AcceptedChapterFacts } from '../src/lib/fact-write';

const PROJECT = 'D:/batch-book';
const FILE = PROJECT + '/正文/第004章.md';
const SNAPSHOT = PROJECT + '/.storyforge/versions/正文/第004章.md/checkpoints/11.meta.json';
const LEDGER =
  PROJECT + '/.storyforge/versions/.storyforge/canon/facts.json/checkpoints/12.meta.json';

const effects = vi.hoisted(() => ({
  snapshot: vi.fn(),
  record: vi.fn(async () => ({ recordPath: null, updatedBlueprintPath: null })),
  mark: vi.fn(async () => null),
  facts: vi.fn(),
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

describe('交接口', () => {
  it('先交后等、先等后交，都拿得到；同一次运行以后交的为准', async () => {
    reportChapterWriteback('run-a', { written: false, reason: '先交的' });
    reportChapterWriteback('run-a', { written: false, reason: '后交的' });
    await expect(awaitChapterWriteback('run-a', { timeoutMs: 1000 })).resolves.toEqual({
      written: false,
      reason: '后交的',
    });
    const waiting = awaitChapterWriteback('run-b', { timeoutMs: 1000 });
    reportChapterWriteback('run-b', Promise.resolve({ written: false, reason: '后到' }));
    await expect(waiting).resolves.toEqual({ written: false, reason: '后到' });
  });

  it('等太久当没写进去；中止就抛', async () => {
    await expect(awaitChapterWriteback('run-c', { timeoutMs: 10 })).resolves.toMatchObject({
      written: false,
    });
    const controller = new AbortController();
    const waiting = awaitChapterWriteback('run-d', { timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(ChapterWritebackAbortedError);
  });
});

describe('编辑器接受写章修订后交结果', () => {
  let files: Map<string, string>;
  let root: Root;
  let host: HTMLDivElement;
  const dialogs = { alert: async () => {}, confirm: async () => false, prompt: async () => null };

  beforeEach(() => {
    vi.clearAllMocks();
    effects.snapshot.mockResolvedValue({ path: SNAPSHOT, timestamp: 11, created: true });
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

  async function proposeAuto(runId: string) {
    await act(async () =>
      root.render(
        <Editor
          projectPath={PROJECT}
          filePath={FILE}
          retainedFilePaths={[FILE]}
          dialogs={dialogs}
        />,
      ),
    );
    await observe(() => expect(__getLastEditor()?.getValue()).toBe(''));
    await act(async () =>
      emitFileSuggestion({
        id: `patch-${runId}`,
        filePath: FILE,
        before: '',
        after: '第四章\n\n潮水退了。\n',
        title: '写章',
        summary: '写章',
        note: '',
        createdAt: 1,
        requiresConfirmation: false,
        runId,
      }),
    );
  }

  it('记账落定前等不到；落定后交出写前快照、台账版本与对不上的条数', async () => {
    let settleFacts!: (value: AcceptedChapterFacts) => void;
    effects.facts.mockReturnValue(
      new Promise<AcceptedChapterFacts>((resolve) => (settleFacts = resolve)),
    );
    let result: ChapterWriteback | null = null;
    const waiting = awaitChapterWriteback('run-9', { timeoutMs: 10_000 }).then(
      (value) => (result = value),
    );
    await proposeAuto('run-9');
    await observe(() => expect(effects.facts).toHaveBeenCalledOnce());
    expect(files.get(FILE)).toBe('第四章\n\n潮水退了。\n');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result).toBeNull();
    settleFacts({ snapshotPath: LEDGER, disputes: 1, error: null });
    await waiting;
    expect(result).toEqual({
      written: true,
      filePath: FILE,
      snapshotVersion: '.storyforge/versions/正文/第004章.md/checkpoints/11.meta.json',
      factsBefore: '.storyforge/versions/.storyforge/canon/facts.json/checkpoints/12.meta.json',
      factDisputes: 1,
      factError: null,
    });
  });

  it('写进文件前的保护拦下：交原因，不记账', async () => {
    effects.snapshot.mockRejectedValue(new Error('快照没拍成'));
    const waiting = awaitChapterWriteback('run-10', { timeoutMs: 10_000 });
    await proposeAuto('run-10');
    await expect(waiting).resolves.toEqual({ written: false, reason: '快照没拍成' });
    expect(effects.facts).not.toHaveBeenCalled();
    expect(files.has(FILE)).toBe(false);
  });
});
