import { act } from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { BookOverview, type BookOverviewProps } from '../src/components/app/BookOverview';
import { emptyBookProfile } from '../src/lib/book-profile';
import type { BookProfileHandle } from '../src/components/app/useBookProfile';
import type { BookContextHandle } from '../src/components/app/useBookContext';
import type { BookOverviewChaptersHandle } from '../src/components/app/useBookOverviewChapters';
import { executeIdeCommand } from '../src/lib/api/ide-commands';

// 总览按「下一章」向 book.context 要上一章结尾；默认没有上一章，个别用例自己给。
vi.mock('../src/lib/api/ide-commands', () => ({
  executeIdeCommand: vi.fn(async () => ({
    command_id: 'book.context',
    status: 'accepted',
    payload: { book_context: { chapters: [], previous_chapter: null } },
  })),
}));
const mockedExecute = vi.mocked(executeIdeCommand);

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

test('长篇总览只展示当前章附近的八章，查看全部进入手稿视图且不丢数量', async () => {
  root = createRoot(host);
  const openWorkspace = vi.fn();
  const openManuscript = vi.fn();
  const chapters = Array.from({ length: 100 }, (_, index) => ({
    ordinal: index + 1,
    relativePath: `正文/${String(index + 1).padStart(3, '0')}.md`,
    name: `第${index + 1}章.md`,
    estimatedChars: 100 + index,
    path: `D:/book/正文/${String(index + 1).padStart(3, '0')}.md`,
  }));
  const chapterIndex: BookOverviewChaptersHandle = {
    chapters,
    currentChapter: chapters[49],
    status: 'available',
    error: null,
    refreshing: false,
    refresh: vi.fn(),
  };
  await render({
    chapters: chapterIndex,
    onContinueWriting: openWorkspace,
    onOpenAllChapters: openManuscript,
    onOpenChapter: vi.fn(),
  });

  const rows = host.querySelectorAll<HTMLButtonElement>(
    '[data-testid="book-overview-chapter-row"]',
  );
  assert.equal(rows.length, 8);
  assert.equal(rows[0].textContent?.includes('第46章'), true);
  assert.equal(rows[7].textContent?.includes('第53章'), true);
  assert.equal(
    host
      .querySelector('[data-testid="book-overview-recent-chapters"]')
      ?.textContent?.includes('100 章'),
    true,
  );
  const viewAll = host.querySelector<HTMLButtonElement>(
    '[data-testid="book-overview-view-all-chapters"]',
  );
  assert.ok(viewAll);
  await act(async () => viewAll!.click());
  assert.deepEqual(openManuscript.mock.calls.at(-1), []);
  assert.equal(openWorkspace.mock.calls.length, 0);
});
test('无有效当前章节时接着写阅读序最新一章，不打开不存在的路径', async () => {
  root = createRoot(host);
  const open = vi.fn();
  const bookContext = context();
  bookContext.snapshot!.currentRelativePath = '不存在.md';
  await render({ context: bookContext, onContinueWriting: open });
  const button = host.querySelector<HTMLButtonElement>('[data-testid="book-overview-continue"]')!;
  expect(button.textContent).toContain('继续写第 2 章');
  await act(async () => button.click());
  expect(open).toHaveBeenCalledWith('正文/02.md');
  expect(open).not.toHaveBeenCalledWith('不存在.md');
  expect(host.textContent).toContain('从最新的第 2 章');
});

test('空手稿时主按钮只聚焦章节列表，不打开假章节', async () => {
  root = createRoot(host);
  const open = vi.fn();
  const emptyContext = context();
  emptyContext.snapshot!.chapters = [];
  emptyContext.snapshot!.currentRelativePath = null;
  await render({ context: emptyContext, onContinueWriting: open });
  const button = host.querySelector<HTMLButtonElement>('[data-testid="book-overview-continue"]')!;
  expect(button.textContent).toContain('选择章节开始');
  await act(async () => button.click());
  expect(open).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    host.querySelector('[data-testid="book-overview-recent-chapters"]'),
  );
});

