import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test } from 'vitest';

import { ChatWindowView } from '../../src/components/chat-window/ChatWindowView';
import type { ChatWindowState } from '../../src/components/chat-window/useChatWindowState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let submitCalls = 0;

function state(status: 'waiting' | 'completed'): ChatWindowState {
  return {
    conversationTitle: '测试会话',
    assistantSessions: [],
    sessionLoadError: null,
    messages: [],
    projectName: '测试项目',
    contextRef: '正文/第01章.md',
    agentRun: {
      id: 'run-1',
      sessionId: 'run-1',
      goal: '改稿',
      status,
      steps: [
        {
          id: 'approval',
          title: '等待作者确认',
          tool: 'author.approval',
          status: status === 'waiting' ? 'waiting' : 'completed',
          detail: '',
          filePath: 'D:/book/正文/第01章.md',
          patchId: 'patch-1',
        },
      ],
    },
    agentRunRecovery: null,
    writingRunProjection: null,
    explicitContextPaths: [],
    contextCandidates: [],
    contextCandidatesLoading: false,
    contextCandidatesError: null,
    contextPickerOpen: false,
    lastContextBundle: null,
    missingContextPaths: [],
    chapterBrief: null,
    retryRequest: null,
    agentBusy: false,
    input: '继续下一轮',
    setInput: () => undefined,
  } as unknown as ChatWindowState;
}

const controls = {
  onApprovePermission: () => undefined,
  onDenyPermission: () => undefined,
  onPauseRun: () => undefined,
  onResumeRun: () => undefined,
  onStopRun: () => undefined,
  onAcceptPatch: () => undefined,
  onRejectPatch: () => undefined,
};

function render(status: 'waiting' | 'completed') {
  root.render(
    <ChatWindowView
      state={state(status)}
      projectPath="D:/book"
      assistantSessionId={7}
      layoutMode="balanced"
      onSetLayoutMode={() => undefined}
      onOpenObservatory={() => undefined}
      observatoryAttention={false}
      agentPermissionProfile="ask"
      onAgentPermissionProfileChange={() => undefined}
      handleSelectSession={() => undefined}
      handleNewSession={() => undefined}
      retryAssistantSessionLoad={() => undefined}
      retryContextCandidates={() => undefined}
      addExplicitContext={() => undefined}
      togglePinnedContext={() => undefined}
      handleSubmit={async () => {
        submitCalls += 1;
      }}
      handleComposerSubmit={async () => undefined}
      userMessageHistory={[]}
      retryLastFailedRun={() => undefined}
      agentRunControls={controls}
    />,
  );
}

beforeEach(() => {
  submitCalls = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('待确认补丁存在时 Composer 不能静默启动新一轮', async () => {
  await act(async () => render('waiting'));
  const submit = container.querySelector('[data-testid="composer-submit"]') as HTMLButtonElement;
  assert.ok(submit);

  await act(async () => submit.click());
  assert.equal(submitCalls, 0);

  await act(async () => render('completed'));
  await act(async () => {
    (container.querySelector('[data-testid="composer-submit"]') as HTMLButtonElement).click();
  });
  assert.equal(submitCalls, 1);
});
