import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { proposalToEdit, useKnowledgeInbox } from '../src/components/app/useKnowledgeInbox';
import { KnowledgeInboxView } from '../src/components/shell/KnowledgeInboxView';
import type {
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalPatch,
} from '../src/lib/api/contracts';
import {
  materializeKnowledgeProposal,
  refreshKnowledgeProposals,
  resolveKnowledgeProposal,
  reviseKnowledgeProposalGroup,
} from '../src/lib/api/knowledge-proposals';
import { applyKnowledgePatch } from '../src/lib/project/knowledge-writeback';
import { emitToast } from '../src/lib/toast';

vi.mock('../src/lib/api/knowledge-proposals', () => ({
  materializeKnowledgeProposal: vi.fn(),
  refreshKnowledgeProposals: vi.fn(),
  resolveKnowledgeProposal: vi.fn(),
  reviseKnowledgeProposalGroup: vi.fn(),
}));
vi.mock('../src/lib/project/knowledge-writeback', () => ({ applyKnowledgePatch: vi.fn() }));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'D:/inbox-lifecycle-A';
const B = 'D:/inbox-lifecycle-B';
function inbox(project: string): ApiKnowledgeProposalInbox {
  return {
    pending_count: 1,
    items: [
      {
        artifact_id: 7,
        proposal_group_id: 'same-group',
        run_id: 'run-1',
        revision: 1,
        state: 'pending',
        created_at: '2026-09-08T00:00:00Z',
        proposals: [
          {
            proposal_id: 'same-id',
            knowledge_id: 'same-knowledge',
            target_path: '设定/规则.md',
            operation: 'create',
            title: project,
            claim: `${project} 的设定`,
            kind: 'world_rule',
            confidence: 'project_observed',
            sources: [],
            related_knowledge_ids: [],
            reason: '',
            claim_fingerprint: 'test-fingerprint',
            state: 'pending',
          },
        ],
      },
    ],
  };
}
function patch(project: string): ApiKnowledgeProposalPatch {
  return {
    id: `${project}-patch`,
    artifact_id: 7,
    kind: 'project_knowledge',
    patch_class: 'project_knowledge',
    proposal_id: 'same-id',
    proposal_revision: 1,
    knowledge_id: 'same-knowledge',
    author_confirmation_event_id: 'test-event',
    file_path: `${project}/设定/规则.md`,
    relative_path: '设定/规则.md',
    before: '',
    after: project,
    baseline_hash: 'test-hash',
    requires_confirmation: true,
    created_by_tool: 'knowledge.propose',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Handle = ReturnType<typeof useKnowledgeInbox>;
type Action = 'refresh' | 'materialize' | 'revise' | 'reject' | 'accept';
const actions: Action[] = ['refresh', 'materialize', 'revise', 'reject', 'accept'];
const groupA = inbox(A).items[0]!;
let latest: Handle;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function Harness({ project, showView = false }: { project: string | null; showView?: boolean }) {
  latest = useKnowledgeInbox(project);
  return showView ? <KnowledgeInboxView handle={latest} /> : <output>{latest.error}</output>;
}
async function render(project: string | null, showView = false) {
  await act(async () => root.render(<Harness project={project} showView={showView} />));
}
async function flushInitialRefresh() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function prepare() {
  await render(A);
  await flushInitialRefresh();
  await act(async () => latest.materialize(groupA, groupA.proposals[0]!));
}
function invoke(handle: Handle, action: Action) {
  if (action === 'refresh' || action === 'accept') return handle[action]();
  if (action === 'revise')
    return handle.revise(groupA, 'same-id', proposalToEdit(groupA.proposals[0]!));
  return handle[action](groupA, groupA.proposals[0]!);
}
function hold(action: Action) {
  const read = deferred<ApiKnowledgeProposalInbox>();
  const preview = deferred<ApiKnowledgeProposalPatch>();
  const write = deferred<'written'>();
  if (action === 'refresh') vi.mocked(refreshKnowledgeProposals).mockReturnValueOnce(read.promise);
  if (action === 'revise')
    vi.mocked(reviseKnowledgeProposalGroup).mockReturnValueOnce(read.promise);
  if (action === 'reject') vi.mocked(resolveKnowledgeProposal).mockReturnValueOnce(read.promise);
  if (action === 'materialize')
    vi.mocked(materializeKnowledgeProposal).mockReturnValueOnce(preview.promise);
  if (action === 'accept') vi.mocked(applyKnowledgePatch).mockReturnValueOnce(write.promise);
  return {
    succeed() {
      if (action === 'materialize') preview.resolve(patch('late-A'));
      else if (action === 'accept') write.resolve('written');
      else read.resolve(inbox('late-A'));
    },
    fail() {
      const error = new Error('old-project-failure');
      if (action === 'materialize') preview.reject(error);
      else if (action === 'accept') write.reject(error);
      else read.reject(error);
    },
  };
}
function visible() {
  return {
    inbox: latest.inbox,
    reviewPatch: latest.reviewPatch,
    error: latest.error,
    loading: latest.loading,
    busyProposalId: latest.busyProposalId,
  };
}
function calls() {
  return [
    refreshKnowledgeProposals,
    materializeKnowledgeProposal,
    reviseKnowledgeProposalGroup,
    resolveKnowledgeProposal,
    applyKnowledgePatch,
  ].map((fn) => vi.mocked(fn).mock.calls.length);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(refreshKnowledgeProposals).mockImplementation(async (project) => inbox(project));
  vi.mocked(materializeKnowledgeProposal).mockImplementation(async ({ projectRoot }) =>
    patch(projectRoot),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.useRealTimers();
});

test('切换项目立即隐藏旧 Inbox 和预览，不等待新项目刷新返回', async () => {
  await prepare();
  await render(B);
  assert.equal(latest.inbox.pending_count, 0);
  assert.equal(latest.reviewPatch, null);
  assert.equal(latest.error, '');
  assert.equal(latest.busyProposalId, null);
});

test('两个项目存在同名提议时，旧编辑草稿不带入新项目', async () => {
  await render(A, true);
  await flushInitialRefresh();
  const edit = container.querySelector<HTMLButtonElement>('[data-testid="knowledge-edit"]');
  assert.ok(edit);
  act(() => edit.click());
  assert.ok(container.querySelector('[data-testid="knowledge-editor-title"]'));
  await render(B, true);
  await flushInitialRefresh();
  assert.equal(
    container.querySelector('[data-testid="knowledge-editor-title"]') === null,
    true,
    '项目切换必须结束旧项目的本地编辑会话',
  );
  assert.match(container.textContent ?? '', /inbox-lifecycle-B/);
  assert.doesNotMatch(container.textContent ?? '', /inbox-lifecycle-A/);
});

for (const target of ['other', 'closed', 'returned'] as const) {
  for (const action of actions) {
    for (const outcome of ['success', 'failure']) {
      test(`${action} 旧请求${outcome}不污染项目 ${target}`, async () => {
        await prepare();
        const pending = hold(action);
        let done!: ReturnType<typeof invoke>;
        await act(async () => {
          done = invoke(latest, action);
        });
        await render(target === 'closed' ? null : B);
        await flushInitialRefresh();
        if (target === 'returned') {
          await render(A);
          await flushInitialRefresh();
        }
        const currentProject = target === 'closed' ? null : target === 'returned' ? A : B;
        const newer = deferred<ApiKnowledgeProposalPatch>();
        let nextDone: Promise<void> | undefined;
        if (currentProject) {
          vi.mocked(materializeKnowledgeProposal).mockReturnValueOnce(newer.promise);
          const group = inbox(currentProject).items[0]!;
          await act(async () => {
            nextDone = latest.materialize(group, group.proposals[0]!);
          });
        }
        const expected = visible();
        const requestsBefore = calls();
        await act(async () => {
          if (outcome === 'success') pending.succeed();
          else pending.fail();
          await done;
        });
        assert.deepEqual(visible(), expected, '旧结果/错误/finally 必须与当前项目隔离');
        assert.deepEqual(calls(), requestsBefore, '旧写回完成不能再次刷新旧项目');
        assert.equal(vi.mocked(emitToast).mock.calls.length, 0);
        if (currentProject) {
          await act(async () => {
            newer.resolve(patch(currentProject));
            await nextDone;
          });
          assert.equal(latest.reviewPatch?.file_path, patch(currentProject).file_path);
          assert.equal(latest.busyProposalId, null);
        }
      });
    }
  }
}

for (const action of actions) {
  test(`${action} 已过期回调不能启动旧项目副作用`, async () => {
    await prepare();
    const old = latest;
    await render(B);
    await flushInitialRefresh();
    await render(A);
    await flushInitialRefresh();
    const before = calls();
    const stateBefore = visible();
    await act(async () => {
      await invoke(old, action);
    });
    assert.deepEqual(calls(), before, 'A → B → A 不能重新授权第一代回调');
    assert.deepEqual(visible(), stateBefore);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`确认写回结束后的刷新等待期间切项目，不发送旧提示：${outcome}`, async () => {
    await prepare();
    const refresh = deferred<ApiKnowledgeProposalInbox>();
    vi.mocked(refreshKnowledgeProposals).mockReturnValueOnce(refresh.promise);
    vi.mocked(applyKnowledgePatch).mockResolvedValueOnce('written');
    let done!: ReturnType<Handle['accept']>;
    await act(async () => {
      done = latest.accept();
    });
    await render(B);
    await flushInitialRefresh();
    const expected = visible();
    await act(async () => {
      if (outcome === 'success') refresh.resolve(inbox(A));
      else refresh.reject(new Error('late-refresh-error'));
      await done;
    });
    assert.deepEqual(visible(), expected);
    assert.equal(vi.mocked(emitToast).mock.calls.length, 0);
  });
}

for (const action of actions) {
  test(`${action} 卸载后的回调不再启动请求`, async () => {
    await prepare();
    const old = latest;
    act(() => root.unmount());
    const before = calls();
    await act(async () => {
      await invoke(old, action);
    });
    assert.deepEqual(calls(), before);
    assert.equal(vi.mocked(emitToast).mock.calls.length, 0);
  });
}

test('过期 clearReview 回调不关闭当前项目的预览', async () => {
  await prepare();
  const old = latest;
  await render(B);
  await flushInitialRefresh();
  const groupB = inbox(B).items[0]!;
  await act(async () => latest.materialize(groupB, groupB.proposals[0]!));
  act(() => old.clearReview());
  assert.equal(latest.reviewPatch?.file_path, patch(B).file_path);
});

test('项目切换取消旧编辑器尚未执行的回焦点帧', async () => {
  await render(A, true);
  await flushInitialRefresh();
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="knowledge-edit"]')!.click());
  const cancel = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === '取消',
  );
  assert.ok(cancel);
  act(() => cancel.click());
  await render(B, true);
  await flushInitialRefresh();
  const outside = document.createElement('button');
  outside.textContent = '新项目的外部入口';
  document.body.appendChild(outside);
  try {
    outside.focus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    assert.equal(
      document.activeElement === outside,
      true,
      '旧项目的延迟回焦点不能命中新项目同名提议',
    );
  } finally {
    outside.remove();
  }
});

for (const outcome of ['success', 'failure']) {
  test(`卸载期间已确认写回${outcome}不发旧提示或后续刷新`, async () => {
    await prepare();
    const pending = hold('accept');
    let done!: ReturnType<Handle['accept']>;
    await act(async () => {
      done = latest.accept();
    });
    const before = calls();
    act(() => root.unmount());
    await act(async () => {
      if (outcome === 'success') pending.succeed();
      else pending.fail();
      assert.equal(await done, false);
    });
    assert.deepEqual(calls(), before);
    assert.equal(vi.mocked(emitToast).mock.calls.length, 0);
    assert.equal(vi.mocked(applyKnowledgePatch).mock.calls[0]?.[0], A);
  });
}

test('当前项目正常确认仍通过原写回边界并投递成功提示', async () => {
  await prepare();
  vi.mocked(applyKnowledgePatch).mockResolvedValueOnce('written');
  await act(async () => {
    assert.equal(await latest.accept(), true);
  });
  assert.deepEqual(vi.mocked(applyKnowledgePatch).mock.calls[0], [A, patch(A)]);
  assert.equal(latest.reviewPatch, null);
  assert.equal(latest.busyProposalId, null);
  assert.equal(latest.error, '');
  assert.deepEqual(vi.mocked(emitToast).mock.calls, [['知识已写入项目', { tone: 'success' }]]);
});

test('确认写回失败保留预览和确认按钮焦点', async () => {
  await render(A, true);
  await flushInitialRefresh();
  await act(async () => latest.materialize(groupA, groupA.proposals[0]!));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  vi.mocked(applyKnowledgePatch).mockRejectedValueOnce(new Error('本地文件已变化'));
  const confirm = container.querySelector<HTMLButtonElement>(
    '[data-testid="knowledge-confirm-writeback"]',
  );
  assert.ok(confirm);
  confirm.focus();
  await act(async () => confirm.click());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  assert.equal(latest.reviewPatch?.file_path, patch(A).file_path);
  assert.equal(document.activeElement === confirm, true);
  assert.match(container.textContent ?? '', /本地文件已变化/);
});

for (const sameId of [false, true]) {
  test(`旧写回成功不关闭后来打开的预览：同 ID=${sameId}`, async () => {
    await prepare();
    const pending = hold('accept');
    let done!: ReturnType<Handle['accept']>;
    await act(async () => {
      done = latest.accept();
    });
    const next = {
      ...patch(A),
      id: 'new-patch',
      proposal_id: sameId ? 'same-id' : 'other-id',
      after: '新预览',
    };
    vi.mocked(materializeKnowledgeProposal).mockResolvedValueOnce(next);
    await act(async () => latest.materialize(groupA, groupA.proposals[0]!));
    await act(async () => {
      pending.succeed();
      assert.equal(await done, true);
    });
    assert.equal(latest.reviewPatch, next);
    assert.deepEqual(vi.mocked(applyKnowledgePatch).mock.calls[0], [A, patch(A)]);
  });
}

for (const moveBeforeResult of [false, true]) {
  test(`写回成功不抢外部焦点：结果前移动=${moveBeforeResult}`, async () => {
    await render(A, true);
    await flushInitialRefresh();
    await act(async () => latest.materialize(groupA, groupA.proposals[0]!));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    const pending = hold('accept');
    const confirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-confirm-writeback"]',
    )!;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      confirm.focus();
      act(() => confirm.click());
      if (moveBeforeResult) outside.focus();
      await act(async () => {
        pending.succeed();
      });
      if (!moveBeforeResult) outside.focus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      assert.equal(latest.reviewPatch, null);
      assert.equal(document.activeElement === outside, true);
    } finally {
      outside.remove();
    }
  });
}

