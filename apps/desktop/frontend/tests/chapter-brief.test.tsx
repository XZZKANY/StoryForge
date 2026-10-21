import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
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
    const card = container.querySelector('[data-testid="chapter-brief-card"]');
    assert.match(card?.textContent ?? '', /章纲草稿/);
    assert.match(card?.textContent ?? '', /第 1 版/);
    assert.doesNotMatch(card?.textContent ?? '', /Chapter Brief|revision/);
    act(() => confirm.click());
    act(() => cancel.click());
    assert.equal(confirmed[0]?.goal, '推进冲突并留下线索');
    assert.equal(cancelled, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

// 点了开始起草、结果还没回来时，卡片要看得出在起草，也不能再点「取消」误打到随后出来的补丁上。
test('a busy chapter brief card says it is drafting and takes no further choice', () => {
  let confirmed = 0;
  let cancelled = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChapterBriefCard
        brief={brief}
        busy
        onConfirm={() => {
          confirmed += 1;
        }}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
  });
  try {
    const confirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="chapter-brief-confirm"]',
    );
    const cancel = container.querySelector<HTMLButtonElement>(
      '[data-testid="chapter-brief-cancel"]',
    );
    assert.ok(confirm && cancel);
    assert.equal(confirm.textContent, '起草中…');
    assert.equal(confirm.disabled, true);
    assert.equal(cancel.disabled, true);
    act(() => confirm.click());
    act(() => cancel.click());
    assert.equal(confirmed, 0);
    assert.equal(cancelled, 0);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

