import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type {
  ApiKnowledgeProposalGroup,
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalItem,
  ApiKnowledgeProposalPatch,
} from '../src/lib/api/contracts';
import {
  materializeKnowledgeProposal,
  refreshKnowledgeProposals,
  resolveKnowledgeProposal,
  reviseKnowledgeProposalGroup,
} from '../src/lib/api/knowledge-proposals';
import { useKnowledgeInbox } from '../src/components/app/useKnowledgeInbox';
import { KnowledgeInboxView } from '../src/components/shell/KnowledgeInboxView';

vi.mock('../src/lib/api/knowledge-proposals', () => ({
  materializeKnowledgeProposal: vi.fn(),
  refreshKnowledgeProposals: vi.fn(),
  resolveKnowledgeProposal: vi.fn(),
  reviseKnowledgeProposalGroup: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projectRoot = 'D:/Book';
const proposal = (proposalId: string): ApiKnowledgeProposalItem => ({
  proposal_id: proposalId,
  knowledge_id: `knowledge-${proposalId}`,
  target_path: `设定/${proposalId}.md`,
  operation: 'create',
  title: proposalId,
  claim: proposalId,
  kind: 'world_rule',
  confidence: 'project_observed',
  sources: [],
  related_knowledge_ids: [],
  reason: '',
  claim_fingerprint: `fingerprint-${proposalId}`,
  state: 'pending',
});

const group: ApiKnowledgeProposalGroup = {
  artifact_id: 7,
  proposal_group_id: 'group-1',
  run_id: 'run-1',
  revision: 1,
  state: 'pending',
  created_at: '2026-08-03T10:00:00Z',
  proposals: [proposal('A'), proposal('B')],
};

const patch = (proposalId: string): ApiKnowledgeProposalPatch => ({
  id: `patch-${proposalId}`,
  artifact_id: group.artifact_id,
  kind: 'project_knowledge',
  patch_class: 'project_knowledge',
  proposal_id: proposalId,
  proposal_revision: group.revision,
  knowledge_id: `knowledge-${proposalId}`,
  author_confirmation_event_id: `event-${proposalId}`,
  file_path: `${projectRoot}/设定/${proposalId}.md`,
  relative_path: `设定/${proposalId}.md`,
  before: '',
  after: proposalId,
  baseline_hash: `hash-${proposalId}`,
  requires_confirmation: true,
  created_by_tool: 'knowledge.propose',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

let latest: ReturnType<typeof useKnowledgeInbox> | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

function Harness({ showView = false }: { showView?: boolean }) {
  latest = useKnowledgeInbox(projectRoot);
  if (showView) return <KnowledgeInboxView handle={latest} />;
  return <output data-testid="review-proposal">{latest.reviewPatch?.proposal_id ?? ''}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(refreshKnowledgeProposals).mockResolvedValue({ items: [group], pending_count: 2 });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  vi.resetAllMocks();
  vi.useRealTimers();
});

test('旧拒绝请求晚返回时不会清掉后来打开的预览', async () => {
  const materializeA = deferred<ApiKnowledgeProposalPatch>();
  const materializeB = deferred<ApiKnowledgeProposalPatch>();
  const rejectA = deferred<ApiKnowledgeProposalInbox>();
  vi.mocked(materializeKnowledgeProposal).mockImplementation(({ proposalId }) =>
    proposalId === 'A' ? materializeA.promise : materializeB.promise,
  );
  vi.mocked(resolveKnowledgeProposal).mockReturnValue(rejectA.promise);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness />);
    await Promise.resolve();
  });

  await act(async () => {
    const firstReview = latest!.materialize(group, group.proposals[0]!);
    materializeA.resolve(patch('A'));
    await firstReview;
  });
  assert.equal(container.querySelector('[data-testid="review-proposal"]')?.textContent, 'A');

  let rejectPromise!: Promise<void>;
  let secondReview!: Promise<void>;
  await act(async () => {
    rejectPromise = latest!.reject(group, group.proposals[0]!);
    secondReview = latest!.materialize(group, group.proposals[1]!);
  });
  await act(async () => {
    materializeB.resolve(patch('B'));
    await secondReview;
  });
  assert.equal(container.querySelector('[data-testid="review-proposal"]')?.textContent, 'B');

  await act(async () => {
    rejectA.resolve({ items: [{ ...group, proposals: [group.proposals[1]!] }], pending_count: 1 });
    await rejectPromise;
  });
  assert.equal(container.querySelector('[data-testid="review-proposal"]')?.textContent, 'B');
});

async function mountInboxEditor() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<Harness showView />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const edit = container.querySelector<HTMLButtonElement>('[data-testid="knowledge-edit"]');
  assert.ok(edit);
  act(() => edit.click());
  const title = container.querySelector<HTMLInputElement>('[data-testid="knowledge-editor-title"]');
  assert.ok(title);
  changeTitle(title, '作者尚未保存的新设定');
  const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === '保存修改',
  );
  assert.ok(save);
  return { title, save };
}

