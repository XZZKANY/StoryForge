import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, test, vi } from 'vitest';

import { SearchView } from '../src/components/shell/SearchView';

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const current = mounted.pop();
    if (!current) continue;
    act(() => current.root.unmount());
    current.container.remove();
  }
});

function searchState(overrides: Record<string, unknown> = {}) {
  return {
    unreadableCount: 0,
    query: '',
    setQuery: vi.fn(),
    caseSensitive: false,
    setCaseSensitive: vi.fn(),
    results: [],
    status: 'idle',
    error: '',
    capped: false,
    totalHits: 0,
    rerun: vi.fn(),
    ...overrides,
  } as never;
}

test('搜索输入和空态提供可感知的状态语义', () => {
  const html = renderToStaticMarkup(
    <SearchView search={searchState()} projectOpen active={false} onOpenHit={() => undefined} />,
  );
  assert.match(html, /aria-label="搜索项目正文"/);
  assert.match(html, /搜索正文内容；文件名请用命令面板/);
  assert.match(html, /role="status"/);
});

test('搜索失败状态提供 assertive 提示和重试入口', () => {
  const html = renderToStaticMarkup(
    <SearchView
      search={searchState({ status: 'error', error: '读取失败' })}
      projectOpen
      active={false}
      onOpenHit={() => undefined}
    />,
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(html, />重试</);
});

test('清空搜索后焦点留在输入框，便于继续输入', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <SearchView
        search={searchState({ query: '雾港' })}
        projectOpen
        active={false}
        onOpenHit={() => undefined}
      />,
    );
  });
  const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
  const clear = container.querySelector('[data-testid="search-clear"]') as HTMLButtonElement;
  await act(async () => clear.click());
  assert.equal(document.activeElement, input);
});

test('文件结果折叠按钮关联稳定分组并同步 hidden 状态', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <SearchView
        search={searchState({
          query: '雾港',
          results: [
            {
              path: 'D:/连载/雾港/第一章.md',
              hits: [{ line: 3, text: '雾港灯火', start: 0, end: 2 }],
              truncated: false,
            },
          ],
          totalHits: 1,
        })}
        projectOpen
        active={false}
        onOpenHit={() => undefined}
      />,
    );
  });

  const toggle = container.querySelector<HTMLButtonElement>('[aria-controls^="search-results-"]');
  assert.ok(toggle);
  const resultGroupId = toggle.getAttribute('aria-controls');
  assert.ok(resultGroupId);
  const resultGroup = container.querySelector<HTMLElement>(`#${CSS.escape(resultGroupId)}`);
  assert.ok(resultGroup);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(resultGroup.getAttribute('role'), 'group');
  assert.equal(resultGroup.hidden, false);

  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(resultGroup.hidden, true);
});
