import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';

import type {
  ApiKnowledgeProposalGroup,
  ApiKnowledgeProposalPatch,
} from '../src/lib/api/contracts';
import type { KnowledgeInboxHandle } from '../src/components/app/useKnowledgeInbox';
import { ActivityBar } from '../src/components/shell/ActivityBar';
import { KnowledgeInboxView } from '../src/components/shell/KnowledgeInboxView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const group: ApiKnowledgeProposalGroup = {
  artifact_id: 7,
  proposal_group_id: 'kpg_1',
  run_id: 'run_1',
  revision: 1,
  state: 'pending',
  created_at: '2026-08-03T10:00:00Z',
  proposals: [
    {
      proposal_id: 'kpp_1',
      knowledge_id: 'pk_550e8400-e29b-41d4-a716-446655440000',
      target_path: '设定/天枢.md',
      operation: 'create',
      title: '天枢不可移动',
      claim: '天枢是固定架位。',
      kind: 'world_rule',
      confidence: 'project_observed',
      sources: [
        {
          type: 'project_file',
          path: '正文/第001章.md',
          content_sha256: `sha256:${'a'.repeat(64)}`,
        },
      ],
      related_knowledge_ids: [],
      reason: '影响后续章节。',
      claim_fingerprint: `sha256:${'b'.repeat(64)}`,
      state: 'pending',
    },
  ],
};

const patch: ApiKnowledgeProposalPatch = {
  id: 'knowledge-patch-1',
  artifact_id: 7,
  kind: 'project_knowledge',
  patch_class: 'project_knowledge',
  proposal_id: 'kpp_1',
  proposal_revision: 1,
  knowledge_id: group.proposals[0].knowledge_id,
  author_confirmation_event_id: 'ake_1',
  file_path: 'D:/Book/设定/天枢.md',
  relative_path: '设定/天枢.md',
  before: '',
  after: '<!-- storyforge-knowledge:v1 -->',
  baseline_hash: `sha256:${'c'.repeat(64)}`,
  requires_confirmation: true,
  created_by_tool: 'knowledge.propose',
};

function handle(
  reviewPatch: ApiKnowledgeProposalPatch | null = null,
  inboxGroup: ApiKnowledgeProposalGroup = group,
): KnowledgeInboxHandle {
  return {
    inbox: { items: [inboxGroup], pending_count: 1 },
    loading: false,
    busyProposalId: null,
    reviewPatch,
    error: '',
    refresh: vi.fn(async () => undefined),
    materialize: vi.fn(async () => undefined),
    revise: vi.fn(async () => true),
    reject: vi.fn(async () => undefined),
    accept: vi.fn(async () => undefined),
    clearReview: vi.fn(),
  };
}

test('Knowledge Inbox 在左栏非 modal 展示，每条独立进入审阅', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const inbox = handle();
  try {
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));

    assert.equal(container.querySelector('[role="dialog"]'), null);
    assert.equal(
      container.querySelector('[data-testid="knowledge-inbox-count"]')?.textContent,
      '1',
    );
    assert.match(container.textContent ?? '', /天枢不可移动/);
    const review = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('审阅'),
    );
    assert.ok(review);
    await act(async () => review.click());
    assert.equal(vi.mocked(inbox.materialize).mock.calls.length, 1);
    // D4 信息级层：面板标题是语义 h2，读屏按 H 跳得到。
    assert.equal(container.querySelector('h2')?.textContent, 'Knowledge Inbox');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