for (const cause of [new Error('版本已变化，请重试'), '服务暂时不可用']) {
  test(`知识提议保存失败保留草稿，成功重试才关闭：${String(cause)}`, async () => {
    vi.mocked(reviseKnowledgeProposalGroup).mockRejectedValueOnce(cause);
    const { title, save } = await mountInboxEditor();
    save.focus();
    await act(async () => save.click());

    assert.equal(vi.mocked(reviseKnowledgeProposalGroup).mock.calls.length, 1);
    assert.equal(
      vi.mocked(reviseKnowledgeProposalGroup).mock.calls[0]?.[0].proposals[0]?.title,
      '作者尚未保存的新设定',
    );
    assert.equal(title.isConnected, true, '保存失败后不能卸载编辑器或丢弃草稿');
    assert.equal(title.value, '作者尚未保存的新设定');
    assert.match(container?.textContent ?? '', /版本已变化，请重试|服务暂时不可用/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    assert.equal(document.activeElement, save, '保存失败不应把焦点移到已隐藏的编辑入口');

    vi.mocked(reviseKnowledgeProposalGroup).mockResolvedValueOnce({
      items: [
        {
          ...group,
          revision: 2,
          proposals: [{ ...group.proposals[0]!, title: title.value }, group.proposals[1]!],
        },
      ],
      pending_count: 2,
    });
    await act(async () => save.click());
    assert.equal(vi.mocked(reviseKnowledgeProposalGroup).mock.calls.length, 2);
    assert.equal(
      vi.mocked(reviseKnowledgeProposalGroup).mock.calls[1]?.[0].proposals[0]?.title,
      '作者尚未保存的新设定',
    );
    assert.equal(title.isConnected, false, '成功保存才退出编辑态');
    assert.equal(latest?.error, '');
    assert.match(container?.textContent ?? '', /作者尚未保存的新设定/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    assert.equal(document.activeElement?.getAttribute('data-testid'), 'knowledge-edit');
  });
}

function changeTitle(title: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setValue);
  act(() => {
    setValue.call(title, value);
    title.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

for (const action of ['切换提议', '继续输入', '取消后重新编辑'] as const) {
  test(`旧保存成功不能关闭当前草稿或抢焦点：${action}`, async () => {
    const saving = deferred<ApiKnowledgeProposalInbox>();
    vi.mocked(reviseKnowledgeProposalGroup).mockReturnValue(saving.promise);
    const { save } = await mountInboxEditor();
    await act(async () => save.click());
    assert.equal(vi.mocked(reviseKnowledgeProposalGroup).mock.calls.length, 1);

    if (action === '取消后重新编辑') {
      const cancel = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === '取消',
      );
      assert.ok(cancel);
      act(() => cancel.click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
    }
    if (action !== '继续输入') {
      const id = action === '切换提议' ? 'B' : 'A';
      const edit = container!.querySelector<HTMLButtonElement>(
        `[data-testid="knowledge-edit"][data-proposal-id="${id}"]`,
      );
      assert.ok(edit);
      act(() => edit.click());
    }
    const currentTitle = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-editor-title"]',
    );
    assert.ok(currentTitle);
    changeTitle(currentTitle, '后来输入的草稿不能丢');
    currentTitle.focus();
    await act(async () => {
      saving.resolve({ items: [{ ...group, revision: 2 }], pending_count: 2 });
    });
    assert.equal(currentTitle.isConnected, true, '旧保存结果不得清除当前编辑会话/新输入');
    assert.equal(currentTitle.value, '后来输入的草稿不能丢');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    assert.equal(document.activeElement === currentTitle, true, '旧保存结果不得将焦点拉回旧入口');
  });
}

for (const timing of ['返回前', '回焦点帧前']) {
  test(`保存成功不抢走外部控件焦点：${timing}`, async () => {
    const saving = deferred<ApiKnowledgeProposalInbox>();
    vi.mocked(reviseKnowledgeProposalGroup).mockReturnValue(saving.promise);
    const { title, save } = await mountInboxEditor();
    const outside = document.createElement('button');
    outside.textContent = '外部焦点入口';
    document.body.appendChild(outside);
    try {
      save.focus();
      await act(async () => save.click());
      if (timing === '返回前') outside.focus();
      await act(async () => {
        saving.resolve({ items: [group], pending_count: 2 });
      });
      assert.equal(title.isConnected, false, '原草稿保存成功仍应退出编辑态');
      if (timing === '回焦点帧前') outside.focus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      assert.equal(document.activeElement === outside, true, '保存成功不应覆盖作者显式移动的焦点');
    } finally {
      outside.remove();
    }
  });
}

for (const outcome of ['成功', '失败']) {
  test(`保存中即时防重并反馈状态，${outcome}后结束忙碌`, async () => {
    const saving = deferred<ApiKnowledgeProposalInbox>();
    vi.mocked(reviseKnowledgeProposalGroup).mockReturnValue(saving.promise);
    const { title, save } = await mountInboxEditor();
    save.focus();
    act(() => {
      save.click();
      save.click();
    });
    assert.equal(
      vi.mocked(reviseKnowledgeProposalGroup).mock.calls.length,
      1,
      '同一帧连点保存只能发出一次请求',
    );
    assert.equal(save.disabled, true);
    assert.match(save.textContent ?? '', /保存中/);
    assert.equal(
      container!.querySelector('[aria-label="编辑知识提议"]')?.getAttribute('aria-busy'),
      'true',
    );
    assert.match(
      container!.querySelector('[role="status"]')?.textContent ?? '',
      /正在保存知识提议/,
    );
    assert.equal(title.disabled, false, '保存中的后续输入仍然可编辑并由草稿身份保护');

    await act(async () => {
      if (outcome === '成功') saving.resolve({ items: [group], pending_count: 2 });
      else saving.reject(new Error('暂时不可用，请重试'));
    });
    if (outcome === '成功') {
      assert.equal(title.isConnected, false);
    } else {
      assert.equal(title.isConnected, true);
      assert.equal(save.disabled, false);
      assert.match(save.textContent ?? '', /保存修改/);
      assert.equal(
        container!.querySelector('[aria-label="编辑知识提议"]')?.getAttribute('aria-busy'),
        'false',
      );
      vi.mocked(reviseKnowledgeProposalGroup).mockResolvedValueOnce({
        items: [group],
        pending_count: 2,
      });
      await act(async () => save.click());
      assert.equal(vi.mocked(reviseKnowledgeProposalGroup).mock.calls.length, 2);
      assert.equal(title.isConnected, false, '失败后释放防重状态，允许成功重试');
    }
  });
}

for (const failure of [false, true]) {
  for (const newerFinished of [false, true]) {
    test(`审阅按作者最后选择呈现：旧失败=${failure}，新完成=${newerFinished}`, async () => {
      const first = deferred<ApiKnowledgeProposalPatch>();
      const second = deferred<ApiKnowledgeProposalPatch>();
      vi.mocked(materializeKnowledgeProposal)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => root?.render(<Harness />));
      let one!: Promise<void>;
      let two!: Promise<void>;
      await act(async () => {
        one = latest!.materialize(group, group.proposals[0]!);
      });
      await act(async () => {
        two = latest!.materialize(group, group.proposals[1]!);
      });
      if (newerFinished)
        await act(async () => {
          second.resolve(patch('B'));
          await two;
        });
      await act(async () => {
        if (failure) first.reject(new Error('旧预览失败'));
        else first.resolve(patch('A'));
        await one;
      });
      assert.equal(latest!.reviewPatch?.proposal_id ?? null, newerFinished ? 'B' : null);
      assert.equal(latest!.error, '');
      assert.equal(latest!.busyProposalId, newerFinished ? null : 'B');
      if (!newerFinished)
        await act(async () => {
          second.resolve(patch('B'));
          await two;
        });
      assert.equal(latest!.reviewPatch?.proposal_id, 'B');
    });
  }
  test(`关闭预览后旧请求不重开或报错：失败=${failure}`, async () => {
    const pending = deferred<ApiKnowledgeProposalPatch>();
    vi.mocked(materializeKnowledgeProposal)
      .mockResolvedValueOnce(patch('A'))
      .mockReturnValueOnce(pending.promise);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Harness />));
    await act(async () => {
      await latest!.materialize(group, group.proposals[0]!);
    });
    let request!: Promise<void>;
    await act(async () => {
      request = latest!.materialize(group, group.proposals[1]!);
    });
    act(() => latest!.clearReview());
    await act(async () => {
      if (failure) pending.reject(new Error('已关闭预览的错误'));
      else pending.resolve(patch('B'));
      await request;
    });
    assert.equal(latest!.reviewPatch, null);
    assert.equal(latest!.error, '');
    assert.equal(latest!.busyProposalId, null);
  });
}