test('本地章节索引没有字数时照抄底座同一章的估值，不显示「字数未知」', async () => {
  root = createRoot(host);
  const chapterIndex: BookOverviewChaptersHandle = {
    chapters: [
      {
        ordinal: 1,
        relativePath: '正文/01.md',
        name: '01.md',
        path: 'D:/book/正文/01.md',
        modified: 1,
        size: 600,
        estimatedChars: null,
      },
      {
        ordinal: 2,
        relativePath: '正文\\02.md',
        name: '02.md',
        path: 'D:/book/正文/02.md',
        modified: 1,
        size: 900,
        estimatedChars: null,
      },
      {
        ordinal: 3,
        relativePath: '正文/03.md',
        name: '03.md',
        path: 'D:/book/正文/03.md',
        modified: 1,
        size: 0,
        estimatedChars: null,
      },
    ],
    currentChapter: null,
    status: 'available',
    error: null,
    refreshing: false,
    refresh: vi.fn(),
  };
  await render({ chapters: chapterIndex });
  const rows = [
    ...host.querySelectorAll<HTMLButtonElement>('[data-testid="book-overview-chapter-row"]'),
  ].map((row) => row.textContent ?? '');
  expect(rows[0]).toContain('约 200 字');
  expect(rows[1]).toContain('约 300 字');
  // 底座里没有这一章就如实说不知道，不拿文件字节数冒充字数。
  expect(rows[2]).toContain('字数未知');
});

test('接着写最新一章时 hero 引用上一章结尾并提久未回收的伏笔', async () => {
  root = createRoot(host);
  mockedExecute.mockResolvedValueOnce({
    command_id: 'book.context',
    status: 'accepted',
    payload: {
      book_context: {
        chapters: [],
        previous_chapter: {
          relative_path: '正文/02.md',
          tail: '他推开门。\n\n门外什么都没有，只有雨。',
        },
      },
    },
  } as unknown as Awaited<ReturnType<typeof executeIdeCommand>>);
  const bookContext = context();
  bookContext.snapshot!.currentRelativePath = null;
  await render({
    context: bookContext,
    promises: {
      currentChapter: 2,
      ledger: [
        {
          id: 'p1',
          title: '旧伤',
          status: 'planted',
          kind: 'foreshadow',
          plantedChapter: 1,
          dueChapter: 3,
          resolvedChapter: null,
          lastTouchChapter: 1,
          issues: [],
        },
      ],
    },
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockedExecute).toHaveBeenCalledWith('book.context', {
    project_root: 'D:/book',
    current_file: '正文/第003章.md',
  });
  const handoff = host.querySelector('[data-testid="book-overview-handoff"]');
  expect(handoff?.textContent).toContain('第 2 章停在这里');
  expect(handoff?.textContent).toContain('门外什么都没有，只有雨。');
  expect(handoff?.textContent).toContain('还有一条线没收：「旧伤」第 1 章埋下，计划第 3 章回收');
});

test('总览不在前台（章节索引未激活）时不去取上一章结尾', async () => {
  root = createRoot(host);
  mockedExecute.mockClear();
  const inactive: BookOverviewChaptersHandle = {
    chapters: [],
    currentChapter: null,
    status: 'unavailable',
    error: null,
    refreshing: false,
    refresh: vi.fn(),
  };
  await render({ chapters: inactive });
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockedExecute).not.toHaveBeenCalled();
});

test('当前页签是前面某章时不引用最新一章的结尾', async () => {
  root = createRoot(host);
  mockedExecute.mockResolvedValueOnce({
    command_id: 'book.context',
    status: 'accepted',
    payload: {
      book_context: {
        chapters: [],
        previous_chapter: { relative_path: '正文/02.md', tail: '最新一章的结尾。' },
      },
    },
  } as unknown as Awaited<ReturnType<typeof executeIdeCommand>>);
  const bookContext = context();
  bookContext.snapshot!.currentRelativePath = '正文/01.md';
  await render({ context: bookContext });
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="book-overview-handoff"]')).toBeNull();
  expect(host.textContent).toContain('继续写第 1 章');
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
  expect(host.textContent).not.toContain('9,999');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="book-overview-refresh"]')!.click(),
  );
  expect(refresh).toHaveBeenCalledOnce();
});

test('章节列表卡与 hero 都暴露「AI 起草下一章」入口并按最大章号推导下一章', async () => {
  root = createRoot(host);
  const draft = vi.fn();
  await render({ onDraftNextChapter: draft });

  const hero = host.querySelector<HTMLButtonElement>(
    '[data-testid="book-overview-hero-draft-next"]',
  );
  expect(hero?.textContent).toContain('AI 起草第 3 章');
  const next = host.querySelector<HTMLButtonElement>('[data-testid="book-overview-draft-next"]');
  // fixture 手稿有第 1、2 章，下一章应为第 3 章。
  expect(next?.textContent).toContain('AI 起草下一章 · 第 3 章');

  await act(async () => hero!.click());
  await act(async () => next!.click());
  expect(draft).toHaveBeenCalledTimes(2);
});