// 起草把连续性约束当既成事实；模型拿不准时会写「需核实」，作者得在卡片上看得到、改得了。
test('chapter brief card shows pov, setting and constraints one per line and submits edits', () => {
  const confirmed: ChapterBrief[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const stale = '进化点：4 点（第 5 章累计 7 点，需核实；按 4 点处理）';
  act(() => {
    root.render(
      <ChapterBriefCard
        brief={{ ...brief, continuityConstraints: ['左臂仍受伤', stale] }}
        onConfirm={(value) => confirmed.push(value)}
        onCancel={() => undefined}
      />,
    );
  });
  const field = <T extends Element>(id: string) => {
    const element = container.querySelector<T>(`[data-testid="chapter-brief-${id}"]`);
    assert.ok(element, id);
    return element;
  };
  const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(() => {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  try {
    assert.equal(field<HTMLInputElement>('pov').value, '林岚');
    assert.equal(field<HTMLInputElement>('setting').value, '港口');
    assert.equal(field<HTMLTextAreaElement>('beats').value, '见面');
    assert.equal(field<HTMLTextAreaElement>('forbidden').value, '提前揭晓身份');
    // 一条一行：条目里自带的分号不再把它拆成两条。
    const continuity = field<HTMLTextAreaElement>('continuity');
    assert.equal(continuity.value, `左臂仍受伤\n${stale}`);

    type(continuity, '左臂仍受伤\n\n进化点：7 点；随机变异池 1/3');
    type(field<HTMLInputElement>('pov'), '');
    type(field<HTMLTextAreaElement>('beats'), '见面\n交出钥匙');
    act(() => field<HTMLButtonElement>('confirm').click());

    // 作者一行里写两件事，仍算一条。
    assert.deepEqual(confirmed[0]?.continuityConstraints, [
      '左臂仍受伤',
      '进化点：7 点；随机变异池 1/3',
    ]);
    assert.deepEqual(confirmed[0]?.requiredBeats, ['见面', '交出钥匙']);
    assert.equal(confirmed[0]?.pov, '');
    assert.equal(confirmed[0]?.setting, '港口');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('brief adjustments show on the card and can be reverted one by one', () => {
  const keep = {
    planQuote: '追捕跛脚男',
    factQuote: '杨小满被押上了车。',
    adjustment: '追的是另一名跛脚男。',
    source: 'model' as const,
  };
  const drop = {
    planQuote: '周树声在码头接货',
    factQuote: '周树声已经死了。',
    adjustment: '「周树声」已死，只能是回忆或提及。',
    source: 'program' as const,
  };
  const confirmed: ChapterBrief[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChapterBriefCard
        brief={{ ...brief, factAdjustments: [keep, drop] }}
        onConfirm={(value) => confirmed.push(value)}
        onCancel={() => {}}
      />,
    );
  });
  try {
    const section = container.querySelector('[data-testid="chapter-brief-adjustments"]');
    assert.match(section?.textContent ?? '', /按已写内容调整/);
    assert.match(section?.textContent ?? '', /计划：「追捕跛脚男」 · 已写：「杨小满被押上了车。」/);
    const reverts = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="chapter-brief-adjustment-revert"]',
    );
    assert.equal(reverts.length, 2);
    act(() => reverts[1].click());
    assert.equal(container.querySelectorAll('[data-testid="chapter-brief-adjustment"]').length, 1);
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="chapter-brief-confirm"]')!.click(),
    );
    assert.deepEqual(confirmed[0]?.factAdjustments, [keep]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('the decoder keeps verified adjustments and the card hides the section without them', () => {
  const message = {
    agent_result: {
      confirmation_kind: 'chapter_brief',
      chapter_brief: {
        brief_id: brief.briefId,
        revision: 1,
        target_path: brief.targetPath,
        goal: brief.goal,
        target_chars_min: 1600,
        target_chars_max: 2600,
        fact_adjustments: [
          { plan_quote: '甲', fact_quote: '乙', adjustment: '丙', source: 'program' },
          { plan_quote: '甲', fact_quote: '乙', adjustment: '  ' },
          '坏的',
        ],
      },
    },
    plan: [],
    tool_trace: [],
  } as unknown as AgentResultMessage;
  assert.deepEqual(chapterBriefFromAgentResult(message)?.factAdjustments, [
    { planQuote: '甲', factQuote: '乙', adjustment: '丙', source: 'program' },
  ]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ChapterBriefCard brief={brief} onConfirm={() => {}} onCancel={() => {}} />);
  });
  try {
    assert.equal(container.querySelector('[data-testid="chapter-brief-adjustments"]'), null);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

// 作者 10-20：只抄了一句目标、其余全空的章纲铺满一屏「好丑」——空着的可选栏收成一行，按需展开。
test('空着的可选栏收成一行「补充…（可选）」，有内容的照常摆出来，点开后全部可填', () => {
  const sparse: ChapterBrief = {
    ...brief,
    pov: null,
    setting: '港口',
    requiredBeats: [],
    forbiddenItems: [],
    continuityConstraints: [],
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChapterBriefCard brief={sparse} onConfirm={() => undefined} onCancel={() => undefined} />,
    );
  });
  try {
    const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
    assert.ok(q('chapter-brief-setting'));
    for (const id of [
      'chapter-brief-pov',
      'chapter-brief-beats',
      'chapter-brief-forbidden',
      'chapter-brief-continuity',
    ])
      assert.equal(q(id), null, id);
    const more = q('chapter-brief-more') as HTMLButtonElement;
    assert.equal(more.textContent, '+ 补充视角、必达节拍、禁写事项、连续性约束（可选）');
    act(() => more.click());
    for (const id of [
      'chapter-brief-pov',
      'chapter-brief-beats',
      'chapter-brief-forbidden',
      'chapter-brief-continuity',
    ])
      assert.ok(q(id), id);
    assert.equal(q('chapter-brief-more'), null);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('栏位都有内容时不出「补充」入口；起草中写明在干什么', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChapterBriefCard
        brief={brief}
        busy
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
  });
  try {
    assert.equal(container.querySelector('[data-testid="chapter-brief-more"]'), null);
    const progress = container.querySelector('[data-testid="chapter-brief-progress"]');
    assert.match(progress?.textContent ?? '', /起草 → 检查 → 必要时修一次/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
