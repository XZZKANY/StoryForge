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
    revise: vi.fn(async () => undefined),
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
    assert.equal(container.querySelector('[data-testid="knowledge-inbox-count"]')?.textContent, '1');
    assert.match(container.textContent ?? '', /天枢不可移动/);
    const review = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('审阅'),
    );
    assert.ok(review);
    await act(async () => review.click());
    assert.equal(vi.mocked(inbox.materialize).mock.calls.length, 1);
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
    assert.equal(container.querySelector('[data-testid="activity-knowledge-badge"]')?.textContent, '3');
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
