import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test } from 'vitest';

import {
  leaveSessionConfirmText,
  pendingDecisionOnLeave,
} from '../src/components/chat-window/session-switch';
import type { AgentRun, ChapterBrief } from '../src/components/chat-window/types';
import { useChatSessionContext } from '../src/components/chat-window/useChatSessionContext';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { TOAST_EVENT } from '../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const waitingRun: AgentRun = {
  id: 'run-1',
  sessionId: 's-1',
  goal: '改稿',
  status: 'waiting',
  steps: [
    {
      id: 'approval',
      title: '等待作者确认',
      tool: 'author.approval',
      status: 'waiting',
      detail: '',
      filePath: 'D:/book/正文/第001章.md',
      patchId: 'patch-1',
    },
  ],
};

const pendingBrief: ChapterBrief = {
  briefId: 'brief-1',
  revision: 1,
  targetPath: '正文/第002章.md',
  chapterOrdinal: 2,
  chapterTitle: '潮声',
  goal: '推进冲突',
  pov: null,
  setting: null,
  requiredBeats: [],
  forbiddenItems: [],
  continuityConstraints: [],
  targetCharsMin: 1600,
  targetCharsMax: 2600,
};

test('pendingDecisionOnLeave 只认补丁待确认（waiting）与章纲待确认', () => {
  assert.equal(pendingDecisionOnLeave(null, null), null);
  assert.equal(pendingDecisionOnLeave(waitingRun, null), 'patch');
  assert.equal(pendingDecisionOnLeave(null, pendingBrief), 'brief');
  assert.equal(pendingDecisionOnLeave(waitingRun, pendingBrief), 'both');
  assert.equal(pendingDecisionOnLeave({ ...waitingRun, status: 'running' }, null), null);
  assert.equal(pendingDecisionOnLeave({ ...waitingRun, status: 'paused' }, null), null);
  assert.equal(pendingDecisionOnLeave({ ...waitingRun, status: 'failed' }, null), null);
});

test('leaveSessionConfirmText 指明离开后需在编辑器 diff 里处理', () => {
  assert.match(leaveSessionConfirmText('patch', 'switch'), /未处理的修订/);
  assert.match(leaveSessionConfirmText('patch', 'switch'), /编辑器 diff/);
  assert.match(leaveSessionConfirmText('patch', 'switch'), /切换会话/);
  assert.match(leaveSessionConfirmText('brief', 'new'), /未处理的章纲/);
  assert.match(leaveSessionConfirmText('both', 'new'), /新建会话/);
});

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type SessionContextApi = ReturnType<typeof useChatSessionContext>;

let harness: {
  state: ReturnType<typeof useChatWindowState>;
  api: SessionContextApi;
} | null = null;

