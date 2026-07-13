import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  APPLY_FILE_SUGGESTION_EVENT,
  AUTHOR_LOOP_RESULT_EVENT,
  EXPORT_CURRENT_FILE_EVENT,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  REVIEW_ISSUES_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
  SUGGESTION_RESULT_EVENT,
  emitAuthorLoopResult,
  emitFileSuggestion,
  emitReviewIssues,
  emitSuggestionResult,
  flushActiveEditorToDisk,
  takePendingFileSuggestion,
} from '../../src/lib/assistant-events';
import type { AssistantFileSuggestion } from '../../src/lib/assistant-suggestions';
import {
  isAgentControlAckMessage,
  isAgentErrorMessage,
  isAgentPermissionRequiredMessage,
  isAgentResultMessage,
  isAgentRunStartedMessage,
  isAgentStepEventMessage,
  isAgentToolTraceEventMessage,
} from '../../src/lib/api/agent-socket';
import { reconstructAgentResultFromEvents } from '../../src/lib/api/agent-run-events';

// 契约金测：钉死新桌面壳子必须继续对接的接缝。壳子在重做，但这些是稳定接口——
// ①DOM CustomEvent 桥（编辑器 ↔ 对话协调）②Agent 消息守卫（SSE/control 帧解码）③F10 中止流重建。
// 任一漂移 → 红。测的是稳定接口模块本身，不碰在改的 UI 组件（ChatWindow/Editor/App）。

afterEach(() => {
  // 领空 emitFileSuggestion 的模块级缓冲，避免用例间串味。
  takePendingFileSuggestion('__drain__');
  vi.useRealTimers();
});

function makeSuggestion(filePath: string): AssistantFileSuggestion {
  return {
    id: 'sug-1',
    filePath,
    title: '加强紧张感',
    summary: '',
    before: '旧',
    after: '新',
    note: '',
    createdAt: 0,
  };
}

describe('DOM CustomEvent 桥事件名（壳子重连时的字符串常量契约）', () => {
  it('八个事件名固定不变——改名即断开编辑器与对话的所有协调', () => {
    expect(EXPORT_CURRENT_FILE_EVENT).toBe('storyforge:export-current-file');
    expect(APPLY_FILE_SUGGESTION_EVENT).toBe('storyforge:apply-file-suggestion');
    expect(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT).toBe('storyforge:accept-current-file-suggestion');
    expect(SUGGESTION_RESULT_EVENT).toBe('storyforge:suggestion-result');
    expect(AUTHOR_LOOP_RESULT_EVENT).toBe('storyforge:author-loop-result');
    expect(REQUEST_SAVE_ACTIVE_FILE_EVENT).toBe('storyforge:request-save-active-file');
    expect(SAVE_ACTIVE_FILE_DONE_EVENT).toBe('storyforge:save-active-file-done');
    expect(REVIEW_ISSUES_EVENT).toBe('storyforge:review-issues');
  });
});

describe('emit → listen 明细往返（壳子监听端要拿到的 detail 形状）', () => {
  it('suggestion-result 带 filePath/status/message', () => {
    const received: unknown[] = [];
    const onEvent = (event: Event) => received.push((event as CustomEvent).detail);
    window.addEventListener(SUGGESTION_RESULT_EVENT, onEvent);
    emitSuggestionResult({ filePath: '第二章.md', status: 'ready', message: '就绪' });
    window.removeEventListener(SUGGESTION_RESULT_EVENT, onEvent);
    expect(received).toEqual([{ filePath: '第二章.md', status: 'ready', message: '就绪' }]);
  });

  it('author-loop-result 带 action/artifactPath（导出/接受修订两态）', () => {
    const received: unknown[] = [];
    const onEvent = (event: Event) => received.push((event as CustomEvent).detail);
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, onEvent);
    emitAuthorLoopResult({
      filePath: '第二章.md',
      status: 'completed',
      action: 'revision_accepted',
      message: '已写回',
      recordPath: '.storyforge/records/1.json',
    });
    window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, onEvent);
    expect(received[0]).toMatchObject({ action: 'revision_accepted', status: 'completed' });
  });

  it('review-issues 把 filePath + issues[] 一起下发给编辑器打标记', () => {
    let detail: { filePath: string; issues: unknown[] } | null = null;
    const onEvent = (event: Event) => {
      detail = (event as CustomEvent<{ filePath: string; issues: unknown[] }>).detail;
    };
    window.addEventListener(REVIEW_ISSUES_EVENT, onEvent);
    emitReviewIssues('第二章.md', [
      {
        id: 'i1',
        category: 'consistency',
        severity: 'warn',
        message: '人物动机断裂',
        evidence: '第3段',
        suggestedAction: '补一句内心戏',
      },
    ]);
    window.removeEventListener(REVIEW_ISSUES_EVENT, onEvent);
    expect(detail).not.toBeNull();
    expect(detail!.filePath).toBe('第二章.md');
    expect(detail!.issues).toHaveLength(1);
  });
});

describe('emitFileSuggestion 缓冲：目标文件尚未就绪时先存后取', () => {
  it('takePendingFileSuggestion 仅在 filePath 匹配时一次性领取', () => {
    emitFileSuggestion(makeSuggestion('第二章.md'));
    expect(takePendingFileSuggestion('别的.md')).toBeNull();
    const taken = takePendingFileSuggestion('第二章.md');
    expect(taken?.filePath).toBe('第二章.md');
    // 领取即清空——第二次拿不到。
    expect(takePendingFileSuggestion('第二章.md')).toBeNull();
  });
});

