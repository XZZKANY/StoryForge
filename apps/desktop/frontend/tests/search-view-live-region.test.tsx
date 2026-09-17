/**
 * D5 状态变化反馈：搜索是异步的，结果文本会动态翻转
 * （空 → 搜索中… → N 处 · M 个文件 / 没有匹配的内容。）。
 * 这些变化必须被屏幕阅读器感知——否则读屏作者发起搜索后完全不知道何时有结果。
 *
 * 本测试钉死：
 *  1. 常驻 live region（role=status）随状态翻转播报正确措辞；
 *  2. 失败态不重复进 live region，而是走 role=alert 另行打断。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { SearchView } from '../src/components/shell/SearchView';
import type { useProjectSearch } from '../src/components/app/useProjectSearch';
import type { SearchFileResult } from '../src/lib/project-search';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.appendChild(host);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host.innerHTML = '';
});

type SearchHandle = ReturnType<typeof useProjectSearch>;

function search(overrides: Partial<SearchHandle> = {}): SearchHandle {
  return {
    query: '离别',
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
  };
}

function results(): SearchFileResult[] {
  return [
    { path: '正文/01.md', hits: [], truncated: false },
    { path: '正文/02.md', hits: [], truncated: false },
  ];
}

async function render(handle: SearchHandle) {
  root ??= createRoot(host);
  await act(async () =>
    root.render(
      <SearchView search={handle} projectOpen={true} active={true} onOpenHit={() => {}} />,
    ),
  );
}

const live = () => host.querySelector('[data-testid="search-live"]');

test('搜索中广播「正在搜索正文…」，收尾广播总命中数与文件数', async () => {
  root = createRoot(host);
  await render(search({ status: 'searching' }));
  // 搜索进行中：live region 报「正在搜索」，且语义上是对读屏温和的 status。
  expect(live()?.getAttribute('role')).toBe('status');
  expect(live()?.textContent).toBe('正在搜索正文…');
  // 无结果时也不空口说「完成」。
  expect(live()?.textContent).not.toContain('搜索完成');

  // 收尾：命中 2 处、跨 2 个文件 → 播报完整结果数。
  await render(search({ status: 'done', totalHits: 2, results: results() }));
  expect(live()?.textContent).toContain('搜索完成');
  expect(live()?.textContent).toContain('2 处');
  expect(live()?.textContent).toContain('2 个文件');
});

test('零命中广播「没有匹配的内容。」，达上限时补充说明', async () => {
  root = createRoot(host);
  await render(search({ status: 'done', totalHits: 0, results: [] }));
  expect(live()?.textContent).toBe('没有匹配的内容。');

  await render(search({ status: 'done', totalHits: 40, results: results(), capped: true }));
  expect(live()?.textContent).toContain('40 处');
  expect(live()?.textContent).toContain('已达上限');
});

test('搜索失败走 role=alert 打断，不混入 polite live region', async () => {
  root = createRoot(host);
  await render(search({ status: 'error', error: '磁盘不可读' }));
  // 失败：可见错误块是 alert（打断级），并把原始报错降级为细节。
  const alert = host.querySelector('[data-testid="search-error"]');
  expect(alert?.getAttribute('role')).toBe('alert');
  expect(alert?.textContent).toContain('搜索失败');
  expect(alert?.textContent).toContain('磁盘不可读');
  // live region 不重复播报失败，避免同一件事被念两遍。
  expect(live()?.textContent).toBe('');
});

test('查询不足最小长度或项目未打开时不播报（没有可报告的状态）', async () => {
  root = createRoot(host);
  // 一个字符：未达 SEARCH_MIN_QUERY，此时根本不会发起搜索。
  await render(search({ query: '离', status: 'idle' }));
  expect(live()?.textContent).toBe('');
  // 项目未打开：提示「打开项目后可搜索」，不播报结果。
  await act(async () =>
    root.render(
      <SearchView search={search()} projectOpen={false} active={true} onOpenHit={() => {}} />,
    ),
  );
  expect(live()?.textContent).toBe('');
});