function LeaveGuardHarness({
  assistantSessionId,
  onAssistantSessionChange,
  confirmLeave,
}: {
  assistantSessionId: number | null;
  onAssistantSessionChange: (id: number | null) => void;
  confirmLeave?: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const state = useChatWindowState({
    projectPath: null,
    currentFile: null,
    assistantSessionId,
  });
  const api = useChatSessionContext(
    state,
    { projectPath: null, currentFile: null, assistantSessionId, onAssistantSessionChange },
    { confirmLeave },
  );
  harness = { state, api };
  return null;
}

function mountHarness(props: {
  assistantSessionId: number | null;
  onAssistantSessionChange: (id: number | null) => void;
  confirmLeave?: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  harness = null;
  act(() => root.render(<LeaveGuardHarness {...props} />));
  assert.ok(harness);
  return {
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function controllableConfirm(calls: ConfirmOptions[]) {
  let resolveConfirm: (value: boolean) => void = () => undefined;
  const confirmLeave = (options: ConfirmOptions) => {
    calls.push(options);
    return new Promise<boolean>((resolve) => {
      resolveConfirm = resolve;
    });
  };
  return {
    confirmLeave,
    answer: (value: boolean) => resolveConfirm(value),
  };
}

afterEach(() => {
  harness = null;
});

test('补丁待确认时切会话先弹确认，取消不切换、确认才切换', async () => {
  const changes: Array<number | null> = [];
  const confirmCalls: ConfirmOptions[] = [];
  const { confirmLeave, answer } = controllableConfirm(confirmCalls);
  const mounted = mountHarness({
    assistantSessionId: null,
    onAssistantSessionChange: (id) => changes.push(id),
    confirmLeave,
  });
  try {
    assert.ok(harness);
    act(() => harness?.state.setAgentRun(waitingRun));

    act(() => harness?.api.handleSelectSession(2));
    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0]?.message ?? '', /未处理的修订/);
    assert.match(confirmCalls[0]?.message ?? '', /编辑器 diff/);
    assert.deepEqual(changes, []);

    await act(async () => answer(false));
    assert.deepEqual(changes, []);

    act(() => harness?.api.handleSelectSession(2));
    assert.equal(confirmCalls.length, 2);
    await act(async () => answer(true));
    assert.deepEqual(changes, [2]);
  } finally {
    mounted.cleanup();
  }
});

test('章纲待确认时新建会话：取消保留现场，确认后才清空并进入新会话', async () => {
  const changes: Array<number | null> = [];
  const confirmCalls: ConfirmOptions[] = [];
  const { confirmLeave, answer } = controllableConfirm(confirmCalls);
  const mounted = mountHarness({
    assistantSessionId: null,
    onAssistantSessionChange: (id) => changes.push(id),
    confirmLeave,
  });
  try {
    assert.ok(harness);
    act(() => {
      harness?.state.setChapterBrief(pendingBrief);
      harness?.state.setMessages([{ role: 'user', content: '前文' }]);
    });

    // 取消：消息与章纲都保留，不发出会话切换。
    let result: boolean | Promise<boolean> | undefined;
    act(() => {
      result = harness?.api.handleNewSession();
    });
    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0]?.message ?? '', /未处理的章纲/);
    await act(async () => answer(false));
    assert.equal(await result, false);
    assert.equal(harness?.state.messages.length, 1);
    assert.equal(harness?.state.chapterBrief, pendingBrief);
    assert.deepEqual(changes, []);

    // 确认：清空本地现场并通知外层进入新会话。
    act(() => {
      result = harness?.api.handleNewSession();
    });
    await act(async () => answer(true));
    assert.equal(await result, true);
    assert.equal(harness?.state.messages.length, 0);
    assert.equal(harness?.state.chapterBrief, null);
    assert.deepEqual(changes, [null]);
  } finally {
    mounted.cleanup();
  }
});

test('无待确认内容时切会话/新建直接执行，不弹确认', () => {
  const changes: Array<number | null> = [];
  const confirmCalls: ConfirmOptions[] = [];
  const { confirmLeave } = controllableConfirm(confirmCalls);
  const mounted = mountHarness({
    assistantSessionId: null,
    onAssistantSessionChange: (id) => changes.push(id),
    confirmLeave,
  });
  try {
    act(() => harness?.api.handleSelectSession(3));
    act(() => harness?.api.handleNewSession());
    assert.equal(confirmCalls.length, 0);
    assert.deepEqual(changes, [3, null]);
  } finally {
    mounted.cleanup();
  }
});

test('未接确认设施时有待确认内容则阻止离开并提示', () => {
  const changes: Array<number | null> = [];
  const toasts: string[] = [];
  const onToast = (event: Event) => {
    toasts.push((event as CustomEvent<{ message: string }>).detail.message);
  };
  window.addEventListener(TOAST_EVENT, onToast);
  const mounted = mountHarness({
    assistantSessionId: null,
    onAssistantSessionChange: (id) => changes.push(id),
  });
  try {
    act(() => harness?.state.setAgentRun(waitingRun));
    act(() => harness?.api.handleSelectSession(2));
    assert.deepEqual(changes, []);
    assert.match(toasts[0] ?? '', /待确认/);
  } finally {
    mounted.cleanup();
    window.removeEventListener(TOAST_EVENT, onToast);
  }
});