describe('flushActiveEditorToDisk：读盘前请编辑器落盘的请求/应答握手', () => {
  it('收到匹配 filePath 的 save-done 即 resolve', async () => {
    const onRequest = () => {
      window.dispatchEvent(
        new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
          detail: { filePath: '第二章.md', status: 'saved' },
        }),
      );
    };
    window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest);
    await expect(flushActiveEditorToDisk('第二章.md', 1000)).resolves.toBeUndefined();
    window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest);
  });

  it('无编辑器应答时超时拒绝，阻断后续读盘', async () => {
    vi.useFakeTimers();
    const pending = flushActiveEditorToDisk('第二章.md', 2000);
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('编辑器报告保存失败时拒绝，调用方不能继续读旧磁盘内容', async () => {
    const onRequest = () => {
      window.dispatchEvent(
        new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
          detail: { filePath: '第二章.md', status: 'error', message: '磁盘已满' },
        }),
      );
    };
    window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest);
    await expect(flushActiveEditorToDisk('第二章.md', 1000)).rejects.toMatchObject({
      reason: 'error',
      message: '磁盘已满',
    });
    window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest);
  });
});

describe('Agent 消息守卫：后端帧的判别式（agent-socket.ts isAgent*）', () => {
  it('agent_result 要 number assistant_session_id + 数组 plan/tool_trace', () => {
    const ok = {
      type: 'agent_result',
      session_id: 's',
      assistant_session_id: 7,
      intent: 'chat.explain',
      user_message: '',
      plan: [],
      agent_result: {},
      tool_trace: [],
    };
    expect(isAgentResultMessage(ok as never)).toBe(true);
    expect(isAgentResultMessage({ ...ok, assistant_session_id: '7' } as never)).toBe(false);
  });

  it('run_started/step/tool_trace/permission_required 各自判别式', () => {
    expect(isAgentRunStartedMessage({ type: 'agent_run_started', run_id: 'r' } as never)).toBe(
      true,
    );
    expect(isAgentRunStartedMessage({ type: 'agent_run_started' } as never)).toBe(false);
    expect(
      isAgentStepEventMessage({ type: 'agent_step', step: '读取', status: 'running' } as never),
    ).toBe(true);
    expect(
      isAgentToolTraceEventMessage({ type: 'tool_trace', trace: { tool_name: 'x' } } as never),
    ).toBe(true);
    expect(isAgentToolTraceEventMessage({ type: 'tool_trace', trace: null } as never)).toBe(false);
    expect(
      isAgentPermissionRequiredMessage({ type: 'permission_required', run_id: 'r' } as never),
    ).toBe(true);
    expect(isAgentErrorMessage({ type: 'error', detail: '炸了' } as never)).toBe(true);
  });

  it('控制回执守卫认映射后的 type（permission_approved）且要 status==recorded', () => {
    expect(
      isAgentControlAckMessage({ type: 'permission_approved', status: 'recorded' } as never),
    ).toBe(true);
    expect(isAgentControlAckMessage({ type: 'stop_run', status: 'recorded' } as never)).toBe(true);
    // 入站 type（approve_permission）不是回执 type——守卫必须拒。
    expect(
      isAgentControlAckMessage({ type: 'approve_permission', status: 'recorded' } as never),
    ).toBe(false);
    expect(
      isAgentControlAckMessage({ type: 'permission_approved', status: 'pending' } as never),
    ).toBe(false);
  });
});

describe('F10 断线重建：reconstructAgentResultFromEvents（终态事件 → agent_result）', () => {
  const ctx = { sessionId: 's', runId: 'r' };

  it('无终态事件返回 null（继续轮询）', () => {
    expect(
      reconstructAgentResultFromEvents([{ event_type: 'agent_step', payload: {} }], ctx),
    ).toBeNull();
  });

  it('completed 事件用 payload.assistant_session_id 重建 agent_result', () => {
    const message = reconstructAgentResultFromEvents(
      [
        {
          event_type: 'agent_run_completed',
          message: '已完成',
          payload: { assistant_session_id: 7, summary: '完成', intent: 'chat.explain' },
        },
      ],
      ctx,
    );
    expect(message).not.toBeNull();
    expect(message!.type).toBe('agent_result');
    expect((message as { assistant_session_id: number }).assistant_session_id).toBe(7);
  });

  it('failed 事件用 message 作 error.detail', () => {
    const message = reconstructAgentResultFromEvents(
      [{ event_type: 'agent_run_failed', message: '运行失败：boom', payload: {} }],
      ctx,
    );
    expect(message!.type).toBe('error');
    expect((message as { detail: string }).detail).toBe('运行失败：boom');
  });

  it('permission_required 事件带 proposed_patch → 标记待确认', () => {
    const patch = { kind: 'file_revision', file_path: '第二章.md', before: '旧', after: '新' };
    const message = reconstructAgentResultFromEvents(
      [
        {
          event_type: 'permission_required',
          payload: { assistant_session_id: 7, proposed_patch: patch },
        },
      ],
      ctx,
    );
    expect(message!.type).toBe('agent_result');
    expect((message as { proposed_patch: unknown }).proposed_patch).toEqual(patch);
    expect(
      (message as { agent_result: { requires_user_confirmation?: boolean } }).agent_result
        .requires_user_confirmation,
    ).toBe(true);
  });
});
