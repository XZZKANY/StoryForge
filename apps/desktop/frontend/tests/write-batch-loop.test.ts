/**
 * 批量写章调度循环：发起 → 等写进文件与事实记账落定 → 记一笔 → 问下一步。判断全交给引擎（这里是假的 next），
 * 钉住时序和每种停下：引擎说停、作者停止、没开跑、结果未知、要作者点、写进文件被拦、事实没记上、出错。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AUTHOR_STOP_MESSAGE,
  runWriteBatchLoop,
  type WriteBatchLoopDeps,
} from '../src/components/chat-window/write-batch-loop';
import type { RunAuthorAgentOutcome } from '../src/components/chat-window/types';
import type { ApiWriteBatch, ApiWriteBatchStep } from '../src/lib/api/contracts';
import type { ChapterWriteback } from '../src/lib/write-batch-writeback';

const ROOT = 'D:/book';
const write = (ordinal: number): ApiWriteBatchStep => ({
  action: 'write',
  ordinal,
  target_path: `正文/第${String(ordinal).padStart(3, '0')}章.md`,
  goal: `第${ordinal}章目标`,
});
const written = (ordinal: number, extra: Partial<ChapterWriteback> = {}): ChapterWriteback =>
  ({
    written: true,
    filePath: `${ROOT}/正文/第${String(ordinal).padStart(3, '0')}章.md`,
    snapshotVersion: `.storyforge/versions/正文/第${String(ordinal).padStart(3, '0')}章.md/checkpoints/${ordinal}.meta.json`,
    factsBefore: `.storyforge/versions/.storyforge/canon/facts.json/checkpoints/${ordinal}.meta.json`,
    factDisputes: 0,
    factsAdded: 3,
    factError: null,
    ...extra,
  }) as ChapterWriteback;
const autoProposal = (ordinal: number, runId = `run-${ordinal}`): RunAuthorAgentOutcome => ({
  kind: 'settled',
  runId,
  proposal: {
    patchId: `patch-${ordinal}`,
    filePath: `${ROOT}/正文/第${String(ordinal).padStart(3, '0')}章.md`,
    requiresConfirmation: false,
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** 一份可编排的依赖：steps 是引擎按顺序给的下一步，outcomes / writebacks 按章序给。 */
function harness(
  steps: ApiWriteBatchStep[],
  outcomes: Record<number, RunAuthorAgentOutcome>,
  writebacks: Record<string, ChapterWriteback | Promise<ChapterWriteback>> = {},
) {
  const log: string[] = [];
  let stopRequested = false;
  let alive = true;
  const batch = { id: 'write-batch-1' } as ApiWriteBatch;
  const deps: WriteBatchLoopDeps = {
    next: vi.fn(async (input) => {
      log.push(`next:${input.permissionProfile}:${input.modelKey}`);
      return steps.shift() ?? { action: 'finished' };
    }),
    record: vi.fn(async (input) => {
      log.push(`record:${input.ordinal}:${input.writtenPath ?? 'null'}`);
      return batch;
    }),
    stop: vi.fn(async (input) => {
      log.push(`stop:${input.code}`);
      return batch;
    }),
    permissionProfile: () => 'ask',
    modelKey: async () => 'model-a',
    dispatch: vi.fn(async (step, position) => {
      log.push(`dispatch:${step.ordinal}:${position.index}/${position.total}`);
      return outcomes[step.ordinal];
    }),
    awaitWriteback: vi.fn(async (runId) => {
      log.push(`await:${runId}`);
      const result = await writebacks[runId];
      log.push(`settled:${runId}`);
      return result;
    }),
    total: 3,
    stopRequested: () => stopRequested,
    alive: () => alive,
    onLeaveChapter: vi.fn((path) => log.push(`leave:${path.split('/').pop()}`)),
  };
  return {
    deps,
    log,
    requestStop: () => (stopRequested = true),
    abandon: () => (alive = false),
  };
}