for (const action of ['revise', 'reject'] as const) {
  for (const readStartsFirst of [false, true]) {
    for (const readFails of [false, true]) {
      test(`${action} 成功淘汰旧刷新：刷新先启动=${readStartsFirst}，旧刷新失败=${readFails}`, async () => {
        await prepare();
        const read = deferred<ApiKnowledgeProposalInbox>();
        const change = deferred<ApiKnowledgeProposalInbox>();
        vi.mocked(refreshKnowledgeProposals).mockReturnValueOnce(read.promise);
        if (action === 'revise')
          vi.mocked(reviseKnowledgeProposalGroup).mockReturnValueOnce(change.promise);
        else vi.mocked(resolveKnowledgeProposal).mockReturnValueOnce(change.promise);
        let reading!: Promise<void>;
        let changing!: ReturnType<typeof invoke>;
        await act(async () => {
          if (readStartsFirst) reading = latest.refresh();
          changing = invoke(latest, action);
          if (!readStartsFirst) reading = latest.refresh();
        });
        const changed = inbox('操作完成后的列表');
        await act(async () => {
          change.resolve(changed);
          await changing;
        });
        assert.equal(latest.inbox, changed);

        await act(async () => {
          if (readFails) read.reject(new Error('过期刷新错误'));
          else read.resolve(inbox('操作前的旧列表'));
          await reading;
        });
        assert.equal(latest.inbox, changed);
        assert.equal(latest.error, '');
        assert.equal(latest.loading, false);
        const newest = deferred<ApiKnowledgeProposalInbox>();
        vi.mocked(refreshKnowledgeProposals).mockReturnValueOnce(newest.promise);
        let newestReading!: Promise<void>;
        await act(async () => {
          newestReading = latest.refresh();
        });
        assert.equal(latest.loading, true);
        const fresh = inbox('后续正常刷新');
        await act(async () => {
          newest.resolve(fresh);
          await newestReading;
        });
        assert.equal(latest.inbox, fresh);
        assert.equal(latest.loading, false);
      });
    }
  }
}
