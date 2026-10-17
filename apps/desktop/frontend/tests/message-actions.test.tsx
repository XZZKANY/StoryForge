/**
 * 单条消息的操作（作者 10-17 巡检：复制、重新生成都没有）。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import { MessageList } from '../src/components/chat-window/panels';
import type { Message } from '../src/components/chat-window/types';
import { emitToast } from '../src/lib/toast';

vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGES: Message[] = [
  { role: 'user', content: '帮我看看第 5 章结尾' },
  { role: 'assistant', content: '结尾停在动作上。' },
  { role: 'user', content: '换个意象再说一次' },
  { role: 'assistant', content: '可以换成**一道拖痕**。' },
];

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

function render(messages: Message[], onRegenerate?: (text: string) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MessageList
        messages={messages}
        agentRun={null}
        agentRunRecovery={null}
        onRegenerate={onRegenerate}
      />,
    ),
  );
  return container;
}

test('每条 AI 回复都能复制；只有最后一条能重新生成，用的是它前面那句作者的话', () => {
  const onRegenerate = vi.fn();
  const container = render(MESSAGES, onRegenerate);
  assert.equal(container.querySelectorAll('[data-testid="message-copy"]').length, 2);
  const regenerate = container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="message-regenerate"]',
  );
  assert.equal(regenerate.length, 1);
  act(() => regenerate[0]!.click());
  assert.deepEqual(onRegenerate.mock.calls[0], ['换个意象再说一次']);
});

test('AI 正在跑（不给 onRegenerate）时不出「重新生成」；还在流式输出的回复不出操作', () => {
  const container = render([
    ...MESSAGES.slice(0, 3),
    { role: 'assistant', content: '正在写', stream: { phase: 'streaming' } } as Message,
  ]);
  assert.equal(container.querySelectorAll('[data-testid="message-regenerate"]').length, 0);
  assert.equal(container.querySelectorAll('[data-testid="message-copy"]').length, 1);
});

test('复制把回复原文放进剪贴板并提示', async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const container = render(MESSAGES);
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>('[data-testid="message-copy"]')[1]!.click(),
  );
  assert.deepEqual(writeText.mock.calls[0], ['可以换成**一道拖痕**。']);
  assert.equal(vi.mocked(emitToast).mock.calls.at(-1)?.[0], '已复制这条回复');
});