describe('runWriteBatchLoop', () => {
  it('一章接一章：等写进文件、记账落定才记一笔，记完才问下一步；最后一章的页签留着', async () => {
    const { deps, log } = harness(
      [write(4), write(5), write(6), { action: 'finished' }],
      { 4: autoProposal(4), 5: autoProposal(5), 6: autoProposal(6) },
      { 'run-4': written(4), 'run-5': written(5, { factDisputes: 0 }), 'run-6': written(6) },
    );
    await expect(runWriteBatchLoop(deps)).resolves.toEqual({ kind: 'ended', error: null });
    expect(log).toEqual([
      'next:ask:model-a',
      'dispatch:4:1/3',
      'await:run-4',
      'settled:run-4',
      `record:4:${ROOT}/正文/第004章.md`,
      'next:ask:model-a',
      'leave:第004章.md',
      'dispatch:5:2/3',
      'await:run-5',
      'settled:run-5',
      `record:5:${ROOT}/正文/第005章.md`,
      'next:ask:model-a',
      'leave:第005章.md',
      'dispatch:6:3/3',
      'await:run-6',
      'settled:run-6',
      `record:6:${ROOT}/正文/第006章.md`,
      'next:ask:model-a',
    ]);
    expect(deps.record).toHaveBeenNthCalledWith(1, {
      ordinal: 4,
      runId: 'run-4',
      writtenPath: `${ROOT}/正文/第004章.md`,
      snapshotVersion: '.storyforge/versions/正文/第004章.md/checkpoints/4.meta.json',
      factsBefore: '.storyforge/versions/.storyforge/canon/facts.json/checkpoints/4.meta.json',
      factDisputes: 0,
      factsAdded: 3,
    });
    expect(deps.stop).not.toHaveBeenCalled();
  });

  it('事实记账没落定前不记、不问下一步', async () => {
    const facts = deferred<ChapterWriteback>();
    const { deps, log } = harness(
      [write(4), { action: 'finished' }],
      { 4: autoProposal(4) },
      {
        'run-4': facts.promise,
      },
    );
    const done = runWriteBatchLoop(deps);
    await vi.waitFor(() => expect(log).toContain('await:run-4'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deps.record).not.toHaveBeenCalled();
    expect(deps.next).toHaveBeenCalledTimes(1);
    facts.resolve(written(4, { factDisputes: 2 }));
    await done;
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ factDisputes: 2 }));
    expect(deps.next).toHaveBeenCalledTimes(2);
  });

  it('引擎说停：不再发起', async () => {
    const { deps, log } = harness(
      [write(4), { action: 'stop', code: 'cap_reached', message: '用到上限', ordinal: 5 }],
      { 4: autoProposal(4) },
      { 'run-4': written(4) },
    );
    await expect(runWriteBatchLoop(deps)).resolves.toEqual({ kind: 'ended', error: null });
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(log.at(-1)).toBe('next:ask:model-a');
    expect(deps.onLeaveChapter).not.toHaveBeenCalled();
  });

  it('作者按了停止：这一章记完就停，不再问下一步、不再开下一章', async () => {
    const h = harness([write(4), write(5)], {
      4: { kind: 'settled', runId: 'run-4', proposal: null },
    });
    vi.mocked(h.deps.dispatch).mockImplementationOnce(async () => {
      h.requestStop();
      return { kind: 'settled', runId: 'run-4', proposal: null };
    });
    await runWriteBatchLoop(h.deps);
    expect(h.log).toEqual(['next:ask:model-a', 'record:4:null', 'stop:author_stopped']);
    expect(h.deps.stop).toHaveBeenCalledWith({
      code: 'author_stopped',
      message: AUTHOR_STOP_MESSAGE,
    });
  });

  it('问下一步时作者按了停止：引擎说写下一章也不开', async () => {
    const h = harness([write(4)], {});
    vi.mocked(h.deps.next).mockImplementationOnce(async () => {
      h.requestStop();
      return write(4);
    });
    await runWriteBatchLoop(h.deps);
    expect(h.deps.dispatch).not.toHaveBeenCalled();
    expect(h.deps.stop).toHaveBeenCalledWith(expect.objectContaining({ code: 'author_stopped' }));
  });

  it('运行失败、没交出修订：不等写进文件，直接记，交给引擎判', async () => {
    const { deps, log } = harness(
      [
        write(4),
        { action: 'stop', code: 'run_failed', message: '第 4 章的运行失败了', ordinal: 4 },
      ],
      { 4: { kind: 'settled', runId: 'run-4', proposal: null } },
    );
    await runWriteBatchLoop(deps);
    expect(deps.awaitWriteback).not.toHaveBeenCalled();
    expect(log).toEqual([
      'next:ask:model-a',
      'dispatch:4:1/3',
      'record:4:null',
      'next:ask:model-a',
    ]);
  });

  it('修订要作者点接受：不等，直接记', async () => {
    const outcome = autoProposal(4);
    if (outcome.kind === 'settled' && outcome.proposal)
      outcome.proposal.requiresConfirmation = true;
    const { deps } = harness([write(4)], { 4: outcome });
    await runWriteBatchLoop(deps);
    expect(deps.awaitWriteback).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ writtenPath: null }));
  });

  it('写进文件被保护拦下：记成没写进去', async () => {
    const { deps } = harness(
      [write(4)],
      { 4: autoProposal(4) },
      {
        'run-4': { written: false, reason: '当前文件内容已变化' },
      },
    );
    await runWriteBatchLoop(deps);
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ writtenPath: null, snapshotVersion: null, factDisputes: 0 }),
    );
  });

  it('没能开跑、结果未知：不记，停在这一章（没开跑是 run_not_started，拿不到结果算界面出错）', async () => {
    for (const [outcome, code] of [
      [{ kind: 'not_dispatched' }, 'run_not_started'],
      [{ kind: 'unsettled', runId: 'run-4' }, 'scheduler_error'],
    ] as [RunAuthorAgentOutcome, string][]) {
      const { deps } = harness([write(4), write(5)], { 4: outcome });
      await runWriteBatchLoop(deps);
      expect(deps.record).not.toHaveBeenCalled();
      expect(deps.stop).toHaveBeenCalledWith(
        expect.objectContaining({ code, message: expect.stringMatching(/^第 4 章/) }),
      );
      expect(deps.dispatch).toHaveBeenCalledTimes(1);
    }
  });

  it('正文写进去了、事实没记上：记下这一章，然后停，不带着漏掉的事实写下一章', async () => {
    const { deps, log } = harness(
      [write(4), write(5)],
      { 4: autoProposal(4) },
      {
        'run-4': written(4, { factError: 'facts.json 在记账期间被改过了' }),
      },
    );
    await runWriteBatchLoop(deps);
    expect(log.slice(-2)).toEqual([`record:4:${ROOT}/正文/第004章.md`, 'stop:scheduler_error']);
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
  });

  it('任何一步抛错：停下这一批，把原因交出去，不重试', async () => {
    const { deps } = harness([write(4)], { 4: autoProposal(4) }, { 'run-4': written(4) });
    vi.mocked(deps.record).mockRejectedValueOnce(new Error('写进的文件不是第 4 章的目标文件'));
    await expect(runWriteBatchLoop(deps)).resolves.toEqual({
      kind: 'ended',
      error: '写进的文件不是第 4 章的目标文件',
    });
    expect(deps.stop).toHaveBeenCalledWith({
      code: 'scheduler_error',
      message: '第 4 章出错停下：写进的文件不是第 4 章的目标文件',
    });
    expect(deps.next).toHaveBeenCalledTimes(1);
  });

  it('换作品或卸载：晚到的结果不记、不停，悄悄退出', async () => {
    const h = harness([write(4)], {});
    vi.mocked(h.deps.dispatch).mockImplementationOnce(async () => {
      h.abandon();
      return autoProposal(4);
    });
    await expect(runWriteBatchLoop(h.deps)).resolves.toEqual({ kind: 'abandoned' });
    expect(h.deps.record).not.toHaveBeenCalled();
    expect(h.deps.stop).not.toHaveBeenCalled();
  });
});
