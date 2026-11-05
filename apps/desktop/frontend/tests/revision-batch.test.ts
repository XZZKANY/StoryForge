import { describe, expect, it, vi } from 'vitest';
import {
  parseRevisionBatchCommand,
  resolveRevisionChapters,
  revisionChapterPrompt,
  runRevisionBatchLoop,
} from '../src/components/chat-window/revision-batch';
import type { ChapterWriteback } from '../src/lib/write-batch-writeback';
import type { RunAuthorAgentOutcome } from '../src/components/chat-window/types';
const chapters = [1, 2, 3].map((ordinal) => ({
  ordinal,
  relativePath: '正文/第' + ordinal + '章.md',
  name: '第' + ordinal + '章.md',
  estimatedChars: 2000,
}));
const request = { from: 1, to: 3, instruction: '完整融入世界规则，保留关键线索' };
const written = (path: string): ChapterWriteback => ({
  written: true,
  filePath: path,
  snapshotVersion: 'snapshot',
  factsBefore: null,
  factDisputes: 0,
  factsAdded: null,
  factError: null,
});
function harness() {
  const dispatch = vi.fn(
    async (chapter: (typeof chapters)[number]): Promise<RunAuthorAgentOutcome> => ({
      kind: 'settled',
      runId: 'run-' + chapter.ordinal,
      proposal: {
        patchId: 'p-' + chapter.ordinal,
        filePath: chapter.relativePath,
        requiresConfirmation: true,
      },
    }),
  );
  return {
    chapters,
    alive: () => true,
    validate: vi.fn(async () => {}),
    dispatch,
    awaitWriteback: vi.fn(async (id: string) =>
      written(chapters[Number(id.slice(4)) - 1].relativePath),
    ),
    matchesTarget: (path: string, chapter: (typeof chapters)[number]) =>
      path === chapter.relativePath,
    progress: vi.fn(),
    saved: vi.fn(),
  };
}

describe('连续修改命令', () => {
  it.each([
    '/改 1-3 融入世界规则',
    '连续修改第1—3章，融入世界规则',
    '重写一下1-3章，能引入世界规则就引入',
    '帮我逐章润色第一至三章',
  ])('recognizes %s', (text) => {
    expect(parseRevisionBatchCommand(text)).toMatchObject({
      kind: 'range',
      request: { from: 1, to: 3 },
    });
  });
  it.each([
    '不要修改1-3章',
    '怎么修改1-3章？',
    '“重写1-3章”是示例',
    '> 修改1-3章',
    '修改1-3章可以吗',
    '请审读1-3章',
    '/写 1-3',
    '修改1-3章和5-6章',
  ])('does not dispatch %s', (text) => expect(parseRevisionBatchCommand(text)).toBeNull());
  it.each(['/改', '/改 3-1', '/改 0-2', '/改 abc'])('rejects invalid explicit command %s', (text) =>
    expect(parseRevisionBatchCommand(text)?.kind).toBe('invalid'),
  );
  it('validates all chapters before starting and keeps author requirements in every step', () => {
    expect(resolveRevisionChapters(request, chapters)).toEqual(chapters);
    expect(() => resolveRevisionChapters(request, chapters.slice(0, 2))).toThrow('第 3 章');
    expect(() => resolveRevisionChapters(request, [...chapters, chapters[1]])).toThrow('重号');
    expect(() =>
      resolveRevisionChapters(request, [
        { ...chapters[0], estimatedChars: 0 },
        ...chapters.slice(1),
      ]),
    ).toThrow('没有正文');
    expect(revisionChapterPrompt(request, chapters[1], 1, 3)).toContain(request.instruction);
    expect(revisionChapterPrompt(request, chapters[1], 1, 3)).toContain('只修改第 2 章（2/3）');
  });
});

describe('连续修改只在保存回执后推进', () => {
  it('waits for manual acceptance and does not dispatch the second chapter early', async () => {
    const deps = harness();
    let resolve!: (r: ChapterWriteback) => void;
    deps.awaitWriteback.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = runRevisionBatchLoop(deps);
    await vi.waitFor(() => expect(deps.awaitWriteback).toHaveBeenCalledOnce());
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    resolve(written(chapters[0].relativePath));
    await pending;
    expect(deps.dispatch).toHaveBeenCalledTimes(3);
    expect(deps.saved).toHaveBeenCalledTimes(3);
  });
  it.each([
    'not_dispatched',
    'unsettled',
    'no-patch',
    'wrong-target',
    'write-failed',
    'wrong-receipt',
  ])('stops on %s', async (mode) => {
    const deps = harness();
    if (mode === 'not_dispatched') deps.dispatch.mockResolvedValueOnce({ kind: 'not_dispatched' });
    if (mode === 'unsettled')
      deps.dispatch.mockResolvedValueOnce({ kind: 'unsettled', runId: 'r' });
    if (mode === 'no-patch')
      deps.dispatch.mockResolvedValueOnce({ kind: 'settled', runId: 'r', proposal: null });
    if (mode === 'wrong-target')
      deps.dispatch.mockResolvedValueOnce({
        kind: 'settled',
        runId: 'r',
        proposal: { patchId: 'p', filePath: 'other', requiresConfirmation: false },
      });
    if (mode === 'write-failed')
      deps.awaitWriteback.mockResolvedValueOnce({ written: false, reason: '磁盘冲突' });
    if (mode === 'wrong-receipt') deps.awaitWriteback.mockResolvedValueOnce(written('other'));
    await expect(runRevisionBatchLoop(deps)).rejects.toThrow();
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.saved).not.toHaveBeenCalled();
  });
  it('keeps a saved chapter counted but stops when facts fail', async () => {
    const deps = harness();
    deps.awaitWriteback.mockResolvedValueOnce({
      ...written(chapters[0].relativePath),
      factError: '记录失败',
    } as ChapterWriteback);
    await expect(runRevisionBatchLoop(deps)).rejects.toThrow('事实记录失败');
    expect(deps.saved).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
  });
  it('ignores late results after stopping or leaving the project', async () => {
    const deps = harness();
    let alive = true;
    deps.alive = () => alive;
    deps.awaitWriteback.mockImplementationOnce(async () => {
      alive = false;
      return written(chapters[0].relativePath);
    });
    await runRevisionBatchLoop(deps);
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.saved).not.toHaveBeenCalled();
  });
});

it('matches explicit chapter numbers despite reading-order gaps and rejects duplicate filenames', () => {
  const files = [chapters[0], { ...chapters[2], ordinal: 2 }];
  expect(() => resolveRevisionChapters({ ...request, from: 2, to: 2 }, files)).toThrow(
    '第 2 章不存在',
  );
  expect(resolveRevisionChapters({ ...request, from: 3, to: 3 }, files)[0]).toMatchObject({
    ordinal: 3,
    relativePath: '正文/第3章.md',
  });
  const duplicates = [
    chapters[0],
    chapters[1],
    { ...chapters[1], ordinal: 3, relativePath: '正文/卷二/第2章.md' },
  ];
  expect(() => resolveRevisionChapters({ ...request, from: 2, to: 2 }, duplicates)).toThrow('重号');
});

it('recognizes the Chinese input-method slash used by the command menu', () => {
  expect(parseRevisionBatchCommand('、改 1-3 统一要求')).toMatchObject({
    kind: 'range',
    request: { from: 1, to: 3 },
  });
});
