import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { ChapterBriefCard } from '../src/components/chat-window/ChapterBriefCard';
import { chapterBriefFromAgentResult } from '../src/components/chat-window/chapter-brief';
import type { ChapterBrief } from '../src/components/chat-window/types';
import type { AgentResultMessage } from '../src/lib/api-client';
import { reconstructAgentResultFromEvents } from '../src/lib/api/agent-run-events';

const brief: ChapterBrief = {
  briefId: 'chapter-brief-1',
  revision: 1,
  targetPath: '正文/第002章.md',
  chapterOrdinal: 2,
  chapterTitle: '潮声',
  goal: '推进冲突',
  pov: '林岚',
  setting: '港口',
  requiredBeats: ['见面'],
  forbiddenItems: ['提前揭晓身份'],
  continuityConstraints: ['左臂仍受伤'],
  targetCharsMin: 1600,
  targetCharsMax: 2600,
};

test('chapter brief decoder validates the confirmation payload', () => {
  const message = {
    agent_result: {
      confirmation_kind: 'chapter_brief',
      chapter_brief: {
        brief_id: brief.briefId,
        revision: brief.revision,
        target_path: brief.targetPath,
        chapter_ordinal: brief.chapterOrdinal,
        chapter_title: brief.chapterTitle,
        goal: brief.goal,
        pov: brief.pov,
        setting: brief.setting,
        required_beats: brief.requiredBeats,
        forbidden_items: brief.forbiddenItems,
        continuity_constraints: brief.continuityConstraints,
        target_chars_min: brief.targetCharsMin,
        target_chars_max: brief.targetCharsMax,
      },
    },
    plan: [],
    tool_trace: [],
  } as unknown as AgentResultMessage;
  assert.deepEqual(chapterBriefFromAgentResult(message), brief);
  message.agent_result.chapter_brief.revision = 0;
  assert.equal(chapterBriefFromAgentResult(message), null);
});

test('F10 reconstructs a pending chapter brief after the SSE stream is lost', () => {
  const reconstructed = reconstructAgentResultFromEvents(
    [
      {
        event_type: 'permission_required',
        payload: {
          assistant_session_id: 7,
          intent: 'chapter.write',
          summary: '等待确认',
          requires_user_confirmation: true,
          confirmation_kind: 'chapter_brief',
          chapter_brief: {
            brief_id: brief.briefId,
            revision: brief.revision,
            target_path: brief.targetPath,
            goal: brief.goal,
            target_chars_min: brief.targetCharsMin,
            target_chars_max: brief.targetCharsMax,
          },
        },
      },
    ],
    { sessionId: 'session-1', runId: 'run-1' },
  );
  assert.ok(reconstructed && reconstructed.type === 'agent_result');
  assert.deepEqual(chapterBriefFromAgentResult(reconstructed), {
    ...brief,
    chapterOrdinal: null,
    chapterTitle: null,
    pov: null,
    setting: null,
    requiredBeats: [],
    forbiddenItems: [],
    continuityConstraints: [],
  });
});

test('chapter brief card submits edited fields and can cancel', () => {
  const confirmed: ChapterBrief[] = [];
  let cancelled = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChapterBriefCard
        brief={brief}
        onConfirm={(value) => confirmed.push(value)}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
  });
  try {
    const goal = container.querySelector<HTMLTextAreaElement>('[data-testid="chapter-brief-goal"]');
    assert.ok(goal);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      assert.ok(setter);
      setter.call(goal, '推进冲突并留下线索');
      goal.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="chapter-brief-confirm"]',
    );
    const cancel = container.querySelector<HTMLButtonElement>(
      '[data-testid="chapter-brief-cancel"]',
    );
    assert.ok(confirm && cancel);
    act(() => confirm.click());
    act(() => cancel.click());
    assert.equal(confirmed[0]?.goal, '推进冲突并留下线索');
    assert.equal(cancelled, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('chapter brief 请求确认期间锁定编辑字段和动作，避免重复恢复', () => {
  const html = renderToStaticMarkup(
    <ChapterBriefCard brief={brief} busy onConfirm={() => undefined} onCancel={() => undefined} />,
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  assert.equal(
    host.querySelector('[data-testid="chapter-brief-card"]')?.getAttribute('aria-busy'),
    'true',
  );
  assert.equal(
    host.querySelector<HTMLTextAreaElement>('[data-testid="chapter-brief-goal"]')?.disabled,
    true,
  );
  assert.equal(
    host.querySelector<HTMLButtonElement>('[data-testid="chapter-brief-confirm"]')?.disabled,
    true,
  );
  assert.equal(
    host.querySelector<HTMLButtonElement>('[data-testid="chapter-brief-cancel"]')?.disabled,
    true,
  );
});

test('chapter brief 出现时聚焦目标字段，Escape 取消确认', () => {
  let cancelled = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChapterBriefCard
        brief={brief}
        onConfirm={() => undefined}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
  });
  try {
    const goal = container.querySelector<HTMLTextAreaElement>('[data-testid="chapter-brief-goal"]');
    assert.ok(goal);
    assert.equal(document.activeElement, goal);
    act(() => goal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(cancelled, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('chapter brief 卸载时把焦点还给打开前的控件', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const openerHost = document.createElement('div');
  document.body.appendChild(openerHost);
  const opener = document.createElement('button');
  opener.type = 'button';
  opener.textContent = '打开确认';
  openerHost.appendChild(opener);
  opener.focus();
  act(() => {
    root.render(
      <ChapterBriefCard brief={brief} onConfirm={() => undefined} onCancel={() => undefined} />,
    );
  });
  try {
    assert.equal(
      document.activeElement,
      container.querySelector('[data-testid="chapter-brief-goal"]'),
    );
    act(() => root.render(null));
    assert.equal(document.activeElement, opener);
  } finally {
    act(() => root.unmount());
    container.remove();
    openerHost.remove();
  }
});
