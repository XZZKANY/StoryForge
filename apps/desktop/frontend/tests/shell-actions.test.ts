import { afterEach, expect, test, vi } from 'vitest';

import { shellActions } from '../src/components/app/shell-actions';
import { REQUEST_AGENT_PROMPT_EVENT, REQUEST_NEW_SESSION_EVENT } from '../src/lib/assistant-events';

function fakeShell() {
  const calls: string[] = [];
  const shell = {
    showRight: () => calls.push('showRight'),
    showSidebar: () => calls.push('showSidebar'),
    setLayoutMode: (mode: string) => calls.push(`layout:${mode}`),
  };
  return { calls, shell: shell as unknown as Parameters<typeof shellActions>[0] };
}

const listeners: Array<[string, EventListener]> = [];
function listen(type: string, listener: EventListener) {
  window.addEventListener(type, listener);
  listeners.push([type, listener]);
}
afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) window.removeEventListener(type, listener);
});

test('让 AI 查：先回到写作台、展开对话栏，再把话发进对话', () => {
  const { calls, shell } = fakeShell();
  const openWorkspace = vi.fn(() => calls.push('workspace'));
  const prompts: string[] = [];
  listen(REQUEST_AGENT_PROMPT_EVENT, (event) => {
    calls.push('prompt');
    prompts.push((event as CustomEvent<{ text: string }>).detail.text);
  });
  shellActions(shell, openWorkspace).onAskAgent('查一下');
  expect(calls).toEqual(['workspace', 'showRight', 'prompt']);
  expect(prompts).toEqual(['查一下']);
});

test('新建会话同样先展开对话栏；布局三条照旧', () => {
  const { calls, shell } = fakeShell();
  const actions = shellActions(shell, () => calls.push('workspace'));
  listen(REQUEST_NEW_SESSION_EVENT, () => calls.push('session'));
  actions.onNewSession();
  actions.onFocusAssistantOnly();
  actions.onFocusWorkspaceOnly();
  actions.onRestoreLayout();
  expect(calls).toEqual([
    'workspace',
    'showRight',
    'session',
    'workspace',
    'showRight',
    'layout:chat',
    'workspace',
    'showSidebar',
    'layout:editor',
    'workspace',
    'showSidebar',
    'layout:balanced',
  ]);
});
