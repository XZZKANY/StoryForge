import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';

import { MessageList } from '../src/components/chat-window/panels';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderList(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  conversationScope = 0,
) {
  return (
    <MessageList
      messages={messages}
      conversationScope={conversationScope}
      agentRun={null}
      agentRunRecovery={null}
      writingRunProjection={null}
    />
  );
}

function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  });
  if (!Object.prototype.hasOwnProperty.call(element, 'scrollTop')) {
    let top = 0;
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, element.scrollHeight - element.clientHeight));
      },
    });
  }
}

test('MessageList 仅在接近底部时跟随流式追加，上滚后显示回底部入口', () => {
  const host = document.createElement('div');
  const composerInput = document.createElement('input');
  document.body.append(host, composerInput);
  const root = createRoot(host);
  try {
    act(() => root.render(renderList([{ role: 'assistant', content: '第一条' }])));
    const scroll = host.querySelector<HTMLElement>('[data-testid="message-list-scroll"]');
    assert.ok(scroll);
    setScrollMetrics(scroll, 100, 100);

    setScrollMetrics(scroll, 200, 100);
    act(() =>
      root.render(
        renderList([
          { role: 'assistant', content: '第一条' },
          { role: 'assistant', content: '第二条' },
        ]),
      ),
    );
    assert.equal(scroll.scrollTop, 100);
    assert.equal(host.querySelector('[data-testid="message-list-new-content"]'), null);

    composerInput.focus();
    scroll.scrollTop = 10;
    act(() => scroll.dispatchEvent(new Event('scroll')));
    setScrollMetrics(scroll, 300, 100);
    act(() =>
      root.render(
        renderList([
          { role: 'assistant', content: '第一条' },
          { role: 'assistant', content: '第二条' },
          { role: 'assistant', content: '第三条' },
        ]),
      ),
    );
    const unread = host.querySelector<HTMLButtonElement>(
      '[data-testid="message-list-new-content"]',
    );
    assert.ok(unread);
    assert.equal(scroll.scrollTop, 10);

    // happy-dom 的 scrollTo 是空 stub（不动 scrollTop）：此 stub 把平滑滚动落地为动画跑完后的终态。
    const smoothScroll = vi.fn((options: ScrollToOptions) => {
      scroll.scrollTop = Number(options.top ?? 0);
    });
    Object.defineProperty(scroll, 'scrollTo', { configurable: true, value: smoothScroll });
    act(() => {
      unread.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      unread.click();
    });
    assert.deepEqual(smoothScroll.mock.calls[0]?.[0], { top: 300, behavior: 'smooth' });
    assert.equal(scroll.scrollTop, 200);
    assert.equal(host.querySelector('[data-testid="message-list-new-content"]'), null);
    assert.equal(document.activeElement, composerInput);
  } finally {
    act(() => root.unmount());
    host.remove();
    composerInput.remove();
  }
});

test('长会话首次打开在底部；切换会话重置阅读意图而不是重建消息节点', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  const total = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(600);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(renderList([{ role: 'assistant', content: '打开已有长会话' }])));
    const scroll = host.querySelector<HTMLElement>('[data-testid="message-list-scroll"]')!;
    assert.equal(scroll.scrollTop, 600); // happy-dom default setter does not clamp
    setScrollMetrics(scroll, 600, 100);
    scroll.scrollTop = 10;
    act(() => scroll.dispatchEvent(new Event('scroll')));
    act(() => root.render(renderList([{ role: 'assistant', content: '旧会话的新内容' }])));
    assert.equal(scroll.scrollTop, 10);
    assert.ok(host.querySelector('[data-testid="message-list-new-content"]'));
    act(() => root.render(renderList([{ role: 'assistant', content: '新会话' }], 1)));
    assert.equal(host.querySelector('[data-testid="message-list-scroll"]'), scroll);
    assert.equal(scroll.scrollTop, 500);
    assert.equal(host.querySelector('[data-testid="message-list-new-content"]'), null);
  } finally {
    act(() => root.unmount());
    host.remove();
    height.mockRestore();
    total.mockRestore();
  }
});

test('流式修改同一消息、异步内容高度与隐藏后恢复跟随底部；上滚意图不被 resize 抢走', () => {
  let onResize: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        onResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const resize = () => onResize?.([], {} as ResizeObserver);
  try {
    act(() => root.render(renderList([{ role: 'assistant', content: '流式' }])));
    const scroll = host.querySelector<HTMLElement>('[data-testid="message-list-scroll"]')!;
    setScrollMetrics(scroll, 500, 100);
    act(resize);
    assert.equal(scroll.scrollTop, 400);
    setScrollMetrics(scroll, 700, 100);
    act(() => root.render(renderList([{ role: 'assistant', content: '流式追加内容' }])));
    assert.equal(scroll.scrollTop, 600);
    setScrollMetrics(scroll, 900, 100);
    act(resize); // e.g. Markdown font/image/layout completion, no message count change
    assert.equal(scroll.scrollTop, 800);
    scroll.scrollTop = 30;
    act(() => scroll.dispatchEvent(new Event('scroll')));
    setScrollMetrics(scroll, 0, 0);
    act(() => {
      scroll.dispatchEvent(new Event('scroll'));
      resize();
    });
    setScrollMetrics(scroll, 1000, 100);
    act(resize);
    assert.equal(scroll.scrollTop, 30);
    act(() => root.render(renderList([{ role: 'assistant', content: '后台生成的新内容' }])));
    assert.ok(host.querySelector('[data-testid="message-list-new-content"]'));
    assert.equal(observe.mock.calls.length, 2);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
  assert.equal(disconnect.mock.calls.length, 1);
});

test('键盘激活返回最新后将焦点留在消息区域，而不是被移除的按钮', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(renderList([{ role: 'assistant', content: '第一条' }])));
    const scroll = host.querySelector<HTMLElement>('[data-testid="message-list-scroll"]')!;
    setScrollMetrics(scroll, 500, 100);
    scroll.scrollTop = 10;
    act(() => scroll.dispatchEvent(new Event('scroll')));
    act(() => root.render(renderList([{ role: 'assistant', content: '新内容' }])));
    const latest = host.querySelector<HTMLButtonElement>(
      '[data-testid="message-list-new-content"]',
    )!;
    latest.focus();
    // 同上：happy-dom 不实现 scrollTo，stub 为平滑滚动完成后的终态位移。
    Object.defineProperty(scroll, 'scrollTo', {
      configurable: true,
      value: (options: ScrollToOptions) => {
        scroll.scrollTop = Number(options.top ?? 0);
      },
    });
    act(() => latest.click());
    assert.equal(document.activeElement, scroll);
    assert.equal(scroll.scrollTop, 400);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
