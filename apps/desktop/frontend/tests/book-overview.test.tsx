import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { BookOverview, type BookOverviewProps } from '../src/components/app/BookOverview';
import { emptyBookProfile } from '../src/lib/book-profile';
import type { BookProfileHandle } from '../src/components/app/useBookProfile';
import type { BookContextHandle } from '../src/components/app/useBookContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.appendChild(host);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host.innerHTML = '';
});
function profile(): BookProfileHandle {
  return {
    profile: { ...emptyBookProfile(), title: '测试作品', wordGoal: 1000 },
    loading: false,
    save: vi.fn(async () => {}),
    pickCover: vi.fn(async () => {}),
    coverUrl: null,
    totals: { chars: 500, chapters: 2, unreadable: 0 },
    totalsError: null,
    outline: [],
    outlineDropped: 0,
    notes: [],
    addNote: vi.fn(async () => {}),
    toggleNote: vi.fn(async () => {}),
    removeNote: vi.fn(async () => {}),
    refreshing: false,
    refresh: vi.fn(),
  };
}
function context(): BookContextHandle {
  return {
    availability: 'available',
    refreshing: false,
    refresh: vi.fn(),
    snapshot: {
      totalChapters: 2,
      totalEstimatedChars: 9999,
      currentRelativePath: '正文/02.md',
      currentOrdinal: 2,
      chapters: [
        { ordinal: 1, relativePath: '正文/01.md', name: '01.md', estimatedChars: 200 },
        { ordinal: 2, relativePath: '正文/02.md', name: '02.md', estimatedChars: 300 },
      ],
      skeleton: [],
      skeletonTotal: 0,
      skeletonLimit: 0,
      roster: [],
      rosterDeclaredTotal: 0,
      rosterLimit: 0,
      dossierRelativePath: null,
      previousChapter: null,
      promptBlock: null,
    },
  };
}
async function render(overrides: Partial<BookOverviewProps> = {}) {
  root ??= createRoot(host);
  await act(async () =>
    root.render(
      <BookOverview
        projectPath="D:/book"
        profile={profile()}
        context={context()}
        onContinueWriting={() => {}}
        {...overrides}
      />,
    ),
  );
}
test('总览进度使用真实扫描且章节按阅读序；继续写作只传当前章节', async () => {
  root = createRoot(host);
  const open = vi.fn();
  await render({ onContinueWriting: open, onOpenChapter: open });
  expect(
    host.querySelector<HTMLElement>('[data-testid="book-overview-progress-bar"]')?.style.width,
  ).toBe('50%');
  const rows = host.querySelectorAll<HTMLButtonElement>(
    '[data-testid="book-overview-chapter-row"]',
  );
  expect(rows[0].textContent).toContain('01.md');
  expect(rows[1].textContent).toContain('02.md');
  expect(host.textContent).not.toContain('最近章节');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="book-overview-continue"]')!.click(),
  );
  expect(open).toHaveBeenLastCalledWith('正文/02.md');
});
test('无有效当前章节时选择按钮可操作且只聚焦章节列表，不打开假章节', async () => {
  root = createRoot(host);
  const open = vi.fn();
  const bookContext = context();
  bookContext.snapshot!.currentRelativePath = '不存在.md';
  await render({ context: bookContext, onContinueWriting: open });
  const button = host.querySelector<HTMLButtonElement>('[data-testid="book-overview-continue"]')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(open).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    host.querySelector('[data-testid="book-overview-recent-chapters"]'),
  );
});
test('统计失败不混入模型估值，显示可重试的显式错误', async () => {
  root = createRoot(host);
  const data = profile();
  data.totals = null;
  data.totalsError = '读取失败';
  data.loading = true;
  const refresh = vi.fn();
  await render({ profile: data, onRefresh: refresh });
  expect(host.querySelector('[role="status"]')?.textContent).toContain('正在读取');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('统计失败');
  expect(host.querySelector('[data-testid="book-overview-progress-bar"]')).toBeNull();
  expect(host.querySelector('[data-testid="book-overview-progress"]')?.textContent).not.toContain(
    '9,999',
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="book-overview-refresh"]')!.click(),
  );
  expect(refresh).toHaveBeenCalledOnce();
});

test('总览暴露运行中或等待确认的 Agent，并可返回工作台', async () => {
  root = createRoot(host);
  const open = vi.fn();
  await render({
    agentRun: { projectPath: 'D:/book', status: 'waiting', goal: '检查第二章的连续性' },
    onOpenAgentRun: open,
  });
  const card = host.querySelector<HTMLButtonElement>('[data-testid="book-overview-agent-run"]');
  expect(card?.textContent).toContain('等待你的确认');
  expect(card?.textContent).toContain('检查第二章的连续性');
  await act(async () => card?.click());
  expect(open).toHaveBeenCalledOnce();
});
