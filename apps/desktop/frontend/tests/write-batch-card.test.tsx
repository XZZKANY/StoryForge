/**
 * `/写 …` 批量写章确认卡：提交时不发给 AI、在对话里出卡；卡上四种状态（可开跑·有历史、试写、有不能开跑的原因、
 * 格式不对）与续写的文案和按钮；数字按「万」显示；「开始写」只把计划交给外面传进来的回调。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WriteBatchCommand } from '@storyforge/project-core';

vi.mock('../src/lib/api/write-batch', () => ({
  planWriteBatch: vi.fn(),
  // 打开作品时调度器查一次上一批：这里没有批量记录。
  recoverInterruptedWriteBatch: async () => ({ recovered: false, batch: null }),
  readWriteBatch: async () => ({
    batch: null,
    mismatches: [],
    can_resume: false,
    resume_from: null,
  }),
}));
vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));

import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import { useChatSubmission } from '../src/components/chat-window/useChatSubmission';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { RunAuthorAgent } from '../src/components/chat-window/types';
import { formatTenThousands, WriteBatchCard } from '../src/components/chat-window/WriteBatchCard';
import type { AgentPermissionProfile } from '../src/lib/agent-permission';
import type { ChapterHandoff } from '../src/lib/chapter-handoff';
import type { ApiWriteBatchChapter, ApiWriteBatchPlan } from '../src/lib/api/contracts';
import { planWriteBatch } from '../src/lib/api/write-batch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\书\\甲';
const plan = vi.mocked(planWriteBatch);
const run = vi.fn<RunAuthorAgent>(async () => undefined);
let host: HTMLDivElement;
let root: Root;

const chapter = (
  ordinal: number,
  status: ApiWriteBatchChapter['status'] = 'write',
  extra: Partial<ApiWriteBatchChapter> = {},
): ApiWriteBatchChapter => ({
  ordinal,
  target_path: `正文/第${String(ordinal).padStart(3, '0')}章.md`,
  title: `标题${ordinal}`,
  goal: `目标${ordinal}`,
  status,
  written_path: status === 'skip_written' ? `正文/第${ordinal}章.md` : null,
  ...extra,
});

function historyPlan(overrides: Partial<ApiWriteBatchPlan> = {}): ApiWriteBatchPlan {
  return {
    project_root: PROJECT,
    from: 4,
    to: 6,
    permission_profile: 'ask',
    chapters: [chapter(4, 'skip_written'), chapter(5), chapter(6)],
    blockers: [],
    can_start: true,
    basis: 'history',
    estimate: {
      chapter_count: 2,
      sample_count: 8,
      average_tokens: 62_000,
      min_tokens: 48_000,
      max_tokens: 91_000,
      estimated_calls: 3,
      unknown_calls: 2,
      estimated_tokens: 124_000,
      cap_tokens: 186_000,
    },
    note: null,
    ...overrides,
  };
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  plan.mockReset().mockResolvedValue(historyPlan());
  run.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const q = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const all = (testId: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];
const text = (testId: string) => q(testId)?.textContent ?? null;
const buttons = () =>
  [...(q('write-batch-card')?.querySelectorAll('button') ?? [])].map((button) => ({
    label: button.textContent,
    disabled: button.disabled,
  }));

async function card(
  command: WriteBatchCommand,
  {
    onStart,
    profile = 'ask',
  }: { onStart?: (plan: ApiWriteBatchPlan) => void; profile?: AgentPermissionProfile } = {},
) {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <WriteBatchCard
        command={command}
        projectPath={PROJECT}
        permissionProfile={profile}
        onStart={onStart}
        onClose={onClose}
      />,
    ),
  );
  return onClose;
}

const range = (from: number, to: number, note: string | null = null): WriteBatchCommand => ({
  kind: 'range',
  from,
  to,
  note,
});

describe('确认卡', () => {
  test('可开跑、有历史：摘要行、章列表只给跳过的章挂小标、按万的详细说明、固定说明与询问档的授权说明', async () => {
    await card(range(4, 6));
    expect(plan).toHaveBeenCalledWith({
      projectRoot: PROJECT,
      from: 4,
      to: 6,
      permissionProfile: 'ask',
    });
    expect(text('write-batch-title')).toBe('批量写第 4–6 章');
    expect(text('write-batch-summary')).toBe('要写 2 章 · 预估 12.4 万 · 上限 18.6 万');
    expect(
      all('write-batch-chapter').map((row) =>
        [...row.querySelectorAll('div, span')].map((n) => n.textContent),
      ),
    ).toEqual([
      [expect.any(String), '第 4 章《标题4》', '目标4', '已有正文，跳过'],
      [expect.any(String), '第 5 章《标题5》', '目标5'],
      [expect.any(String), '第 6 章《标题6》', '目标6'],
    ]);
    expect([...q('write-batch-estimate')!.querySelectorAll('p')].map((p) => p.textContent)).toEqual(
      [
        '按本书最近 8 章，每章平均 6.2 万（最少 4.8 万、最多 9.1 万）。',
        '其中 3 次服务商没报用量，是按字数估的；2 次没拿到用量，没算进去。',
        '这里算的是 token 数，不是钱。',
      ],
    );
    expect([...q('write-batch-notes')!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(
      [
        '写完直接写进文件，每章写进去之前都留快照，可以撤销。',
        '到了上限会把正在写的这一章写完再停，实际用量可能比上限多出一章。',
        '这一批的修订不用逐章点接受，算你这次点了开始的授权；平时的权限档位不变。',
      ],
    );
    expect(q('write-batch-blockers')).toBeNull();
    expect(q('write-batch-trial')).toBeNull();
  });

  test('没接 onStart 时「开始写」显示但禁用，带提示「下一步接上」；接了点一下把计划交出去', async () => {
    await card(range(4, 6));
    expect(buttons()).toEqual([
      { label: '取消', disabled: false },
      { label: '开始写', disabled: true },
    ]);
    const start = q('write-batch-start')!;
    expect(start.getAttribute('title')).toBe('下一步接上');
    expect(document.getElementById(start.getAttribute('aria-describedby')!)?.textContent).toBe(
      '下一步接上',
    );

    const onStart = vi.fn();
    await card(range(4, 6), { onStart });
    expect(buttons()).toEqual([
      { label: '取消', disabled: false },
      { label: '开始写', disabled: false },
    ]);
    await act(async () => q('write-batch-start')!.click());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(historyPlan());
  });

  test('只报没拿到用量时只补那一句；自动档不出授权说明；单章标题', async () => {
    plan.mockResolvedValue(
      historyPlan({
        from: 5,
        to: 5,
        permission_profile: 'auto',
        chapters: [chapter(5)],
        estimate: { ...historyPlan().estimate!, estimated_calls: 0, unknown_calls: 1 },
      }),
    );
    await card(range(5, 5), { profile: 'auto' });
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ permissionProfile: 'auto' }));
    expect(text('write-batch-title')).toBe('写第 5 章');
    expect(text('write-batch-estimate')).toContain('其中 1 次没拿到用量，没算进去。');
    expect(text('write-batch-estimate')).not.toContain('按字数估');
    expect(q('write-batch-notes')!.querySelectorAll('li')).toHaveLength(2);
  });

  test('试写：摘要说先试写哪章，显示引擎给的说明，不出预估也不说上限；后面几章标「试写后再估」', async () => {
    const note =
      '这部作品还没有写章的用量记录：这次先只写第 1 章量一量，写完按实际用量给剩下 2 章的预估，再问你一次。';
    plan.mockResolvedValue(
      historyPlan({
        from: 1,
        to: 3,
        chapters: [chapter(1), chapter(2, 'after_trial'), chapter(3, 'after_trial')],
        basis: 'trial',
        estimate: null,
        note,
      }),
    );
    await card(range(1, 3));
    expect(text('write-batch-summary')).toBe('先试写第 1 章量一量');
    expect(text('write-batch-trial')).toBe(note);
    expect(q('write-batch-estimate')).toBeNull();
    expect(
      all('write-batch-chapter').map(
        (row) => row.querySelector('[data-testid="write-batch-chapter-tag"]')?.textContent ?? null,
      ),
    ).toEqual([null, '试写后再估', '试写后再估']);
    expect([...q('write-batch-notes')!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(
      [
        '写完直接写进文件，每章写进去之前都留快照，可以撤销。',
        '这一批的修订不用逐章点接受，算你这次点了开始的授权；平时的权限档位不变。',
      ],
    );
    expect(buttons().map((button) => button.label)).toEqual(['取消', '开始写']);
  });

  test('有不能开跑的原因：逐条列出，没有「开始写」只有「关闭」，也不出预估和说明', async () => {
    const blockers: ApiWriteBatchPlan['blockers'] = [
      {
        code: 'gap_before_start',
        message: '第 2–3 章还没有正文：先写完这几章，或者从第 2 章开始写。',
        chapters: [2, 3],
      },
      { code: 'missing_goal', message: '第 5 章在连载计划里没写本章目标。', chapters: [5] },
    ];
    plan.mockResolvedValue(
      historyPlan({
        chapters: [chapter(4), chapter(5, 'write', { goal: null, title: null })],
        blockers,
        can_start: false,
      }),
    );
    const onClose = await card(range(4, 5), { onStart: vi.fn() });
    expect(text('write-batch-summary')).toBe('有 2 处要先处理');
    expect(all('write-batch-blocker').map((item) => item.textContent)).toEqual(
      blockers.map((item) => item.message),
    );
    expect(all('write-batch-chapter')[1].textContent).toContain('第 5 章计划里没写本章目标');
    expect(q('write-batch-start')).toBeNull();
    expect(q('write-batch-estimate')).toBeNull();
    expect(q('write-batch-notes')).toBeNull();
    expect(buttons()).toEqual([{ label: '关闭', disabled: false }]);
    await act(async () => q('write-batch-close')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('格式不对：显示提示和用法示例，只有「关闭」，不排计划', async () => {
    await card({ kind: 'invalid', message: '章序从 1 开始，没有第 0 章。' });
    expect(plan).not.toHaveBeenCalled();
    expect(text('write-batch-title')).toBe('格式不对');
    expect(text('write-batch-invalid')).toContain('章序从 1 开始，没有第 0 章。');
    expect(text('write-batch-invalid')).toContain('/写 4-10写第 4 到第 10 章');
    expect(buttons()).toEqual([{ label: '关闭', disabled: false }]);
  });

  test('续写上一批：只说下一步接上，只有「关闭」，不排计划', async () => {
    await card({ kind: 'resume' });
    expect(plan).not.toHaveBeenCalled();
    expect(q('write-batch-card')!.textContent).toBe('续写上一批：下一步接上关闭');
    expect(buttons()).toEqual([{ label: '关闭', disabled: false }]);
  });

  test('章多时全列在限高的列表里、卡内滚动；说明和按钮在列表外面的底部区，不随列表滚走', async () => {
    const chapters = Array.from({ length: 15 }, (_, index) => chapter(index + 1));
    plan.mockResolvedValue(historyPlan({ from: 1, to: 15, chapters }));
    await card(range(1, 15));
    const list = q('write-batch-chapters')!;
    expect(all('write-batch-chapter')).toHaveLength(15);
    expect(list.classList).toContain('max-h-44');
    expect(list.classList).toContain('overflow-y-auto');
    expect(host.textContent).not.toContain('还有');
    const footer = q('write-batch-footer')!;
    expect(footer.classList).toContain('flex-shrink-0');
    for (const id of ['write-batch-estimate', 'write-batch-notes', 'write-batch-start']) {
      expect(footer.contains(q(id)), id).toBe(true);
      expect(list.contains(q(id)), id).toBe(false);
    }
  });

  test('排计划失败时说明原因，只有「关闭」', async () => {
    plan.mockRejectedValue(new Error('读不到连载计划'));
    await card(range(1, 2));
    expect(text('write-batch-error')).toBe('排不出这一批：读不到连载计划');
    expect(buttons()).toEqual([{ label: '关闭', disabled: false }]);
  });

  test('token 按万显示，保留一位小数', () => {
    expect(formatTenThousands(62_000)).toBe('6.2');
    expect(formatTenThousands(430_000)).toBe('43.0');
    expect(formatTenThousands(651_234)).toBe('65.1');
  });
});

let api: {
  state: ReturnType<typeof useChatWindowState>;
  submission: ReturnType<typeof useChatSubmission>;
};
const HANDOFF: ChapterHandoff = {
  lastChapter: { ordinal: 3, relativePath: '正文/第003章.md' },
  next: { targetPath: '正文/第004章.md', chapterOrdinal: 4 },
  excerpt: null,
  excerptClipped: false,
  excerptSource: null,
  stalePromises: [],
};
const onOpeningDraft = vi.fn();

function Chat() {
  const state = useChatWindowState({
    projectPath: PROJECT,
    currentFile: null,
    assistantSessionId: 1,
  });
  const submission = useChatSubmission(state, run, { projectPath: PROJECT, assistantSessionId: 1 });
  api = { state, submission };
  return (
    <ChatWindowView
      state={state}
      projectPath={PROJECT}
      assistantSessionId={1}
      layoutMode="balanced"
      onSetLayoutMode={() => {}}
      onOpenObservatory={() => {}}
      observatoryAttention={false}
      agentPermissionProfile="ask"
      onAgentPermissionProfileChange={() => {}}
      handleSelectSession={() => {}}
      handleNewSession={() => {}}
      retryAssistantSessionLoad={() => {}}
      retryContextCandidates={() => {}}
      addExplicitContext={() => {}}
      togglePinnedContext={() => {}}
      handleSubmit={submission.handleSubmit}
      handleComposerSubmit={submission.handleComposerSubmit}
      userMessageHistory={submission.userMessageHistory}
      queuedMessages={submission.queuedMessages}
      onRemoveQueuedMessage={submission.removeQueuedMessage}
      conversationScope={submission.conversationScope}
      retryLastFailedRun={() => {}}
      agentRunControls={{
        onApprovePermission: () => {},
        onDenyPermission: () => {},
        onPauseRun: () => {},
        onResumeRun: () => {},
        onStopRun: () => {},
      }}
      writeBatch={submission.writeBatch}
      onCloseWriteBatch={submission.closeWriteBatch}
      opening={HANDOFF}
      onOpeningDraft={onOpeningDraft}
    />
  );
}

async function submit(value: string) {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')!.click(),
  );
}

describe('对话里提交 /写', () => {
  test('/写 4-6 不发给 AI、不进对话记录，输入框清空，下面出确认卡', async () => {
    await act(async () => root.render(<Chat />));
    await submit('/写 4-6 这几章节奏快一点');
    expect(run).not.toHaveBeenCalled();
    expect(api.state.messages).toEqual([]);
    expect(host.querySelector('textarea')!.value).toBe('');
    expect(q('write-batch-decision')).not.toBeNull();
    expect(text('write-batch-title')).toBe('批量写第 4–6 章');
    expect(q('write-batch-card')!.textContent).toContain('要求：这几章节奏快一点');
    expect(api.submission.writeBatch?.command).toEqual({
      kind: 'range',
      from: 4,
      to: 6,
      note: '这几章节奏快一点',
    });
    expect(plan).toHaveBeenCalledWith({
      projectRoot: PROJECT,
      from: 4,
      to: 6,
      permissionProfile: 'ask',
    });
    await act(async () => q('write-batch-close')!.click());
    expect(q('write-batch-decision')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  test('卡开着时别的话先不发、草稿留着；新的 /写 换一张卡', async () => {
    await act(async () => root.render(<Chat />));
    await submit('/写 0-3');
    expect(text('write-batch-title')).toBe('格式不对');
    await submit('帮我看看第三章');
    expect(run).not.toHaveBeenCalled();
    expect(host.querySelector('textarea')!.value).toBe('帮我看看第三章');
    await submit('、写 1-3');
    expect(text('write-batch-title')).toBe('批量写第 1–3 章');
    expect(host.querySelector('textarea')!.value).toBe('');
    await act(async () => q('write-batch-close')!.click());
    await submit('帮我看看第三章');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('卡开着时藏起开场的「先聊聊」「起草第 N 章」，开场的话照留；卡关掉按钮回来', async () => {
    await act(async () => root.render(<Chat />));
    const opening = () => q('partner-opening');
    expect(q('partner-opening-discuss')?.textContent).toBe('先聊聊第 4 章怎么走');
    expect(q('partner-opening-draft')?.textContent).toBe('起草第 4 章');
    await submit('/写 4-6');
    expect(q('write-batch-card')).not.toBeNull();
    expect(opening()!.textContent).toContain('第 4 章从哪儿接？');
    expect(opening()!.querySelectorAll('button')).toHaveLength(0);
    await act(async () => q('write-batch-close')!.click());
    expect(q('partner-opening-discuss')).not.toBeNull();
    await act(async () => q('partner-opening-draft')!.click());
    expect(onOpeningDraft).toHaveBeenCalledWith(HANDOFF.next);
  });

  test('AI 在跑时照现有规则先进待发，跑完才出卡，仍不发给 AI', async () => {
    await act(async () => root.render(<Chat />));
    await act(async () => api.state.setAgentBusy(true));
    await submit('/写 2');
    expect(q('write-batch-decision')).toBeNull();
    expect(api.submission.queuedMessages.map((item) => item.content)).toEqual(['/写 2']);
    await act(async () => api.state.setAgentBusy(false));
    await act(async () => Promise.resolve());
    expect(text('write-batch-title')).toBe('写第 2 章');
    expect(run).not.toHaveBeenCalled();
  });
});