test('空章节索引时提供「让 AI 起草第 1 章」入口', async () => {
  root = createRoot(host);
  const draft = vi.fn();
  const emptyIndex: BookOverviewChaptersHandle = {
    chapters: [],
    currentChapter: null,
    status: 'available',
    error: null,
    refreshing: false,
    refresh: vi.fn(),
  };
  const emptyContext = context();
  emptyContext.snapshot!.chapters = [];
  await render({ chapters: emptyIndex, context: emptyContext, onDraftNextChapter: draft });

  const first = host.querySelector<HTMLButtonElement>('[data-testid="book-overview-draft-first"]');
  expect(first?.textContent).toContain('让 AI 起草第 1 章');
  expect(host.querySelector('[data-testid="book-overview-draft-next"]')).toBeNull();
  await act(async () => first!.click());
  expect(draft).toHaveBeenCalledOnce();
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

// D2/D5：载入中把「一行裸文字」换成形状骨架，镜像 hero 两卡的布局，加载结束不跳动；
// 骨架是装饰（aria-hidden），语义由外层 aria-busy + sr-only「正在读取」承载。
test('载入中显示形状骨架、区域标记 aria-busy，骨架本身对屏幕阅读器隐藏', async () => {
  root = createRoot(host);
  const data = profile();
  data.loading = true;
  await render({ profile: data });

  const region = host.querySelector('[data-testid="book-overview"]');
  expect(region?.getAttribute('aria-busy')).toBe('true');

  const skeleton = host.querySelector('[data-testid="book-overview-skeleton"]');
  expect(skeleton).toBeTruthy();
  expect(host.querySelector('[data-testid="book-overview-hero"]')).toBeNull();
  expect(host.querySelector('[data-testid="book-overview-continue"]')).toBeNull();
  // 骨架只供肉眼，整块对屏幕阅读器隐藏；里面每个占位块都用 .skeleton。
  expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  expect(skeleton!.querySelectorAll('.skeleton').length).toBeGreaterThan(4);
  // 屏幕阅读器的语义落在 sr-only 的「正在读取」上。
  const status = host.querySelector('[role="status"]');
  expect(status?.textContent).toContain('正在读取');
  expect(status?.className).toContain('sr-only');

  // 加载结束后骨架与 busy 都消失（重渲染到非 loading 态）。
  const settled = profile();
  settled.loading = false;
  await act(async () =>
    root.render(
      <BookOverview
        projectPath="D:/book"
        profile={settled}
        context={context()}
        onContinueWriting={() => {}}
      />,
    ),
  );
  expect(host.querySelector('[data-testid="book-overview-skeleton"]')).toBeNull();
  expect(host.querySelector('[data-testid="book-overview-hero"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="book-overview"]')?.getAttribute('aria-busy')).toBe(
    'false',
  );
});

test('档案与大纲失败明确报错并可重试，不显示未填写的空状态', async () => {
  root = createRoot(host);
  const data = profile();
  data.profileError = '档案无读取权限';
  data.outlineError = '大纲读取失败';
  const refresh = vi.fn();
  await render({ profile: data, onRefresh: refresh });
  expect(host.textContent).toContain('档案无读取权限');
  expect(host.textContent).toContain('大纲读取失败');
  expect(host.textContent).not.toContain('还没有简介');
  expect(host.textContent).not.toContain('尚未添加题材标签');
  expect(host.textContent).not.toContain('还没有可展示的大纲标题');
  expect(host.querySelector('[data-testid="book-overview-progress-bar"]')).toBeNull();
  const retry = host.querySelector<HTMLButtonElement>(
    '[data-testid="book-overview-retry-profile"]',
  );
  expect(retry).toBeTruthy();
  await act(async () => retry!.click());
  expect(refresh).toHaveBeenCalledOnce();
});

test('大纲读取中不声称为空，字数失败不把旧进度当成当前统计', async () => {
  root = createRoot(host);
  const data = profile();
  data.outlineLoading = true;
  data.totalsError = '统计读取失败';
  await render({ profile: data });
  const outline = host.querySelector('[data-testid="book-overview-outline"]');
  expect(outline?.textContent).toContain('正在读取大纲');
  expect(outline?.textContent).not.toContain('还没有可展示');
  expect(host.querySelector('[data-testid="book-overview-progress"]')?.textContent).toContain(
    '上次统计',
  );
  expect(host.querySelector('[data-testid="book-overview-progress-bar"]')).toBeNull();
});
