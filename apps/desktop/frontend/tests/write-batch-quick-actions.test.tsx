/**
 * 批量写章确认卡开着时，总览上的「AI 起草下一章」藏起来（免得和这一批抢着写），卡关掉就回来。
 * 卡开没开由常驻对话窗口经 lib/write-batch-card 告诉壳层；这里直接拨那个开关，看真 App 的接线。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { setWriteBatchCardOpen } from '../src/lib/write-batch-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/components/editor/Editor', () => ({ Editor: () => null }));
vi.mock('../src/components/chat-window/ChatWindow', () => ({ ChatWindow: () => null }));

// 冷启动要编整个 App，满载时会越过默认 5 秒。
test('卡开着时总览不出「AI 起草下一章」，卡关掉恢复', { timeout: 30_000 }, async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"detail":"offline test"}', { status: 503 })),
  );
  localStorage.clear();
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['D:/quick-actions-test']));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const draftNext = () => host.querySelector('[data-testid="book-overview-hero-draft-next"]');
  try {
    await act(async () => root.render(<App />));
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('quick-actions-test'))!
        .click(),
    );
    expect(draftNext()).not.toBeNull();
    await act(async () => setWriteBatchCardOpen(true));
    expect(draftNext()).toBeNull();
    await act(async () => setWriteBatchCardOpen(false));
    expect(draftNext()).not.toBeNull();
  } finally {
    setWriteBatchCardOpen(false);
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