// D5 状态变化反馈：后台 5s 轮询 + 手动刷新会改变待处理数；刷新中必须被读屏感知。
test('Knowledge Inbox live region 播报刷新中与待处理数', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const inbox = handle();
  inbox.loading = true;
  try {
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    const live = () => container.querySelector('[data-testid="knowledge-inbox-live"]');
    assert.equal(live()?.getAttribute('role'), 'status');
    assert.match(live()?.textContent ?? '', /刷新/);

    // 刷新完成，带待处理数。
    inbox.loading = false;
    inbox.inbox = { ...inbox.inbox, pending_count: 3 };
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    assert.match(live()?.textContent ?? '', /3 条/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('知识 diff 只有显式确认按钮会调用 accept', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const inbox = handle(patch);
  try {
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    const confirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-confirm-writeback"]',
    );
    assert.ok(confirm);
    assert.equal(vi.mocked(inbox.accept).mock.calls.length, 0);
    await act(async () => confirm.click());
    assert.equal(vi.mocked(inbox.accept).mock.calls.length, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

// 破坏性口径统一：拒绝是不可撤销的终态操作，必须先经 AppDialog 确认；
// 「取消」不动任何状态，「确认」才调 reject 一次。
test('拒绝知识提案先弹确认，取消不动、确认才执行', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const inbox = handle();
  try {
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    const rejectBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-reject-kpp_1"]',
    );
    assert.ok(rejectBtn);
    await act(async () => rejectBtn.click());

    // 弹出确认弹窗，reject 尚未触发。
    const dialog = container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent ?? '', /拒绝这条知识提案/);
    assert.match(dialog.textContent ?? '', /天枢不可移动/);
    assert.equal(vi.mocked(inbox.reject).mock.calls.length, 0);

    // 取消：关掉弹窗，reject 仍不触发。
    const cancel = [...dialog.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('取消'),
    );
    assert.ok(cancel);
    await act(async () => cancel.click());
    assert.equal(container.querySelector('[role="dialog"]'), null);
    assert.equal(vi.mocked(inbox.reject).mock.calls.length, 0);

    // 再点一次「拒绝」→ 确认 → reject 恰好一次。
    await act(async () => rejectBtn.click());
    const dialog2 = container.querySelector('[role="dialog"]');
    assert.ok(dialog2);
    const confirmBtn = [...dialog2.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('拒绝提案'),
    );
    assert.ok(confirmBtn);
    await act(async () => confirmBtn.click());
    assert.equal(vi.mocked(inbox.reject).mock.calls.length, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('活动栏 Knowledge 图标显示 pending 数字 badge', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ActivityBar
          view="explorer"
          sidebarHidden={false}
          noProject={false}
          onSwitchView={() => undefined}
          onOpenSettings={() => undefined}
          knowledgePendingCount={3}
        />,
      ),
    );
    assert.equal(
      container.querySelector('[data-testid="activity-knowledge-badge"]')?.textContent,
      '3',
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('知识收件箱页签是 roving tabindex：方向键移动焦点并自动激活', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const inbox = handle();
  try {
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    const tabs = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]'));
    assert.equal(tabs().length, 4);
    // 默认「待处理」激活：只有它进 Tab 序，其余 -1。
    assert.deepEqual(
      tabs().map((el) => el.tabIndex),
      [0, -1, -1, -1],
    );

    tabs()[0].focus();
    await act(async () => {
      tabs()[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
    });
    // 焦点与选中一起移到「冲突」，roving 同步轮换 tabIndex。
    assert.equal(document.activeElement, tabs()[1]);
    assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
    assert.deepEqual(
      tabs().map((el) => el.tabIndex),
      [-1, 0, -1, -1],
    );

    await act(async () => {
      tabs()[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      );
    });
    assert.equal(tabs()[3].getAttribute('aria-selected'), 'true');

    await act(async () => {
      tabs()[3].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
    });
    // 环绕回第一项。
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('冲突页并列显示旧值、新值和双方来源，裁决前不能直接审阅', async () => {
  const conflictGroup: ApiKnowledgeProposalGroup = {
    ...group,
    state: 'conflict',
    proposals: [
      {
        ...group.proposals[0],
        state: 'conflict',
        operation: 'conflict',
        conflicts: [
          {
            knowledge_id: 'pk_550e8400-e29b-41d4-a716-446655440099',
            relative_path: '设定/天枢.md',
            title: '旧天枢规则',
            claim: '天枢可以移动。',
            status: 'active',
            evidence_state: 'current',
            sources: [{ type: 'author_statement', agent_event_id: 'ake_old' }],
          },
        ],
      },
    ],
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const inbox = handle(null, conflictGroup);
  try {
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    const conflictTab = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '冲突',
    );
    assert.ok(conflictTab);
    await act(async () => conflictTab.click());

    const comparison = container.querySelector('[data-testid="knowledge-conflict-comparison"]');
    assert.match(comparison?.textContent ?? '', /天枢可以移动/);
    assert.match(comparison?.textContent ?? '', /天枢是固定架位/);
    assert.match(comparison?.textContent ?? '', /作者声明/);
    assert.match(comparison?.textContent ?? '', /正文\/第001章\.md/);
    assert.match(container.textContent ?? '', /先编辑并选择裁决方式/);
    assert.equal(vi.mocked(inbox.materialize).mock.calls.length, 0);
    const edit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '编辑',
    );
    assert.ok(edit);
    await act(async () => edit.click());
    assert.match(container.textContent ?? '', /保留双方为争议/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('编辑保存成功才关闭编辑框；失败保留草稿不丢已输入内容', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const inbox = handle();
  inbox.revise = vi.fn(async () => false);
  try {
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    const edit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '编辑',
    );
    assert.ok(edit);
    await act(async () => edit.click());

    // 编辑态出现，输入草稿。
    const titleInput = container.querySelector<HTMLInputElement>('input[aria-label="知识标题"]');
    const claimInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="知识内容"]',
    );
    assert.ok(titleInput);
    assert.ok(claimInput);
    await act(async () => {
      // 模拟作者改标题/内容（受控组件：走 setter 路径）。
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(titleInput, '改过的标题');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(titleInput.value, '改过的标题');

    const save = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('保存修改'),
    );
    assert.ok(save);
    await act(async () => save.click());
    assert.equal(vi.mocked(inbox.revise).mock.calls.length, 1);
    // 保存失败：编辑框仍在，草稿（输入框当前值）未丢。
    assert.ok(container.querySelector('input[aria-label="知识标题"]'));
    assert.equal(
      container.querySelector<HTMLInputElement>('input[aria-label="知识标题"]')?.value,
      '改过的标题',
    );

    // 改为成功路径后再次保存：编辑框关闭，回到摘要态。
    inbox.revise = vi.fn(async () => true);
    await act(async () => root.render(<KnowledgeInboxView handle={inbox} />));
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('保存修改'))
        ?.click(),
    );
    assert.equal(container.querySelector('input[aria-label="知识标题"]'), null);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
